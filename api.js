// nodejs
var timers = require('timers')
var crypto = require('crypto')
var uuid = require('node-uuid');
var os = require('os')

// npm
var moment = require('moment')
var rethink = require('rethinkdb')
var Promise = require('bluebird');
var geojsonArea = require('geojson-area')

// local
var major_version = 2
var settings = require('./lib/settings')(major_version)
var protocol = require('./lib/protocol-v' + major_version)(settings.api)
var server = require('./lib/server').factory()
var db = require('./lib/dblib').factory(rethink, rethink.connect(settings.rethinkdb))
var emailer = require('./lib/email').factory(settings.email)

// config-dependent
var stripe = require('stripe')(settings.stripe.key);

var motd = "version:" + settings.api.version + " server:" + settings.api.hostname
console.log("api", motd)
console.log("rethinkdb", "host:", settings.rethinkdb.host)

db.setup(function(){
  server.listen(settings.api.listen_port)
  db.changes().then(function(cursor){
    cursor.on("data", activity_added)
  })
})

server.on('listening', function () {
  console.log("api listening on *:" + settings.api.listen_port)
  timers.setInterval(function() {
      progress_report();
      server.timer.reset();
    }, settings.api.progress_report_timer)
})

server.on('connection', handleConnection)

server.on('close', function() {console.log('closed')})
server.on('error', function(e) {console.log('net.sever err', e)})

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
  server.timer.hits += 1
  switch(msg.method) {
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

function activity_added(activity_chg){
  if(activity_chg.new_val && activity_chg.new_val.type === "location") {
    pump_location(activity_chg.new_val)
  }
}

function newer_user_location(location) {
  return db.get_user(location.user_id).then(function(user){
    return new Promise(function(resolve) {
      if(user.latest && user.latest.location_id){
        db.activity_get(user.latest.location_id)
          .then(function(last_location){
            if(last_location) {
              if(location.date > last_location.date){
                resolve(location)
              }
            }
          })
      } else {
        resolve(location)
      }
    })
  })
}

function fences_for(location) {
  return db.fences_intersect(rethink.point(location.longitude, location.latitude),
                             {user_id: location.user_id})
    .then(function(cursor){
      return cursor.toArray()
  })
}

function rules_for(user_id, fence_id) {
  return db.rule_list(user_id).then(function(cursor){
    return cursor.toArray().filter(function(rule){
      return rule.fence_id === fence_id
    })
  })
}

function pump_location(location) {
  console.log('pump_location for device ' + location.device_id)
  server.clients.list.forEach(function(client) {
    client.following.forEach(function(search){
      var stream_id = search(location)
      if(stream_id){
        location_fences_load(location).then(function(location_enhanced){
          protocol.respond_success(client, stream_id, location_enhanced)
        })
      }
    })
  })
}

function progress_report() {
  var now = new Date();
  var period = (now - server.timer.mark) / 1000
  var rate = server.timer.hits / period
  var stats = { type: "status_report",
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
  var parts = []
  parts.push(moment().format())
  if(client.flags.authenticated){
    var id_id = client.flags.authenticated.device_id.substr(0, 8) + ':' +
                client.flags.authenticated.user_id.substr(0, 8)
    parts.push(id_id)
  } else if(client.socket) {
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
    if(client.flags.stats) {
      var stats_str = JSON.stringify(status)
      clog(client, stats_str)
      protocol.respond_success(client, client.flags.stats, status)
    }
  })
}

function fences_add(location) {
  return fences_for(location).then(function(fences){
    if(fences.length > 0) {
      location.fences = fences.map(function(fence){return fence.id})
    }
    return location
  })
}

function rules_add(location) {
  if(location.fences) {
    return Promise.all(location.fences.map(function(fence_id){
      return rules_for(location.user_id, fence_id)
        .then(function(rules){
          if(rules.length > 0) {
            if(!location.rules) { location.rules = []}
            Array.prototype.push.apply(location.rules, rules.map(function(rule){
              return {id: rule.id, fence_id: rule.fence_id, kind: rule.kind}
            }))
          }
        })
    })).then(function(){
      return location
    })
  } else {
    return Promise.resolve(location) // no fences
  }
}

/* API calls */

function process_activity_add(client, msg) {
  if(client.flags.authenticated){
    msg.params.user_id = client.flags.authenticated.user_id
    msg.params.device_id = client.flags.authenticated.device_id
    var now = new Date()
    msg.params.received_at = now.toISOString()

    db.activity_add(msg.params)
      .then(function(result) {
        if(result.errors === 0) {
          protocol.respond_success(client, msg.id, {message: "saved",
                                                    id: msg.params.id})
          if(msg.params.type === 'location') {
            user_latest(msg.params)
          }
        } else {
          var fail = {message: result.first_error};
          protocol.respond_fail(client, msg.id, fail)
        }
      })

  } else {
    var auth_fail = {message: 'not authorized'};
    protocol.respond_fail(client, msg.id, auth_fail)
  }
}

function user_latest(location) {
  newer_user_location(location)
    .then(function(newer_location) {
      fences_for(newer_location)
        .then(function(fences){
          var latest = { location_id: newer_location.id,
                          fences: fences.map(function(fence){return fence.id}) }
          console.log('updating user last location', latest)
          return db.update_user_latest(location.user_id, latest)
        })
    })
}

function process_user_stats(client, msg) {
  var stats = {}
  db.users_link_count().then(function(link_count){
    stats.link_count = link_count
    console.log('stats', link_count)
  }).then(function(){
    db.users_count().then(function(count){
      stats.count = count
      protocol.respond_success(client, msg.id, stats)
      return stats
    })
  })
}

function process_activity_stats(client, msg) {
  var stats = {}
  var allfilter = {}
  if(client.flags.authenticated){
    allfilter.user_id = client.flags.authenticated.user_id
  }
  console.log('process_activity_stats', '1 allfilter', allfilter)
  db.activity_count(allfilter).then(function(count){
    stats.total = count
    // 24 hour count
    var today = new Date()
    var yesterday = new Date(today - 1000 * 60 * 60 * 24)
    allfilter.start = yesterday
    allfilter.stop = today
    console.log('process_activity_stats', '2 allfilter', allfilter)
    db.activity_count(allfilter).then(function (c24){
      console.log('process_activity_stats', '2 allfilter result', c24)
      stats.day = {total: c24,
                   start: yesterday.toISOString(),
                   stop: today.toISOString()}
      if(msg.params && msg.params.type) {
        allfilter.type = msg.params.type
        console.log('process_activity_stats', '3 allfilter', allfilter)
        db.activity_count(allfilter).then(function (ct24){
          stats.day[msg.params.type] = ct24
          if(allfilter.user_id){
            db.get_user(allfilter.user_id).then(function(user){
              stats.username = user.username
              protocol.respond_success(client, msg.id, stats)
            })
          } else {
            console.log('process_activity_stats', '4 allfilter', allfilter)
            allfilter.distinct_user = true
            db.activity_count(allfilter).then(function (uct24){
              stats.day[msg.params.type + "_users"] = uct24
              protocol.respond_success(client, msg.id, stats)
            })
          }
        })
      } else {
        protocol.respond_success(client, msg.id, stats)
      }
    })
  })
}

function process_stream_follow(client, msg) {
  db.find_user_by({username: msg.params.username}).then(function(user){
    var stream_id = uuid.v4().substr(0, 8)
    var auth = false

    if(msg.params.key) {
      var rule = user.access[msg.params.key]
      if(typeof rule === 'object') {
        if(rule_check(rule)) {
          auth = true
        }
      }
    }
    if(client.flags.authenticated){
      if(user.id === client.flags.authenticated.user_id ||
         user.friends.indexOf(client.flags.authenticated.user_id) >= 0){
        auth = true
      }
    }
    if(user.access.public){
      auth = true
    }

    if(auth) {
      if(!msg.params.count){ msg.params.count = 2 }
      var count = msg.params.count < 2000 ? msg.params.count : 2000
      var start = msg.params.start && (new Date(msg.params.start))
      var stop = msg.params.stop && (new Date(msg.params.stop))
      var type = msg.params.type
      var order = msg.params.order
      if(msg.params.follow) {
        // a running query if no stop/start specified
        client.following.push(function(location){
          if(location.user_id === user.id){
            return stream_id
          }
        })
      }

      protocol.respond_success(client, msg.id, {stream_id: stream_id})
      send_last_locations(client, stream_id, user.id, start, stop, count, type, order)

    } else {
      protocol.respond_fail(client, msg.id, {code: "NOACCESS",
                                             message: msg.params.username+" is not sharing location data with you."})
    }

  }, function() {
      protocol.respond_fail(client, msg.id, {code: "UNF",
                                             message: "username "+msg.params.username+" not found"})
  })
}

function process_stream_unfollow(client, msg) {
}

function rule_check(rule){
  // read
  if(rule.scopes.indexOf('read') > -1) {
    // time
    if(rule.expires_at) {
      var now = new Date()
      var expire = (new Date(rule.expires_at))
      if(expire > now){
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
  console.log('send_last_locations',user_id, stream_id, start, stop, count, type, order)
  //db.count_locations_for(user_id, start, stop, count, type, order)
  //  .then(function(qcount){}) // stream helper
    db.find_locations_for(user_id, start, stop, count, type, order)
      .then(function(cursor){
        cursor.each(function(err, location){
          location_fences_load(location).then(function(location){
            protocol.respond_success(client, stream_id, location)
          })
        })
      })
}

function location_fences_load(location) {
  if(location.type == 'location') {
    return fences_add(location)
      .then(rules_add)
        .then(function(location){
          if(location.rules) {
            console.log('rules triggered', location.rules)
            delete location.longitude
            delete location.latitude
          }
          return location
        })
  } else {
    return Promise.resolve(location)
  }
}

function gravatar_url(email, size) {
  var md5sum = crypto.createHash('md5')
  md5sum.update(email)
  var url = "//www.gravatar.com/avatar/"+md5sum.digest('hex')
  return url
}

function process_auth_email(client, msg) {
  var params = msg.params
  console.log('auth_email '+JSON.stringify(msg))
  server.create_token_temp(params)
    .then(function(token){
      var email_opts = emailer.build_token_email(params.email, params.device_id, token)
      console.log('auth_email send_email begin.')
      emailer.send_email(email_opts)
      protocol.respond_success(client, msg.id, {status: "OK"})
    }, function(err) {
      console.log('auth_email error '+err);
    })
}

function process_auth_session(client, msg) {
  if(client.flags.authenticated){
    protocol.respond_fail(client, msg.id, {code: "AF1", message: "already authenticated",
                                           user_id: client.flags.authenticated.user_id})
  } else {
    server.find_session(msg.params.device_key).then(function(session){
      if(session) {
        console.log("session loaded:", session)
        if(session.email) {
          client_auth_check(client, msg, session)
        } else {
          client_auth_trusted(client, session)
          protocol.respond_success(client, msg.id, {user:{id:session.user_id}})
        }
      } else {
        // device_key not found
        protocol.respond_fail(client, msg.id, {code: "BK1", message: "bad device_key"})
      }
    }).catch(function(err){console.log('Err! '+err)})
  }
}

function client_auth_check(client, msg, session) {
  db.find_user_by({email_downcase: session.email.toLowerCase()}).then(function(user){
    clog(client, 'authenticating session for '+session.email)
    if(user.devices.indexOf(session.device_id) > -1) {
      clog(client, '* existing device '+session.device_id);
      return user
    } else {
      clog(client, '* adding device '+session.device_id);
      return db.user_add_device(user.id, session.device_id).then(function(){return user})
    }
  }, function(err){
    clog(client, '* user not found by '+session.email+' '+JSON.stringify(err))
    var new_user = user_new(session.email, session.device_id)
    var email = emailer.build_admin_email('New user '+session.email)
    emailer.send_email(email)
    return db.ensure_user(new_user)
  }).then(function(user){
    clog(client, '* token validate '+JSON.stringify(user))
    server.token_validate(msg.params.device_key, user.id, session.device_id).then(function(session){
      clog(client, "post token validate w/ "+JSON.stringify(session))
      client_auth_trusted(client, session)
      protocol.respond_success(client, msg.id, {user:{id:user.id}})
    })
  })
}

function client_auth_trusted(client, session) {
  client.flags.authenticated = session
  clog(client, "Trusted user id "+session.user_id.substr(0,8))
}

function user_new(email, device_id){
  var user = {email:email,
              created_at: new Date().toISOString(),
              devices: [device_id],
              friends: [],
              access: {}
             }
  return user
}

function process_user_detail(client, msg) {
  // default value is the authenticated user
  var filter = {}

  if(msg.params && Object.keys(msg.params).length > 0){
    if(msg.params.id) {
      filter = {id: msg.params.id}
    } else if(msg.params.username) {
      filter = {username: msg.params.username}
    }
  } else {
    if(client.flags.authenticated) {
      filter = {id: client.flags.authenticated.user_id}
    } else {
      protocol.respond_fail(client, msg.id, {message:"Not authenticated"})
      return
    }
  }

  console.log('process_user_detail', filter)
  db.find_user_by(filter).then(function(user){
    var safe_user = {id: user.id,
                     username: user.username,
                     friends: []}
    if(client.flags.authenticated) {
      var client_user_id = client.flags.authenticated.user_id
      if(user.id == client_user_id)  {
        safe_user.email = user.email
        safe_user.photo = gravatar_url(user.email)
        safe_user.friends = user.friends
        safe_user.access = user.access
        safe_user.level = user.level
        safe_user.latest = user.latest
      } else {
        if(user.friends.indexOf(client_user_id) > -1) {
          safe_user.photo = gravatar_url(user.email)
          safe_user.friends.push(client_user_id)
        }
      }
    } else {
      if(user.access.public){
        safe_user.photo = gravatar_url(user.email)
      } else {
        protocol.respond_fail(client, msg.id, {message:"Profile is private"})
        return
      }
    }

    protocol.respond_success(client, msg.id, safe_user)
  }, function(err){
    protocol.respond_fail(client, msg.id, err)
  })
}

function process_user_update(client, msg) {
  if(client.flags.authenticated){
    // default value is the authenticated user
    db.update_user_by(client.flags.authenticated.user_id, msg.params).then(function(result){
      protocol.respond_success(client, msg.id, result)
    }, function(err){
      protocol.respond_fail(client, msg.id, err)
    })
  } else {
    protocol.respond_fail(client, msg.id, {message:"Not authenticated"})
  }
}

function process_user_access_add(client, msg) {
  if(client.flags.authenticated){
    db.find_user_by({id: client.flags.authenticated.user_id}).then(function(user){
      var key = uuid.v4().substr(0,18)
      var rule = {created_at: new Date(),
                  scopes: ["read"]}
      if(msg.params.expires_at){
        rule.expires_at = msg.params.expires_at
      }
      user.access[key] = rule
      db.update_user_access(client.flags.authenticated.user_id, user.access).then(function(result){
        protocol.respond_success(client, msg.id, result)
      }, function(err){
        protocol.respond_fail(client, msg.id, err)
      })
    })
  }
}

function process_user_access_del(client, msg) {
  if(client.flags.authenticated){
    db.find_user_by({id: client.flags.authenticated.user_id}).then(function(user){
      if(user.access[msg.params.key]){
        user.access[msg.params.key] = rethink.literal()
        db.update_user_access(client.flags.authenticated.user_id, user.access)
          .then(function(result){
          protocol.respond_success(client, msg.id, result)
        }, function(err){
          protocol.respond_fail(client, msg.id, err)
        })
      }
    })
  }
}

function process_user_payment(client, msg) {
  if(client.flags.authenticated){
    var client_user_id = client.flags.authenticated.user_id
    db.find_user_by({id: client.flags.authenticated.user_id}).then(function(user){
      // user loaded, process payment
      console.log('process_user_payment', 'stripe.customers.create', user.email)
      stripe.customers.create({
        email: user.email,
        card: msg.params.token,
        metadata: { user_id: client_user_id, email: user.email, level: user.level }
      }).then(function(customer) {
        console.log('process_user_payment', 'stripe customer', customer)
        var amount
        if(msg.params.product == "ex1mo") { amount = 300}
        if(msg.params.product == "ex6mo") { amount = 1500}
        if(amount) {
          return stripe.charges.create({
            amount: amount,
            currency: 'usd',
            customer: customer.id
          });
        } else {
          return new Promise(function(resolve, reject) {
            reject({code:'noproduct', message:"No product found"})
          })
        }
      }).then(function(charge) {
        // New charge created on a new customer
        console.log('process_user_payment', 'stripe charge', charge)
        protocol.respond_success(client, msg.id, {amount: 0.02})
        var email_payment = emailer.build_payment_email(user.email, msg.params.product, charge.amount)
        emailer.send_email(email_payment)
        user_add_time(user, msg.params.product)
        var email_admin = emailer.build_admin_email('User payment '+user.email+' '+msg.params.product)
        emailer.send_email(email_admin)
      }, function(err) {
        // Deal with an error
        console.log('process_user_payment', 'error', err)
        protocol.respond_fail(client, msg.id, {message: err.message})
        var email = emailer.build_admin_email('User payment error '+err.message)
        emailer.send_email(email)
      });
    })
  } else {
    protocol.respond_fail(client, msg.id, {message:"Not authenticated"})
  }
}

function user_add_time(user, product){
  var endTime
  console.log('user_add_time', user.username, user.level)
  if(user.level && user.level.extra) {
    endTime = new Date(user.level.extra)
  } else {
    endTime = new Date()
  }
  console.log('user_add_time', user.username, 'endTime', endTime)
  var days = 24*60*60*1000
  var duration
  if(product == "ex1mo") { duration = 1*30*days }
  if(product == "ex6mo") { duration = 6*30*days }
  console.log('user_add_time', user.username, 'duration', duration)
  if(duration) {
    var newEndTime = new Date(endTime.valueOf() + duration)
    console.log('user_add_time', user.username, 'newEndTime', newEndTime)
    db.update_user_level(user.id, {extra: newEndTime.toISOString()} )
  }
}

function process_user_friend(client, msg) {
  if(client.flags.authenticated){
    var client_user_id = client.flags.authenticated.user_id
    db.find_user_by({username:msg.params.username}).then(function(friend){
      db.user_add_friend(client_user_id, friend.id).then(function(result){
        protocol.respond_success(client, msg.id, result)
        // inefficient
        db.get_user(client_user_id).then(function(user){
          var email = emailer.build_friend_email(friend.email, user.username)
          emailer.send_email(email)
        })
      }, function(err){
        protocol.respond_fail(client, msg.id, err)
      })
    })
  } else {
    protocol.respond_fail(client, msg.id, {message:"Not authenticated"})
  }
}

function process_fence_add(client,msg){
  if(client.flags.authenticated){
    console.log('fence_add', msg)
    var fence = {}
    fence.id = uuid.v4().substr(0,18)
    fence.created_at = new Date()
    fence.name = msg.params.name
    fence.user_id = client.flags.authenticated.user_id
    db.fence_add(fence).then(function(result){
      if(result.inserted == 1) {
        protocol.respond_success(client, msg.id, fence)
      }
    })
  } else {
    protocol.respond_fail(client, msg.id, {message:"Not authenticated"})
  }
}

function process_fence_list(client,msg){
  if(client.flags.authenticated){
    db.fence_list(client.flags.authenticated.user_id).then(function(cursor){
      cursor.toArray().then(function(fences){
        protocol.respond_success(client, msg.id, fences)
      })
    })
  } else {
    protocol.respond_fail(client, msg.id, {message:"Not authenticated"})
  }
}

function process_fence_get(client,msg){
  if(client.flags.authenticated){
    db.fence_get(msg.params.id).then(function(fence){
      if(fence.user_id == client.flags.authenticated.user_id) {
        protocol.respond_success(client, msg.id, fence)
      } else {
        db.get_user(fence.user_id).then(function(owner){
          if(owner.friends.indexOf(client.flags.authenticated.user_id) >= 0) {
            protocol.respond_success(client, msg.id, fence)
          }
        })
      }
    })
  } else {
    protocol.respond_fail(client, msg.id, {message:"Not authenticated"})
  }
}

function process_fence_del(client,msg){
  if(client.flags.authenticated){
    db.fence_get(msg.params.id).then(function(fence){
      if(fence.user_id == client.flags.authenticated.user_id) {
        db.fence_del(msg.params.id).then(function(result){
          protocol.respond_success(client, msg.id, fence)
        })
      }
    })
  } else {
    protocol.respond_fail(client, msg.id, {message:"Not authenticated"})
  }
}

function process_fence_update(client,msg){
  if(client.flags.authenticated){
    db.fence_get(msg.params.id).then(function(fence){
      if(fence.user_id == client.flags.authenticated.user_id) {
        if(msg.params.name) { fence.name = msg.params.name }
        if(msg.params.geojson) {
          fence.geojson = rethink.geojson(msg.params.geojson.geometry)
          fence.area = parseInt(geojsonArea.geometry(msg.params.geojson.geometry))
        }
        db.fence_update(fence).then(function(result){
          if(fence.user_id == client.flags.authenticated.user_id) {
            protocol.respond_success(client, msg.id, fence)
          }
        }, function(err){
          console.log('process_fence_update', err)
        })
      }
    })
  } else {
    protocol.respond_fail(client, msg.id, {message:"Not authenticated"})
  }
}

function process_rule_list(client,msg){
  if(client.flags.authenticated){
    db.rule_list(client.flags.authenticated.user_id).then(function(cursor){
      cursor.toArray().then(function(rules){
        protocol.respond_success(client, msg.id, rules)
      })
    })
  } else {
    protocol.respond_fail(client, msg.id, {message:"Not authenticated"})
  }
}

function process_rule_add(client,msg){
  if(client.flags.authenticated){
    console.log('rule_add', msg)
    var rule = {}
    rule.created_at = new Date()
    rule.user_id = client.flags.authenticated.user_id
    rule.fence_id = msg.params.fence_id
    rule.kind = 'cloaked'
    if(msg.params.kind && msg.params.kind.length > 0) {
      rule.kind = msg.params.kind
    }
    db.rule_add(rule).then(function(result){
      protocol.respond_success(client, msg.id, result)
    })
  } else {
    protocol.respond_fail(client, msg.id, {message:"Not authenticated"})
  }
}

function process_rule_del(client,msg){
  if(client.flags.authenticated){
    db.rule_get(msg.params.id).then(function(rule){
      if(rule.user_id == client.flags.authenticated.user_id) {
        db.rule_del(rule.id).then(function(result){
          protocol.respond_success(client, msg.id, rule)
        })
      }
    })
  } else {
    protocol.respond_fail(client, msg.id, {message:"Not authenticated"})
  }
}

function process_stream_zip(client, msg) {
  if(client.flags.authenticated){
    var user_id = client.flags.authenticated.user_id
    server.zipq_add(user_id)
      .then(function(){
        protocol.respond_success(client, msg.id, {status: 'OK'})
      })
  } else {
    protocol.respond_fail(client, msg.id, {message:"Not authenticated"})
  }
}

function process_stream_ziplist(client, msg) {
  if(client.flags.authenticated){
    var user_id = client.flags.authenticated.user_id
    server.zipq_get(user_id)
      .then(function(list){
        protocol.respond_success(client, msg.id, list)
      })
  } else {
    protocol.respond_fail(client, msg.id, {message:"Not authenticated"})
  }
}
