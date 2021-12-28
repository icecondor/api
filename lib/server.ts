// nodejs
import * as crypto from 'crypto'

// npm
import moment from 'moment'
import * as geojsonArea from 'geojson-area'
import * as turfhelp from '@turf/helpers'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import * as stripeLib from 'stripe'

// local
import * as util from "./util"
import * as emailerLib from './email'
import * as nouns from './nouns'

var net = require('net')
var then_redis = require('then-redis')
var uuid = require('node-uuid');
var Promise = require('bluebird');

export default function(settings, db, protocol) {

  var server = new net.Server();
  var redis = then_redis.createClient();
  let stripe = stripeLib.default(settings.stripe.key);
  let emailer = emailerLib.factory(settings.email) as any

  server.timer = {
    mark: new Date(),
    hits: 0,
    reset: function() {
      this.mark = new Date()
      this.hits = 0
    }
  }

  server.clients = {
    list: [],
    add: function(client) {
      this.list.push(client)
    },
    remove: function(client) {
      var idx = this.list.indexOf(client)
      this.list.splice(idx, 1)
    }
  }

  function clog(client, msg) {
    let parts: string[] = []
    parts.push(new Date().toISOString())
    if (client.flags.authenticated) {
      var id_id = client.flags.authenticated.device_id.substr(0, 8) + ':' +
        client.flags.authenticated.user_id.substr(0, 8)
      parts.push(id_id)
    } else if (client.socket) {
      parts.push(client.socket.remoteAddress + ':' + client.socket.remotePort)
    }
    if (typeof msg !== "string") {
      parts.push(JSON.stringify(msg))
    } else {
      parts.push(msg)
    }
    console.log(parts.join(' '))
  }

  server.create_token_temp = function(params) {
    var token, key
    if (params.device_id == 'browser') {
      token = key = "browser_key-" + uuid.v4()
    } else {
      key = "device_key-" + uuid.v4()
      token = util.sha256(params.device_id + key)
    }
    // todo: session_key, use device_key for now
    var session_value = { device_id: params.device_id, email: params.email }
    return redis.hset("session_keys", token, JSON.stringify(session_value)).then(function() {
      return key
    }, function(e) {
      console.log('create_token_temp redis hset err', e)
    })
  }

  server.token_validate = function(device_key, user_id, device_id) {
    var session = { user_id: user_id, device_id: device_id }
    return redis.hset("session_keys", device_key, JSON.stringify(session)).then(function() {
      return session
    })
  }

  server.find_session = function(token) {
    return redis.hget("session_keys", token).then(function(session_json) {
      var session = JSON.parse(session_json)
      return session
    })
  }

  server.build_client = function(socket) {
    return { socket: socket, flags: {}, following: [] }
  }

  server.zipq_get = function(user_id) {
    return redis.hexists('zipq', user_id)
      .then(function(count) {
        if (count === 0) {
          console.log('zipq_get not-exists', user_id)
          var list = []
          return redis.hset('zipq', user_id, JSON.stringify(list))
        }
      }).then(function() {
        return redis.hget('zipq', user_id)
          .then(function(json) {
            return JSON.parse(json)
          })
      })
  }

  server.zipq_add = function(user_id, start, end) {
    return server.zipq_get(user_id)
      .then(function(q) {
        console.log('zipq_add', user_id, q)
        q.push({ time: new Date(), start: start, end: end, status: 'waiting' })
        return redis.hset('zipq', user_id, JSON.stringify(q))
      })
  }


  server.activity_added = function(change) {
    if (change.index == 'location.user_id_date') {
      server.pump_location(change.new_val)
    }
  }

  server.friendly_fences_for = function(location, friends: string[]) {
    let pt = turfhelp.point([location.longitude, location.latitude])
    return Promise.all(friends.map(friend_id => {
      return db.fence_list(friend_id).then(function(cursor) {
        return cursor.toArray().then(fences =>
          fences.filter(fence => {
            if (fence.geojson) { // some fences are incomplete
              // todo: first fastpass with fence bounding boxes
              // https://github.com/mourner/flatbush
              let poly = turfhelp.polygon(fence.geojson.coordinates)
              return booleanPointInPolygon(pt, poly)
            }
          }))
      })
    })).then(fencemap => [].concat.apply([], fencemap))
  }

  server.rules_for = function(user_id, fence_id) {
    return db.rule_list(user_id).then(function(cursor) {
      return cursor.toArray().then(rules => {
        let winning = rules.filter(function(rule) {
          return rule.fence_id === fence_id
        })
        //console.log('rules_for', user_id, fence_id, rules.length, 'rules count', winning.length, 'applies to fence')
        return winning
      })
    })
  }

  server.pump_location = function(location) {
    server.clients.list.forEach(function(client) {
      if (client.following.length > 0) {
        console.log('pump_location for device', location.device_id.substr(7, 8),
          'to', client.following.length, 'clients')
      }
      client.following.forEach(function(search) {
        var stream_id = search(location)
        if (stream_id) {
          server.location_fences_load(location).then(function(location_enhanced) {
            protocol.respond_success(client, stream_id, location_enhanced)
          })
        }
      })
    })
  }

  server.pump = function(status) {
    server.clients.list.forEach(function(client) {
      if (client.flags.stats) {
        var stats_str = JSON.stringify(status)
        clog(client, stats_str)
        protocol.respond_success(client, client.flags.stats, status)
      }
    })
  }

  server.fences_add = function(location) {
    return server.friendly_fences_for(location, [location.user_id]).then(function(fences) {
      if (fences.length > 0) {
        location.fences = fences.map(function(fence: any) { return fence.id })
      }
      return location
    })
  }

  server.rules_add = function(location) {
    if (location.fences) {
      return Promise.all(location.fences.map(function(fence_id) {
        return server.rules_for(location.user_id, fence_id)
          .then(function(rules) {
            if (rules.length > 0) {
              if (!location.rules) { location.rules = [] }
              Array.prototype.push.apply(location.rules, rules.map(function(rule) {
                return { id: rule.id, fence_id: rule.fence_id, kind: rule.kind }
              }))
            }
          })
      })).then(function() {
        return location
      })
    } else {
      return Promise.resolve(location) // no fences
    }
  }

  /* API calls */

  server.process_activity_add = function(client, msg) {
    if (client.flags.authenticated) {
      if (server.activityValid(msg.params)) {
        msg.params.user_id = client.flags.authenticated.user_id
        msg.params.device_id = client.flags.authenticated.device_id
        var now = new Date()
        msg.params.received_at = now.toISOString()

        let timer = new Date()
        db.activity_add(msg.params)
          .then(function(result) {
            server.influxWrite('activity_add', (new Date()).getTime() - timer.getTime())
            if (result.errors === 0) {
              protocol.respond_success(client, msg.id, {
                message: "saved",
                id: msg.params.id
              })
              if (msg.params.type === 'location') {
                clog(client, 'activity ' + msg.params.type + ' ' + msg.params.id + ' ' + msg.params.date)
                server.user_fence_run(msg.params)
              }
              if (msg.params.type === 'config') {
                clog(client, 'activity ' + msg.params.type + ' recording ' + msg.params.recording + ' ' + msg.params.date)
              }
            } else {
              var fail = { message: result.first_error };
              protocol.respond_fail(client, msg.id, fail)
            }
          })
      } else {
        let fail = { message: 'invalid activity properties' };
        protocol.respond_fail(client, msg.id, fail)
      }
    } else {
      var auth_fail = { message: 'not authorized' };
      protocol.respond_fail(client, msg.id, auth_fail)
    }
  }

  server.activityValid = function(location) {
    if (location.type === 'location') {
      return location.latitude &&
        location.longitude &&
        location.date
    }
    return true
  }

  server.user_fence_run = function(location: nouns.Location) {
    return db.get_user(location.user_id).then(function(user) {
      return db.friending_me(user.id)
        .then(function(friend_ids) {
          var me_and_friends = [user.id].concat(friend_ids)
          console.log('newer_user_location calling', user, location)
          return server.newer_user_location(user, location)
            .then(function(last_location: any) {
              console.log('newer_user_location returned last_location', last_location)
              return server.friendly_fences_for(last_location, me_and_friends)
                .then(function(last_fences) {
                  return server.friendly_fences_for(location, me_and_friends)
                    .then(function(fences) {
                      console.log(user.username, 'new pt', location.latitude, location.longitude, 'in', fences.length, 'fences.',
                        'prev pt', last_location.latitude, last_location.longitude, ' in', last_fences.length, 'fences.')
                      var fences_exited = server.fences_diff(last_fences, fences)
                      var fences_entered = server.fences_diff(fences, last_fences)
                      console.log(user.username, 'fences_exited', fences_exited.map(f => f.name),
                        'fences_entered', fences_entered.map(f => f.name))

                      server.fence_rule_run(user, last_location, location, fences_entered, "entered")
                      server.fence_rule_run(user, location, last_location, fences_exited, "exited")

                      var my_fences = fences.filter(
                        function(f: any) { return f.user_id == location.user_id }
                      ).map(function(fence: any) { return fence.id })
                      console.log('user_latest_freshen', fences_entered, fences_exited, new Date())
                      return [fences_entered, fences_exited]
                    })
                })
            }, function() {
              console.log('skipping user freshen. historical point received.')
            })
        })
    })
  }

  server.newer_user_location = function(user, location) {
    return new Promise(function(resolve, reject) {
      if (user.latest && user.latest.location_id) {
        let last_location = db.loadFile(user.latest.location_id)
        console.log('newer_user_location pre-check', user.username, user.id, location.date, last_location.date)
        if (location.date > last_location.date) {
          console.log('newer_user_location NEWER')
          resolve(last_location)
        } else {
          reject()
        }
      } else {
        resolve(location)
      }
    })
  }

  server.fences_diff = function(a: any[], b: any[]) {
    return a.filter(x => b.map(f => f.id).indexOf(x.id) == -1)
  }

  server.fence_rule_run = function(user, location_outside, location_inside, fences, direction: Direction) {
    fences.forEach(function(fence) {
      db.rule_list_by_fence(fence.id)
        .then(function(rules_cursor) {
          rules_cursor.toArray()
            .then(function(rules) {
              console.log('fence', fence.name, 'rules', rules.map(function(rule) { return rule.kind }))
              rules.forEach(function(rule) {
                if (rule.kind == 'alert') {
                  server.rule_alert_go(user, location_outside, location_inside, fence, rule, direction)
                }
              })
            })
        })
    })
  }

  type Direction = "entered" | "exited"

  server.rule_alert_go = function(user, location_outside, location_inside, fence, rule, direction: Direction) {
    console.log('rule trigger', rule.kind, 'for location user', user.username,
      'fence', fence.name, 'direction', direction)
    db.get_user(rule.user_id)
      .then(function(ruleuser) {
        var email = emailer.build_fence_alert_email(ruleuser.email,
          fence,
          user.username,
          location_outside,
          location_inside,
          direction)
        emailer.send_email(email)
      })
  }

  server.process_user_stats = function(client, msg) {
    var stats: any = {}
    db.users_link_count().then(function(link_count) {
      stats.link_count = link_count
      console.log('stats', link_count)
    }).then(function() {
      db.users_count().then(function(count) {
        stats.count = count
        protocol.respond_success(client, msg.id, stats)
        return stats
      })
    })
  }

  server.process_activity_stats = function(client, msg) {

    // 24 hour count
    var today = msg.params.start ? new Date(msg.params.start) : new Date()
    var yesterday = new Date(today.getTime() - 1000 * 60 * 60 * 24)
    var timestep = msg.params.timestep || 60 * 60 * 1000

    var times: Date[] = []
    for (let time = yesterday.getTime(); time < today.getTime(); time += timestep) {
      times.push(new Date(time))
    }
    let good_times: any[] = times.reduce(
      function(m: any[], t: Date, i: number) {
        if (i > 0) m.push([times[i - 1], t]); return m
      }, [])

    var stats = {
      start: today.toISOString(),
      stop: yesterday.toISOString(),
      periods: <any>[],
      period_length: timestep
    }
    stats.periods = good_times.map(
      ts => db.activity_count('location', ts[0].toISOString(), ts[1].toISOString()))
    if (stats) {
      protocol.respond_success(client, msg.id, stats)
    } else {
      protocol.respond_success(client, msg.id, stats) // todo fail msg
    }

  }

  server.process_stream_follow = function(client, msg) {
    var stream_id = uuid.v4().substr(0, 8)
    if (msg.params.username) {
      server.stream_follow_user(stream_id, client, msg)
    } else {
      if (client.flags.authenticated) {
        msg.params.id = client.flags.authenticated.user_id
        server.stream_follow_user(stream_id, client, msg) // follow me too
        db.friending_me(client.flags.authenticated.user_id).then(function(friend_ids) {
          friend_ids.forEach(function(friend_id) {
            msg.params.id = friend_id
            server.stream_follow_user(stream_id, client, msg)
          })
        })
      } else {
        protocol.respond_fail(client, msg.id, {
          code: "UNAUTHORIZED",
          message: "This action requires authorization"
        })
      }
    }
  }

  server.stream_follow_user = function(stream_id, client, msg) {
    var findby: any = { username: msg.params.username }
    if (msg.params.id) { findby = { id: msg.params.id } }
    db.find_user_id_by(findby).then((user_id) => db.get_user(user_id)).then(function(user) {
      var auth = false

      if (msg.params.key) {
        var rule = user.access[msg.params.key]
        if (typeof rule === 'object') {
          if (server.rule_check(rule)) {
            auth = true
          }
        }
      }
      if (client.flags.authenticated) {
        if (user.id === client.flags.authenticated.user_id ||
          user.friends.indexOf(client.flags.authenticated.user_id) >= 0) {
          auth = true
        }
      }
      //if(user.access.public){
      //  auth = true
      //}

      if (auth) {
        if (!msg.params.count) { msg.params.count = 1 }
        var count = msg.params.count < 86400 ? msg.params.count : 2000
        var start = msg.params.start && (new Date(msg.params.start))
        var stop = msg.params.stop && (new Date(msg.params.stop))
        var type = msg.params.type || "location"
        var order = msg.params.order
        if (msg.params.follow) {
          // a running query if no stop/start specified
          client.following.push(function(location) {
            if (location.user_id === user.id) {
              return stream_id
            }
          })
        }

        protocol.respond_success(client, msg.id, { stream_id: stream_id, added: [{ id: user.id, username: user.username }] })
        server.send_last_locations(client, stream_id, user.id, start, stop, count, type, order)

      } else {
        protocol.respond_fail(client, msg.id, {
          code: "NOACCESS",
          message: msg.params.username + " is not sharing location data with you."
        })
      }

    }, function() {
      protocol.respond_fail(client, msg.id, {
        code: "UNF",
        message: "username " + msg.params.username + " not found"
      })
    })
  }

  server.process_stream_unfollow = function(client, msg) {
  }

  server.rule_check = function(rule) {
    // read
    if (rule.scopes.indexOf('read') > -1) {
      // time
      if (rule.expires_at) {
        var now = new Date()
        var expire = (new Date(rule.expires_at))
        if (expire > now) {
          console.log('time compare success')
          return true
        }
      } else {
        return true
      }
    }
    return false
  }

  server.send_last_locations = function(client, stream_id, user_id, start, stop, count, type, order) {
    //db.count_locations_for(user_id, start, stop, count, type, order)
    //  .then(function(qcount){}) // stream helper
    let timer = new Date()
    start = start || moment().subtract(1, 'days').format()
    stop = stop || moment().format()
    db.find_locations_for(user_id, start, stop, count, type, order)
      .then(function(locations) {
        console.log('send_last_locations', user_id, start, '-', stop, locations.length + '/' + count, 'points')
        locations.forEach(function(location) {
          server.location_fences_load(location).then(function(location) {
            server.influxWrite('send_last_locations', (new Date()).getTime() - timer.getTime())
            protocol.respond_success(client, stream_id, location)
          })
        })
      })
  }

  server.location_fences_load = function(location) {
    if (location.type == 'location') {
      return server.fences_add(location)
        .then(server.rules_add)
        .then(function(location) {
          console.log('location', location.date, location.latitude, location.longitude, 'fences', location.fences ? location.fences.length : 0)
          if (location.rules) {
            var cloak_rules = location.rules.filter(function(rule) { return rule.kind == 'cloaked' })
            if (cloak_rules.length > 0) {
              delete location.longitude
              delete location.latitude
            }
          }
          return location
        })
    } else {
      return Promise.resolve(location)
    }
  }

  server.gravatar_url = function(email) {
    var md5sum = crypto.createHash('md5')
    md5sum.update(email)
    var url = "//www.gravatar.com/avatar/" + md5sum.digest('hex')
    return url
  }

  server.process_auth_email = function(client, msg) {
    var params = msg.params
    console.log('auth_email ' + JSON.stringify(msg))
    server.create_token_temp(params)
      .then(function(token) {
        var email_opts = emailer.build_token_email(params.email, params.device_id, token)
        console.log('auth_email send_email begin.')
        emailer.send_email(email_opts)
        protocol.respond_success(client, msg.id, { status: "OK" })
      }, function(err) {
        console.log('auth_email error ' + err);
      })
  }

  server.process_auth_session = function(client, msg) {
    if (client.flags.authenticated) {
      protocol.respond_fail(client, msg.id, {
        code: "AF1", message: "already authenticated",
        user_id: client.flags.authenticated.user_id
      })
    } else {
      server.find_session(msg.params.device_key).then(function(session) {
        if (session) {
          if (session.email) {
            server.client_auth_check(client, msg, session)
          } else {
            server.client_auth_trusted(client, session)
            protocol.respond_success(client, msg.id, { user: { id: session.user_id } })
          }
        } else {
          console.log('debug, session not found for', msg.params.device_key)
          // look up access token
          let access = db.findAccess(msg.params.token || msg.params.device_key)
          if (access) {
            console.log('(unimplemented) found access:', JSON.stringify(access))
            protocol.respond_fail(client, msg.id, { code: "BK1", message: "api_key unimplemented" })
          } else {
            console.log("session for " + msg.params.device_key + " not found")
            protocol.respond_fail(client, msg.id, { code: "BK1", message: "bad device_key" })
          }
        }
      }).catch(function(err) { console.log('process_auth_session', err) })
    }
  }

  server.client_auth_check = function(client, msg, session) {
    db.find_user_id_by({ email_downcase: session.email.toLowerCase() }).then((user_id) => db.get_user(user_id)).then(function(user) {
      clog(client, 'authenticating session for ' + session.email)
      if (user.devices.indexOf(session.device_id) > -1) {
        clog(client, '* existing device ' + session.device_id);
        return user
      } else {
        clog(client, '* adding device ' + session.device_id);
        return db.user_add_device(user.id, session.device_id).then(function() { return user })
      }
    }, function(err) {
      clog(client, '* user not found by ' + session.email + ' ' + JSON.stringify(err))
      var new_user = server.user_new(session.email, session.device_id)
      var email = emailer.build_admin_email('New user ' + session.email)
      emailer.send_email(email)
      return db.ensure_user(new_user)
    }).then(function(user) {
      clog(client, '* token validate ' + JSON.stringify(user))
      server.token_validate(msg.params.device_key, user.id, session.device_id).then(function(session) {
        clog(client, "post token validate w/ " + JSON.stringify(session))
        server.client_auth_trusted(client, session)
        protocol.respond_success(client, msg.id, { user: { id: user.id } })
      })
    })
  }

  server.client_auth_trusted = function(client, session) {
    client.flags.authenticated = session
    clog(client, "logged in user id " + session.user_id + " on device " + JSON.stringify(session.device_id))
  }

  server.user_new = function(email, device_id) {
    var user = {
      email: email,
      created_at: new Date().toISOString(),
      devices: [device_id],
      friends: [],
      access: {}
    }
    return user
  }

  server.process_user_detail = function(client, msg) {
    console.log('process_user_detail start')
    var filter = {}

    // identify the user to look up - auth check happens below
    if (msg.params && Object.keys(msg.params).length > 0) {
      if (msg.params.id) {
        filter = { id: msg.params.id }
      } else if (msg.params.username) {
        filter = { username: msg.params.username }
      }
    } else {
      // default value is the authenticated user
      if (client.flags.authenticated) {
        filter = { id: client.flags.authenticated.user_id }
      } else {
        protocol.respond_fail(client, msg.id, { message: "Login or specify a username/id to lookup" })
        return
      }
    }

    console.log('process_user_detail filter', filter)
    db.find_user_id_by(filter).then((user_id) => db.get_user(user_id)).then(function(user) {
      let empty_user: any = {
        id: user.id,
        username: user.username,
        friends: []
      }
      let user_promise = Promise.resolve(empty_user)
      if (client.flags.authenticated) {
        var client_user_id = client.flags.authenticated.user_id
        if (user.id == client_user_id) {
          console.log('process_user_detail full detail for', user.username)
          user_promise = user_promise.then(safe_user => {
            // basic profile
            safe_user.created_at = user.created_at
            safe_user.photo = server.gravatar_url(user.email)
            // full profile
            safe_user.email = user.email
            safe_user.friends = user.friends
            safe_user.access = user.access
            safe_user.level = user.level
            safe_user.latest = user.latest
            safe_user.location_stats = {} //db.user_location_stats(user.id)
            console.log('process_user_detail full detail for', user.username, 'stats built')
            return db.friending_me(user.id).then(friending_ids => {
              console.log('process_user_detail full detail for', user.username, 'friending ids')
              safe_user.friending = friending_ids
              return safe_user
            })
          })
        } else {
          if (user.friends.indexOf(client_user_id) > -1) {
            // public profile for friends
            user_promise = user_promise.then(safe_user => {
              safe_user.created_at = user.created_at
              safe_user.photo = server.gravatar_url(user.email)
              if (user.latest.location) {
                safe_user.latest = { location: { date: user.latest.location.date }, fences: [] } // use just date (todo: privacy fence check)
              }
              return safe_user
            })
          }
        }
      } else {
        let key_auth = false
        if (msg.params && Object.keys(msg.params).length > 0) {
          if (msg.params.key) {
            var rule = user.access[msg.params.key]
            if (typeof rule === 'object') {
              if (server.rule_check(rule)) {
                key_auth = true
              } else {
                protocol.respond_fail(client, msg.id, { message: "key has insufficient permissions" })
                return
              }
            } else {
              protocol.respond_fail(client, msg.id, { message: "invalid key" })
              return
            }
          }
        }
        if (!key_auth) {
          if (user.access.public) {
            user_promise = user_promise.then(safe_user => {
              safe_user.photo = server.gravatar_url(user.email)
              return safe_user
            })
          } else {
            protocol.respond_fail(client, msg.id, { message: "Profile is private" })
            return
          }
        }
      }

      return user_promise.then(safe_user => {
        console.log('process_user_detail for', user.username, 'respond success')
        protocol.respond_success(client, msg.id, safe_user)
      })
    }, function(err) {
      protocol.respond_fail(client, msg.id, err)
    })
  }

  server.process_user_update = function(client, msg) {
    if (client.flags.authenticated) {
      // default value is the authenticated user
      db.update_user_by(client.flags.authenticated.user_id, msg.params).then(function(result) {
        protocol.respond_success(client, msg.id, result)
      }, function(err) {
        protocol.respond_fail(client, msg.id, err)
      })
    } else {
      protocol.respond_fail(client, msg.id, { message: "Not authenticated" })
    }
  }

  server.process_user_access_add = function(client, msg) {
    if (client.flags.authenticated) {
      db.find_user_id_by({ id: client.flags.authenticated.user_id }).then((user_id) => db.get_user(user_id)).then(function(user) {
        var key = uuid.v4().substr(0, 18)
        var rule: any = {
          created_at: new Date(),
          scopes: msg.params.scopes
        }
        if (msg.params.expires_at) {
          rule.expires_at = msg.params.expires_at
        }
        user.access[key] = rule
        db.update_user_access(client.flags.authenticated.user_id, user.access).then(function(result) {
          protocol.respond_success(client, msg.id, result)
        }, function(err) {
          protocol.respond_fail(client, msg.id, err)
        })
      })
    }
  }

  server.process_user_access_del = function(client, msg) {
    if (client.flags.authenticated) {
      db.find_user_id_by({ id: client.flags.authenticated.user_id }).then((user_id) => db.get_user(user_id)).then(function(user) {
        if (user.access[msg.params.key]) {
          delete user.access[msg.params.key]
          db.update_user_access(client.flags.authenticated.user_id, user.access)
            .then(function(result) {
              protocol.respond_success(client, msg.id, result)
            }, function(err) {
              protocol.respond_fail(client, msg.id, err)
            })
        }
      })
    }
  }

  server.process_user_payment = function(client, msg) {
    if (client.flags.authenticated) {
      var client_user_id = client.flags.authenticated.user_id
      db.find_user_id_by({ id: client.flags.authenticated.user_id }).then((user_id) => db.get_user(user_id)).then(function(user) {
        // user loaded, process payment
        console.log('process_user_payment', 'stripe.customers.create', user.email)
        stripe.customers.create({
          email: user.email,
          card: msg.params.token,
          metadata: { user_id: client_user_id, email: user.email, level: user.level }
        }).then(function(customer) {
          console.log('process_user_payment', 'stripe customer', customer)
          var amount
          if (msg.params.product == "ex1mo") { amount = 300 }
          if (msg.params.product == "ex6mo") { amount = 1500 }
          if (amount) {
            return stripe.charges.create({
              amount: amount,
              currency: 'usd',
              customer: customer.id
            });
          } else {
            return new Promise(function(resolve, reject) {
              reject({ code: 'noproduct', message: "No product found" })
            })
          }
        }).then(function(charge) {
          // New charge created on a new customer
          console.log('process_user_payment', 'stripe charge', charge)
          protocol.respond_success(client, msg.id, { amount: 0.02 })
          var email_payment = emailer.build_payment_email(user.email, msg.params.product, charge.amount)
          emailer.send_email(email_payment)
          server.user_add_time(user, msg.params.product)
          var email_admin = emailer.build_admin_email('User payment ' + user.email + ' ' + msg.params.product)
          emailer.send_email(email_admin)
        }, function(err) {
          // Deal with an error
          console.log('process_user_payment', 'error', err)
          protocol.respond_fail(client, msg.id, { message: err.message })
          var email = emailer.build_admin_email('User payment error ' + err.message)
          emailer.send_email(email)
        });
      })
    } else {
      protocol.respond_fail(client, msg.id, { message: "Not authenticated" })
    }
  }

  server.user_add_time = function(user, product) {
    var endTime
    console.log('user_add_time', user.username, user.level)
    if (user.level && user.level.extra) {
      endTime = new Date(user.level.extra)
    } else {
      endTime = new Date()
    }
    console.log('user_add_time', user.username, 'endTime', endTime)
    var days = 24 * 60 * 60 * 1000
    var duration
    if (product == "ex1mo") { duration = 1 * 30 * days }
    if (product == "ex6mo") { duration = 6 * 30 * days }
    console.log('user_add_time', user.username, 'duration', duration)
    if (duration) {
      var newEndTime = new Date(endTime.valueOf() + duration)
      console.log('user_add_time', user.username, 'newEndTime', newEndTime)
      db.update_user_level(user.id, { extra: newEndTime.toISOString() })
    }
  }

  server.process_user_friend = function(client, msg) {
    if (client.flags.authenticated) {
      var client_user_id = client.flags.authenticated.user_id
      db.find_user_id_by({ username: msg.params.username }).then((user_id) => db.get_user(user_id)).then(function(friend) {
        db.user_add_friend(client_user_id, friend.id).then(function(result) {
          protocol.respond_success(client, msg.id, result)
          // inefficient
          db.get_user(client_user_id).then(function(user) {
            var email = emailer.build_friend_email(friend.email, user.username)
            emailer.send_email(email)
          })
        }, function(err) {
          protocol.respond_fail(client, msg.id, err)
        })
      })
    } else {
      protocol.respond_fail(client, msg.id, { message: "Not authenticated" })
    }
  }

  server.process_fence_add = function(client, msg) {
    if (client.flags.authenticated) {
      console.log('fence_add', msg)
      var fence: any = {}
      fence.id = uuid.v4().substr(0, 18)
      fence.created_at = new Date()
      fence.name = msg.params.name
      fence.user_id = client.flags.authenticated.user_id
      db.fence_add(fence).then(function(result) {
        if (result.inserted == 1) {
          protocol.respond_success(client, msg.id, fence)
        }
      })
    } else {
      protocol.respond_fail(client, msg.id, { message: "Not authenticated" })
    }
  }

  server.process_device_list = function(client, msg) {
    if (client.flags.authenticated) {
      db.device_list(client.flags.authenticated.user_id).then(function(cursor) {
        cursor.toArray().then(function(devices) {
          let realdevices = devices.filter(d => d.device_id != 'browser')
          protocol.respond_success(client, msg.id, realdevices)
        })
      })
    } else {
      protocol.respond_fail(client, msg.id, { message: "Not authenticated" })
    }
  }

  server.process_device_add = function(client, msg) {
    if (client.flags.authenticated) {
      let device = {
        id: uuid.v4(),
        device_id: uuid.v4(),
        created_at: new Date().toISOString(),
        name: msg.params.name,
        user_id: client.flags.authenticated.user_id
      }
      db.device_add(device)
      protocol.respond_success(client, msg.id, { id: device.id })
    } else {
      protocol.respond_fail(client, msg.id, { message: "Not authenticated" })
    }
  }

  server.process_device_genkey = function(client, msg) {
    if (client.flags.authenticated) {
      let device = db.loadFile(msg.params.id)
      server.create_token_temp({ device_id: device.device_id })
        .then(function(device_key) {
          let token = util.sha256(device.device_id + device_key) // magic sauce
          server.token_validate(token, client.flags.authenticated.user_id, device.device_id)
          protocol.respond_success(client, msg.id, { token: token })
        }, function(err) {
          console.log('device.genkey error ' + err);
        })
    } else {
      protocol.respond_fail(client, msg.id, { message: "Not authenticated" })
    }
  }

  server.process_fence_list = function(client, msg) {
    if (client.flags.authenticated) {
      db.fence_list(client.flags.authenticated.user_id).then(function(cursor) {
        cursor.toArray().then(function(fences) {
          protocol.respond_success(client, msg.id, fences)
        })
      })
    } else {
      protocol.respond_fail(client, msg.id, { message: "Not authenticated" })
    }
  }

  server.process_fence_get = function(client, msg) {
    if (client.flags.authenticated) {
      db.fence_get(msg.params.id).then(function(fence) {
        if (fence.user_id == client.flags.authenticated.user_id) {
          protocol.respond_success(client, msg.id, fence)
        } else {
          db.get_user(fence.user_id).then(function(owner) {
            if (owner.friends.indexOf(client.flags.authenticated.user_id) >= 0) {
              protocol.respond_success(client, msg.id, fence)
            }
          })
        }
      })
    } else {
      protocol.respond_fail(client, msg.id, { message: "Not authenticated" })
    }
  }

  server.process_fence_del = function(client, msg) {
    if (client.flags.authenticated) {
      db.fence_get(msg.params.id).then(function(fence) {
        if (fence.user_id == client.flags.authenticated.user_id) {
          db.fence_del(msg.params.id).then(function(result) {
            protocol.respond_success(client, msg.id, fence)
          })
        }
      })
    } else {
      protocol.respond_fail(client, msg.id, { message: "Not authenticated" })
    }
  }

  server.process_fence_update = function(client, msg) {
    if (client.flags.authenticated) {
      db.fence_get(msg.params.id).then(function(fence) {
        if (fence.user_id == client.flags.authenticated.user_id) {
          if (msg.params.name) { fence.name = msg.params.name }
          if (msg.params.geojson) {
            let geometry = msg.params.geojson.geometry
            let turfcoord = turfhelp.polygon(geometry.coordinates)
            fence.geojson = { type: turfcoord.type, coordinates: turfcoord.geometry.coordinates }
            fence.area = parseInt(geojsonArea.geometry(geometry))
          }
          db.fence_update(fence).then(function(result) {
            if (fence.user_id == client.flags.authenticated.user_id) {
              protocol.respond_success(client, msg.id, fence)
            }
          }, function(err) {
            console.log('process_fence_update', err)
          })
        }
      })
    } else {
      protocol.respond_fail(client, msg.id, { message: "Not authenticated" })
    }
  }

  server.process_rule_list = function(client, msg) {
    if (client.flags.authenticated) {
      db.rule_list(client.flags.authenticated.user_id).then(function(cursor) {
        cursor.toArray().then(function(rules) {
          protocol.respond_success(client, msg.id, rules)
        })
      })
    } else {
      protocol.respond_fail(client, msg.id, { message: "Not authenticated" })
    }
  }

  server.process_rule_add = function(client, msg) {
    if (client.flags.authenticated) {
      console.log('rule_add', msg)
      var rule: any = {}
      rule.id = uuid.v4()
      rule.created_at = new Date()
      rule.user_id = client.flags.authenticated.user_id
      rule.fence_id = msg.params.fence_id
      rule.kind = 'cloaked'
      if (msg.params.kind && msg.params.kind.length > 0) {
        rule.kind = msg.params.kind
      }
      db.rule_add(rule).then(function(result) {
        protocol.respond_success(client, msg.id, result)
      })
    } else {
      protocol.respond_fail(client, msg.id, { message: "Not authenticated" })
    }
  }

  server.process_rule_del = function(client, msg) {
    if (client.flags.authenticated) {
      db.rule_get(msg.params.id).then(function(rule) {
        if (rule.user_id == client.flags.authenticated.user_id) {
          db.rule_del(rule.id).then(function(result) {
            protocol.respond_success(client, msg.id, rule)
          })
        }
      })
    } else {
      protocol.respond_fail(client, msg.id, { message: "Not authenticated" })
    }
  }

  server.process_stream_zip = function(client, msg) {
    if (client.flags.authenticated) {
      var user_id = client.flags.authenticated.user_id
      server.zipq_add(user_id)
        .then(function() {
          protocol.respond_success(client, msg.id, { status: 'OK' })
        })
    } else {
      protocol.respond_fail(client, msg.id, { message: "Not authenticated" })
    }
  }

  server.process_stream_ziplist = function(client, msg) {
    if (client.flags.authenticated) {
      var user_id = client.flags.authenticated.user_id
      server.zipq_get(user_id)
        .then(function(list) {
          protocol.respond_success(client, msg.id, list)
        })
    } else {
      protocol.respond_fail(client, msg.id, { message: "Not authenticated" })
    }
  }

  return server;
}

