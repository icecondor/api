var settings = require('./settings'),
    net = require('net');

console.log("socket.io listening on "+settings.socket_io.listen_port)

var express = require('express')
  , app = express.createServer()
  , io = require('socket.io').listen(app)

app.use(express.static(__dirname + '/html'));
app.listen(settings.socket_io.listen_port);

// serve an html page for testing
app.get('/', function (req, res) {
  res.sendfile(__dirname + '/html/index.html');
});

// socket.io
io.sockets.on('connection', function (client) {
  console.log(client.id+" connecting to API")
  var apiSocket = net.connect(settings.api.listen_port, "localhost")

  apiSocket.on('data', function(data) {
    console.log("->"+data)
    var msg = JSON.parse(data.toString('utf8'))
    client.emit('dispatch',msg)
  })

  client.on('api', function (msg) {
    console.log("<- "+str)
    msgs = JSON.parse(str)
    msgs.forEach(function(msg){
      apiSocket.write(JSON.stringify(msg)+"\n")
    })
  });

  client.on('disconnect', function(client) {
    apiSocket.end()
    console.log('disconnnect!')
  })
});

