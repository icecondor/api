require('source-map-support').install()
// npm
import { Command } from 'commander'

// local
import * as Db from '../lib/db-lmdb'

// node
import * as fs from 'fs'

const commander = new Command()

commander
  .option('--start <char>')
  .option('--type_name <name>')
commander.parse()
const options = commander.opts()

let settings = JSON.parse(fs.readFileSync("settings.json", 'utf8'))

console.log('storage', settings.storage)

let db = new Db.Db(settings.storage)

if (process.argv.length >= 3) {
  let cmd = process.argv[2]
  switch (cmd) {
    case "sync": 
      var type_name
      if (process.argv.length >= 4) {
        type_name = process.argv[3]
        console.log('index refresh for type', type_name)
      }
      db.connect(async () => {
        await db.syncIndexes(options.type_name, options.start)
      })
      break;
    case "stat": 
      db.connect(async () => {
        db.schema_dump()
      })
      break;
  }
} else {
  console.log('usage: index_refresh <stat | sync <index name>>')
}
