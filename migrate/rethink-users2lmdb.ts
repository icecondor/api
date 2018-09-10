require('source-map-support').install()
import * as Db from '../lib/db-lmdb'
import * as fs from 'fs'
import * as rethink from 'rethinkdb'

let settings = JSON.parse(fs.readFileSync("settings.json", 'utf8'))

console.log('lmdb', settings.storage)
let db = new Db.Db(settings.storage)
db.connect(async () => {
  console.log('rethink', settings.rethinkdb)
  let conn = await rethink.connect(settings.rethinkdb)
  var dbs = await rethink.dbList().run(conn)
  console.log(dbs)
  let fails = 0
  conn.use('icecondor')
  try {
    const cursor = await rethink.table('users').run(conn)
    const users = await cursor.toArray() // all at once
    for (const user of users) {
      try {
        const eu = db.ensure_user(user)
        if (eu.error) {
          console.log('user2lmdb result error', eu.error)
        } else {
          if(user.id != eu.id) {
            console.log('user2lmdb save FAIL', user.email, eu.email)
            console.log('rethink user', user)
            console.log('ensure user', eu)
            fails += 1
          }
        }
      } catch(e) {
        console.log('user2lmdb', user.email, 'CATCH', e)
        process.exit(1)
      }
    }

    console.log('*** done', users.length, 'rethink users', fails, 'save fails')
  } catch (e) {
    console.log(e)
  }
}).catch(e => {console.log(e); process.exit(1)})
