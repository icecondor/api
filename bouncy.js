var bouncy = require('bouncy')
  , settings = require('./settings').settings;

console.log("bouncy listening on "+settings.bouncy.listen_port)
bouncy(function (req, bounce) {
console.log(req.url)
    if (req.url.match(/^\/socket.io\//)) {
        bounce(settings.socket_io.listen_port);
    }
    else {
        bounce(settings.web.listen_port)
    }
}).listen(settings.bouncy.listen_port);
