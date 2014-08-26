
describe("api full", function() {
  function phoney_client() {
  }

  it("should say hello", function() {
    var client = phoney_client()
    protocol.hello(client)
    expect(client.socket.last().type).toEqual("hello")
  })
})

