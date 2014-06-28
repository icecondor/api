var rethink = require('rethinkdb')

exports.factory = function() {
  var dblib = {}
  var db = rethink.connect({db:'icecondor'})

  dblib.connectcb = function(err, conn){
    if(err) {
      console.log(err)
    } else {
      console.log("Rethinkdb connected!")
    }
  }

  dblib.setup = function() {
    // db
    db.then(function(conn){
      var dbs = rethink.dbList().run(conn)
      dbs.then(function(dbs){
        if(dbs.indexOf('icecondor') == -1){
          console.log("Warning: creating database icecondor")
          rethink.dbCreate('icecondor').run(conn)
        }
      })

      var tables = rethink.tableList().run(conn)
      tables.then(function(tables){
        if(tables.indexOf('actions') == -1){
          console.log("Warning: creating table actions")
          rethink.tableCreate('actions').run(conn)
        }
      })

      console.log('db connected.')
    })
  }

  dblib.insert = function(record) {
    db.then(function(conn){
      rethink.table('actions').insert(record).run(conn)
    })
  }

  return dblib
}