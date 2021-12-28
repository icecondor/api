require('source-map-support').install()

// nodejs
import * as timers from 'timers'
import * as uuid from 'node-uuid'
import * as os from 'os'

//npm

// local
import * as settingsLib from './lib/settings'
let settings = settingsLib.default("settings.json")
import * as util from "./lib/util"
import * as protocolLib from "./lib/protocol-v2"
let protocol = protocolLib.default(settings.api)
import * as dbLib from './lib/db'
let db = new dbLib.Db(settings.storage) as any
import serverLib from './lib/server'
let server: any = serverLib(settings, db, protocol)

var motd = "version:" + settings.api.version + " server:" + settings.api.hostname
console.log("api", motd)

db.connect(function() {
  db.schema_dump()

  server.on('listening', listening)
  server.on('connection', handleConnection)
  server.on('close', function() { console.log('closed') })
  server.on('error', function(e) { console.log('net.sever err', e) })
  server.listen(settings.api.listen_port)

  db.changes(server.activity_added)
})

function listening() {
  console.log("api listening on *:" + settings.api.listen_port)
  timers.setInterval(function() {
    progress_report();
    server.timer.reset();
  }, settings.api.progress_report_timer)
}

function handleConnection(socket) {
  var client = server.build_client(socket)
  protocol.connection(client, client_dispatch, end_of_connection)
  server.clients.add(client)
  util.clog(client, 'connected. ' + server.clients.list.length + ' clients.');
  progress_report()
}

function end_of_connection(client) {
  server.clients.remove(client)
  util.clog(client, 'disconnected')
  progress_report()
}

function progress_report() {
  var now = new Date();
  var period = (now.getTime() - server.timer.mark) / 1000
  var rate = server.timer.hits / period
  var stats = {
    type: "status_report",
    server: settings.api.hostname,
    version: settings.api.version,
    date: now.toISOString(),
    msg_rate: rate,
    client_count: server.clients.list.length,
    freemem: os.freemem()
  }
  db.activity_add(stats)
  var srep = 'status report - ' + rate.toFixed(1) + ' hits/sec. ' +
    server.clients.list.length + ' clients.'
  console.log(srep)
  server.pump(stats)
}

function client_dispatch(me, msg) {
  util.clog(me, msg)
  server.timer.hits += 1
  switch (msg.method) {
    case 'auth.email': server.process_auth_email(me, msg); break;
    case 'auth.session': server.process_auth_session(me, msg); break;
    case 'user.detail': server.process_user_detail(me, msg); break;
    case 'user.update': server.process_user_update(me, msg); break;
    case 'user.friend': server.process_user_friend(me, msg); break;
    case 'user.payment': server.process_user_payment(me, msg); break;
    case 'user.stats': server.process_user_stats(me, msg); break;
    case 'user.access.add': server.process_user_access_add(me, msg); break;
    case 'user.access.del': server.process_user_access_del(me, msg); break;
    case 'activity.add': server.process_activity_add(me, msg); break;
    case 'activity.stats': server.process_activity_stats(me, msg); break;
    case 'device.list': server.process_device_list(me, msg); break;
    case 'device.add': server.process_device_add(me, msg); break;
    case 'device.genkey': server.process_device_genkey(me, msg); break;
    case 'fence.add': server.process_fence_add(me, msg); break;
    case 'fence.list': server.process_fence_list(me, msg); break;
    case 'fence.get': server.process_fence_get(me, msg); break;
    case 'fence.update': server.process_fence_update(me, msg); break;
    case 'fence.del': server.process_fence_del(me, msg); break;
    case 'stream.follow': server.process_stream_follow(me, msg); break;
    case 'stream.unfollow': server.process_stream_unfollow(me, msg); break;
    case 'stream.zip': server.process_stream_zip(me, msg); break;
    case 'stream.ziplist': server.process_stream_ziplist(me, msg); break;
    case 'stream.stats': me.flags.stats = msg.id; break;
    case 'rule.list': server.process_rule_list(me, msg); break;
    case 'rule.add': server.process_rule_add(me, msg); break;
    case 'rule.del': server.process_rule_del(me, msg); break;
    default: console.log('!!unknown method', msg)
  }
}

