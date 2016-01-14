var rethink_mock = require('../rethink_mock')
var db = require('../../lib/dblib').factory(rethink_mock, rethink_mock.connect())

describe("existing users", function(){
  // call before db.setup
  it("should search for user by email", function(done) {
    rethink_mock._seed('icecondor', ['users'])
    db.setup(function(){
      var orig_user = {email:'bob@server'}
      rethink_mock._next_answer('users', orig_user)
      db.find_user_by({email:'bob@server'}).then(function(user){
        expect(user).toEqual(orig_user)
        done() //jasmine
      })
    })
  })
})


describe("empty users", function(){
  it("should ensure a user exists", function(done) {
    rethink_mock._seed('icecondor', ['users', 'actions'])
    db.setup(function(){
      var new_user = {email:'bob@server'}
      rethink_mock._next_answer('users', []) // no users
      db.ensure_user(new_user)
        .then(function(){
          done() //jasmine
        }, function(){
          expect(false).toEqual(true) // expect this not to be called
          done() //
        })
    })
  })
})
