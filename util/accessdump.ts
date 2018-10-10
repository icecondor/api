require('source-map-support').install()
import * as Db from '../lib/db-lmdb'
import * as fs from 'fs'

let settings = JSON.parse(fs.readFileSync("settings.json", 'utf8'))

console.log('storage', settings.storage)
let db = new Db.Db(settings.storage)
db.connect(async () => {
  let last = db.getLastKey('access', 'key')
  let records = db.getIdxBetween('access', 'key', null, last)
  console.log('-- access records --')
  for (const key in records) {
    let record = db.loadFile(records[key])
    console.log(JSON.stringify(record))
  }
})
