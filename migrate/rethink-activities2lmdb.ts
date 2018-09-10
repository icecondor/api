require('source-map-support').install()
import * as Db from '../lib/db-lmdb'
import * as fs from 'fs'
import * as rethink from 'rethinkdb'

let settings = JSON.parse(fs.readFileSync("settings.json", 'utf8'))

console.log('lmdb', settings.lmdb)
let db = new Db.Db(settings.lmdb)
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
      stop = await pull_group(conn, start)
      console.log('group done', start, stop)
      db.schema_dump()
      start = new Date(stop)
    }
  } catch (e) {
    console.log('while loop stopped:', e)
  }
  console.log('el fin')
})

async function pull_group(conn, start) {
    let stop = new Date()
    let last
    let limit = 10
    let err_count = 0
    let cursor = await rethink
      .table('activities')
      .between(start.toISOString(),
               stop.toISOString(),
                {index: "date",
                 left_bound:'open',right_bound:'closed'})
      .orderBy({index: rethink.asc('date')})
      .limit(limit)
      .run(conn)
    let rows = await cursor.toArray()
    await Promise.all(rows.map(async row => {
      await dbsave(row)
      if (!last || row.date > last) last = row.date
    })).catch(e => console.log('promise all err', e))
    console.log(rows.length, 'rows', err_count, 'errors', last, 'last')
    return last
}

async function dbsave(activity) {
  let datefix = ''
  if (activity.date && !activity.received_at) {
    datefix = 'received from created'
    activity.received_at = activity.date
  }
  if (!activity.date) datefix='missing date!'
  console.log('activity', activity.id, activity.date, activity.type, '['+datefix+']')
  let result = await db.activity_add(activity)
  if (result.errors > 0) {
    throw "dbsave failed on "+activity.id
  }
}
