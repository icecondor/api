import * as db from '../lib/db-rqlite'
import * as fs from 'fs'

let settings = JSON.parse(fs.readFileSync("settings.test.json", 'utf8'))

test('connect', () => {
  let rdb = new db.Db(settings.rqlite)
  rdb.connect(()=>{})
  expect(rdb.settings).toBeDefined()
})

