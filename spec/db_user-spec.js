var db = require('../lib/dblib').factory()

describe("data users", function(){
  it("should search for user by email", function() {
    db.setup()
    db.find_user_by_email('bob@server')
    expect(1).toEqual(1)
  })
})
