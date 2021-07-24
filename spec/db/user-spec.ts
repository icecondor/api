import * as settingsLib from '../../lib/settings'
let settings = settingsLib.default("settings.test.json")
import * as dbLib from '../../lib/db'
let db = new dbLib.Db(settings.storage) as any

describe("existing users", function() {
  it("should search for user by email", async function() {
    return db.connect(async function() {
      // rethink_mock._seed('icecondor', ['users'])
      // db.setup(function() {
      //   var orig_user = { email: 'bob@server' }
      //   rethink_mock._next_answer('users', orig_user)
      //   db.find_user_by({ email: 'bob@server' }).then(function(user) {
      //     expect(user).toEqual(orig_user)
      //await db.create_user({ email: "a@b", username: "ab" })
      //let user = await db.find_user_by({ email: "a@b" })
      expect(db.find_user_id_by({ email: "a@b" })).rejects.toMatch('key not found')
      //   })
      // })
    })
  })
})
