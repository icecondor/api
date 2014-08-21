"use strict"

// nodejs
var timers = require('timers')
var crypto = require('crypto')

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
  progress_report()
}

function client_dispatch(me, msg) {
  switch(msg.method) {
    case 'auth.email': process_auth_email(me, msg); break;
    case 'auth.session': process_auth_session(me, msg); break;
    case 'user.detail': process_user_detail(me, msg); break;
    case 'location': process_location(me, msg); break;
    case 'status': me.flags.stats = true; break;
    case 'follow': process_follow(me, msg); break;
    case 'unfollow': process_unfollow(me, msg); break;
  }
}

function pump_location(location) {
  server.clients.list.forEach(function(client) {
    if(client.following.indexOf(location.username) >= 0) {
      location.id = location._id;
      delete location._id;
      delete location._rev;
      client.socket.write(JSON.stringify(location)+"\n")
    }
  })
}

function pump_last_location(me, username) {
  var now = (new Date()).toISOString()
  var res = couch.db.view('Location','by_username_and_date',
                          {startkey: [username, now],
                           endkey: [username, ""],
                           limit: 1, descending: true, reduce: false},
                          function(_, result){
                            if (!result.error && result.rows.length > 0) {
                              couch.db.get(result.rows[result.rows.length-1].id, function(_, location) {
                                location.id = location._id
                                delete location._id
                                delete location._rev
                                client_write(me, location)
                              })
                            }
                          });
}

function progress_report() {
  var now = new Date();
  var period = (now - server.timer.mark) / 1000
  var rate = server.timer.hits / period
  var stats = {       type: "status_report",
                    server: settings.api.hostname,
                   version: settings.api.version,
                      date: new Date(),
                  msg_rate: rate,
              client_count: server.clients.list.length}
  db.insert(stats)
}

function clog(client, msg) {
  var parts = []
  parts.push(moment().format())
  if(client.socket) {
    parts.push(client.socket.remoteAddress+':'+client.socket.remotePort);
  }
  if (typeof msg !== "string") {
    parts.push(JSON.stringify(msg))
  } else {
    parts.push(msg)
  }
  console.log(parts.join(' '))
}

function pump_status(status) {
  server.clients.list.forEach(function(client) {
    if(client.flags.stats == true) {
      var stats_str = JSON.stringify(status)
      clog(client, stats_str)
      client_write(client, stats_str+"\n")
    }
  })
}

function process_location(me, msg) {
  if(me.flags.authorized) {
    couch_write(me, msg)
  } else {
    var msg = {id:msg.id,
               type: 'location',
               status: 'ERR',
               message: 'not authorized'};
    clog(me,"-> "+JSON.stringify(msg))
    client_write(me, msg)
  }
}

/* API calls */

function process_follow(me, msg) {
  var res = couch.db.view('User','by_username', {key: msg.username},
                          function(_, result){
                            process_follow_with_user(_,me,result)
                          });
}

function process_follow_with_user(_, me, result) {
  if (!result.error && result.rows.length > 0) {
    couch.db.get(result.rows[0].id, function(_, user) {
      if(user.friends) {
        if (user.friends.indexOf('frontpage') >= 0) {
          follow_finish(me, user, "following public profile")
          return
        }
        if (me.user) {
          if (user.friends.indexOf(me.user.username) >= 0) {
            follow_finish(me, user, "existing friendship")
          } else {
            var msg = {type: "follow",
                       status: "ERR",
                       username: user.username,
                       message: "not friends"}
            clog(me,"-> "+JSON.stringify(msg))
            client_write(me, msg)
          }
        }
      } else {
        var msg = {type: "follow",
                   username: user.username,
                   status: "ERR",
                   message: "profile is not public and not logged in"}
        clog(me,"-> "+JSON.stringify(msg))
        client_write(me, msg)
      }
    })
  }
}

