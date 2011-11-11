var net = require('net')

exports.factory = function() {
	return new net.Server()
}
