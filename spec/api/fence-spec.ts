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
import * as geojsonArea from 'geojson-area'
import * as turfhelp from '@turf/helpers'

let new_user: any = {}
let email = "fence-a@b.c"
let device_id = "1"
let username = "fence-abc"

beforeAll(() => {
  return db.connect(async function() {
    new_user = await db.create_user({ email: email, username: username })
  })
})

describe("fence", function() {
  let new_date = new Date()
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
      var fence: any = {}
      fence.id = uuid.v4().substr(0, 18)
      fence.created_at = new Date()
      fence.name = "test fence"
      fence.user_id = new_user.id
      let geometry = [[[-5, 52], [-4, 56], [-2, 51], [-7, 54], [-5, 52]]]
      console.log(geometry.length)
      let turfcoord: any = turfhelp.polygon(geometry).geometry.coordinates
      fence.geojson = { type: turfcoord.type, coordinates: turfcoord.coordinates }
      fence.area = parseInt(geojsonArea.geometry(geometry))
      await db.fence_add(fence).then(function(result) {
        expect(result.inserted).toEqual(1) 
      })
    })
  })

  test('fence enter', () => {
    let second_date = new Date()
    let second_location = {
      id: uuid.v4(),
      type: "location",
      user_id: new_user.id,
      date: second_date.toISOString(),
      latitude: 45.6,
      longitude: -122.6,
    }
    return db.connect(async function() {
      await db.activity_add(second_location)
      await db.find_locations_for(new_user.id, new_date, second_date, 2, "location")
        .then(function(locations) {
          expect(locations.length).toEqual(2)
        })
      //await server.user_latest_freshen(location)
    })
  })
})

