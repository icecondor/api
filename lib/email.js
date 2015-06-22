// npm
var jade = require('jade');
var nodemailer = require('nodemailer')

exports.factory = function(config) {
  var o = {}

  o.build_payment_email = function(email, product, amount) {
    var opts = {
      from: config.from,
      to: email,
      subject: 'Purchase complete: '+product,
      text: 'Thank you for your purchase of '+product+'.\n\n'+
            'Your card has been charged $'+(amount/100).toFixed(2)+'.\n'
    }
    return opts
  }

  o.build_friend_email = function(email, friended_by) {
    var opts = {
      from: config.from,
      to: email,
      subject: friended_by+' is sharing their location with you',
      text: friended_by+' is now sharing their location with you.\n\n'+
            'View their map at\n'+
            'https://icecondor.com/'+friended_by
    }
    return opts
  }

  o.build_token_email = function(email, device_id, token) {
    console.log('build_token_email for', email)
    var link = "https://icecondor.com/auth/"+encodeURIComponent(token)
    var emailOpt = {
      from: config.from,
      to: email,
      //html: '<b>Hello world </b>'
    }
    var templateFile
    if(device_id == 'browser') {
      console.log('build_token_email render browser')
      emailOpt.subject = 'IceCondor web login button'
      emailOpt.text = 'Web Browser Login link for '+email+'.\n\n'+link+'\n'
      templateFile = 'email/access_browser.jade'
    } else {
      console.log('build_token_email render phone')
      emailOpt.subject = 'IceCondor Phone Activation Link'
      emailOpt.text = 'Cell Phone Activation link\n\n'+link+'\n'
      templateFile = 'email/access_phone.jade'
    }
    var templateOpts = {link: link, email:email}
    console.log('email template opts', templateFile, templateOpts)
    emailOpt.html = jade.compileFile(templateFile, {pretty: true})(templateOpts)
    console.log('email build done', emailOpt.from, emailOpt.to)
    return emailOpt
  }

   o.build_admin_email = function(msg) {
    var opts = {
      from: config.from,
      to: config.alert,
      subject: msg,
      text: msg
    }
    return opts
  }

  o.send_email = function(params) {
    var transporter = nodemailer.createTransport({host:'localhost', ignoreTLS: true})
    console.log("email delivery attempt to "+params.to)
    if(!params.bcc) { params.bcc = config.alert }
    transporter.sendMail(params, function(error, info){
      if(error){
          console.log("SMTP error: ", error);
      } else {
          console.log('Message sent to', params.to);
          console.log('SMTP response', info);
      }
    });
  }

  return o;
}
