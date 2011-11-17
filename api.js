"use strict"
var timers = require('timers')
var cradle = require('cradle')
var server = require('./server').factory()
var settings = require('./settings').settings

console.log("connection to couchdb/icecondor")
var couch = new(cradle.Connection)().database('icecondor');
couch.create()
couch.changes().on('response', function (res){
     res.on('data', function (change) {
          console.log(change);
          couch.get(change.id, server_dispatch)
      });
})

console.log("api listening on "+JSON.stringify(settings.api.listen_port))
server.listen(settings.api.listen_port)

server.on('listening', function() {
  timers.setInterval(progress_report, settings.progress_report_timer)
})

server.on('connection', function(socket) {
  var me = {socket: socket, flags: {}}
  server.clients.add(me)
  clog(me,'connected. '+server.clients.list.length+' clients.');
  socket.on('data', function(data) {
			server.timer.hits += 1
	        var msgs = multilineParse(data)
			clog(me, "msgs:"+JSON.stringify(msgs))
	        msgs.forEach(function(msg){
	        	dispatch(me, msg)
  		    })
  })

  socket.on('close', function() {
  	server.clients.remove(me)
  	clog(me, 'closed. remaining client list: '+ server.clients.list)
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

function dispatch(me, msg) {
	switch(msg.type) {
		case 'location': couch_write(msg); break;
		case 'stats': me.flags.stats = true; break;
	}
}

function server_dispatch(err, doc) {
	console.log("server dispatch "+doc)
	switch(doc.type) {
		case 'location': pump_location(doc); break;
	}
}

function pump_location(location) {
	server.clients.list.forEach(function(client) {
		client.socket.write(JSON.stringify(location)+"\n")
	})
}

function progress_report() {
	var now = new Date();
	var period = (now - server.timer.mark)/1000
	var rate = server.timer.hits / period
	if (rate > 0) {
		server.clients.list.forEach(function(client) {
			if(client.flags.stats == true) {
				var stats = {msg_rate: rate, 
		        	         client_count: server.clients.list.length}
	        	var stats_str = JSON.stringify(stats)
	        	clog(client, stats_str)
	        	client.socket.write(stats_str+"\n")
	        }
			
		})
    }
    server.timer.reset()
}

function couch_write(doc) {
	console.log('writing: '+ JSON.stringify(doc))
	couch.save(doc.id, doc, couch_write_finish)
}

function couch_write_finish(error, response) {
	if(error){
		console.log("couch error: "+ JSON.stringify(error))
	} else {
		console.log("response: "+response)
	}
}

function clog(client, msg) {
	console.log(client.socket.remoteAddress+':'+client.socket.remotePort+": "+msg);
}