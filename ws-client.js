#!/usr/bin/env node
var wsock = require('websock');
var readline = require('readline');
var settings = require('./settings');

var url = process.argv[2]
console.log('opening '+url);
var ws = new wsock.connect(url);

var rl = readline.createInterface(process.stdin, process.stdout);
rl.setPrompt('=> ')

ws.on('open', function() {
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
  console.log('closed');
});
