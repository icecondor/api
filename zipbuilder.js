// node
var fs = require('fs')

// npm
var rethink = require('rethinkdb')
var then_redis = require('then-redis')

// local
var major_version = 2
var settings = require('./lib/settings')(major_version)
var r = rethink.connect(settings.rethinkdb)
var redis = then_redis.createClient();

var lock = false
downloadCheck()
setTimeout(downloadCheck, 30*1000)

function downloadCheck() {
  if(lock) { console.log('abort! lock held.'); return }
  lock = true
  redis.hgetall('zipq')
    .then(function(zipq){
      console.log(zipq)
      var keys = Object.keys(zipq)
      keys.forEach(function(user_id){
        var list = JSON.parse(zipq[user_id])
        list.forEach(function(entry) {
          if(entry.status == 'waiting') {
            console.log(user_id, entry)
            entry.status = 'processing'
            redis.hset('zipq', user_id, JSON.stringify(list))
            doZip(user_id)
          }
        })
      })
      lock = false
    })
}

function doZip(user_id) {
  r.then(function(conn){
    conn.use('icecondor')
    rethink.table('users').get(user_id).run(conn)
      .then(function(user){
        rethink.table('activities').filter({user_id: user_id}).run(conn)
          .then(function(cursor){
            var gpx = fs.createWriteStream('out.gpx')
            gpx.write('<?xml version="1.0" encoding="UTF-8"?>\n')
            gpx.write('<gpx version="1.0">\n')
            gpx.write(' <name>IceCondor export for '+user.username+'</name>\n')
            gpx.write(' <trk><name>History</name><number>1</number>\n')
            gpx.write('  <trkseg>\n')
            cursor.each(function(err, act){
              gpx.write('   <trkpt lat="'+act.latitude+'" lon="'+act.longitude+'">'+
                        '<ele>'+act.elevation+'</ele><time>'+act.date+'</time></trkpt>\n')
            })
            gpx.write('  </trkseg>\n')
            gpx.write(' </trk>\n')
            gpx.write('</gpx>\n')
            gpx.end()
          })
      })
  })
}