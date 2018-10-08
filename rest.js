'use strict'
var net = require('net')
var http = require('http')
var Url = require('url')
var uuid = require('node-uuid')
var settings = require('./settings')

console.log("rest listening on", settings.rest.listen_port)
var server = http.createServer(function(request, response) {
  var url = Url.parse(request.url)
  var parts = url.query.split('&').map(function(r) { let z = r.match(/([^=]+)=(.*)/); let y = {}; y[z[1]] = z[2]; return y })
  var params = Object.assign({}, ...parts)
  let body = []
  request.on('data', (chunk) => {
    body.push(chunk)
  }).on('end', () => {
    body = Buffer.concat(body).toString()
    try {
      let jsonbody = JSON.parse(body)
      console.log(JSON.stringify(jsonbody, null, 2))
      push_points(response, params.token, jsonbody.locations)
    } catch (e) {
      console.log(e)
      console.log(body)
      response.writeHead(400)
      response.end()
    }
  })

})

server.listen(settings.rest.listen_port)

function push_points(response, auth_token, points) {
  console.log(new Date(), 'ws_connect')
  var apiSocket = new net.Socket()

  console.log('connecting to api on ' + settings.api.listen_port)

  apiSocket.on('open', function(data) {
    console.log("apiSocket open.")
  })

  apiSocket.on('data', function(data) {
    var lines = data.toString('utf8').split('\n')
    console.log('->', lines)
    var msg = JSON.parse(lines[0])
    if (msg.method) {
      console.log('method', msg.method)
      if (msg.method == "hello") {
        apiSocket.write(JSON.stringify({
          id: "rpc-auth",
          method: "auth.session", params: { device_key: auth_token }
        }) + "\n")
      }
    }

    if (msg.error) {
      apiSocket.end()
      if (msg.error.code == "BK1") {
        response.writeHead(401)
      } else {
        response.writeHead(500)
      }
      response.end()
    }

    if (msg.id == "rpc-auth" && msg.result) {
      if (msg.result.user) {
        rpcNext(points, apiSocket)
      }
    }

    if (msg.id == "rpc-add") {
      if (msg.result) {
        response.writeHead(200, { "Content-type": "application/json" })
        msg.result.result = "ok"
        if (!response.finished) {
          response.write(JSON.stringify(msg.result))
        } else {
          console.log('!!client write when finished')
        }
        rpcNext(points, apiSocket)
      }
      if (msg.error) {
        response.writeHead(500)
        response.write(JSON.stringify(msg.error))
      }
      response.end()
    }
  })

  apiSocket.on('error', function(exception) {
    console.log("apiSocket error: " + exception)
    apiSocket.end()
    response.writeHead(500)
    response.end()
  })

  apiSocket.on('close', function(data) {
    console.log("apiSocket closed.")
  })

  apiSocket.connect(settings.api.listen_port, "localhost")
}

function rpcNext(points, apiSocket) {
  var last_location = points.pop()
  if (last_location) {
    if (last_location.properties.action) {
      console.log('#' + points.length, 'overland action', last_location.properties.action, 'ignored')
      rpcNext(points, apiSocket)
    } else {
      console.log('#' + points.length, new Date())
      rpcAdd(last_location, apiSocket)
    }
  } else {
    console.log('last_location points.pop is null!')
  }
}

function rpcAdd(last_location, apiSocket) {
  if (last_location) {
    let rpc = { id: "rpc-add", method: "activity.add", params: geojson2icecondor(last_location) }
    console.log(rpc)
    apiSocket.write(JSON.stringify(rpc) + "\n")
  }
}

function geojson2icecondor(geojson) {

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
    date: geojson.properties.timestamp,
    latitude: geojson.geometry.coordinates[1],
    longitude: geojson.geometry.coordinates[0],
    accuracy: geojson.properties.horizontal_accuracy,
    provider: "network"
  }
}
