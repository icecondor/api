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

  dblib.find_user_by = function(terms) {
    console.log('db.find_user_by '+terms)
    return db.then(function(conn){
      return rethink.table('users').filter(terms).run(conn).then(function(cursor){
        return cursor.toArray().then(function(users){
          if(users.length == 1) {
            return users[0]
          }
          return new Promise(function(resolve, reject) {
            reject("User not found")
          })
        })
      })
    })
  }

  dblib.get_user = function(id) {
    console.log('db.get_user '+id)
    return db.then(function(conn){
      return rethink.table('users').get(id).run(conn).then(function(cursor){
        return cursor.toArray().then(function(users){
          if(users.length == 1) {
            return users[0]
          }
          return new Promise(function(resolve, reject) {
            reject("User not found")
          })
        })
      })
    })
  }

  dblib.ensure_user = function(user) {
    console.log('db.ensure_user '+JSON.stringify(user))
    return dblib.find_user_by(rethink.row('email').eq(user.email)).then(function(){},
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
