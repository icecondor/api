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

      ensure_table(conn, 'actions')
      ensure_table(conn, 'users')

      console.log('db connected.')
    })
  }

  function ensure_table(conn, table_name) {
    var tables = rethink.tableList().run(conn)
    tables.then(function(tables){
      if(tables.indexOf(table_name) == -1){
        console.log("Warning: creating table "+table_name)
        rethink.tableCreate(table_name).run(conn)
      }
    })
  }

  dblib.insert = function(record) {
    db.then(function(conn){
      rethink.table('actions').insert(record).run(conn)
    })
  }

/* record functions */

  dblib.find_user_by_email = function(email) {
    console.log('db.find_user_by_email')
    db.then(function(conn){
      rethink.table('users').filter({email:email}).run(conn,
        function(err,cursor){
          console.log('db.find_user_by_email response')
          if(err) {
            console.log('err:'+err)
          } else {
            var user = cursor.next()
            console.log(user)
            return user
          }
        })
    })

  }

  dblib.ensure_user = function(user) {
    console.log('db.ensure_user')
    if(!dblib.find_user_by_email(user.email)){
      console.log('user not found')
      db.then(function(conn){
        rethink.table('users').insert(user).run(conn,
          function(err,cursor){
            console.log('db.ensure_user response')
            if(err) {
              console.log('err:'+err)
            } else {
              var user = cursor.next()
              console.log(user)
              return user
            }
          })
      })
    }
  }

  return dblib
}
