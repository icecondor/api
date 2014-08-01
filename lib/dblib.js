var Promise = require('bluebird');
var rethink = require('rethinkdb')

exports.factory = function() {
  var dblib = {}
  var db = rethink.connect()
  var db_name = 'icecondor'

  function connectdb(conn) {
    var dbs = rethink.dbList().run(conn)
    return dbs.then(function(db_names){
      if(db_names.indexOf(db_name) == -1){
        console.log("Warning: creating database "+db_name)
        rethink.dbCreate(db_name).run(conn) //sync
      }
    }).then(function(){
      conn.use(db_name)
    })
  }

  dblib.setup = function(cb) {
    db.then(function(conn){
      connectdb(conn).then(function(){
        Promise.all(['users','actions'].map(function(table_name){
          return ensure_table(conn, table_name)
        })).then(function(){
          cb(conn)
        })
      })
    })
  }

  function ensure_table(conn, table_name) {
    var tables = rethink.tableList().run(conn)
    return tables.then(function(tables){
      if(tables.indexOf(table_name) == -1){
        console.log("Warning: creating table "+table_name)
        rethink.tableCreate(table_name).run(conn) // sync
      }
    }).error(function(e){console.log(e)})
  }

  dblib.insert = function(record) {
    db.then(function(conn){
      rethink.table('actions').insert(record).run(conn)
    })
  }

/* record functions */

  dblib.find_user_by_email = function(email, cb) {
    console.log('db.find_user_by_email '+email)
    db.then(function(conn){
      var user_filter = rethink.table('users').filter({email:email})
      user_filter.run(conn,
        function(err,cursor){
          console.log('db.find_user_by_email response')
          if(err) {
            console.log('err:'+err)
          } else {
            var users = cursor.toArray()
            var user
            if(users.length > 0) {
              user = users[0]
              console.log(user)
            }
            cb(user)
          }
        }
      )
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
