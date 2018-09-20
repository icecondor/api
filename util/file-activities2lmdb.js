require('source-map-support').install()
import * as Db from '../lib/db-lmdb'
import * as fs from 'fs'

let settings = JSON.parse(fs.readFileSync("settings.json", 'utf8'))

console.log('lmdb', settings.lmdb)
let db = new Db.Db(settings.lmdb)

let filename = process.argv[2]
console.log('loading', filename)
let activities = JSON.parse(fs.readFileSync(filename))
db.connect( () => {
  for (const activity of activities) {
    console.log('activity', activity.type)
    db.activity_add(activity)
  }
})
