import * as settingsLib from '../../lib/settings'
let settings = settingsLib.default("settings.test.json")
import * as util from "../../lib/util"
import * as protocolLib from "../../lib/protocol-v2"
let protocol = protocolLib.default(settings.api)
import * as dbLib from '../../lib/db'
let db = new dbLib.Db(settings.storage) as any
import serverLib from '../../lib/server'
let server: any = serverLib(settings, db, protocol)
import * as uuid from 'node-uuid'

let new_user: any = {}
let email = "a@b.c"
let device_id = "1"
let username = "abc"

beforeAll(() => {
  return db.connect(async function() {
    new_user = await db.create_user({ email: email, username: username })
    console.log(new_user)
  })
})

describe("location", function() {
  let new_date = new Date()
  console.log('needed', new_user)
  let location = {
    id: uuid.v4(),
    type: "location",
    user_id: "", // db.create_user hasnt run yet
    date: new_date.toISOString(),
    latitude: 45.5,
    longitude: -122.6,
  }

  beforeAll(() => {
    location.user_id = new_user.id // fixup location with new user id
    return db.connect(async function() {
      await db.activity_add(location)
    })
  })

  test('read/write', () => {
    return db.find_locations_for(new_user.id, new_date, new_date, 1, "location")
      .then(function(locations) {
        expect(locations.length).toEqual(1)
        expect(locations[0].user_id).toEqual(new_user.id)
      })
  })
})

