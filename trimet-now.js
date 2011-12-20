var request = require('request'),
    net = require('net'),
    settings = require('./settings'),
    timers = require('timers'),
    fs = require('fs');
    
var trimet = JSON.parse(fs.readFileSync('trimet.json'));

var url = "http://developer.trimet.org/ws/V1/arrivals?locIDs="+trimet.stopID
           +"&json=yes&appID="+trimet.appID
console.log(url)

client = net.connect(settings.api.listen_port, "localhost", start_timer)

function start_timer() {
  console.log('api connected. start timer')
  timers.setInterval(function() {
      trimet_request(trimet_positions);
    }, 30000)
}

function trimet_request(callback) {
  request(url, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      callback(JSON.parse(body));
    } else {
      console.log('error '+response.statusCode)
    }
  })
}

// unfortunately not able to track a specific bus
function trimet_positions(msg) {
  var arrivals = msg.resultSet.arrival;
  var estimateds = arrivals.filter(function(arrival) { return arrival.status == "estimated"})
  writeApi(estimateds[0].blockPosition)
}

function writeApi(location) {
  var msg = { type:"location",
              username:"trimet14",
              date: new Date(new Date(location.at).getTime()),
              heading: location.heading,
              provider: "api",
              position: { latitude: location.lat,
                          longitude: location.lng,
                         }
            }
  var msg_s = JSON.stringify(msg)+"\n"
  console.log(msg_s)
  client.write(msg_s)

}
