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
      this.ensure_schema()
      let r = await this.api.select("select * from sqlite_master")
      r.body.results[0].values.forEach(row => console.log(row[0], row[1]))
    } catch(e) {
      console.log('err1',e)
    }
  }

  changes() {
  }

  ensure_schema(){
    console.log(this.settings)
    let sql_files = fs.readdirSync(this.settings.sql_folder)
    sql_files.forEach(async (filename) => {
      let sql = fs.readFileSync(this.settings.sql_folder+'/'+filename)
      try {
        let sql_result = await this.api.select(sql)
        console.log(filename, "table create", sql_result.body)
      } catch(e) {
        console.log('err1',e)
      }
    })
  }
}
