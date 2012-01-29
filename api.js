"use strict"
var timers = require('timers')
var settings = require('./lib/settings')
var server = require('./lib/server').factory()
var couch = require('./lib/couchdb')
var version="0.2"

/* iriscouch/follow */
var follow = require('follow')
follow({db:settings.couchdb.url, include_docs:true, since:"now"}, couch_dispatch)

console.log(settings.api.hostname+" starting")
console.log("connection to "+settings.couchdb.url)
console.log("api listening on "+JSON.stringify(settings.api.listen_port))
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
  socket.write(JSON.stringify(hello)+"\n")

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
	switch(msg.type) {
		case 'location': process_location(me, msg); break;
		case 'status': me.flags.stats = true; break;
    case 'follow': process_follow(me, msg); break;
    case 'unfollow': process_unfollow(me, msg); break;
    case 'auth': start_auth(me, msg); break;
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
  couch.db.insert(stats, couch_write_finish)
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

function process_follow(me, msg) {
  // check for login
  if(me.user) {
    // check for authorization
    if(me.user.friends.indexOf(msg.username) >= 0) {
      follow_finish(me, msg.username, "following")
    } else {
      var msg = {type: "follow",
                 status: "ERR",
                 username: msg.username,
                 message: "not friends"}    
      clog(me,"-> "+JSON.stringify(msg))
      client_write(me, msg)
    }
  } else {
    // check for public profile
    var res = couch.db.view('User','by_username', {key: msg.username}, 
                            function(_, result){
                              process_follow_with_user(_,me,result)
                            });
  }
}

function process_follow_with_user(_, me, result) {
  if (!result.error && result.rows.length > 0) {
    couch.db.get(result.rows[0].id, function(_, user) {
      if(user.friends && user.friends.indexOf('frontpage') >= 0) {
        follow_finish(me, user.username, "following public profile")
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

function follow_finish(me, username, message) {
        me.following.push(username)
        var msg = {type: "follow",
                   username: username,
                   status: "OK",
                   message: message}    
        clog(me,"-> "+JSON.stringify(msg))
        client_write(me, msg)
        pump_last_location(me, username)
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
                                   couch_write_finish(error,body,headers,me)})
}

function couch_write_finish(error, body, headers, me) {
  var msg;
	if(error){
    msg = {id: body.id,
           type: 'location',
           status: 'ERR',
           message: JSON.stringify(error)}
	} else {
    msg = {id: body.id,
           type: 'location',
           status: 'OK'}
	}
  if(me) {
    clog(me, "-> "+JSON.stringify(msg))
    client_write(me, msg)
  }
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
