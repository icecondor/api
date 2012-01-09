var net = require('net');
var wsock = require('websock');
var settings = require('./settings');

wsock.listen(settings.websockets.listen_port, ws_connect);
console.log("websockets listening on "+settings.websockets.listen_port)

function ws_connect(socket) {
  console.log('ws_connect')
  var apiSocket = new net.Socket();

  console.log('websockets open. connecting to api on '+settings.api.listen_port);

  apiSocket.on('data', function(data) {
    console.log('ws-> '+data)
    socket.send(data)
  })
  
  apiSocket.on('error', function(exception) {
    console.log("apiSocket error: "+exception);
  })

  apiSocket.connect(settings.api.listen_port, "localhost")

  socket.on('message', function(data) {
    console.log('<-ws '+data)
    apiSocket.write(data+"\n")
  });

  socket.on('close', function() {
    apiSocket.end();
    console.log('websockets close');
  });

}
