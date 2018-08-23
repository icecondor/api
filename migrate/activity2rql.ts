require('source-map-support').install()
import * as db from '../lib/db-rqlite'
import * as fs from 'fs'
let settings = JSON.parse(fs.readFileSync("settings.json", 'utf8'))

let rdb = new db.Db(settings.rqlite)
rdb.connect(async () => {
  try {
    const filename = process.argv[2]

    // at once
    const data = fs.readFileSync(filename, 'utf8')
    const users = JSON.parse(data)
    console.log(filename, users.length, 'activities')
    for (const line of users) await dbsave(line)

    // var lineReader = require('readline').createInterface({input: fs.createReadStream(filename)})
    // lineReader.on('line', function (line) {
    //   //await dbsave(user, line)
    // })
    console.log('done')
  } catch (e) {
    console.log(e)
  }
})

async function dbsave(activity) {
  let datefix = ''
  if (activity.created_at && !activity.received_at) {
    datefix = 'received from created'
    activity.received_at = activity.created_at
  }
  if (activity.received_at && !activity.created_at) {
    datefix = 'created from received'
    activity.created_at = activity.received_at
  }
  console.log('activity', activity.id, activity.type, datefix)
  let new_user = await rdb.activity_add(activity)
}
