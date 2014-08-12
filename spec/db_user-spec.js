var rethink_mock = require('../spec/rethink_mock')
var db = require('../lib/dblib').factory(rethink_mock)

describe("existing users", function(){
  // call before db.setup
  it("should search for user by email", function(done) {
    rethink_mock._seed('icecondor', ['users'])
    db.setup(function(){
      rethink_mock._next_answer('users', {toArray:function(){return ['bob@server']}})
      db.find_user_by_email('bob@server').then(function(user){
        expect(user).toEqual("bob@server")
        done() //jasmine
      })
    })
  })
})


describe("empty users", function(){
  it("should ensure a user exists", function(done) {
    rethink_mock._seed('icecondor', ['users'])
    db.setup(function(){
      rethink_mock._next_answer('users', {toArray:function(){return []}}) // no users
      rethink_mock._next_answer('users', {next:function(){return "bob@server"}}) // one was created
      db.ensure_user('bob@server')
        .then(function(user){
          expect(user).toEqual("bob@server")
          done() //jasmine
        })
    })
  })
})
