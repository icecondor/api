var settings = require('./settings').settings;

console.log("socket.io listening on "+settings.socket_io.listen_port)

var app = require('express').createServer()
  , io = require('socket.io').listen(app)

app.listen(settings.socket_io.listen_port);

// webserver because, why not
app.get('/', function (req, res) {
  res.sendfile(__dirname + '/index.html');
});

// per-client connections to the api
var client_sockets = {}

// socket.io
io.sockets.on('connection', function (socket) {
  socket.emit('update', { hello: 'world' });
  socket.on('following', function (data) {
    console.log(data);
  });
});
