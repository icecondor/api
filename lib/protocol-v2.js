module.exports = (function() {
  var version = "2"

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
    var msg = {id: id, result: params}
    client_write(client, msg)
  }

  protocol.hello = function(client) {
    var hello = {type: "hello", version: version}
    client_write(client, hello)
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
      me.socket = null
      close(me)
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
})()