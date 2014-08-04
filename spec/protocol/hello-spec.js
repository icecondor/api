var protocol = require('../../lib/protocol-v2')

describe("the protocol", function() {
  function phoney_client() {
    var journal = []
    return {socket: {write: function(str){journal.push(str)},
                     last: function(){return JSON.parse(journal[0])}
                    }
           }
  }

  it("should say hello", function() {
    var client = phoney_client()
    protocol.hello(client)
    expect(client.socket.last().type).toEqual("hello")
  })
})

