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
          if(entry.status == 'processing') {
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
    rethink.table('activities').filter({user_id: user_id}).run(conn)
      .then(function(cursor){
        cursor.each(function(act){
          console.log(act)
        })
      })
  })
}