"use strict"

// nodejs
var timers = require('timers')
var crypto = require('crypto')
var uuid = require('node-uuid');
var os = require('os')

// npm
var moment = require('moment')
var emailer = require('nodemailer')
var rethink = require('rethinkdb')

// local
var major_version = 2
var settings = require('./lib/settings')(major_version)
var protocol = require('./lib/protocol-v'+major_version)(settings.api)
var server = require('./lib/server').factory()
var db = require('./lib/dblib').factory(rethink)

console.log("v:"+settings.api.version+" host:"+settings.api.hostname)

db.setup(function(){
  server.listen(settings.api.listen_port)
  db.changes().then(function(cursor){
    cursor.on("data", activity_added)
  })
})

server.on('listening', function() {
  console.log("api listening on *:"+settings.api.listen_port)
  timers.setInterval(function() {
      progress_report();
      server.timer.reset();
    }, settings.api.progress_report_timer)
})

server.on('connection', handleConnection)

server.on('close', function() {console.log('closed')})

function handleConnection(socket) {
  var client = server.build_client(socket)
  protocol.connection(client, client_dispatch, end_of_connection)
  server.clients.add(client)
  clog(client, 'connected. '+server.clients.list.length+' clients.');
  progress_report()
}

function end_of_connection(client) {
  server.clients.remove(client)
  clog(client, 'disconnected '+JSON.stringify(client.flags.authenticated))
  progress_report()
}

function client_dispatch(me, msg) {
  switch(msg.method) {
    case 'auth.email': process_auth_email(me, msg); break;
    case 'auth.session': process_auth_session(me, msg); break;
    case 'user.detail': process_user_detail(me, msg); break;
    case 'user.update': process_user_update(me, msg); break;
    case 'user.friend': process_user_friend(me, msg); break;
    case 'activity.add': process_activity_add(me, msg); break;
    case 'stream.follow': process_stream_follow(me, msg); break;
    case 'stream.unfollow': process_stream_unfollow(me, msg); break;
    case 'stream.stats': me.flags.stats = msg.id; break;
  }
}

function activity_added(activity_chg){
  if(activity_chg.new_val.type == "location") {
    pump_location(activity_chg.new_val)
  }
}

function pump_location(location) {
  console.log('pump_location for device '+location.device_id)
  server.clients.list.forEach(function(client) {
    client.following.forEach(function(search){
      var stream_id = search(location)
      if(stream_id){
        protocol.respond_success(client, stream_id, location)
      }
    })
  })
}

function send_last_locations(client, stream_id, user_id, start, stop, count) {
  var now = (new Date()).toISOString()
  db.find_locations_for(user_id, start, stop, count).then(function(locations_cursor){
    locations_cursor.each(function(err, location){
      protocol.respond_success(client, stream_id, location)
    })
  })
}

function progress_report() {
  var now = new Date();
  var period = (now - server.timer.mark) / 1000
  var rate = server.timer.hits / period
  var stats = {       type: "status_report",
                    server: settings.api.hostname,
                   version: settings.api.version,
                      date: now.toISOString(),
                  msg_rate: rate,
              client_count: server.clients.list.length,
                   freemem: os.freemem()
              }
  db.activity_add(stats)
  console.log('status report - '+rate+' hits/sec. '+server.clients.list.length+' clients.')
  pump(stats)
}

