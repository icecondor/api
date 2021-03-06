require('source-map-support').install()
import * as Db from '../lib/db'
import * as fs from 'fs'
import * as rethink from 'rethinkdb'

let settings = JSON.parse(fs.readFileSync("settings.json", 'utf8'))

console.log('storage', settings.storage)
let limit = 1000

let db = new Db.Db(settings.storage)
db.connect(async () => {
  console.log('rethink', settings.rethinkdb)
  let conn = await rethink.connect(settings.rethinkdb)
  var dbs = await rethink.dbList().run(conn)
  console.log(dbs)
  conn.use('icecondor')
  //  let act_total = await rethink.table('activities').count().run(conn)
  //  console.log('icecondor activities', act_total)

  try {
    let start = new Date(await db.activity_last_date() || "2008-08-01")
    let stop = new Date()
    while (stop) {
      console.log('\n** lmdb start', start)
      let time = new Date()
      stop = await pull_group(conn, start, limit)
      let delay_sec = (new Date().getTime() - time.getTime()) / limit
      console.log('group done', start, stop, delay_sec + "s", (limit / delay_sec).toFixed(0), "rows per sec")
      db.schema_dump()
      start = new Date(stop)
    }
  } catch (e) {
    console.log('while loop stopped:', e)
  }
  console.log('el fin')
})

async function pull_group(conn, start, limit: number) {
  let stop = new Date()
  let last
  let save_count = 0
  let err_count = 0
  let cursor = await rethink
    .table('activities')
    .between(start.toISOString(),
      stop.toISOString(),
      {
        index: "date",
        left_bound: 'open', right_bound: 'closed'
      })
    .orderBy({ index: rethink.asc('date') })
    .limit(limit)
    .run(conn)
  let rows = await cursor.toArray()
  await Promise.all(rows.map(async row => {
    await dbsave(row)
    save_count += 1
    if (!last || row.date > last) last = row.date
  }))
  console.log(rows.length, 'rows', save_count, 'saves', err_count, 'errors', last, 'lastdate')
  return last
}

async function dbsave(activity) {
  let datefix = ''
  if (activity.date) {
    //console.log('activity', activity.id, activity.date, activity.type, '['+datefix+']')
    let result = await db.activity_add(activity)
    if (result.errors > 0) {
      throw "dbsave failed on " + activity.id
    }
  } else {
    console.log('SKIP ' + activity.id + ' missing date!')
  }
}
