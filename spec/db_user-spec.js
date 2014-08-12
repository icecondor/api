var rethink_mock = require('../spec/rethink_mock')
var db = require('../lib/dblib').factory(rethink_mock)

describe("users", function(){
  // call before db.setup
  rethink_mock.tableSeeds({
                       users: ["bob@server"]
                    })
  it("should search for user by email", function(done) {
    db.setup(function(){
      db.find_user_by_email('bob@server', function(user){
        expect(user).toEqual("bob@server")
        done() //jasmine
      })
    })
  })
})
