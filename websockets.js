var net = require('net')
var wsock = require('websock')
var settings = require('./settings')
var apis = []
var openCount = 0

wsock.listen(settings.websockets.listen_port, ws_connect);
console.log("websockets listening on " + settings.websockets.listen_port)

function ws_connect(socket) {
  openCount += 1
  console.log('websockets #'+openCount+' open. connecting to api on ' + settings.api.listen_port);
  var sockApi = relayTo(socket, 'localhost', settings.api.listen_port)
  if (sockApi) {
    apis.push(sockApi)
  } else {
    console.log('api socket open fail!')
  }

  socket.on('message', function(data) {
    console.log('['+apis.length+']<-ws ' + data)
    for(const api of apis) api.write(data + "\n")
  })

  socket.on('close', function() {
    openCount -= 1
    console.log('websocket closed. '+openCount+' remaining.');
    for(const api of apis) api.end()
  })
}

function relayTo(socket, host, port) {
  var apiSocket = new net.Socket();

  apiSocket.on('data', function(data) {
    console.log(':'+socket.connection._peername.port+'-> '+data)
    socket.send(data)
  })

  apiSocket.on('error', function(exception) {
    console.log("apiSocket error: " + exception);
    apiSocket.end()
    socket.end()
  })

  apiSocket.on('close', function() {
    console.log('api '+host+' closed. closing client');
    socket.end()
  })

  apiSocket.connect(port, host)

  return apiSocket
}
