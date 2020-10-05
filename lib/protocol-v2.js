var uuid = require('node-uuid');

module.exports = (function(config) {
  var version = "2-" + config.minor_version

  protocol = {}
  function client_write(client, msg) {
    if (client.socket) {
      if (typeof msg !== "string") {
        msg = JSON.stringify(msg)
      }
      client.socket.write(msg + "\n")
    }
  }

  protocol.respond_success = function(client, id, params) {
    if (params == null) { params = {} }
    var msg = { id: id, result: params }
    client_write(client, msg)
  }

  protocol.respond_fail = function(client, id, params) {
    if (params == null) { params = {} }
    var msg = { id: id, error: params }
    client_write(client, msg)
  }

  protocol.api = function(client, method, params) {
    rpc(client, method, params)
  }

  function rpc(client, method, params) {
    var id = uuid.v4().substr(0, 8)
    var hello = { id: id, method: method, params: params }
    client_write(client, hello)
  }

  protocol.hello = function(client) {
    rpc(client, 'hello', { name: config.hostname, version: version })
  }

  protocol.connection = function(client, dispatch, close) {
    protocol.hello(client)

    client.socket.on('data', function(data) {
      try {
        var msgs = multilineParse(data)
        msgs.forEach(function(msg) {
          dispatch(client, msg)
        })
      } catch (e) {
        if (e.message == "Unexpected end of JSON input") {
          console.log("bad json. dropping.")
        } else {
          console.log(e)
        }
        client.socket.end()
      }
    })

    client.socket.on('close', function() {
      client.socket = null
      close(client)
    })
  }

  function multilineParse(data) {
    var lines = data.toString('utf8').split(/[\n\r]/)
    lines = lines.map(function(line) {
      if (line.length > 0) {
        return JSON.parse(line)
      }
    })
    lines = lines.filter(function(msg) { return msg })
    return lines
  }


  return protocol
})