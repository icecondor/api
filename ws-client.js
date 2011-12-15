var websockets = require('websockets');
var settings = require('./settings');

var url = 'ws://127.0.0.1:2040'
var ws = new websockets.WebSocket(url);

ws.on('open', function() {
  console.log('ws open.'+url);
});

ws.on('message', function(data) {
  console.log('-> '+data)
});

ws.on('error', function(data) {
  console.log('ERR-> '+data)
});

ws.on('close', function() {
  console.log('ws close');
});

