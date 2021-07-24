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
    } else {
      console.log(email, 'not found')
    }
  })
} else {
    console.log('userdel <username>')
}
