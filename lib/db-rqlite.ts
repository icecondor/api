import * as fs from 'fs'
import * as rqlite from 'rqlite-js'
import { Db as DbBase } from './db'

let db_name = 'icecondor'
let schema = { 'users': {indexes: ['username',
                                   ['email_downcase', ''],
                                   ['friends', ['friends'], {multi: true}]
                                  ]},
               'activities': {indexes: ['date',
                                        'user_id',
                                        ['user_id_date', ['user_id', 'date']]
                                       ]},
               'fences': {indexes: ['user_id',
                                    ['geojson', ['geojson'], {geo: true}]]},
               'rules': {indexes: ['user_id', 'fence_id']}
             }

export class Db implements DbBase {
  settings: any
  api: any

  constructor(settings: object) {
    this.settings = settings
  }

  async connect(f) {
    console.log('about to connect')
    try {
      this.api = await rqlite('http://'+this.settings.host+':4001')
      let r = await this.api.select("select * from sqlite_master")
      console.log(JSON.stringify(r.body))
      this.ensure_schema()
    } catch(e) {
      console.log(e)
    }
  }

  changes() {
  }

  ensure_schema(){
    let sql_files = fs.readdirSync(this.settings.sql_folder)
    console.log(sql_files)
  }
}
