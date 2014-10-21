var fs = require('fs');
var stream = require('stream')

var r = require('rethinkdb')
var JSONStream = require('JSONStream')

var echoStream = new stream.Writable({objectMode: true});

function transform(loc){
    loc.id = loc._id
    delete loc._id
    delete loc._rev
}

r.connect({db:'icecondor'}).then(function(conn){
  echoStream._write = function (chunk, encoding, done) {
    transform(chunk)

    r.table('load').insert(chunk).run(conn, function(doc, result){
      if(result.errors > 0) {
        console.log(chunk.type, result.errors)
      }
      done()
    })
  };
  fs.createReadStream("icecondor.json")
    .pipe(JSONStream.parse('rows.*.doc'))
    .pipe(echoStream)
})
