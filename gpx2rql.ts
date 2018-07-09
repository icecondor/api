require('source-map-support').install()
import * as db from './lib/db-rqlite'
import * as fs from 'fs'
let settings = JSON.parse(fs.readFileSync("settings.test.json", 'utf8'))

let rdb = new db.Db(settings.rqlite)
rdb.connect(async () => {
  const email = process.argv[2]
  try {
    let user = await rdb.ensure_user({email: email, devices: ["gpxload"]})
    console.log(email, user)
    const filename = process.argv[3]
    const data = fs.readFileSync(filename, 'utf8')
    const lines = data.split('\n')
    console.log(filename, lines.length, 'lines')
    for (const line of lines) await matchput(user, line)
    console.log('done')
  } catch(e) {
    console.log(email, 'email not found', e)
  }
})

async function matchput(user, cmd) {
  let match = gpxmatch(cmd)
  if(match) {
    let new_location = {
      user_id: user.id,
      latitude: match[1],
      longitude: match[2],
      date: match[3]
    }
    await rdb.activity_add(new_location)
  }
}

function gpxmatch(line) {
  return line.match(/trkpt.lat=\"(-?\d+.\d+)\".lon=\"(-?\d+.\d+)\"..time.(.*)..time/)
}