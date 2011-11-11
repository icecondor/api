"use strict"
var fs = require ('fs')
var timers = require('timers')
var ic = require('./server')

var server = ic.factory()

var timeMark = new Date()
var hits = 0

var settings = JSON.parse(fs.readFileSync("settings.json"))
var clients = []

server.listen(2020)

server.on('listening', function() {
  console.log('listening')
  timers.setInterval(progress_report, 3000)
})

server.on('connection', function(socket) {
  var me = {socket: socket, flags: {}}
  var client_id = clients.push(me)
  console.log(me.socket.address()+' connected. '+clients.length+' clients.');
  socket.on('data', function(data) {go(me, data)})
  socket.on('close', function() {
  	var idx = clients.indexOf(me)
  	clients.splice(idx,1)
  	console.log('closed. client list '+clients)
  })
})

server.on('close', function() {console.log('closed')})

function go(me, data) {
	hits += 1
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
	switch(msg.type) {
		case 'location': couch_write(msg); break;
		case 'stats': me.flags.stats = true; break;
	}
}

function progress_report() {
	var now = new Date();
	var period = (now - timeMark)/1000
	var rate = hits / period
	if (rate > 0) {
		clients.forEach(function(client) {
			if(client.flags.stats == true) {
	        	var pr = {msg_rate: rate, client_count: clients.length}
	        	console.log(JSON.stringify(client.socket.address())+": "+pr)
	        	client.socket.write(JSON.stringify(pr)+"\n")
	        }
			
		})
    }
    counterReset()
}

function counterReset() {
    timeMark = new Date()
    hits = 0	
}

function couch_write(doc) {
	console.log('couchwrite: '+doc)
}
