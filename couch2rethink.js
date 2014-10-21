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
    console.log(chunk);

    r.table('activities').insert(chunk).run(conn, function(doc, result){
      console.dir(result)
      done()
    })
  };
  fs.createReadStream("icecondor.json")
    .pipe(JSONStream.parse('rows.*.doc'))
    .pipe(echoStream)
})
