var net = require('net')
var emailer = require('nodemailer')

exports.factory = function() {
  var server = new net.Server();

  server.timer = {
    mark: new Date(),
      hits: 0,
      reset: function() {
        this.mark = new Date()
        this.hits = 0
    }
  }

  server.clients = {
    list: [],
    add: function(client) {
      this.list.push(client)
    },
    remove: function(client) {
      var idx = this.list.indexOf(client)
        this.list.splice(idx,1)
    }
  }

  /* straight http request */
  server.request_token = function(params) {
    console.log('request_token '+JSON.stringify(params))
    var emailOpt = {
      from: 'IceCondor <system@icecondor.com>',
      to: params.email,
      subject: 'Cellphone Login',
      text: 'icecondor://token/abc123\n'+params.device_id,
      //html: '<b>Hello world </b>'
      }
    var transporter = emailer.createTransport()
    transporter.sendMail(emailOpt, function(error, info){
      if(error){
          console.log(error);
      }else{
          console.log('Message sent: ' + info.response);
      }
    });
  }

  return server;
}
