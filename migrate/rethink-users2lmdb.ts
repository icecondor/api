require('source-map-support').install()
import * as Db from '../lib/db-lmdb'
import * as fs from 'fs'
import * as rethink from 'rethinkdb'

let settings = JSON.parse(fs.readFileSync("settings.json", 'utf8'))

console.log('lmdb', settings.lmdb)
let db = new Db.Db(settings.lmdb)
db.connect(async () => {
  console.log('rethink', settings.rethinkdb)
  let conn = await rethink.connect(settings.rethinkdb)
  var dbs = await rethink.dbList().run(conn)
  console.log(dbs)
  conn.use('icecondor')
  try {
    const cursor = await rethink.table('users').run(conn)
    const users = await cursor.toArray() // all at once
    for (const user of users) {
      try {
        const eu = await db.ensure_user(user)
        if (eu.error) {
          console.log('user2rql result error', eu.error)
        } else {
          if(user.email == eu.email) {
            console.log('user2rql GOOD', eu.username, eu.email)
          } else {
            console.log('user2rql save FAIL', user.email, eu.email)
          }
        }
      } catch(e) {
        console.log('user2rql', user.email, 'CATCH', e)
        process.exit(1)
      }
    }

    console.log('*** done', users.length, 'rethink users')
  } catch (e) {
    console.log(e)
  }
})