function clog(client, msg) {
  var parts = []
  parts.push(moment().format())
  if(client.flags.authenticated){
    parts.push(client.flags.authenticated.device_id+':'+client.flags.authenticated.user_id)
  } else if(client.socket) {
    parts.push(client.socket.remoteAddress+':'+client.socket.remotePort)
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

/* API calls */

function process_activity_add(client, msg) {
  if(client.flags.authenticated){
    msg.params.user_id = client.flags.authenticated.user_id
    msg.params.device_id = client.flags.authenticated.device_id
    db.activity_add(msg.params).then(function(){
      protocol.respond_success(client, msg.id, {message: "saved", id: msg.params.id})
    })
  } else {
    var fail = {message: 'not authorized'};
    protocol.respond_fail(client, msg.id, fail)
  }
}

function process_stream_follow(client, msg) {
  db.find_user_by({username: msg.params.username}).then(function(user){
    var stream_id = uuid.v4().substr(0,8)
    var auth = false

    if(client.flags.authenticated){
      if(user.id == client.flags.authenticated.user_id ||
         user.friends.indexOf(client.flags.authenticated.user_id) >= 0){
        auth = true
      }
    } else {
      if(user.access.public){
        auth = true
      }
    }

    if(auth) {
      client.following.push(function(location){
        if(location.user_id == user.id){
          return stream_id
        }
      })
      protocol.respond_success(client, msg.id, {stream_id: stream_id})
      var count = msg.params.count > 0 ? msg.params.count : 2
      var start = msg.params.start && (new Date(msg.params.start))
      var stop = msg.params.stop && (new Date(msg.params.stop))
      send_last_locations(client, stream_id, user.id, start, stop, count)
    } else {
      protocol.respond_fail(client, msg.id, {code: "NOACCESS",
                                             message: msg.params.username+" is not sharing location data with you."})
    }

  }, function() {
      protocol.respond_fail(client, msg.id, {code: "UNF",
                                             message: "username "+msg.params.username+" not found"})
  })
}

function gravatar_url(email, size) {
  var md5sum = crypto.createHash('md5')
  md5sum.update(email)
  var url = "http://www.gravatar.com/avatar/"+md5sum.digest('hex')+"?s="+size
  return url
}

function process_unfollow(me, msg) {
  var follow_idx = me.following.indexOf(msg.username)
  if(follow_idx >= 0) {
    delete me.following[follow_idx]
    var msg = {type: "unfollow",
               username: msg.username,
               status: "OK",
               message: "stopped following"}
    clog(me,"-> "+JSON.stringify(msg))
    client_write(me, msg)
  } else {
    var msg = {type: "unfollow",
               username: msg.username,
               status: "ERR",
               message: "not following"}
    clog(me,"-> "+JSON.stringify(msg))
    client_write(me, msg)
  }
}

function process_auth_email(client, msg) {
  var params = msg.params
  console.log('auth_email '+JSON.stringify(msg))
  server.create_token_temp(params)
    .then(function(token){
      protocol.respond_success(client, msg.id, {status: "OK"})
      var email_opts = build_token_email(params.email, params.device_id, token)
      send_email(email_opts)
    })
}

function process_auth_session(client, msg) {
  if(client.flags.authenticated){
    protocol.respond_fail(client, msg.id, {code: "AF1", message: "already authenticated",
                                           user_id: client.flags.authenticated.user_id})
  } else {
    console.log("session lookup device_key: "+msg.params.device_key)
    server.find_session(msg.params.device_key).then(function(session){
      if(session) {
        console.log("session loaded: "+JSON.stringify(session))
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
  db.find_user_by(rethink.row('email').eq(session.email)).then(function(user){
    clog(client, 'authenticating session for '+session.email)
    if(user.devices.indexOf(session.device_id) > -1) {
      clog(client, '* existing device '+session.device_id);
      return user
    } else {
      clog(client, '* adding device '+session.device_id);
      return db.user_add_device(user.id, session.device_id).then(function(){return user})
    }
  }, function(){
    console.log('user not found by '+session.email)
    var new_user = user_new(session.email, session.device_id)
    return db.ensure_user(new_user)
  }).then(function(user){
    clog(client, 'token validate '+JSON.stringify(user))
    server.token_validate(msg.params.device_key, user.id, session.device_id).then(function(session){
      clog(client, "post token validate w/ "+JSON.stringify(session))
      client_auth_trusted(client, session)
      protocol.respond_success(client, msg.id, {user:{id:user.id}})
    })
  })
}

function client_auth_trusted(client, session) {
  client.flags.authenticated = session
  clog(client, "client flag set to trusted user "+session.user_id)
}

function user_new(email, device_id){
  var user = {email:email,
              devices: [device_id],
              friends: [],
              access: {}
             }
  return user
}

function process_user_detail(client, msg) {
  // default value is the authenticated user
  var filter = {}

  if(msg.params){
    if(msg.params.username) {
      filter = {username: msg.params.username}
    }
  } else {
    if(client.flags.authenticated) {
      filter = {id: client_user_id}
    } else {
      protocol.respond_fail(client, msg.id, {message:"Not authenticated"})
      return
    }
  }

  console.log('process_user_detail', filter)
  db.find_user_by(filter).then(function(user){
    var safe_user = {id: user.id,
                     username: user.username}
    if(client.flags.authenticated) {
      var client_user_id = client.flags.authenticated.user_id
      if(user.id == client_user_id)  {
        safe_user.email = user.email
        safe_user.photo = gravatar_url(user.email)
        safe_user.friends = user.friends
        safe_user.access = user.access
      } else {
        if(user.friends.indexOf(client_user_id) > -1) {
          safe_user.photo = gravatar_url(user.email)
          safe_user.friends = [client_user_id]
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

function process_user_friend(client, msg) {
  if(client.flags.authenticated){
    var client_user_id = client.flags.authenticated.user_id
    db.find_user_by({username:msg.params.username}).then(function(friend){
      db.user_add_friend(client_user_id, friend.id).then(function(result){
        protocol.respond_success(client, msg.id, result)
        // inefficient
        db.get_user(client_user_id).then(function(user){
          var email = build_friend_email(friend.email, user.username)
          send_email(email)
        })
      }, function(err){
        protocol.respond_fail(client, msg.id, err)
      })
    })
  } else {
    protocol.respond_fail(client, msg.id, {message:"Not authenticated"})
  }
}

function build_friend_email(email, friended_by) {
  var opts = {
    from: 'IceCondor <system@icecondor.com>',
    to: email,
    subject: friended_by+' is sharing their location with you',
    text: friended_by+' is now sharing their location with you.\n\n'+
          'View their map at\n'+
          'https://staging.icecondor.com/'+friended_by
  }
  return opts
}

function build_token_email(email, device_id, token) {
  var link = "https://staging.icecondor.com/auth/"+encodeURIComponent(token)
  var emailOpt = {
    from: 'IceCondor <system@icecondor.com>',
    to: email,
    //html: '<b>Hello world </b>'
    }
  if(device_id == 'browser') {
    emailOpt.subject = 'IceCondor Web Login for '+email,
    emailOpt.text = 'Web Browser Login link.\n\n'+link+'\n'
  } else {
    emailOpt.subject = 'IceCondor Phone Activation Link',
    emailOpt.text = 'Cell Phone Activation link\n\n'+link+'\n'
  }
  return emailOpt
}

function send_email(params) {
  var transporter = emailer.createTransport()
  transporter.sendMail(params, function(error, info){
    if(error){
        console.log("email error: "+error);
    } else {
        console.log('Message sent to '+ params.to);
    }
  });
}