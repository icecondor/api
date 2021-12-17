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
  })
})

describe("location", function() {
  test('user_latest_freshen', () => {
    return db.connect(async function() {
      let new_date = new Date()
      let location = {
        id: uuid.v4(),
        type: "location",
        user_id: new_user.id,
        date: new_date.toISOString(),
        latitude: 45.5,
        longitude: -122.6,
      }
      await db.activity_add(location)

      await server.user_latest_freshen(location)

      await db.find_locations_for(new_user.id, new_date, new_date, 1, "location")
        .then(function(locations) {
          expect(locations.length).toEqual(1)
        })
    })
  })
})

