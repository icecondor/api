'use strict'
var net = require('net')
var http = require('http')
var Url = require('url')
var uuid = require('node-uuid')
var settings = require('./settings')

console.log("rest listening on", settings.rest.listen_port)
var server = http.createServer(function(request, response) {
    var url = Url.parse(request.url)
    var parts = url.query.split('&').map(function(r){let z=r.match(/([^=]+)=(.*)/); let y={}; y[z[1]]=z[2]; return y})
    var params = Object.assign({}, ...parts)
    let body = []
    request.on('data', (chunk) => {
      body.push(chunk)
    }).on('end', () => {
      body = Buffer.concat(body).toString()
      try {
        let jsonbody = JSON.parse(body)
        push_point(response, params.token, geojson2icecondor(jsonbody.locations[0]))
      } catch(e) {
        console.log(e)
        response.writeHead(400)
        response.end()
      }
    })

})

server.listen(settings.rest.listen_port)

function push_point(response, auth_token, icpoint) {
  console.log('ws_connect')
  var apiSocket = new net.Socket()

  console.log('connecting to api on '+settings.api.listen_port)

  apiSocket.on('data', function(data) {
    console.log('-> '+data)
    var msg = JSON.parse(data)
    if(msg.method) {
      console.log('method', msg.method)
      if(msg.method == "hello") {
        apiSocket.write(JSON.stringify({id:"rpc-auth",
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

    if(msg.id == "rpc-auth" && msg.result) {
      if(msg.result.user) {
        let rpc = {id:"rpc-add", method:"activity.add", params:icpoint}
        console.log(rpc)
        apiSocket.write(JSON.stringify(rpc)+"\n")
      }
    }

    if(msg.id == "rpc-add") {
      if(msg.result) {
        response.writeHead(200)
        response.write(JSON.stringify(msg.result))
        response.end()
      }
    }
  })

  apiSocket.on('error', function(exception) {
    console.log("apiSocket error: "+exception)
    apiSocket.end()
    response.writeHead(500)
    response.end()
  })

  apiSocket.connect(settings.api.listen_port, "localhost")
}

function geojson2icecondor(geojson){
  console.log('geojson', JSON.stringify(geojson, null, 2))

/*
    {
      "type": "Feature",
      "geometry": {
        "type": "Point",
        "coordinates": [-122.621, 45.535]
      },
      "properties": {
        "timestamp": "2017-01-01T10:00:00-0700",
        "horizontal_accuracy": 65
      }
    }

{ type: 'Feature',
  geometry: { type: 'Point', coordinates: [ -122.406417, 37.785834 ] },
  properties:
   { speed: -1,
     battery_state: 'unknown',
     timestamp: '2017-07-14T21:51:35Z',
     motion: [],
     horizontal_accuracy: 5,
     vertical_accuracy: -1,
     pauses: false,
     deferred: 0,
     significant_change: 0,
     locations_in_payload: 1,
     battery_level: -1,
     activity: 'other',
     desired_accuracy: 100,
     altitude: 0 } }

*/
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
  return {
    id: uuid.v4(),
    type: "location",
    class: "com.icecondor.nest.db.activity.GpsLocation",
    date: geojson.properties.timestamp,
    latitude: geojson.geometry.coordinates[1],
    longitude: geojson.geometry.coordinates[0],
    accuracy: geojson.properties.horizontal_accuracy,
    provider: "network"
  }
}
