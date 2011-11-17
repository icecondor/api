var settings = require('./settings').settings,
    net = require('net');

console.log("socket.io listening on "+settings.socket_io.listen_port)

var app = require('express').createServer()
  , io = require('socket.io').listen(app)

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
    var msg = JSON.parse(data.toString('utf8'))
    client.emit('update',msg)
  })

  client.on('following', function (msg) {
    var data = JSON.stringify((JSON.parse(msg))[0])
    apiSocket.write(data+"\n")
  });

  client.on('disconnect', function(client) {
    apiSocket.end()
    console.log('disconnnect!')
  })
});

