"use strict"
var timers = require('timers')
var fs = require('fs')
var net = require('net')
var xml = require('libxmljs')
var path = require('path')
var settings = require('./settings')
var util = require('util');
var username;
var client = net.connect(settings.api.listen_port, "localhost", play)
client.on('disconnect', function() { console.log('disconnected from api') })

function play() {
  console.log('connected to localhost:' + settings.api.listen_port)
  var msg = {
    type: "auth",
    oauth_token: process.argv[3]
  }
  cwrite(client, msg)

  var filename = process.argv[2]
  username = path.basename(filename, '.gpx')
  var xmlDoc = xml.parseXmlString(fs.readFileSync(filename, 'utf8'));
  var points = xmlDoc.find("//trkseg/trkpt");
  console.log("** loaded " + points.length + " points from " + filename)
  console.log("")

  while (true) {
    for (var f in points) {
      position(points[f].attr('lat').value(),
        points[f].attr('lon').value())
      sleep(5000)
    }
  }
}

// its ok we own the whole node process :)
function sleep(milliSeconds) {
  var startTime = new Date().getTime();
  while (new Date().getTime() < startTime + milliSeconds);
}

function position(lat, lng) {
  var msg = {
    type: "location",
    username: username,
    date: new Date(),
    provider: "api",
    position: {
      latitude: lat,
      longitude: lng
    }
  }
  cwrite(client, msg)
}

function cwrite(client, msg) {
  var msg_s = JSON.stringify(msg) + "\n"
  console.log(msg_s)
  client.write(msg_s)
}
