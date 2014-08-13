var Promise = require('bluebird');

exports.factory = function(rethink) {
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
      console.log("rethinkdb:"+db_name+" connected.")
    })
  }

  dblib.setup = function(cb) {
    return db.then(function(conn){
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

  dblib.find_user_by_email = function(email) {
    console.log('db.find_user_by_email '+email)
    return db.then(function(conn){
      var user_filter = rethink.table('users').filter({email:email})
      return user_filter.run(conn).then(
        function(cursor){
          var users = cursor.toArray()
          if(users.length == 1) {
            return users[0]
          }
          return new Promise(function(resolve, reject) {
            reject("Not found")
          })
        }
      )
    })
  }

  dblib.ensure_user = function(user) {
    console.log('db.ensure_user '+user)
    return dblib.find_user_by_email(user.email).then(null,
      function(){
        return db.then(function(conn) {
          return rethink.table('users').insert(user).run(conn).then(
            function(status){
              return new Promise(function(re,rj){status.inserted == 1 ? re() : rj()})
            })
        })
    })
  }

  return dblib
}
