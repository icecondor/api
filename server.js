var net = require('net')

exports.factory = function() {
	var server = new net.Server();
	server.timer = { mark: new Date(),
	                 hits: 0,
	                 reset: function() {
	                     timeMark = new Date()
                         hits = 0	
                     }
                    }
	return server;
}
