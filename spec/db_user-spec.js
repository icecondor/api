var rethink_mock = require('../spec/rethink_mock').seed({
  users: ["bob@server"]
})
var db = require('../lib/dblib').factory(rethink_mock)

describe("data users", function(){
  it("should search for user by email", function(done) {
    db.setup(function(){
      db.find_user_by_email('bob@server', function(user){
        console.log("got "+user)
        expect(user).toEqual("bob@server")
        done()
      })
    })
  })
})
