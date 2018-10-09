require('source-map-support').install()
import * as Db from '../lib/db-lmdb'
import * as fs from 'fs'

let settings = JSON.parse(fs.readFileSync("settings.json", 'utf8'))

console.log('storage', settings.storage)
let db = new Db.Db(settings.storage)

let email = process.argv[2]
if (email) {
  console.log('user dump', email)
  db.connect(async () => {
    try {
      let user = await db.find_user_by({ username: email })
      console.log(JSON.stringify(user, null, 2))
      let friending = await db.friending_me(user.id)
      console.log(user.friends.length, 'friends', friending.length, 'friending')
    } catch (e) {
      console.log(email, 'not found')
    }
  })
} else {
  db.connect(async () => {
    let last = db.getLastKey('user', 'email')
    let records = db.getIdxBetween('user', 'email', null, last)
    console.log(records)
  })
}
