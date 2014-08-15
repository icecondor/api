var uuid = require('node-uuid');

module.exports = (function(minor_version) {
  var version = "2-"+minor_version

  protocol = {}
  function client_write(client, msg) {
    if(client.socket) {
      if (typeof msg !== "string") {
        msg = JSON.stringify(msg)
      }
      client.socket.write(msg+"\n")
    }
  }

  protocol.respond_success = function(client, id, params) {
    if(params == null){params = {}}
    var msg = {id: id, result: params}
    client_write(client, msg)
  }

  protocol.respond_fail = function(client, id, params) {
    if(params == null){params = {}}
    var msg = {id: id, error: params}
    client_write(client, msg)
  }

  function rpc(client, method, params) {
    var id = uuid.v4()
    var hello = {id: id, method: method, params: params}
    client_write(client, hello)
  }

  protocol.hello = function(client) {
    rpc(client, 'hello', {version: version})
  }

  protocol.connection = function(client, dispatch, close){
    protocol.hello(client)

    client.socket.on('data', function(data) {
      var msgs = multilineParse(data)
      msgs.forEach(function(msg){
        dispatch(client, msg)
      })
    })

    client.socket.on('close', function() {
      client.socket = null
      close(client)
    })
  }

  function multilineParse(data) {
    var lines = data.toString('utf8').split('\n')
    lines = lines.map(function(line) {
      if(line.length>0) {
        try {
          var msg = JSON.parse(line)
          return msg
        } catch (err) {
          console.log(err)
        }
      }
    })
    lines = lines.filter(function(msg){return msg})
    return lines
  }


  return protocol
})