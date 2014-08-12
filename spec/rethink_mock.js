var Promise = require('bluebird');

module.exports = (function() {
  var mock = {}
  var existingDBs = []
  var seed

  mock.seed = function(_seed) {
    seed = _seed
    return mock
  }

  function factoryRunAnswer(value){
    return { run: function(a,b){
        return new Promise(function(resolve, reject){
          if(b) {b(null, value)}
          resolve(value)
        })
      }
    }
  }

  mock.connect = function() {
    console.log('mock db connected')
    return factoryRunAnswer(conn).run()
  }

  mock.dbCreate = function(db_name) {
    existingDBs.push(db_name)
    return factoryRunAnswer()
  }

  mock.dbList = function() {
    return factoryRunAnswer(existingDBs)
  }

  mock.tableList = function() {
    return factoryRunAnswer([])
  }

  mock.tableCreate = function(name) {
    return factoryRunAnswer()
  }

  mock.table = function(name){
    console.log('mock using table '+name)
    return tableFactory(seed[name])
  }

  var conn = {}
  conn.use = function(name) {
    console.log('mock using db '+name)
  }

  function tableFactory(data){
    var table = {}
    table.data = data

    table.filter = function(spec) {
      return factoryRunAnswer({toArray:function(){return table.data}})
    }
    return table
  }

  return mock
})()
