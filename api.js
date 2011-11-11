"use strict"
var timers = require('timers')
var ic = require('./server')

var server = ic.factory()

var timeMark = new Date()
var hits = 0

timers.setInterval(progress, 5000)

server.listen(2020)
server.on('listening', function() {console.log('listening')})
server.on('connection', function(socket) {
  console.log('connected '+socket);
  socket.on('data', go)
})
server.on('close', function() {console.log('closed')})

function go(data) {
	hits += 1
		var lines = data.toString('utf8').split('\n')
		lines.forEach(function(line) {
        	try {
        		if(line.length > 0) {
					var o = JSON.parse(line)
					console.log(o)
			    }
			} catch (err) {
				console.log(err)
			}
		})
}

function progress() {
	var now = new Date();
	var period = (now - timeMark)/1000
	var rate = hits / period
	if (rate > 0) {
      console.log(rate+" hits/second")
    }
    timeMark = new Date()
    hits = 0
}