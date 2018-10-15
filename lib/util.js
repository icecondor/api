var crypto = require('crypto')

module.exports = (function(){
  var util = {}
  util.sha256 = function(text) {
    var shasum = crypto.createHash('sha256');
    shasum.update(text)
    return shasum.digest('base64')
  }

  return util
})()
