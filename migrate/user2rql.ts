require('source-map-support').install()
import * as db from '../lib/db-rqlite'
import * as fs from 'fs'
import * as rethink from 'rethinkdb'

let settings = JSON.parse(fs.readFileSync("settings.json", 'utf8'))

console.log('rql', settings.rqlite)
let rdb = new db.Db(settings.rqlite)
rdb.connect(async () => {
  console.log('rethink', settings.rethinkdb)
  let conn = await rethink.connect(settings.rethinkdb)
  var dbs = await rethink.dbList().run(conn)
  console.log(dbs)
  conn.use('icecondor')
  try {
    const filename = process.argv[2]

    // at once
    const cursor = await rethink.table('users').run(conn)
    const users = await cursor.toArray()
    users.map(async (user,idx) => {
      console.log(idx+'/'+users.length, user.email)
      await rdb.ensure_user(user)
    })

    console.log('done')
  } catch (e) {
    console.log(e)
  }
})
