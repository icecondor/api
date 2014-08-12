var Promise = require('bluebird');

module.exports = (function() {
  var mock = {}
  mock.connect = function() {
    console.log('mock db connected')
    return new Promise(function(){})
  }

  return mock
})()
