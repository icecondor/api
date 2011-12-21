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
		clog(me, "msgs:"+JSON.stringify(msgs))
    msgs.forEach(function(msg){
    	client_dispatch(me, msg)
    })
  })

  socket.on('close', function() {
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
		case 'location': couch_write(msg); break;
		case 'status': me.flags.stats = true; break;
    case 'follow': me.following.push(msg.username); break;
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
		  client.socket.write(JSON.stringify(location)+"\n")
    }
	})
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
      client.socket.write(stats_str+"\n")
    }
  })
}

function couch_write(doc) {
	//console.log('writing: '+ JSON.stringify(doc))
	couch.db.insert(doc, couch_write_finish)
}

function couch_write_finish(error, body, headers) {
	if(error){
		console.log("couch error: "+ JSON.stringify(error))
	} else {
	//	console.log("couch response: "+JSON.stringify(body))
	}
}

function start_auth(client, msg) {
  console.log('start_auth')
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
    client.socket.write(JSON.stringify(omsg)+"\n")
  }
}

function finish_auth(_,result, cred, client) {
  console.log('finish_auth')
  console.log(result)
  var msg = {type:"auth"}
  if (result.rows.length > 0) {
    console.log('loading '+result.rows[0].id)
    couch.db.get(result.rows[0].id, function(_, user) {
      console.log('inside get')
      console.log(user)
      if (user.password === cred.password ||
          user.oauth_token === cred.oauth_token) {
        msg.status = "OK"
        msg.user = user
        client.flags.authorized = true
      } else {
        msg.status = "BADPASS"
      }
      console.log('writing')
      console.log(JSON.stringify(msg))
      client.socket.write(JSON.stringify(msg)+"\n")
    })
  } else {
    msg.status = "NOTFOUND"
    client.socket.write(JSON.stringify(msg)+"\n")
  }
}

function clog(client, msg) {
	console.log(client.socket.remoteAddress+':'+client.socket.remotePort+": "+msg);
}
