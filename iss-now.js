"use strict"
var timers = require('timers')
var net = require('net')
var rest = require('restler')
var settings = require('./settings')
var client

client = net.connect(settings.api.listen_port, "localhost", start_timer)

function start_timer() {
  console.log('api connected. start timer')
  timers.setInterval(function() {
      iss_request(iss_position);
    }, 5000)
}

function iss_request(callback) {
  var url='http://api.open-notify.org/iss-now/'
  console.log(url)
  rest.get(url).on('complete', callback)
}

function iss_position(request) {
  var msg = { type:"location",
              username:"iss",
              date: new Date(),
              position: { latitude:request.iss_position.latitude,
                          longitude:request.iss_position.longitude}
            }
  var msg_s = JSON.stringify(msg)+"\n"
  console.log(msg_s)
  client.write(msg_s)
}
