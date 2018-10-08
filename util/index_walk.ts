require('source-map-support').install()
import * as Db from '../lib/db-lmdb'
import * as fs from 'fs'
let settings = JSON.parse(fs.readFileSync("settings.json", 'utf8'))

console.log('storage', settings.storage)

if (process.argv.length == 3) {
  let type_name = process.argv[2]
  console.log('index refresh for type', type_name)
  let db = new Db.Db(settings.storage)
  db.connect(async () => {
    await db.syncIndexes(type_name)
  })
} else {
  console.log('usage: index_refresh <index name>')
}