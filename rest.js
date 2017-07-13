var net = require('net')
var http = require('http')
var url = require('url')
var wsock = require('websock')
var settings = require('./settings')

console.log("rest listening on", settings.rest.listen_port)
var server = http.createServer( function(request, response) {
    var pathname = url.parse(request.url).pathname
    console.log('rest connected. ', pathname)
    push_point("key", {})
})

server.listen(settings.rest.listen_port)

function push_point(auth_token, geopoint) {
  console.log('ws_connect')
  var apiSocket = new net.Socket()

  console.log('connecting to api on '+settings.api.listen_port)

  apiSocket.on('data', function(data) {
    console.log('-> '+data)
  })

  apiSocket.on('error', function(exception) {
    console.log("apiSocket error: "+exception)
    apiSocket.end()
  })

  apiSocket.connect(settings.api.listen_port, "localhost")
}
