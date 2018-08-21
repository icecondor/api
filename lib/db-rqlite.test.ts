import * as db from '../lib/db-rqlite'
import * as fs from 'fs'

let settings = JSON.parse(fs.readFileSync("settings.test.json", 'utf8'))

test('connect', () => {
  let rdb = new db.Db(settings.rqlite)
  expect(rdb.settings).toBeDefined()
  rdb.connect(() => { })
})

test('find_user_by (not found)', async () => {
  expect.assertions(1)
  let rdb = new db.Db(settings.rqlite)
  await rdb.connect(async () => {
    try {
      let user = await rdb.find_user_by({ email_downcase: "a@b.c" })
    } catch (e) {
      expect(e).toBeDefined()
    }
  })
})

test('ensure_user', async () => {
  expect.assertions(2)
  let rdb = new db.Db(settings.rqlite)
  await rdb.connect(async () => {
    let email = "a@b.c"
    let device_id = "device-abc123"
    await rdb.ensure_user({ email: email, devices: [device_id] })
    let user = await rdb.find_user_by({ email_downcase: email })
    expect(user.email).toBe(email)
    expect(user.devices[0]).toBe(device_id)
  })
})
