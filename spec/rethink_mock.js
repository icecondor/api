var Promise = require('bluebird');

module.exports = (function() {
  var mock = {}
  var data = {}
  var db_name

  mock._seed = function(_db_name, table_names) {
    db_name = _db_name
    data[db_name] = {}
    for (var idx in table_names) {
      var name = table_names[idx]
      data[db_name][name] = tableFactory()
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

  mock.table = function(name) {
    return data[db_name][name]
  }

  mock.row = function(name) {
    return { downcase: function() { } }
  }

  var conn = {}
  conn.use = function(name) {
    console.log('mock using db ' + name)
    db_name = name
  }

  mock._next_answer = function(table_name, answer) {
    data[db_name][table_name]._next_answer(answer)
  }

  mock._next_answer_from_inserted = function(table_name) {
    data[db_name][table_name]._next_answer_from_inserted()
  }

  function tableFactory() {
    var table = {}
    table.next_answers = []
    table.inserted = []
    table.indexes = []

    table._next_answer = function(answer) {
      table.next_answers.push(cursorFactory(answer))
    }

    table._next_answer_from_inserted = function() {
      table.next_answers.push(cursorFactory(table.inserted.shift()))
    }

    table.filter = function(spec) {
      return factoryRunAnswer(table.next_answers.shift())
    }

    table.insert = function(blob) {
      table.inserted.push(blob)
      return factoryRunAnswer({ inserted: 1 })
    }

    table.indexList = function() {
      return factoryRunAnswer(table.indexes)
    }

    table.indexCreate = function(name) {
      table.indexes.push(name)
      return factoryRunAnswer()
    }

    table.indexWait = function() {
      return factoryRunAnswer()
    }

    table.getAll = function(key) {
      return factoryRunAnswer(cursorFactory([]))
    }

    return table
  }

  function factoryRunAnswer(value) {
    return {
      run: function(a, b) {
        return new Promise(function(resolve, reject) {
          if (b) { b(null, value) }
          resolve(value)
        })
      }
    }
  }

  function cursorFactory(values) {
    var cursor = {}
    if (Array.isArray(values)) {
      cursor.values = values
    } else {
      cursor.values = [values]
    }

    cursor.toArray = function() {
      return new Promise(function(resolve, reject) { resolve(cursor.values) })
    }

    cursor.next = function() {
      return cursor.values.shift()
    }

    return cursor
  }

  return mock
})()
