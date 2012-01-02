var bouncy = require('bouncy')
  , settings = require('./settings');

console.log("bouncy listening on "+settings.bouncy.listen_port)

bouncy(function (req, bounce) {
  var host = req.headers.host;
  console.log(host+req.url)

  if (host.match(/^(www\.)?icecondor\.com/)) {
    if (req.url.match(/^\/socket.io\//)) {
      bounce(settings.socket_io.listen_port).on('error', errlog);
    }
    else {
      bounce(settings.web.listen_port).on('error', errlog);
    }
  }

  if (host.match(/^api\.icecondor\.com/)) {
    bounce(settings.websockets.listen_port);
  }
}).listen(settings.bouncy.listen_port);

function errlog(e) {
  console.log(''+e)
}
