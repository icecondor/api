"use strict"
var timers = require('timers')
var server = require('./server').factory()
var settings = require('./settings').settings

server.listen(settings.listen_port)

server.on('listening', function() {
  console.log('icecondor api listening on :'+settings.listen_port)
  timers.setInterval(progress_report, settings.progress_report_timer)
})

server.on('connection', function(socket) {
  var me = {socket: socket, flags: {}}
  server.clients.add(me)
  console.log(me.socket.remoteAddress+':'+me.socket.remotePort+' connected. '
              +server.clients.list.length+' clients.');
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
  	console.log('closed. client list '+clients)
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
	console.log('couchwrite: '+doc)
}

function clog(client, msg) {
	console.log(client.socket.remoteAddress+':'+client.socket.remotePort+": "+msg);
}