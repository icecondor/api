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
  timers.setInterval(progress, 5000)
})
server.on('connection', function(socket) {
  var client_id = clients.push(socket)
  console.log('connected. '+clients.length+' clients. '+clients);
  socket.on('data', go)
  socket.on('close', function() {
  	clients.splice(client_id-1,1)
  	console.log('closed. client list '+clients)
  })
})
server.on('close', function() {console.log('closed')})

function go(data) {
	hits += 1
		var lines = data.toString('utf8').split('\n')
		lines.forEach(function(line) {
        	try {
        		if(line.length > 0) {
					var msg = JSON.parse(line)
					process(msg)
			    }
			} catch (err) {
				console.log(err)
			}
		})
}

function process(msg) {
	console.log(msg)
}

function progress() {
	var now = new Date();
	var period = (now - timeMark)/1000
	var rate = hits / period
	if (rate > 0) {
      console.log(clients.length+" clients. "+rate+" hits/second")
    }
    counterReset()
}

function counterReset() {
    timeMark = new Date()
    hits = 0	
}