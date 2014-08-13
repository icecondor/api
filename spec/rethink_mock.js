var Promise = require('bluebird');

module.exports = (function() {
  var mock = {}
  var data = {}
  var db_name

  mock._seed = function(_db_name, table_names){
    db_name = _db_name
    data[db_name] = {}
    for(var idx in table_names) {
      var name = table_names[idx]
      data[db_name][name] = tableFactory()
    }
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
    data[db_name] = {}
    return factoryRunAnswer()
  }

  mock.dbList = function() {
    return factoryRunAnswer(Object.keys(data))
  }

  mock.tableList = function() {
    return factoryRunAnswer(Object.keys(data[db_name]))
  }

  mock.tableCreate = function(name) {
    data[db_name][name] = tableFactory()
    return factoryRunAnswer()
  }

  mock.table = function(name){
    console.log('mock using table '+name)
    return data[db_name][name]
  }

  var conn = {}
  conn.use = function(name) {
    console.log('mock using db '+name)
    db_name = name
  }

  mock._next_answer = function(table_name, answer) {
    data[db_name][table_name]._next_answer(answer)
  }

  mock._next_answer_from_inserted = function(table_name) {
    data[db_name][table_name]._next_answer_from_inserted()
  }

  function tableFactory(){
    var table = {}
    table.next_answers = []
    table.inserted = []

    table._next_answer = function(answer) {
      table.next_answers.push(answer)
    }

    table._next_answer_from_inserted = function(answer) {
      var answer = {next:function(){return table.inserted.shift()}}
      table.next_answers.push(answer)
    }

    table.filter = function(spec) {
      return factoryRunAnswer(table.next_answers.shift())
    }

    table.insert = function(blob) {
      table.inserted.push(blob)
      return factoryRunAnswer(table.next_answers.shift())
    }

    return table
  }

  return mock
})()
