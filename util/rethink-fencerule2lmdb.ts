require('source-map-support').install()
import * as Db from '../lib/db'
import * as fs from 'fs'
import * as rethink from 'rethinkdb'

let settings = JSON.parse(fs.readFileSync("settings.json", 'utf8'))

console.log('lmdb', settings.storage)
let db = new Db.Db(settings.storage)
db.connect(async () => {
  console.log('rethink', settings.rethinkdb)
  let conn = await rethink.connect(settings.rethinkdb)
  var dbs = await rethink.dbList().run(conn)
  console.log(dbs)
  let fails = 0
  conn.use('icecondor')
  try {
    const cursor = await rethink.table('fences').run(conn)
    const fences = await cursor.toArray() // all at once
    for (const fence of fences) {
      try {
        console.log(JSON.stringify(fence))
        const eu = await db.fence_add(fence)
        if (eu.inserted != 1) {
          console.log('fence2lmdb fence_add error')
          fails += 1
        }
      } catch (e) {
        console.log('fence2lmdb fence_add', fence.id, 'CATCH', e)
        process.exit(1)
      }
    }
    console.log('*** done', fences.length, 'rethink fences', fails, 'save fails')
    await db.schema_dump()

    const cursor2 = await rethink.table('rules').run(conn)
    const rules = await cursor2.toArray() // all at once
    for (const rule of rules) {
      try {
        console.log(rule)
        const add = await db.rule_add(rule)
      } catch (e) {
        console.log('rule2lmdb', rule, 'CATCH', e)
        process.exit(1)
      }
    }
    console.log('*** done', rules.length, 'rethink rules', fails, 'save fails')
    await db.schema_dump()

  } catch (e) {
    console.log(e)
  }
}).catch(e => { console.log(e); process.exit(1) })
