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
io.sockets.on('connection', function (socket) {
  net.connect(settings.api.listen_port, "localhost")
  
  socket.set('api-socket')		
  socket.emit('update', { hello: 'world' });
  socket.on('following', function (data) {
    console.log(data);
  });
});
