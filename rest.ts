var net = require('net')
var fs = require('fs')
var http = require('http')
var Url = require('url')
var uuid = require('node-uuid')
var querystring = require('querystring')

let settings = JSON.parse(fs.readFileSync("settings.json", 'utf8'))
let clientMode

console.log("rest listening on", settings.rest.listen_port)

http
  .createServer(function(request, response) {
    let params = paramsFromUrl(request.url)
    let bodyParts: string[] = []
    request.on('data', (chunk) => {
      if (chunk.length > 0) bodyParts.push(chunk)
    }).on('end', () => http_assemble_json(request, bodyParts, (data) => {
      if (data) {
        console.log('<-JSON', JSON.stringify(data))
        var locations: string[] = []
        if (data.locations) { // bundled message semantics/geojson
          locations = data.locations
        } else {
          locations.push(data)
        }
        let token = params.token || data.token
        if (token.length == 43) { token += '=' } // base64 in url hack
        push_points(response, token, locations)
      } else {
        response.writeHead(400)
        response.end()
      }
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

function http_assemble_json(request, bodyParts, cb) {
  let body = Buffer.concat(bodyParts).toString()
  if (body.length > 0) {
    try {
      console.log('<-HTTP', request.method, request.headers['content-type'], JSON.stringify(body))
      let data = JSON.parse(body)
      cb(data)
    } catch (e) {
      if (e instanceof SyntaxError) {
        let qbody = querystring.parse(body)
        if (qbody) {
          cb(qbody)
        } else {
          console.log('payload not understood', JSON.stringify(body.substr(0, 280)))
          cb()
        }
      } else {
        console.log('aborting connection.', e.name)
        cb()
      }
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
    console.log('<-IC', lines)
    var msg = JSON.parse(lines[0])
    if (msg.method) {
      if (msg.method == "hello") {
        console.log('-> auth.session device_key', auth_token.substr(0, 4) + "...")
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
      console.log('<- rpc-add result', JSON.stringify(msg))
      response.setHeader('content-type', 'application/json')
      if (msg.result) {
        if (points.length == 0) {
          response.statusCode = 200
          console.log('response.statusCode 200', clientMode)
          msg.result.result = "ok"
          if (!response.finished) {
            let responseJson
            if (clientMode == 'overland') {
              responseJson = JSON.stringify(msg.result)
            } else if (clientMode == 'owntracks') {
              responseJson = JSON.stringify([])
            } else if (clientMode == 'nextcloud') {
              responseJson = JSON.stringify("")
            } else {
              console.log('rpc-add unknown clientMode', clientMode)
            }
            console.log('response.write ' + responseJson)
            response.write(responseJson)
          } else {
            console.log('client closed before response write.')
          }
        } else {
          console.log('ignoring return value when points len ' + points.length)
        }
        rpcNext(points, apiSocket)
      }
      if (msg.error) {
        response.statusCode = 500
        response.write(JSON.stringify(msg.error))
      }
      console.log('response.end()')
      response.end()
      clientMode = ''
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
    if (last_location.properties && last_location.properties.action) {
      console.log('record #' + points.length + 'skipped')
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
    let location_params: any = {}
    let heartbeat_params = {}
    if (last_location.type == 'Feature') {
      clientMode = 'overland'
      location_params = geojson2icecondor(last_location)
    } else if (last_location._type == 'location') {
      clientMode = 'owntracks'
      location_params = owntracks2icecondor(last_location)
      heartbeat_params = owntracks2heartbeat(last_location)
    } else if (last_location.timestamp) {
      clientMode = 'nextcloud'
      location_params = nextcloud2icecondor(last_location)
      heartbeat_params = nextcloud2heartbeat(last_location)
    }
    rpcWrite(location_params, apiSocket)
    rpcWrite(heartbeat_params, apiSocket)
  }
}

function rpcWrite(params, apiSocket) {
    let rpc = { id: "rpc-add-"+params.id.substr(-6), method: "activity.add", params: params }
    console.log(rpc)
    apiSocket.write(JSON.stringify(rpc) + "\n")
}

function geojson2icecondor(geojson) {

  /*
  // Overland examples

  // group msg
  {"locations":[
     {"type":"Feature",
      "geometry":{"type":"Point",
                    "coordinates":[-122.69711090116809,45.45002201836941]},
                    "properties":{"speed":-1,"battery_state":"unplugged",
                    "motion":[],"timestamp":"2019-02-06T22:43:15Z",
                    "battery_level":0.7900000214576721,"vertical_accuracy":10,
                    "pauses":true,"horizontal_accuracy":65,"wifi":"a1",
                    "deferred":0,"significant_change":1,"locations_in_payload":1,
                    "activity":"fitness","device_id":"iphoneX","altitude":155,
                    "desired_accuracy":-1}}]}

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
  Icecondor example
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

/*
owntracks
{ _type: 'location',
  acc: 16,
  alt: 0,
  batt: 67,
  conn: 'm',
  lat: 45.5231465,
  lon: -122.6620576,
  t: 'u',
  tid: 'li',
  tst: 1549489702,
  vac: 0,
  vel: 0 }
*/

function owntracks2icecondor(owntracks) {
  let date = new Date(owntracks.tst * 1000)
  return {
    id: uuid.v4(),
    type: "location",
    date: date.toISOString(),
    latitude: owntracks.lat,
    longitude: owntracks.lon,
    accuracy: owntracks.acc,
    provider: "network"
  }
}

function owntracks2heartbeat(owntracks) {
  return {
    id: uuid.v4(),
    type: "heartbeat",
    battery_percentage: owntracks.batt
  }
}

/*
nextcloud/phonetrack
querystring to json:
{"acc":"20.413999557495117","batt":"89.0","alt":"38.099998474121094","lon":"-122.6794917","lat":"45.552868",
 "timestamp":"1554677785","token":"lBX"}
*/
function nextcloud2icecondor(next) {
  return {
    id: uuid.v4(),
    type: "location",
    date: new Date(parseInt(next["timestamp"]) * 1000).toISOString(),
    latitude: parseFloat(next['lat']),
    longitude: parseFloat(next['lon']),
    accuracy: parseFloat(next['acc']),
    provider: "network"
  }
}

function nextcloud2heartbeat(next) {
  return {
    id: uuid.v4(),
    type: "heartbeat",
    battery_percentage: parseFloat(next['batt'])
  }
}

