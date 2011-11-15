"use strict"
var timers = require('timers')
var server = require('./server').factory()
var settings = require('./settings').settings

var clients = []

server.listen(settings.listen_port)

server.on('listening', function() {
  console.log('listening on :'+settings.listen_port)
  timers.setInterval(progress_report, settings.progress_report_timer)
})

server.on('connection', function(socket) {
  var me = {socket: socket, flags: {}}
  var client_id = clients.push(me)
  console.log(me.socket.remoteAddress+':'+me.socket.remotePort+' connected. '
              +clients.length+' clients.');
  socket.on('data', function(data) {go(me, data)})
  socket.on('close', function() {
  	var idx = clients.indexOf(me)
  	clients.splice(idx,1)
  	console.log('closed. client list '+clients)
  })
})

server.on('close', function() {console.log('closed')})

function go(me, data) {
	server.timer.hits += 1
	var lines = data.toString('utf8').split('\n')
	lines.forEach(function(line) {
		if(line.length > 0) {
			try {
				var msg = JSON.parse(line)
			} catch (err) {
				console.log(err)
			}
				dispatch(me, msg)
	    }
	})
}

function dispatch(me, msg) {
	console.log("dispatch: "+msg.type)
	switch(msg.type) {
		case 'location': couch_write(msg); break;
		case 'stats': me.flags.stats = true; break;
	}
}

function progress_report() {
	var now = new Date();
	var period = (now - server.timer.mark)/1000
	var rate = server.timer.hits / period
	if (rate > 0) {
		clients.forEach(function(client) {
			if(client.flags.stats == true) {
	        	var stats_str = JSON.stringify({msg_rate: rate, client_count: clients.length})
	        	console.log(client.socket.remoteAddress+':'+client.socket.remotePort+": "+stats_str)
	        	client.socket.write(stats_str+"\n")
	        }
			
		})
    }
    server.timer.reset()
}

function couch_write(doc) {
	console.log('couchwrite: '+doc)
}
