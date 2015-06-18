var net = require('net')
var crypto = require('crypto')
var then_redis = require('then-redis')
var uuid = require('node-uuid');
var Promise = require('bluebird');

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

  server.create_token_temp = function(params) {
    var token, key
    if(params.device_id == 'browser') {
      token = key = "browser_key-"+uuid.v4()
    } else {
      key = "device_key-"+uuid.v4()
      token = sha256(params.device_id+key)
    }
      // todo: session_key, use device_key for now
      var session_value = {device_id: params.device_id, email: params.email}
      return redis.hset("session_keys", token, JSON.stringify(session_value)).then(function(){
        return key
      }, function(e){
        console.log('create_token_temp redis hset err', e)
      })
  }

  server.token_validate = function(device_key, user_id, device_id) {
      var session = {user_id: user_id, device_id: device_id}
      return redis.hset("session_keys", device_key, JSON.stringify(session)).then(function(){
        return session
      })
  }

  server.find_session = function(token) {
      return redis.hget("session_keys", token).then(function(session_json){
        var session = JSON.parse(session_json)
        return session
      })
  }

  server.build_client = function(socket) {
    return {socket: socket, flags: {}, following: []}
  }

  function sha256(text) {
    var shasum = crypto.createHash('sha256');
    shasum.update(text)
    return shasum.digest('base64')
  }

  server.zipq_get = function(user_id) {
    return redis.hexists('zipq', user_id)
      .then(function(count){
        if(count === 0) {
          console.log('zipq_get not-exists', user_id)
          var list = []
          return redis.hset('zipq', user_id, JSON.stringify(list))
        }
      }).then(function(){
        return redis.hget('zipq', user_id)
          .then(function(json){
            return JSON.parse(json)
          })
      })
  }

  server.zipq_add = function(user_id, start, end) {
    return server.zipq_get(user_id)
      .then(function(q){
        console.log('zipq_add', user_id, q)
        q.push({time: new Date(), start: start, end:end, status: 'waiting'})
        return redis.hset('zipq', user_id, JSON.stringify(q))
      })
  }

  return server;
}
