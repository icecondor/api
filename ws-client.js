var wsock = require('websock');
var readline = require('readline');
var settings = require('./settings');

var url = 'ws://127.0.0.1:2040'
var ws = new wsock.connect(url);

var rl = readline.createInterface(process.stdin, process.stdout);
rl.setPrompt('=> ')

ws.on('open', function() {
  console.log('ws open '+url);
  rl.prompt()
  rl.on('line', function(answer){
    ws.send(answer); 
    rl.prompt()}).on('close', function() {
                       console.log('exiting');
                       process.exit(0);
                     });
});

ws.on('message', function(data) {
  console.log('-> '+data)
  rl.prompt()
});

ws.on('error', function(data) {
  console.log('ERR-> '+data)
});

ws.on('close', function() {
  console.log('ws close');
});
