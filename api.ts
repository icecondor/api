require('source-map-support').install()

// nodejs
import * as timers from 'timers'
import * as crypto from 'crypto'
import * as uuid from 'node-uuid'
import * as os from 'os'

// npm
import moment from 'moment'
import * as geojsonArea from 'geojson-area'
import * as bent from 'bent'
import * as turfhelp from '@turf/helpers'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'

// local
import * as settingsLib from './lib/settings'
let settings = settingsLib.default("settings.json")
import * as util from "./lib/util"
import * as protocolLib from "./lib/protocol-v2"
let protocol = protocolLib.default(settings.api)
import * as serverLib from './lib/server'
let server: any = serverLib.factory()
import * as dbLib from './lib/db'
let db = new dbLib.Db(settings.storage) as any
import * as emailerLib from './lib/email'
let emailer = emailerLib.factory(settings.email) as any
import * as stripeLib from 'stripe'
let stripe = stripeLib.default(settings.stripe.key);

var motd = "version:" + settings.api.version + " server:" + settings.api.hostname
console.log("api", motd)

db.connect(function() {
  db.schema_dump()

  server.on('listening', listening)
  server.on('connection', handleConnection)
  server.on('close', function() { console.log('closed') })
  server.on('error', function(e) { console.log('net.sever err', e) })
  server.listen(settings.api.listen_port)

  db.changes(activity_added)
})

function listening() {
  console.log("api listening on *:" + settings.api.listen_port)
  timers.setInterval(function() {
    progress_report();
    server.timer.reset();
  }, settings.api.progress_report_timer)
}

function handleConnection(socket) {
  var client = server.build_client(socket)
  protocol.connection(client, client_dispatch, end_of_connection)
  server.clients.add(client)
  clog(client, 'connected. ' + server.clients.list.length + ' clients.');
  progress_report()
}

function end_of_connection(client) {
  server.clients.remove(client)
  clog(client, 'disconnected')
  progress_report()
}

function client_dispatch(me, msg) {
  clog(me, msg)
  server.timer.hits += 1
  switch (msg.method) {
    case 'auth.email': process_auth_email(me, msg); break;
    case 'auth.session': process_auth_session(me, msg); break;
    case 'user.detail': process_user_detail(me, msg); break;
    case 'user.update': process_user_update(me, msg); break;
    case 'user.friend': process_user_friend(me, msg); break;
    case 'user.payment': process_user_payment(me, msg); break;
    case 'user.stats': process_user_stats(me, msg); break;
    case 'user.access.add': process_user_access_add(me, msg); break;
    case 'user.access.del': process_user_access_del(me, msg); break;
    case 'activity.add': process_activity_add(me, msg); break;
    case 'activity.stats': process_activity_stats(me, msg); break;
    case 'device.list': process_device_list(me, msg); break;
    case 'device.add': process_device_add(me, msg); break;
    case 'device.genkey': process_device_genkey(me, msg); break;
    case 'fence.add': process_fence_add(me, msg); break;
    case 'fence.list': process_fence_list(me, msg); break;
    case 'fence.get': process_fence_get(me, msg); break;
    case 'fence.update': process_fence_update(me, msg); break;
    case 'fence.del': process_fence_del(me, msg); break;
    case 'stream.follow': process_stream_follow(me, msg); break;
    case 'stream.unfollow': process_stream_unfollow(me, msg); break;
    case 'stream.zip': process_stream_zip(me, msg); break;
    case 'stream.ziplist': process_stream_ziplist(me, msg); break;
    case 'stream.stats': me.flags.stats = msg.id; break;
    case 'rule.list': process_rule_list(me, msg); break;
    case 'rule.add': process_rule_add(me, msg); break;
    case 'rule.del': process_rule_del(me, msg); break;
    default: console.log('!!unknown method', msg)
  }
}

function activity_added(change) {
  if (change.index == 'location.user_id_date') {
    pump_location(change.new_val)
  }
}

