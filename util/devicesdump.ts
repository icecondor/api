require('source-map-support').install()
import * as Db from '../lib/db-lmdb'
import * as fs from 'fs'

let settings = JSON.parse(fs.readFileSync("settings.json", 'utf8'))

console.log('storage', settings.storage)
let db = new Db.Db(settings.storage)
db.connect(async () => {
  let lastKey = db.getLastKey('device', 'user_id_did')
  let lastKeyParts = lastKey.split(db.keySeperator)
  console.log(lastKeyParts)
  let records = db.getIdxBetween('device', 'user_id_did', null, lastKeyParts[0])
  console.log('-- devices records --')
  for (const key in records) {
    let record = db.loadFile(records[key])
    console.log(JSON.stringify(record))
  }
})
