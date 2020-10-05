var net = require('net')
var wsock = require('websock')
var settings = require('./settings')
var openCount = 0

wsock.listen(settings.websockets.listen_port, ws_connect);
console.log("websockets listening on " + settings.websockets.listen_port)

function ws_connect(socket) {
  var apis = []
  openCount += 1
  console.log('websockets #' + openCount + ' open.')
  apiAdd(apis, socket, 'localhost', settings.api.listen_port)
  apiAdd(apis, socket, 'staging.icecondor.com', settings.api.listen_port, true)

  socket.on('message', function(data) {
    for (const api of apis) {
      console.log(api._host + ' <-ws ' + data)
      api.write(data + "\n")
    }
  })

  socket.on('close', function() {
    openCount -= 1
    console.log('websocket closed. ' + openCount + ' remaining.');
    for (const api of apis) api.end()
  })
}

function apiAdd(apis, socket, host, port, silent) {
  console.log('connecting to api on ', settings.api.listen_port, silent ? "SILENT MODE" : "");
  var sockApi = silent ? silentRelayTo(socket, host, port) : relayTo(socket, host, port)
  if (sockApi) {
    apis.push(sockApi)
  } else {
    console.log('api socket open fail for', host + ':' + port)
  }
}

function relayTo(socket, host, port) {
  var apiSocket = new net.Socket();

  apiSocket.on('data', function(data) {
    console.log(host + ':' + port + ' -> :' + socket.connection._peername.port, data.toString().trim())
    socket.send(data)
  })

  apiSocket.on('error', function(exception) {
    console.log("apiSocket error: " + exception);
    apiSocket.end()
    socket.end()
  })

  apiSocket.on('close', function() {
    console.log('api ' + host + ' closed. closing client');
    socket.end()
  })

  apiSocket.connect(port, host)

  return apiSocket
}

function silentRelayTo(socket, host, port) {
  var apiSocket = new net.Socket();

  apiSocket.on('data', function(data) {
    console.log(host + ':' + port + ' [muted]-> :' + socket.connection._peername.port + ' ' + data.toString().trim())
  })
  apiSocket.on('error', function(exception) {
    console.log(host, 'silent socket fail ignored')
  })
  apiSocket.connect(port, host)
  return apiSocket
}

