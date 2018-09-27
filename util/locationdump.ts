require('source-map-support').install()
import * as Db from '../lib/db-lmdb'
import * as fs from 'fs'

let settings = JSON.parse(fs.readFileSync("settings.json", 'utf8'))

console.log('storage', settings.storage)

console.log('location dump')
let db = new Db.Db(settings.storage)
db.connect(async () => {
  try {
    let start = new Date("2008-08-01").toISOString()
    let stop = new Date().toISOString()
    let count = 1000
    let descending = true
    let locations = await db.find_locations(start, stop, count, descending)
    for (const location of locations) console.log(location.date, location.user_id, location.device_id)
  } catch (e) {
    console.log('location dump ERROR', e)
  }
})
