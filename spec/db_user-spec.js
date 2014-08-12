var rethink_mock = require('../spec/rethink_mock')
var db = require('../lib/dblib').factory(rethink_mock)

describe("data users", function(){
  it("should search for user by email", function() {
    db.setup(function(){
      expect(1).toEqual(2)
      db.find_user_by_email('bob@server', function(user){
        console.log("got "+user)
        expect(user).toEqual("a")
        done()
      })
    })
  })
})
