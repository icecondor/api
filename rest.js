var net = require('net')
var http = require('http')
var url = require('url')
var settings = require('./settings')

console.log("rest listening on", settings.rest.listen_port)
var server = http.createServer( function(request, response) {
    var pathname = url.parse(request.url).pathname
    console.log('rest connected. ', pathname)
    push_point(response, "key", {})
})

server.listen(settings.rest.listen_port)

function push_point(response, auth_token, geopoint) {
  console.log('ws_connect')
  var apiSocket = new net.Socket()

  console.log('connecting to api on '+settings.api.listen_port)

  apiSocket.on('data', function(data) {
    console.log('-> '+data)
    var msg = JSON.parse(data)
    if(msg.method) {
      console.log('method', msg.method)
      if(msg.method == "hello") {
        apiSocket.write(JSON.stringify({id:"r1",
          method:"auth.session", params:{device_key: auth_token}})+"\n")
      }
    }

    if(msg.error) {
      apiSocket.end()
      response.writeHead(500)
      response.end()
    }

    if(msg.result) {
      if(msg.user) {
        apiSocket.write(JSON.stringify({id:"l1",
          method:"location.add", params:{}})+"\n")
        response.writeHead(200)
        response.end()
      }
    }
  })

  apiSocket.on('error', function(exception) {
    console.log("apiSocket error: "+exception)
    apiSocket.end()
  })

  apiSocket.connect(settings.api.listen_port, "localhost")
}
