import * as db from '../lib/db-rqlite'
import * as fs from 'fs'

let settings = JSON.parse(fs.readFileSync("settings.test.json", 'utf8'))

test('connect', () => {
  let rdb = new db.Db(settings.rqlite)
  expect(rdb.settings).toBeDefined()
  rdb.connect(()=>{})
})

test('find_user_by', () => {
  let rdb = new db.Db(settings.rqlite)
  rdb.connect(async ()=>{
    try {
      let user = await rdb.find_user_by({email_downcase: "a@b.c"})
    } catch (e) {
      expect(e).toBeDefined()
    }
  })
})

test('ensure_user', () => {
  let rdb = new db.Db(settings.rqlite)
  rdb.connect(async ()=>{
    rdb.ensure_user({email: "a@b.c", devices: ["device-abc123"]})
    let user = await rdb.find_user_by({email_downcase: "a@b.c"})
    expect(user.email).toBe("a@b.c")
  })
})
