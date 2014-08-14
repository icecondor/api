var net = require('net')
var crypto = require('crypto')
var then_redis = require('then-redis')
var uuid = require('node-uuid');

exports.factory = function() {
  var server = new net.Server();
  var redis = then_redis.createClient();

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
      var idx = this.list.indexOf(client)
        this.list.splice(idx,1)
    }
  }

  server.create_token = function(params) {
    var token = "token-"+uuid.v4()
    var device_key = sha512(params.device_id+token)
    return redis.connect().then(function(){
      // todo: session_key, use device_key for now
      return redis.hset("session_keys", device_key, params.device_id).then(function(){
        return token
      })
    })
  }

  server.find_session = function(token) {
    return redis.connect().then(function(){
      return redis.hget("session_keys", token).then(function(device_id){
        return device_id
      })
    })
  }

  server.build_client = function(socket) {
    return {socket: socket, flags: {}, following: []}
  }

  function sha512(text) {
    var shasum = crypto.createHash('sha512');
    shasum.update(text)
    return shasum.digest('base64')
  }

  return server;
}
