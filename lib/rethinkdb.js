var redb = require('rethinkdb')

redb.connect({})

function connectcb(err, conn){
  if(err) {
    console.log(err)
  } else {
    console.log("Rethinkdb connected!")
  }
}