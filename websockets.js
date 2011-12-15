var net = require('net');
var ws_svr = require('websockets');
var settings = require('./settings');

var ws = ws_svr.createServer(ws_http);
ws.on('connect', ws_connect).listen(settings.websockets.listen_port);
console.log("websockets listening on "+settings.websockets.listen_port)

function ws_http(req, res) {
  console.log('http connection')
}

function ws_connect(socket) {
  var apiSocket;

  socket.on('open', function() {
    console.log('ws open. connecting to '+settings.api.listen_port);
    apiSocket = net.connect(settings.api.listen_port, "localhost")
    apiSocket.on('data', function(data) {
      console.log('-> '+data)
      socket.send(data)
    })

  });
  socket.on('message', function(data) {
    console.log('<- '+data)
    apiSocket.write(data+"\n")
  });

  socket.on('close', function() {
    apiSocket.end();
    console.log('ws close');
  });
}

/*// socket.io
io.sockets.on('connection', function (client) {
  console.log(client.id+" connecting to API")
  var apiSocket = net.connect(settings.api.listen_port, "localhost")

  apiSocket.on('data', function(data) {
    var msg = JSON.parse(data.toString('utf8'))
    client.emit('update',msg)
  })

  client.on('following', function (msg) {
    var data = JSON.stringify(msg)
    apiSocket.write(data+"\n")
  });

  client.on('disconnect', function(client) {
    apiSocket.end()
    console.log('disconnnect!')
  })
});

*/