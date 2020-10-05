require('source-map-support').install()
import * as fs from 'fs'
import * as net from 'net'
import * as http from 'http'
import * as serverLib from '../lib/server'
let server = serverLib.factory()
import * as Db from '../lib/db-lmdb'

let settings = JSON.parse(fs.readFileSync("settings.json", 'utf8'))

console.log('storage', settings.storage)
let db = new Db.Db(settings.storage)
db.connect(async () => {
  console.log('db up.')
  var server = http.createServer(function(request, response) {
    console.log(request)
  })

  console.log("oauth token oracle listening on", settings.oauth.listen_port)
  server.listen(settings.oauth.listen_port)
})

// { RFC-6750
//     "access_token":"mF_9.B5f-4.1JqM",
//     "token_type":"Bearer",
//     "expires_in":3600,
//     "refresh_token":"tGzv3JOkF0XG5Qx2TlKWIA"
//   }
