var settings = require('./settings')
console.log(settings)
var couch;
/* nano */
module.exports.db = couch = require('nano')(settings.couchdb.url);

/* doesnt support continuous mode 
couch.changes({"feed": "continuous"}, function (err, change) {
  console.log(change);
}) */

var follow = require('follow')
follow({db:settings.couchdb.url, include_docs:true}, function(error, change) {
  if(!error) {
    console.log("Change " + change.seq + " has " + Object.keys(change.doc).length + " fields");
  }
})

/* cradle 
var cradle = require('cradle')
module.exports = couch = new(cradle.Connection)().database('icecondor');
couch.changes().on('response', function (res){
  res.on('data', function (change) {
      console.log("change detected! "+JSON.stringify(change));
  });
})

*/

