// npm
var jade = require('jade');
var nodemailer = require('nodemailer')

exports.factory = function(config) {
  var o = {}

  o.build_payment_email = function(email, product, amount) {
    var opts = {
      from: config.from,
      to: email,
      subject: 'Purchase complete: ' + product,
      text: 'Thank you for your purchase of ' + product + '.\n\n' +
        'Your card has been charged $' + (amount / 100).toFixed(2) + '.\n'
    }
    return opts
  }

  o.build_friend_email = function(email, friended_by) {
    var opts = {
      from: config.from,
      to: email,
      subject: friended_by + ' is sharing their location with you',
      text: friended_by + ' is now sharing their location with you.\n\n' +
        'View their map at\n' +
        'https://icecondor.com/' + friended_by
    }
    return opts
  }

  o.build_token_email = function(email, device_id, token) {
    var link = "https://icecondor.com/auth/" + encodeURIComponent(token)
    console.log('build_token_email for', email, link)
    var emailOpt = {
      from: config.from,
      to: email,
      //html: '<b>Hello world </b>'
    }
    var templateFile
    if (device_id == 'browser') {
      console.log('build_token_email render browser')
      emailOpt.subject = 'IceCondor web login button'
      emailOpt.text = 'Web Browser Login link for ' + email + '.\n\n' + link + '\n'
      templateFile = 'email/access_browser.jade'
    } else {
      console.log('build_token_email render phone')
      emailOpt.subject = 'IceCondor Phone Activation Link'
      emailOpt.text = 'Cell Phone Activation link\n\n' + link + '\n'
      templateFile = 'email/access_phone.jade'
    }
    var templateOpts = { link: link, email: email }
    console.log('email template opts', templateFile, templateOpts)
    emailOpt.html = jade.compileFile(templateFile, { pretty: true })(templateOpts)
    console.log('email build done', emailOpt.from, emailOpt.to)
    return emailOpt
  }

  o.build_dump_email = function(email, dump_url, count, mb_size) {
    console.log('build_dump_email for', email)
    var emailOpt = {
      from: config.from,
      to: email,
      subject: "Your location data is ready."
    }
    var templateFile = 'email/dump_ready.jade'
    var full_url = 'https://icecondor.com/' + dump_url
    var templateOpts = { link: full_url, count: count, mb_size: mb_size.toFixed(1) }
    emailOpt.html = jade.compileFile(templateFile, { pretty: true })(templateOpts)
    return emailOpt
  }

  o.build_fence_alert_email = function(email, fence, username, location_outside, location_inside, direction) {
    console.log('build_dump_email for', email)
    var emailOpt = {
      from: config.from,
      to: email,
      subject: fence.name + " was " + direction + " by " + username
    }
    var templateFile = 'email/fence_alert.jade'
    var user_link = 'https://icecondor.com/' + username
    var fence_link = user_link + '/fences/' + fence.id
    var templateOpts = {
      username: username, user_link: user_link, fence_name: fence.name,
      fence_link: fence_link, direction: direction,
      location_outside: location_outside, location_inside: location_inside
    }
    emailOpt.html = jade.compileFile(templateFile, { pretty: true })(templateOpts)
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
    var transporter = nodemailer.createTransport({ host: 'localhost', ignoreTLS: true })
    if (!params.bcc && config.alert) { params.bcc = config.alert }
    transporter.sendMail(params, function(error, info) {
      if (error) {
        console.log("SMTP error: ", error.code);
      } else {
        console.log('Message sent.', 'to:', params.to, 'subject:', params.subject);
        console.log('SMTP response', info);
      }
    });
  }

  return o;
}
