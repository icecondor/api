require('source-map-support').install()
import * as Db from '../lib/db-lmdb'
import * as fs from 'fs'

let settings = JSON.parse(fs.readFileSync("settings.json", 'utf8'))

console.log('storage', settings.storage)

let email = process.argv[2]
if (email) {
  console.log('user dump', email)
  let db = new Db.Db(settings.storage)
  db.connect(async () => {
    try {
      console.log(JSON.stringify(await db.find_user_by({username: email}), null, 2))
    } catch (e) {
      console.log(email, 'not found')
    }
  })
} else {
  console.log('usage: userdump.js <username>')
}
