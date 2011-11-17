var settings = require('./settings').settings,
    net = require('net');

console.log("socket.io listening on "+settings.socket_io.listen_port)

var app = require('express').createServer()
  , io = require('socket.io').listen(app)

app.listen(settings.socket_io.listen_port);

// webserver because, why not
app.get('/', function (req, res) {
  res.sendfile(__dirname + '/index.html');
});

// socket.io
io.sockets.on('connection', function (client) {
  console.log(client.id+"connection to API")
  var apiSocket = net.connect(settings.api.listen_port, "localhost")
  apiSocket.write('{"type":"status"}')
  apiSocket.on('data', function(data) {console.log(client.id+"API SOCKET GOT: "+data)})
  client.set('api-socket', apiSocket)

  client.emit('update', { hello: 'world' });
  client.on('following', function (data) {
    console.log(data);
  });
});
