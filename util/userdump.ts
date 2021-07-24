require('source-map-support').install()
import * as Db from '../lib/db'
import * as fs from 'fs'

let settings = JSON.parse(fs.readFileSync("settings.json", 'utf8'))

console.log('storage', settings.storage)
let db = new Db.Db(settings.storage)

let email = process.argv[2]
if (email) {
  console.log('user dump', email)
  db.connect(async () => {
    let user_id
    try {
      user_id = await db.find_user_id_by({ email: email })
    } catch (e) {
      try {
        user_id = await db.find_user_id_by({ username: email })
      } catch (e) {
      }
    }
    if (user_id) {
      let user = await db.get_user(user_id)
      console.log(JSON.stringify(user, null, 2))
      let friending = await db.friending_me(user.id)
      console.log(user.friends.length, 'friends', friending.length, 'friending')
    } else {
      console.log(email, 'not found')
    }
  })
} else {
  db.connect(async () => {
    let last = db.getLastKey('user', 'email')
    let records = db.getIdxBetween('user', 'email', null, last)
    console.log('-- '+Object.keys(records).length+' user records --')
    for (const key in records) {
      let user = db.loadFile(records[key])
      console.log(user.id, user.email, user.username, user.created_at)
    }
  })
}
