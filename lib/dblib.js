var Promise = require('bluebird');

exports.factory = function(rethink, db) {
  var dblib = {}
  var db_name = 'icecondor'
  var schema = { 'users': {indexes: []},
                 'activities': {indexes: ['date']},
               }

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
        Promise.all(Object.keys(schema).map(function(table_name){
          return ensure_table(conn, table_name, schema[table_name])
        })).then(function(){
          cb(conn)
        })
      })
    })
  }

  function ensure_table(conn, table_name, schema) {
    return rethink.tableList().run(conn).then(function(tables){
      if(tables.indexOf(table_name) == -1){
        console.log("Warning: creating table "+table_name+" with "+JSON.stringify(schema))
        return rethink.tableCreate(table_name).run(conn) // sync
      }
    }).error(function(e){console.log(e)}).then(function(){
      schema.indexes.map(function(index_name){
        return ensure_index(conn, table_name, index_name)
      })
    })
  }

  function ensure_index(conn, table_name, index_name) {
    return rethink.table(table_name).indexList().run(conn).then(function(indexes){
      if(indexes.indexOf(index_name) == -1) {
        console.log("Warning: creating table "+table_name+" index "+index_name)
        return rethink.table(table_name).indexCreate(index_name).run(conn) // sync
      }
    })
  }

  dblib.changes = function() {
    return db.then(function(conn){
      return rethink.table('activities').changes().run(conn)
    })
  }

  dblib.activity_add = function(record) {
    return db.then(function(conn){
      return rethink.table('activities').insert(record).run(conn)
    })
  }

/* record functions */

  dblib.find_user_by = function(terms) {
    console.log('db.find_user_by', terms)
    return db.then(function(conn){
      return rethink.table('users').filter(terms).run(conn).then(function(cursor){
        return cursor.toArray().then(function(users){
          if(users.length == 1) {
            console.dir(users[0])
            return users[0]
          }
          return new Promise(function(resolve, reject) {
            reject({code:'notfound', message:"User not found"})
          })
        })
      })
    })
  }

  dblib.update_user_by = function(id, terms) {
    console.log('db.update_user_by', terms)
    var user = {}
    var valid = false
    if(terms.username) {
      // username is a unique string
      if(typeof(terms.username) == 'string') {
        if(terms.username.length >= 2) {
          if(terms.username.length <= 32) {
            if(terms.username.match(/^[a-z0-9]+(-[a-z0-9]+)*$/)) {
              user = {username: terms.username}
              valid = true
            } else {
              return new Promise(function(resolve, reject) {
                reject({message:"Invalid username. Use a-z, 0-9, and -"})
              })
            }
          } else {
            return new Promise(function(resolve, reject) {
              reject({message:"username too long. 32 characters maximum"})
            })
          }
        } else {
          return new Promise(function(resolve, reject) {
            reject({message:"username too short. 2 characters minimum"})
          })
        }
      } else {
        return new Promise(function(resolve, reject) {
          reject({message:"Invalid username"})
        })
      }
    }

    if(valid) {
      return db.then(function(conn){
        return dblib.find_user_by({username: terms.username}).then(function(found){
          console.log('user found', terms.username)
          if(found.id == id) {
            return new Promise(function(resolve, reject) {
              resolve({message: "username: no change"})
            })
          } else {
            return new Promise(function(resolve, reject) {
              reject({message:"username "+terms.username+" already exists"})
            })
          }
        }, function(not_found){
          console.log('user not found', terms.username)
          return rethink.table('users').get(id).update(user).run(conn)
        })
      })
    }
  }

  dblib.get_user = function(id) {
    console.log('db.get_user', id)
    return db.then(function(conn){
      return rethink.table('users').get(id).run(conn)
    })
  }

  dblib.ensure_user = function(user) {
    console.log('db.ensure_user '+JSON.stringify(user))
    return dblib.find_user_by(rethink.row('email').eq(user.email)).then(function(){},
      function(){
        return db.then(function(conn) {
          return rethink.table('users').insert(user).run(conn).then(
            function(status){
              return new Promise(function(re,rj){status.inserted == 1 ? re() : rj()}).then(function(){
                return dblib.find_user_by(rethink.row('email').eq(user.email)) // new query for id
              })
            })
        })
    })
  }

  dblib.user_add_device = function(user_id, device_id) {
    return db.then(function(conn){
      return rethink.table('users').get(user_id).
                 update({devices:rethink.row('devices').prepend(device_id)}).run(conn)
    })
  }

  dblib.user_add_friend = function(user_id, friend_id) {
    console.log('db.user_add_friend', user_id, friend_id)
    return db.then(function(conn){
      rethink.table('users').get(user_id).run(conn).then(function(user){
        if(user.friends.indexOf(friend_id) == -1) {
          console.log('db.user_add_friend adding', friend_id)
          return rethink.table('users').get(user_id).
                   update({friends:rethink.row('friends').append(friend_id)}).
                   run(conn)
        } else {
          return new Promise(function(resolve, reject) {
            resolve({message:"Already friends"})
          })
        }

      })
    })
  }

  dblib.find_locations_for = function(user_id, start, stop, count) {
    console.log('db.find_locations_for ',user_id, start, stop, count)
    return db.then(function(conn){
      var query = rethink.table('activities')
      var order = rethink.desc('date')
      var date_filter
      if(start && stop) {
        console.log('between '+start+' and '+stop)
        query = query.between(start.toISOString(), stop.toISOString(), {index: "date"})
        order = rethink.asc('date')
      }
      if(start && !stop) {
        console.log('greater than '+start.toISOString()+' ascending')
        date_filter = rethink.row('date').gt(start.toISOString())
        order = rethink.asc('date')
      }
      if(!start && stop) {
        console.log('lessthan '+stop)
        date_filter = rethink.row('date').lt(stop.toISOString())
      }
      var user_filter = rethink.row('user_id').eq(user_id)
      var location_type = rethink.row('type').eq("location")
      var filter = user_filter.and(location_type)
      if(date_filter) {
        console.log('adding date_filter')
        filter = filter.and(date_filter)
      }
      query = query.orderBy({index: order})
      query = query.filter(filter)
      count = count > 2000 ? 2000 : count
      query = query.limit(count)
      return query.run(conn)
    })
  }

  return dblib
}