function follow_finish(me, user, message) {
        me.following.push(user.username)
        var msg = {type: "follow",
                   username: user.username,
                   status: "OK",
                   message: message}
        if(user.mobile_avatar_url) {
          msg.mobile_avatar_url = user.mobile_avatar_url
        } else {
          if(user.email) {
            msg.mobile_avatar_url = gravatar_url(user.email)
          }
        }
        clog(me,"-> "+JSON.stringify(msg))
        client_write(me, msg)
        pump_last_location(me, user.username)
}

function gravatar_url(email) {
  var md5sum = crypto.createHash('md5')
  md5sum.update(email)
  var url = "http://www.gravatar.com/avatar/"+md5sum.digest('hex')+"?s=20"
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
      var email_opts = build_token_email(params.email, params.device_id, token)
      send_email(email_opts)
      protocol.respond_success(client, msg.id, {status: "OK"})
    })
}

function process_auth_session(client, msg) {
  server.find_session(msg.params.device_key).then(function(json_value){
    if(json_value) {
      //db.ensure_user(user_new(params.email, params.device_id))
      var value = JSON.parse(json_value)
      if(value.email) {
        client_auth_check(client, msg, value)
      } else {
        client_auth_trusted(client, value.device_id).then(function(user){
          protocol.respond_success(client, msg.id, {user:{id:user.id}})
        })
      }
    } else {
      // device_key not found
      protocol.respond_fail(client, msg.id, {code: "BK1", message: "bad device_key"})
    }
  }).catch(function(err){console.log('Err! '+err)})
}

function client_auth_check(client, msg, value) {
  db.find_user_by(rethink.row('email').eq(value.email)).then(function(user){
    if(user.devices.indexOf(value.device_id) > -1) {
      server.token_validate(msg.params.device_key, value.device_id)
      client_auth_trusted(client, value.device_id).then(function(){
        protocol.respond_success(client, msg.id, {user:{id:user.id}})
        clog(client, 'authenticated existing device '+value.device_id+' to user '+user.email);
      })
    } else {
      db.find_user_by(rethink.row('devices').contains(value.device_id)).then(function(device_user){
        if(device_user) {
          protocol.respond_fail(client, msg.id, {})
          clog(client, 'authfail for '+value.email+': device '+value.device_id+' exists on user '+device_user.email);
        } else {
        }
      })
    }
  }, function(){
    console.log('user not found')
    db.find_user_by(rethink.row('devices').contains(value.device_id)).then(
      function(user){
        console.log('device found on '+user.email) // do nothing
      }, function(){
        console.log('device not found')
        var new_user = user_new(value.email, value.device_id)
        db.ensure_user(new_user).then(function(user){
          client_auth_trusted(client, value.device_id).then(function(){
            protocol.respond_success(client, msg.id, {user:{id:user.id, username: user.username}})
            clog(client, 'authenticated new unique device '+value.device_id+' to new user '+user.email);
          })
        })
      })
  })
}

function client_auth_trusted(client, device_id) {
  // load trusted device_id
  return db.find_user_by(rethink.row('devices').contains(device_id)).then(function(user){
    client.flags.authorized = user.id
    return user
  })
}

function user_new(email, device_id){
  var user = {email:email, devices: [device_id]}
  return user
}

function process_user_detail(client, msg) {
  clog(client, "user_detail")
  console.dir(client)
  if(client.flags.authenticated){
    // default value is the authenticated user
    db.find_user_by(rethink.row('id').eq(client.flags.authenticated)).then(function(user){
      protocol.respond_success(client, msg.id, user)
    })
  } else {
    protocol.respond_fail(client, msg.id, {message:"Not authenticated"})
  }
}

function build_token_email(email, device_id, token) {
  var auth_url = "icecondor://android/v2/auth?access_token="+token
  var link = "https://icecondor.com/oauth2/authorize?client_id=icecondor-nest"+
             "&response_type=token&redirect_uri="+encodeURIComponent(auth_url)
  var emailOpt = {
    from: 'IceCondor <system@icecondor.com>',
    to: email,
    subject: 'Login Link',
    text: 'IceCondor Login link for Android\n\n'+link+'\n',
    //html: '<b>Hello world </b>'
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