var fs = require('fs');
var stream = require('stream')

var r = require('rethinkdb')
var JSONStream = require('JSONStream')

var echoStream = new stream.Writable({objectMode: true});

var user_docs = require('./users.json')
console.log('users', user_docs.length)
var users = {}


function translate_user(user) {
  var new_user = {
          id: user._id,
          email: user.email,
          username: user.username,
          created_at: user.created_at,
          devices: [],
          friends: [],
          access: {}
        }
  return new_user
}

function transform(loc){
  var user = users[loc.username]
  if (user) {
    var new_loc = {
        id: loc._id,
        type: loc.type,
        date: loc.date,
        provider: loc.provider,
        latitude: loc.position.latitude,
        longitude: loc.position.longitude,
        accuracy: loc.position.accuracy,
        altitude: loc.position.altitude,
        velocity: loc.velocity,
        heading: loc.heading
      }
    return new_loc
  } else {
    console.log('location user unknown!', loc.username, loc.id)
  }
}

r.connect({db:'icecondor'}).then(function(conn){
  for(var idx in user_docs) {
    var user = translate_user(user_docs[idx].doc)
    console.log('transform_user wtf1', idx, user.username)
    r.table('users').filter({username: user.username}).run(conn,
      (function(user) {
        return function(err, cursor){
          console.log('transform_user wtf2', idx, user)
          cursor.next(function(err, found){
            if(found) {
              console.log("user exists", user.username)
              users[user.username] = user
            } else {
              console.log('transform_user insert', user.username)
              r.table('users').insert(user).run(conn, function(err, result){
                console.log("user saved!", result)
                users[user.username] = user
              })
            }
          })
        }
      })(user)
    )
  }

  echoStream._write = function (chunk, encoding, done) {
    var new_chunk = transform(chunk)

    r.table('activities').insert(new_chunk).run(conn, function(doc, result){
      if(result.errors > 0) {
        console.log(chunk.type, result.errors)
      } else {
        console.log("SAVED", new_chunk)
      }
      done()
    })
  };
  fs.createReadStream("icecondor.json")
    .pipe(JSONStream.parse('rows.*.doc'))
    .pipe(echoStream)
})
