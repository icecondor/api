var net = require('net')
var http = require('http')
var Url = require('url')
var settings = require('./settings')

console.log("rest listening on", settings.rest.listen_port)
var server = http.createServer( function(request, response) {
    var url = Url.parse(request.url)
    var parts = url.query.split('&').map(function(r){z=r.match(/([^=]+)=(.*)/); y={}; y[z[1]]=z[2]; return y})
    var params = Object.assign({}, ...parts)
    console.log('rest connected. ', params)
    push_point(response, params.token, {})
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
      if(msg.error.code == "BK1") {
        response.writeHead(401)
      } else {
        response.writeHead(500)
      }
      response.end()
    }

    if(msg.result) {
      if(msg.result.user) {
        apiSocket.write(JSON.stringify({id:"l1",
          method:"activity.add", params:{}})+"\n")
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

function geojson2icecondor(geojson){
/*
{
  "id": "c7aaef5d-b785-4f1f-8c9d-0189749de972",
  "class": "com.icecondor.nest.db.activity.GpsLocation",
  "date": "2017-06-09T19:11:18.213Z",
  "type": "location",
  "latitude": 45.5350646,
  "longitude": -122.6243787,
  "accuracy": 30,
  "provider": "network"
}
*/
}
