// node
var fs = require('fs')

// npm
var Promise = require('bluebird')
var rethink = require('rethinkdb')
var then_redis = require('then-redis')
var mkdirp = Promise.promisify(require('mkdirp'))

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
              .then(function(url){
                entry.status = 'finished'
                entry.url = url
                console.log(entry)
                redis.hset('zipq', user_id, JSON.stringify(list))
              })
          }
        })
      })
      lock = false
    })
}

function doZip(user_id) {
  return r.then(function(conn){
    conn.use('icecondor')
    return rethink.table('users').get(user_id).run(conn)
      .then(function(user){
        return rethink.table('activities').filter({user_id: user_id}).run(conn)
          .then(function(cursor){
            var nonce = 'abc'
            var web_dir = 'gpx/'+nonce
            var fs_dir = settings.web.root + '/' + web_dir
            return mkdirp(fs_dir).then(function() {
              var filename = user.username+'-icecondor.gpx'
              var fs_path = fs_dir + '/' + filename
              var url_path = web_dir + '/' + filename
              console.log(fs_path, url_path)
              var gpx = fs.createWriteStream(fs_path)
              gpx.write('<?xml version="1.0" encoding="UTF-8"?>\n')
              gpx.write('<gpx version="1.0">\n')
              gpx.write(' <name>IceCondor export for '+user.username+'</name>\n')
              gpx.write(' <trk><name>History</name><number>1</number>\n')
              gpx.write('  <trkseg>\n')
              cursor.each(function(err, act){
                gpx.write('   <trkpt lat="'+act.latitude+'" lon="'+act.longitude+'">'+
                          '<time>'+act.date+'</time></trkpt>\n')
              })
              gpx.write('  </trkseg>\n')
              gpx.write(' </trk>\n')
              gpx.write('</gpx>\n')
              gpx.end()
              return url_path
            })
          })
      })
  })
}