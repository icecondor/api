import * as fs from 'fs'
import * as rqlite from 'rqlite-js'
import * as squel from 'squel'
import { ulid } from 'ulid'

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

  async connect(onConnect) {
    try {
      this.api = await rqlite('http://'+this.settings.host+':4001')
      await this.ensure_schema()
      let r = await this.api.select("select * from sqlite_master")
      r.body.results[0].values.forEach(row => console.log(row[0], row[1]))
      onConnect()
    } catch(e) {
      console.log('connect err',e)
    }
  }

  changes(onChange) {
  }

  async ensure_schema(){
    let sql_files = fs.readdirSync(this.settings.sql_folder)
    await Promise.all(sql_files.map(async (filename) => {
      let sql = fs.readFileSync(this.settings.sql_folder+'/'+filename)
      try {
        let sql_result = await this.api.select(sql)
        console.log(filename, "table create", sql_result.body)
      } catch(e) {
        console.log('ensure_schema err',e)
      }
      return this
    }))
  }

  async activity_add() {
  }

  async find_user_by(e) {
    let sql = squel.select().from("user").where("email = ?", e.email_downcase)
    console.log('find user by', e, sql.toString())
    let r = await this.api.select(sql.toString())
    let results = r.body.results[0] || []
    console.log('find user by result:', JSON.stringify(results.values.length))
    if(results.values && results.values.length > 0) {
      let row = results.values[0]
      let user = {
        id: row[results.columns.indexOf('id')],
        email: row[results.columns.indexOf('email')],
        username: row[results.columns.indexOf('email')],
        createdat: row[results.columns.indexOf('createdat')],
      }
      await this.user_enhance_devices(user)
      console.log('user built', user)
      return user
    } else {
      return Promise.reject({err:"not found"})
    }
  }

  async user_enhance_devices(user) {
    let sql = squel.select().from("device").where("userid = ?", user.id)
    console.log('user sql', sql.toString())
    let r = await this.api.select(sql.toString())
    let values = r.body.results.values || []
    console.log('user devices', values)
    user['devices'] = values
  }

  async user_add_device(d) {
    console.log('user_add_device', d)
  }

  async ensure_user(u) {
    let new_user = {
      Id: ulid(),
      Email: u.email,
      CreatedAt: u.created_at
    }
    let sql = squel.insert().into("user").setFields(new_user)
    let sql2 = squel.insert().into("device").setFields({
      Id: u.devices[0],
      UserId: new_user.Id
    })
    console.log('ensure user', u, sql.toString(), sql2.toString())
    let r = await this.api.select([sql.toString(), sql2.toString], {transaction: true})
    let results = r.body.results[0] || []
  }
}

