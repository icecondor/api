var major_version = 2
var settings = require('./lib/settings')(major_version),
    net = require('net'),
    http = require('http'),
    express = require('express'), app = express()

app.get('/', function (req, res) {
  res.sendfile(__dirname + '/html/index.html');
});
var server = app.listen(settings.socket_io.listen_port)
var io = require('socket.io')(server)

console.log("socket.io listening on "+settings.socket_io.listen_port)

// socket.io
io.sockets.on('connection', function (client) {
  console.log(client.id+" connecting to API")
  var apiSocket = net.connect(settings.api.listen_port, "localhost")
  var apiBuffer = "";

  apiSocket.on('data', function(data) {
    var dstr = data.toString('utf8')
    dstr.split('\n').forEach(function(ds, idx) {
      if (idx == 0) { ds = apiBuffer + ds }
      if (idx == ds.length-1) {
        apiBuffer = ds
      } else {
         if (ds.length > 0) {
           console.log("json=>"+ds)
           var msg = JSON.parse(ds)
           console.log("-> "+ds)
           client.emit('dispatch',msg)
         }
      }
    })
  })

  apiSocket.on('error', function(err) {
    console.log("apiSocket err: "+err)
  })

  client.on('api', function (str) {
    /* which is it? */
    if(typeof str == 'string') {
      /* string */
      var msgs = JSON.parse(str)
      msgs.forEach(function(msg){
        var data = JSON.stringify(msg)
        console.log("<-s "+data)
        apiSocket.write(data+"\n")
      })
    } else {
      /* message object */
      var ostr = JSON.stringify(str);
      console.log("<-o "+ostr);
      apiSocket.write(ostr+"\n")
    }
  });

  client.on('disconnect', function(client) {
    apiSocket.end()
    console.log('disconnnect!')
  })
});

