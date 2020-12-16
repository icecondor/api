var settings = require('../../lib/settings')(2)
var protocol = require('../../lib/protocol-v2')(settings.api)
var phoney_client = require('../client_mock')

describe("the protocol", function() {
  it("should say hello", function() {
    var client = phoney_client()
    protocol.hello(client)
    expect(client.socket.last().method).toEqual("hello")
  })
})

