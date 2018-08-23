require('source-map-support').install()
import * as db from '../lib/db-rqlite'
import * as fs from 'fs'
let settings = JSON.parse(fs.readFileSync("settings.json", 'utf8'))

let rdb = new db.Db(settings.rqlite)
rdb.connect(async () => {
  try {
    const filename = process.argv[2]
    let err_count = 0
    let promiseq = 0

    var lineReader = require('readline').createInterface({input: fs.createReadStream(filename)})
    lineReader.on('line', async function (line) {
      promiseq += 1
      try {
        line = line.replace(/^\[/, '')
        line = line.replace(/^\]/, '')
        line = line.replace(/,$/, '')
        if(line.length > 0) {
          var act = JSON.parse(line)
          await dbsave(act)
          promiseq -= 1
        }
      } catch(e) {
        err_count += 1
        console.log('err #'+err_count+' (q '+promiseq+'):', line.substr(0,30), e.errno || e)
      }
    })
    console.log('done', err_count, 'errors', promiseq, 'promiseq')
  } catch (e) {
    console.log(e)
  }
})

async function dbsave(activity) {
  let datefix = ''
  if (activity.date && !activity.received_at) {
    datefix = 'received from created'
    activity.received_at = activity.date
  }
  if (!activity.date) datefix='missing date!'
  console.log('activity', activity.id, activity.type, '['+datefix+']')
  let new_user = await rdb.activity_add(activity)
}
