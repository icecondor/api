var bouncy = require('bouncy')
  , settings = require('./settings').settings;

console.log("bouncy listening on "+settings.bouncy.listen_port)
bouncy(function (req, bounce) {
console.log(req.url)
    if (req.url.match(/^\/socket.io\//)) {
        bounce(8080);
    }
    else {
        bounce(3000)
    }
}).listen(settings.bouncy.listen_port);
