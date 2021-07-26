import * as settingsLib from '../../lib/settings'
let settings = settingsLib.default("settings.test.json")
import * as dbLib from '../../lib/db'
let db = new dbLib.Db(settings.storage) as any

beforeAll(() => {
    return db.connect(async function() {
      await db.create_user({ email: "a@b", username: "ab" })
    })
});

describe("existing users", function() {
  it("should search for user by email", async function() {
    return db.connect(async function() {
      //await db.create_user({ email: "a@b", username: "ab" })
      //let user = await db.find_user_by({ email: "a@b" })
      await expect(db.find_user_id_by({ email: "a@b" })).resolves.toHaveLength(36)
    })
  })

  it("should search for user by email and not find", async function() {
    return db.connect(async function() {
      //await db.create_user({ email: "a@b", username: "ab" })
      //let user = await db.find_user_by({ email: "a@b" })
      await expect(db.find_user_id_by({ email: "not@here" })).rejects.toMatch('key not found')
    })
  })
})
