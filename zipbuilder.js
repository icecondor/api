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
var emailer = require('./lib/email').factory(settings.email)

var r = rethink.connect(settings.rethinkdb)
var redis = then_redis.createClient();

var lock = false
cleanUp()
downloadCheck()
setInterval(downloadCheck, 30*1000)

function cleanUp() {

  redis.hgetall('zipq')
    .then(function(zipq){
      var keys = Object.keys(zipq)
      keys.forEach(function(user_id){
        var list = JSON.parse(zipq[user_id])
        list.forEach(function(entry, idx) {
          if(entry.status == 'building') {
            // broken
            console.log('clean', entry, idx)
            list[idx] = null
          }
        })

        list = list.filter(function(e){return e})
        redis.hset('zipq', user_id, JSON.stringify(list))
      })
    })
}

function downloadCheck() {
  console.log('## dumpQueueCheck', new Date())
  if(lock) { console.log('abort! lock held.'); return }
  lock = true
  redis.hgetall('zipq')
    .then(function(zipq){
      var keys = Object.keys(zipq)
      keys.forEach(function(user_id){
        var list = JSON.parse(zipq[user_id])
        list.forEach(function(entry) {
          if(entry.status == 'waiting') {
            entry.status = 'building'
            console.log(user_id, entry)
            redis.hset('zipq', user_id, JSON.stringify(list))
            doZip(user_id, new Date('2008-01-01'), new Date())
              .then(function(out){
                entry.status = 'finished'
                entry.url = out.url
                entry.count = out.count
                entry.size = out.size
                console.log(entry)
                redis.hset('zipq', user_id, JSON.stringify(list))
              })
          }
        })
      })
      lock = false
    })
}

function doZip(user_id, start, stop) {
  return r.then(function(conn){
    conn.use('icecondor')
    return rethink.table('users').get(user_id).run(conn)
      .then(function(user){
        return rethink.table('activities')
          .between([user_id, start.toISOString()],
                   [user_id, stop.toISOString()],
                             {index: 'user_id_date',
                              left_bound:'open',
                              right_bound:'closed'})
          .orderBy({index:rethink.asc('user_id_date')})
          .run(conn)
          .then(function(cursor){
            var nonce = newId(36,5)
            var web_dir = 'gpx/'+nonce
            var fs_dir = settings.web.root + '/' + web_dir
            return mkdirp(fs_dir).then(function() {
              var filename = user.username+'-icecondor.gpx'
              var fs_path = fs_dir + '/' + filename
              var url_path = web_dir + '/' + filename
              console.log(fs_path, url_path)
              var gpx = fs.createWriteStream(fs_path)
              return doWrite(user, gpx, cursor)
                .then(function(count){
                  var stat = fs.statSync(fs_path)
                  var mb_size = stat.size/1024/1024
                  var email = emailer.build_dump_email(user.email, url_path,
                                                       count, mb_size)
                  emailer.send_email(email)
                  return {url: '/'+url_path, count: count, size: stat.size}
                })
            })
          })
      })
  })
}

function doWrite(user, gpx, cursor) {
  return new Promise(function(resolve, reject){
    gpx.write('<?xml version="1.0" encoding="UTF-8"?>\n')
    gpx.write('<gpx version="1.0">\n')
    gpx.write(' <name>IceCondor export for '+user.username+'</name>\n')
    gpx.write(' <trk><name>History</name><number>1</number>\n')
    gpx.write('  <trkseg>\n')
    var count = 0
    cursor.each(function(err, act){
      if(act.type === 'location') {
        gpx.write('   <trkpt lat="'+act.latitude+'" lon="'+act.longitude+'">'+
                  '<time>'+act.date+'</time></trkpt>\n')
        count = count + 1
      }
    }, function(){
      gpx.write('  </trkseg>\n')
      gpx.write(' </trk>\n')
      gpx.write('</gpx>\n')
      gpx.end()
      resolve(count)
    })
  })
}

function newId(base, length) {
  var unit = Math.pow(base,length-1)
  var add = Math.random()*unit*(base-1)
  var idInt = unit + Math.floor(add) - 1
  return idInt.toString(base)
}
