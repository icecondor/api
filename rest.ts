var net = require('net')
var fs = require('fs')
var http = require('http')
var Url = require('url')
var uuid = require('node-uuid')

let settings = JSON.parse(fs.readFileSync("settings.json", 'utf8'))

console.log("rest listening on", settings.rest.listen_port)

http
  .createServer(function(request, response) {
    let params = paramsFromUrl(request.url)
    let bodyParts = []
    request.on('data', (chunk) => {
      if (chunk.length > 0) bodyParts.push(chunk)
    }).on('end', () => http_assemble_json(bodyParts, (data) => {
      if(data)
        push_points(response, params.token, data.locations)
      else
        response.writeHead(400)
      response.end()
    }))
  })
  .listen(settings.rest.listen_port)

function paramsFromUrl(urlStr) {
  var url = Url.parse(urlStr)
  let params: any = {}
  if (url.query) {
    params = url.query.split('&').reduce((y, r) => {
      let z = r.match(/([^=]+)=(.*)/)
      if (z) y[z[1]] = z[2]
      return y
    }, params)
  }
  return params
}

function http_assemble_json(bodyParts, cb) {
  let body = Buffer.concat(bodyParts).toString()
  if (body.length > 0) {
    try {
      let data = JSON.parse(body)
      cb(data)
    } catch (e) {
      if (e instanceof SyntaxError) {
        console.log('bad JSON', JSON.stringify(body.substr(0, 80)))
      } else {
        console.log('aborting connection.', e.name)
      }
      cb()
    }
  } else {
    console.log('empty body. closed.')
    cb()
  }
}


function push_points(response, auth_token, points) {
  console.log(new Date(), 'ws_connect')
  var apiSocket = new net.Socket()

  console.log('connecting to api on ' + settings.api.listen_port)

  apiSocket.on('open', function(data) {
    console.log("apiSocket open.")
  })

  apiSocket.on('data', function(data) {
    var lines = data.toString('utf8').split('\n')
    console.log('<-', lines)
    var msg = JSON.parse(lines[0])
    if (msg.method) {
      if (msg.method == "hello") {
        console.log('-> auth.session device_key', auth_token.substr(0,4)+"...")
        apiSocket.write(JSON.stringify({
          id: "rpc-auth",
          method: "auth.session", params: { device_key: auth_token }
        }) + "\n")
      }
    }

    if (msg.error) {
      console.log('<-', JSON.stringify(msg.error))
      apiSocket.end()
      if (msg.error.code == "BK1") {
        response.writeHead(401)
      } else {
        response.writeHead(500)
      }
      response.end()
    }

    if (msg.id == "rpc-auth" && msg.result) {
      console.log('<- auth good', JSON.stringify(msg.result))
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
          console.log('client closed before response write.')
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
    console.log('record #' + points.length, 'overland action', last_location.properties.action)
    if (last_location.properties.action) {
      rpcNext(points, apiSocket)
    } else {
      console.log('#' + points.length, new Date())
      rpcAdd(last_location, apiSocket)
    }
  } else {
    // end recursion
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
  // Overland examples
  {
    "type": "Feature",
    "geometry": { "type": "Point", "coordinates": [-122.621, 45.535] }, // geojson
    "properties": { // no activity field means new point
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
    {
      "type": "Feature",
      "geometry": {
        "type": "Point",
        "coordinates": [
          -122.60902139561254,
          45.47959670769497
        ]
      },
      "properties": {
        "speed": 0,
        "battery_state": "unplugged",
        "motion": [],
        "timestamp": "2018-10-11T01:15:34Z",
        "battery_level": 0.8799999952316284,
        "vertical_accuracy": 3,
        "pauses": true,
        "horizontal_accuracy": 12,
        "wifi": "",
        "deferred": 0,
        "significant_change": 1,
        "locations_in_payload": 1,
        "activity": "fitness",
        "device_id": "iphone6",
        "altitude": 76,
        "desired_accuracy": -1
      }
    },

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
