var crypto = require('crypto')

module.exports = (function() {
  var util = {}
  util.sha256 = function(text) {
    var shasum = crypto.createHash('sha256');
    shasum.update(text)
    return shasum.digest('base64')
  }

  util.clog = function(client, msg) {
    let parts = []
    parts.push(new Date().toISOString())
    if (client.flags.authenticated) {
      var id_id = client.flags.authenticated.device_id.substr(0, 8) + ':' +
        client.flags.authenticated.user_id.substr(0, 8)
      parts.push(id_id)
    } else if (client.socket) {
      parts.push(client.socket.remoteAddress + ':' + client.socket.remotePort)
    }
    if (typeof msg !== "string") {
      parts.push(JSON.stringify(msg))
    } else {
      parts.push(msg)
    }
    console.log(parts.join(' '))
  }



  return util
})()
