var redb = require('rethinkdb')

redb.connect({}, connectcb)

function connectcb(err, conn){
  if(err) {
    console.log(err)
  } else {
    console.log(conn)
  }
}