function friendly_fences_for(location, friends: string[]) {
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

function rules_for(user_id, fence_id) {
  return db.rule_list(user_id).then(function(cursor) {
    return cursor.toArray().then(rules => {
      let winning = rules.filter(function(rule) {
        return rule.fence_id === fence_id
      })
      console.log('rules_for', user_id, fence_id, rules.length, 'rules count', winning.length, 'applies to fence')
      return winning
    })
  })
}

function pump_location(location) {
  server.clients.list.forEach(function(client) {
    if (client.following.length > 0) {
      console.log('pump_location for device', location.device_id.substr(7, 8),
        'to', client.following.length, 'clients')
    }
    client.following.forEach(function(search) {
      var stream_id = search(location)
      if (stream_id) {
        location_fences_load(location).then(function(location_enhanced) {
          protocol.respond_success(client, stream_id, location_enhanced)
        })
      }
    })
  })
}

function progress_report() {
  var now = new Date();
  var period = (now.getTime() - server.timer.mark) / 1000
  var rate = server.timer.hits / period
  var stats = {
    type: "status_report",
    server: settings.api.hostname,
    version: settings.api.version,
    date: now.toISOString(),
    msg_rate: rate,
    client_count: server.clients.list.length,
    freemem: os.freemem()
  }
  db.activity_add(stats)
  var srep = 'status report - ' + rate.toFixed(1) + ' hits/sec. ' +
    server.clients.list.length + ' clients.'
  console.log(srep)
  pump(stats)
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

function pump(status) {
  server.clients.list.forEach(function(client) {
    if (client.flags.stats) {
      var stats_str = JSON.stringify(status)
      clog(client, stats_str)
      protocol.respond_success(client, client.flags.stats, status)
    }
  })
}

function fences_add(location) {
  return friendly_fences_for(location, [location.user_id]).then(function(fences) {
    if (fences.length > 0) {
      location.fences = fences.map(function(fence: any) { return fence.id })
    }
    return location
  })
}

function rules_add(location) {
  if (location.fences) {
    return Promise.all(location.fences.map(function(fence_id) {
      return rules_for(location.user_id, fence_id)
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

function process_activity_add(client, msg) {
  if (client.flags.authenticated) {
    if (activityValid(msg.params)) {
      msg.params.user_id = client.flags.authenticated.user_id
      msg.params.device_id = client.flags.authenticated.device_id
      var now = new Date()
      msg.params.received_at = now.toISOString()

      let timer = new Date()
      db.activity_add(msg.params)
        .then(function(result) {
          influxWrite('activity_add', (new Date()).getTime() - timer.getTime())
          if (result.errors === 0) {
            protocol.respond_success(client, msg.id, {
              message: "saved",
              id: msg.params.id
            })
            if (msg.params.type === 'location') {
              clog(client, 'activity ' + msg.params.type + ' ' + msg.params.id + ' ' + msg.params.date)
              user_latest_freshen(msg.params)
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

function activityValid(location) {
  if (location.type === 'location') {
    return location.latitude &&
      location.longitude &&
      location.date
  }
  return true
}

function user_latest_freshen(location) {
  return db.get_user(location.user_id).then(function(user) {
    db.friending_me(user.id)
      .then(function(friend_ids) {
        var me_and_friends = [user.id].concat(friend_ids)
        newer_user_location(user, location)
          .then(function(last_location: any) {
            friendly_fences_for(last_location, me_and_friends)
              .then(function(last_fences) {
                friendly_fences_for(location, me_and_friends)
                  .then(function(fences) {
                    console.log(user.username, 'new pt', location.date, 'in', fences.length, 'fences.',
                      'prev pt', last_location.date, ' in', last_fences.length, 'fences.')
                    var fences_exited = fences_diff(last_fences, fences)
                    var fences_entered = fences_diff(fences, last_fences)
                    console.log(user.username, 'fences_exited', fences_exited.map(f => f.name),
                      'fences_entered', fences_entered.map(f => f.name))

                    fence_rule_run(user, last_location, location, fences_entered, "entered")
                    fence_rule_run(user, location, last_location, fences_exited, "exited")

                    var my_fences = fences.filter(
                      function(f: any) { return f.user_id == location.user_id }
                    ).map(function(fence: any) { return fence.id })
                    var latest = {
                      location_id: location.id,
                      fences: my_fences
                    }
                    return db.update_user_latest(location.user_id, latest)
                  })
              })
          }, function() {
            console.log('skipping user freshen. historical point received.')
          })
      })
  })
}

function newer_user_location(user, location) {
  return new Promise(function(resolve, reject) {
    if (user.latest && user.latest.location_id) {
      let last_location = db.loadFile(user.latest.location_id)
      console.log('newer_user_location', user.username, user.id, location.date, last_location.date)
      if (location.date > last_location.date) {
        resolve(last_location)
      } else {
        reject()
      }
    } else {
      resolve(location)
    }
  })
}

function fences_diff(a: any[], b: any[]) {
  return a.filter(x => b.map(f => f.id).indexOf(x.id) == -1)
}

function fence_rule_run(user, location_outside, location_inside, fences, direction: Direction) {
  fences.forEach(function(fence) {
    db.rule_list_by_fence(fence.id)
      .then(function(rules_cursor) {
        rules_cursor.toArray()
          .then(function(rules) {
            console.log('fence', fence.name, 'rules', rules.map(function(rule) { return rule.kind }))
            rules.forEach(function(rule) {
              if (rule.kind == 'alert') {
                rule_alert_go(user, location_outside, location_inside, fence, rule, direction)
              }
            })
          })
      })
  })
}

type Direction = "entered" | "exited"

function rule_alert_go(user, location_outside, location_inside, fence, rule, direction: Direction) {
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

function process_user_stats(client, msg) {
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

function process_activity_stats(client, msg) {

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

function process_stream_follow(client, msg) {
  var stream_id = uuid.v4().substr(0, 8)
  if (msg.params.username) {
    stream_follow_user(stream_id, client, msg)
  } else {
    if (client.flags.authenticated) {
      msg.params.id = client.flags.authenticated.user_id
      stream_follow_user(stream_id, client, msg) // follow me too
      db.friending_me(client.flags.authenticated.user_id).then(function(friend_ids) {
        friend_ids.forEach(function(friend_id) {
          msg.params.id = friend_id
          stream_follow_user(stream_id, client, msg)
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

function stream_follow_user(stream_id, client, msg) {
  var findby: any = { username: msg.params.username }
  if (msg.params.id) { findby = { id: msg.params.id } }
  db.find_user_id_by(findby).then((user_id) => db.get_user(user_id)).then(function(user) {
    var auth = false

    if (msg.params.key) {
      var rule = user.access[msg.params.key]
      if (typeof rule === 'object') {
        if (rule_check(rule)) {
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
      send_last_locations(client, stream_id, user.id, start, stop, count, type, order)

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

function process_stream_unfollow(client, msg) {
}

function rule_check(rule) {
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

function send_last_locations(client, stream_id, user_id, start, stop, count, type, order) {
  //db.count_locations_for(user_id, start, stop, count, type, order)
  //  .then(function(qcount){}) // stream helper
  let timer = new Date()
  start = start || moment().subtract(1, 'days').format()
  stop = stop || moment().format()
  db.find_locations_for(user_id, start, stop, count, type, order)
    .then(function(locations) {
      console.log('send_last_locations', user_id, start, '-', stop, locations.length + '/' + count, 'points')
      locations.forEach(function(location) {
        location_fences_load(location).then(function(location) {
          influxWrite('send_last_locations', (new Date()).getTime() - timer.getTime())
          protocol.respond_success(client, stream_id, location)
        })
      })
    })
}

function location_fences_load(location) {
  if (location.type == 'location') {
    return fences_add(location)
      .then(rules_add)
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

function gravatar_url(email) {
  var md5sum = crypto.createHash('md5')
  md5sum.update(email)
  var url = "//www.gravatar.com/avatar/" + md5sum.digest('hex')
  return url
}

function process_auth_email(client, msg) {
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

function process_auth_session(client, msg) {
  if (client.flags.authenticated) {
    protocol.respond_fail(client, msg.id, {
      code: "AF1", message: "already authenticated",
      user_id: client.flags.authenticated.user_id
    })
  } else {
    server.find_session(msg.params.device_key).then(function(session) {
      if (session) {
        if (session.email) {
          client_auth_check(client, msg, session)
        } else {
          client_auth_trusted(client, session)
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

function client_auth_check(client, msg, session) {
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
    var new_user = user_new(session.email, session.device_id)
    var email = emailer.build_admin_email('New user ' + session.email)
    emailer.send_email(email)
    return db.ensure_user(new_user)
  }).then(function(user) {
    clog(client, '* token validate ' + JSON.stringify(user))
    server.token_validate(msg.params.device_key, user.id, session.device_id).then(function(session) {
      clog(client, "post token validate w/ " + JSON.stringify(session))
      client_auth_trusted(client, session)
      protocol.respond_success(client, msg.id, { user: { id: user.id } })
    })
  })
}

function client_auth_trusted(client, session) {
  client.flags.authenticated = session
  clog(client, "logged in user id " + session.user_id + " on device " + JSON.stringify(session.device_id))
}

function user_new(email, device_id) {
  var user = {
    email: email,
    created_at: new Date().toISOString(),
    devices: [device_id],
    friends: [],
    access: {}
  }
  return user
}

function process_user_detail(client, msg) {
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
          safe_user.photo = gravatar_url(user.email)
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
            safe_user.photo = gravatar_url(user.email)
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
          console.log('process_user_detail for', user.username, 'key check', msg.params.key)
          var rule = user.access[msg.params.key]
          if (typeof rule === 'object') {
            if (rule_check(rule)) {
	      key_auth = true
	    } else {
              protocol.respond_fail(client, msg.id, { message: "invalid key" })
              return
	    }
          }
	}
      }
      if (!key_auth) {
        if (user.access.public) {
          user_promise = user_promise.then(safe_user => {
            safe_user.photo = gravatar_url(user.email)
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

function process_user_update(client, msg) {
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

function process_user_access_add(client, msg) {
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

function process_user_access_del(client, msg) {
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

function process_user_payment(client, msg) {
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
        user_add_time(user, msg.params.product)
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

function user_add_time(user, product) {
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

function process_user_friend(client, msg) {
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

function process_fence_add(client, msg) {
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

function process_device_list(client, msg) {
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

function process_device_add(client, msg) {
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

function process_device_genkey(client, msg) {
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

function process_fence_list(client, msg) {
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

function process_fence_get(client, msg) {
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

function process_fence_del(client, msg) {
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

function process_fence_update(client, msg) {
  if (client.flags.authenticated) {
    db.fence_get(msg.params.id).then(function(fence) {
      if (fence.user_id == client.flags.authenticated.user_id) {
        if (msg.params.name) { fence.name = msg.params.name }
        if (msg.params.geojson) {
          // typescript gets confused on geometry.coordinates.coordinates
          let turfcoord: any = turfhelp.polygon(msg.params.geojson.geometry).geometry.coordinates
          fence.geojson = { type: turfcoord.type, coordinates: turfcoord.coordinates }
          fence.area = parseInt(geojsonArea.geometry(msg.params.geojson.geometry))
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

function process_rule_list(client, msg) {
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

function process_rule_add(client, msg) {
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

function process_rule_del(client, msg) {
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

function process_stream_zip(client, msg) {
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

function process_stream_ziplist(client, msg) {
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

async function influxWrite(module, value) {
  try {
    let url = settings.influx.url + '/write?db=' + settings.influx.database
    const post = bent.default('POST', 204); // accept only 204
    let reading = "response_time,module=" + module + " value=" + value
    const response = await post(url, reading);
  } catch (err) {
    console.log('influxWrite', err)
  }
}
