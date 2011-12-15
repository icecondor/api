var settings = require('./settings')
var couch;
/* dscape/nano */
module.exports.db = couch = require('nano')(settings.couchdb.url);

/* cradle 
var cradle = require('cradle')
module.exports = couch = new(cradle.Connection)().database('icecondor');
couch.changes().on('response', function (res){
  res.on('data', function (change) {
      console.log("change detected! "+JSON.stringify(change));
  });
})

*/

