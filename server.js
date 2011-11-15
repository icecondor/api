var net = require('net')

exports.factory = function() {
	var server = new net.Server();

	server.timer = { 
		mark: new Date(),
	    hits: 0,
	    reset: function() {
	    	this.mark = new Date()
	    	this.hits = 0	
		}
	}

	server.clients = {
		list: [],
		add: function(client) {
			this.list.push(client)
		},
		remove: function(client) {
			var idx = this.list.indexOf(me)
  			this.list.splice(idx,1)
		}
	}

	return server;
}
