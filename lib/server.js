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
    var auth_url = "icecondor://android/v2/auth?access_token="+"abc123"
    var link = "https://icecondor.com/oauth2/authorize?client_id=icecondor-nest"+
               "&response_type=token&redirect_uri="+encodeURIComponent(auth_url)
    var emailOpt = {
      from: 'IceCondor <system@icecondor.com>',
      to: params.email,
      subject: 'Android Login Link',
      text: 'Android Login link\n'+link+'\nfrom device id: '+params.device_id,
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
