var Promise = require('bluebird');

exports.factory = function(rethink, db) {
  var dblib = {}
  var db_name = 'icecondor'
  var schema = {
    'users': {
      indexes: ['username',
        ['email_downcase', [rethink.row('email').downcase()]],
        ['friends', ['friends'], { multi: true }]
      ]
    },
    'activities': {
      indexes: ['date',
        'user_id',
        ['user_id_date', ['user_id', 'date']]
      ]
    },
    'fences': {
      indexes: ['user_id',
        ['geojson', ['geojson'], { geo: true }]]
    },
    'rules': { indexes: ['user_id', 'fence_id'] }
  }

  function connectdb(conn) {
    var dbs = rethink.dbList().run(conn)
    return dbs.then(function(db_names) {
      if (db_names.indexOf(db_name) == -1) {
        console.log("Warning: creating database " + db_name)
        rethink.dbCreate(db_name).run(conn) //sync
      }
    }).then(function() {
      conn.use(db_name)
      console.log("rethinkdb", "db:", db_name, "connected.")
      return new Promise(function(resolve, reject) { resolve() })
    })
  }

  function ensure_table(conn, table_name, schema) {
    return rethink.tableList().run(conn).then(function(tables) {
      if (tables.indexOf(table_name) == -1) {
        console.log("Warning: creating table " + table_name + " with " + JSON.stringify(schema))
        return rethink.tableCreate(table_name).run(conn) // sync
      }
    }).error(function(e) { console.log(e) }).then(function() {
      schema.indexes.map(function(index_name) {
        return ensure_index(conn, table_name, index_name)
      })
    })
  }

  function ensure_index(conn, table_name, index_desc) {
    return rethink.table(table_name).indexList().run(conn).then(function(indexes) {
      if (!Array.isArray(index_desc)) {
        index_desc = [index_desc, [index_desc]]
      }
      var index_name = index_desc[0]
      var columns = index_desc[1].map(function(name) {
        return (typeof name == 'function') ? name : rethink.row(name)
      })
      if (indexes.indexOf(index_name) == -1) {
        var table = rethink.table(table_name)
        var opts = index_desc[2] || {}
        if (columns.length == 1) { columns = columns[0] }
        return table.indexCreate(index_name, columns, opts).run(conn).then(function() {
          console.log("Warning: building index", index_name, "for table", table_name)
          return table.indexWait(index_name).run(conn)
        })
      }
    })
  }

  function dbcall(cb) {
    var start = new Date()
    return db.then(function(conn) {
      return cb(conn).then(function(value) {
        var stop = new Date()
        var duration_sec = (stop - start) / 1000
        return { value: value, duration: duration_sec }
      })
    })
  }

  function build_find_query(user_id, start, stop, count, type, order) {
    console.log('build_find_query', 'user_id', user_id, 'start', start,
      'stop', stop, 'count', count, 'type', type,
      'order', order)
    var query = rethink.table('activities')
    var filters = []

    if (!stop) {
      stop = new Date()
    }
    if (!start) {
      start = new Date("2008-08-01") // all time
    }
    console.log('adjusted between ' + start.toISOString() + ' and ' + stop.toISOString())
    query = query.between([user_id, start.toISOString()],
      [user_id, stop.toISOString()],
      {
        index: "user_id_date",
        left_bound: 'open',
        right_bound: 'closed'
      })

    order = (order == 'oldest' ? rethink.asc('user_id_date') : rethink.desc('user_id_date'))
    query = query.orderBy({ index: order })

    if (type) {
      console.log('filter type', type)
      //filters.push(rethink.row('type').eq(type))
      query = query.filter(rethink.row('type').eq(type))
    }

    console.log('limit count', count)
    query = query.limit(count)

    return query
  }

  dblib.setup = function(cb) {
    return dbcall(function(conn) {
      return connectdb(conn).then(function() {
        return Promise.all(Object.keys(schema).map(function(table_name) {
          return ensure_table(conn, table_name, schema[table_name])
        })).then(function() {
          return cb(conn)
        })
      })
    }).then(function(result) {
      console.log('db setup', result.duration, 'sec')
      return result.value
    })
  }

  dblib.changes = function() {
    return db.then(function(conn) {
      return rethink.table('activities').changes().run(conn)
    })
  }

  dblib.activity_add = function(record) {
    return db.then(function(conn) {
      return rethink.table('activities').insert(record).run(conn)
    })
  }

  dblib.activity_get = function(id) {
    return db.then(function(conn) {
      return rethink.table('activities').get(id).run(conn)
    })
  }

  dblib.activity_count = function(params) {
    return db.then(function(conn) {
      var query = rethink.table('activities')
      if (params.start && params.stop) {
        query = query.between(params.start.toISOString(),
          params.stop.toISOString(), {
            index: 'date',
            left_bound: 'open',
            right_bound: 'closed'
          })
      }
      if (params.type) {
        query = query.filter(rethink.row('type').eq(params.type))
      }
      if (params.distinct_user) {
        query = query("user_id").distinct()
      }
      if (params.user_id) {
        query = query.filter({ user_id: params.user_id })
      }
      return query.count().run(conn)
    })
  }

  /* record functions */

  dblib.find_user_by = function(terms) {
    console.log('db.find_user_by', terms)
    return db.then(function(conn) {
      var field = Object.keys(terms)[0]
      var query = rethink.table('users').getAll(terms[field], { index: field })
      return query.run(conn).then(function(cursor) {
        return cursor.toArray().then(function(users) {
          if (users.length == 1) {
            var user = users[0]
            return user
          }
          if (users.length == 0) {
            return new Promise(function(resolve, reject) {
              reject({ code: 'notfound', message: "User not found" })
            })
          }
          if (users.length > 1) {
            return new Promise(function(resolve, reject) {
              reject({ code: 'toomany', message: "Internal error: clone users" })
            })
          }
        })
      })
    })
  }

  dblib.update_user_level = function(id, level) {
    return db.then(function(conn) {
      return rethink.table('users').get(id).
        update({ level: level }).run(conn).then(function(user) {
          console.log('update_user_level', id, user)
        })
    })
  }

  dblib.update_user_latest = function(id, latest) {
    return db.then(function(conn) {
      return rethink.table('users').get(id).
        update({ latest: latest }).run(conn)
    })
  }

  dblib.update_user_access = function(id, access) {
    return db.then(function(conn) {
      return rethink.table('users').get(id).
        update({ access: access }).run(conn).then(function(user) {
          console.log('update_user_access', id, user)
        })
    })
  }

  dblib.update_user_by = function(id, terms) {
    console.log('db.update_user_by', terms)
    var user = {}
    var valid = false
    if (terms.username) {
      // username is a unique string
      if (typeof (terms.username) == 'string') {
        if (terms.username.length >= 2) {
          if (terms.username.length <= 32) {
            if (terms.username.match(/^[a-z0-9]+(-[a-z0-9]+)*$/)) {
              user = { username: terms.username }
              valid = true
            } else {
              return new Promise(function(resolve, reject) {
                reject({ message: "Invalid username. Use a-z, 0-9, and -" })
              })
            }
          } else {
            return new Promise(function(resolve, reject) {
              reject({ message: "username too long. 32 characters maximum" })
            })
          }
        } else {
          return new Promise(function(resolve, reject) {
            reject({ message: "username too short. 2 characters minimum" })
          })
        }
      } else {
        return new Promise(function(resolve, reject) {
          reject({ message: "Invalid username" })
        })
      }
    }

    if (valid) {
      return db.then(function(conn) {
        return dblib.find_user_by({ username: terms.username }).then(function(found) {
          console.log('user found', terms.username)
          if (found.id == id) {
            return new Promise(function(resolve, reject) {
              resolve({ message: "username: no change" })
            })
          } else {
            return new Promise(function(resolve, reject) {
              reject({ message: "username " + terms.username + " already exists" })
            })
          }
        }, function(not_found) {
          console.log('user not found', terms.username)
          return rethink.table('users').get(id).update(user).run(conn)
        })
      })
    }
  }

  dblib.get_user = function(id) {
    return db.then(function(conn) {
      return rethink.table('users').get(id).run(conn)
    })
  }

  dblib.ensure_user = function(user) {
    console.log('db.ensure_user ' + JSON.stringify(user))
    return dblib.find_user_by({ email_downcase: user.email.toLowerCase() }).then(
      function(user) { },
      function(err) {
        if (err.code == 'notfound') {
          return db.then(function(conn) {
            return rethink.table('users').insert(user).run(conn).then(
              function(status) {
                return new Promise(function(re, rj) { status.inserted == 1 ? re() : rj() }).then(function() {
                  return dblib.find_user_by({ email_downcase: user.email.toLowerCase() }) // new query for id
                })
              })
          })
        } else {
          console.log('db.ensure_user err', err)
        }
      })
  }

  dblib.user_add_device = function(user_id, device_id) {
    return db.then(function(conn) {
      return rethink.table('users').get(user_id).
        update({ devices: rethink.row('devices').prepend(device_id) }).run(conn)
    })
  }

  dblib.user_add_friend = function(user_id, friend_id) {
    console.log('db.user_add_friend', user_id, friend_id)
    return db.then(function(conn) {
      rethink.table('users').get(user_id).run(conn).then(function(user) {
        if (user.friends.indexOf(friend_id) == -1) {
          console.log('db.user_add_friend adding', friend_id)
          return rethink.table('users').get(user_id).
            update({ friends: rethink.row('friends').append(friend_id) }).
            run(conn)
        } else {
          return new Promise(function(resolve, reject) {
            resolve({ message: "Already friends" })
          })
        }

      })
    })
  }

  dblib.count_locations_for = function(user_id, start, stop, count, type, order) {
    var query = build_find_query(user_id, start, stop, count, type, order)
    return db.then(function(conn) {
      return query.count().run(conn)
    })
  }

  dblib.users_count = function() {
    return db.then(function(conn) {
      return rethink.table('users').count().run(conn)
    })
  }

  dblib.users_link_count = function() {
    return db.then(function(conn) {
      return rethink.table('users')('friends').map(function(f) { return f.count() }).
        sum().run(conn)
    })
  }

  dblib.friending_me = function(user_id) {
    return db.then(function(conn) {
      return rethink.table('users').getAll(user_id, { index: 'friends' }).run(conn)
        .then(function(cursor) { return cursor.toArray() })
    })
  }

  dblib.find_locations_for = function(user_id, start, stop, count, type, order) {
    var query = build_find_query(user_id, start, stop, count, type, order)
    return dbcall(function(conn) {
      return query.run(conn)
    }).then(function(result) {
      console.log('db find_locations_for', result.duration, 'sec')
      return result.value
    })
  }

  dblib.fence_add = function(record) {
    return db.then(function(conn) {
      return rethink.table('fences').insert(record).run(conn)
    })
  }

  dblib.fence_del = function(id) {
    return db.then(function(conn) {
      return rethink.table('fences').get(id).delete().run(conn)
    })
  }

  dblib.fence_update = function(record) {
    return db.then(function(conn) {
      return rethink.table('fences').get(record.id).update(record, { nonAtomic: true }).run(conn)
    })
  }

  dblib.fence_list = function(user_id) {
    return db.then(function(conn) {
      return rethink.table('fences').filter({ user_id: user_id }).run(conn)
    })
  }

  dblib.fence_get = function(id) {
    return db.then(function(conn) {
      return rethink.table('fences').get(id).run(conn)
    })
  }

  dblib.fences_intersect = function(point, filter) {
    filter = filter || {} // default value
    return db.then(function(conn) {
      var query = rethink.table('fences')
        .getIntersecting(point, { index: 'geojson' })
      if (filter.user_id) {
        query = query.filter({ user_id: filter.user_id })
      }
      query = query.orderBy('area')
      return query.run(conn)
    })
  }

  dblib.rule_list = function(user_id) {
    return db.then(function(conn) {
      return rethink.table('rules').filter({ user_id: user_id }).run(conn)
    })
  }

  dblib.rule_list_by_fence = function(fence_id) {
    return db.then(function(conn) {
      return rethink.table('rules').getAll(fence_id, { index: 'fence_id' }).run(conn)
    })
  }

  dblib.rule_add = function(record) {
    return db.then(function(conn) {
      return rethink.table('rules').insert(record).run(conn)
    })
  }

  dblib.rule_get = function(id) {
    return db.then(function(conn) {
      return rethink.table('rules').get(id).run(conn)
    })
  }

  dblib.rule_del = function(id) {
    return db.then(function(conn) {
      return rethink.table('rules').get(id).delete().run(conn)
    })
  }

  return dblib
}
