"use strict"

// nodejs
var timers = require('timers')
var crypto = require('crypto')
var fs = require('fs')
var os = require('os')

var settings = require('./lib/settings')
var server = require('./lib/server').factory()
var db = require('./lib/dblib').factory()

var version="2"
try { version += "-"+fs.readFileSync('version') } catch(e) {}

if(!settings.api.hostname){settings.api.hostname = os.hostname()}
console.log("v:"+version+" host:"+settings.api.hostname)
console.log("api listening on *:"+settings.api.listen_port)

db.setup()
server.listen(settings.api.listen_port)

server.on('listening', function() {
  timers.setInterval(function() {
      progress_report();
      server.timer.reset();
    }, settings.api.progress_report_timer)
})

server.on('connection', function(socket) {
  var me = {socket: socket, flags: {}, following: []}
  server.clients.add(me)
  progress_report()
  clog(me,'connected. '+server.clients.list.length+' clients.');
  var hello = {type: "hello", version: version}
  client_write(me, hello)

  socket.on('data', function(data) {
    server.timer.hits += 1
    var msgs = multilineParse(data)
    clog(me, "<- "+ JSON.stringify(msgs))
    msgs.forEach(function(msg){
      client_dispatch(me, msg)
    })
  })

  socket.on('close', function() {
    me.socket = null
    server.clients.remove(me)
    progress_report()
    clog(me, 'closed. '+server.clients.list.length+" remain")
  })
})

server.on('close', function() {console.log('closed')})

function multilineParse(data) {
  var lines = data.toString('utf8').split('\n')
  lines = lines.map(function(line) {
    if(line.length>0) {
      try {
        var msg = JSON.parse(line)
        return msg
      } catch (err) {
        console.log(err)
      }
    }
  })
  lines = lines.filter(function(msg){return msg})
  return lines
}

function client_dispatch(me, msg) {
  switch(msg.method) {
    case 'location': process_location(me, msg); break;
    case 'status': me.flags.stats = true; break;
    case 'follow': process_follow(me, msg); break;
    case 'unfollow': process_unfollow(me, msg); break;
    case 'auth.token': send_token(me, msg.params); break;
    case 'auth': start_auth(me, msg.params); break;
    case 'user.detail': user_detail(me, msg.params); break;
  }
}

function couch_dispatch(err, change) {
  if (err) {
  } else {
    var doc = change.doc
    console.log("ch#"+change.seq+" *"+doc.type+" "+JSON.stringify(doc))
    switch(doc.type) {
      case 'location': pump_location(doc); break;
      case 'status_report': pump_status(doc); break;
    }
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
                   version: version,
                      date: new Date(),
                  msg_rate: rate,
              client_count: server.clients.list.length}
  db.insert(stats)
}

function client_write(client, msg) {
  if(client.socket) {
    if (typeof msg !== "string") {
      msg = JSON.stringify(msg)
    }
    client.socket.write(msg+"\n")
  }
}

function clog(client, msg) {
  if (typeof msg !== "string") {
    msg = JSON.stringify(msg)
  }
  if(client.socket) {
    msg = client.socket.remoteAddress+':'+client.socket.remotePort+" "+msg;
  }
  console.log(msg);
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

function couch_write(me, doc) {
  //console.log('couch writing: '+ JSON.stringify(doc))
  var id = doc.id
  delete doc.id
  couch.db.insert(doc, id, function(error, body, headers){
                                   couch_write_finish(error,body,headers,me, id)})
}

function couch_write_finish(error, body, headers, me, id) {
  var msg;
  msg = {id: id,
         type: 'location'}
  if(error){
    msg.status = 'ERR'
    msg.message = JSON.stringify(error)
  } else {
    msg.status = 'OK'
  }
  if(me) {
    clog(me, "-> "+JSON.stringify(msg))
    client_write(me, msg)
  }
}

function send_token(client, msg) {
  server.request_token({email:msg.email, device_id:msg.device_id})
}

function start_auth(client, msg) {
  if(msg.email) {
    var res = couch.db.view('User','by_email', {key: msg.email},
                            function(_, result){
                              finish_auth(_,result, {password:msg.password}, client)
                            });
  } else if (msg.oauth_token) {
    var res = couch.db.view('User','by_oauth_token', {key: msg.oauth_token},
                            function(_, result){
                              finish_auth(_,result, {oauth_token:msg.oauth_token}, client)
                            });
  } else {
    var omsg = {type:"auth"}
    omsg.status = client.flags.authorized ? "OK" : "NOLOGIN"
    client_write(client, JSON.stringify(omsg)+"\n")
  }
}

function finish_auth(_,result, cred, client) {
  var msg = {type:"auth"}
  if (!result.error && result.rows.length > 0) {
    couch.db.get(result.rows[0].id, function(_, user) {
      if (user.password === cred.password ||
          user.oauth_token === cred.oauth_token) {
        delete user.password
        delete user.oauth_token
        delete user._id
        delete user._rev
        msg.status = "OK"
        msg.user = user
        client.user = user
        client.flags.authorized = true
      } else {
        msg.status = "BADPASS"
      }
      console.log(JSON.stringify(msg))
      client_write(client, JSON.stringify(msg)+"\n")
    })
  } else {
    msg.status = "NOTFOUND"
    client_write(client, (JSON.stringify(msg)+"\n"))
  }
}

function user_detail(client, params) {
  client_write(client, {id:"ab14", user:"bob"})
}


