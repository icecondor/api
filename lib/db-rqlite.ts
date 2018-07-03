import * as fs from 'fs'
import * as rqlite from 'rqlite-js'
import * as squel from 'squel'
import * as protobuf from 'protobufjs'
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
  proto_root: any

  constructor(settings: object) {
    this.settings = settings
  }

  async connect(onConnect) {
    try {
      this.api = await rqlite('http://'+this.settings.host+':4001')
      await this.load_protobuf()
      await this.ensure_schema()
      onConnect()
    } catch(e) {
      console.log('connect err',e)
    }
  }

  async schema_dump() {
      let result = await this.select("select * from sqlite_master")
      result.values.forEach(async row => {
        let table = row[1]
        let sql = squel.select().field("COUNT(*)").from(table)
        let result = await this.select(sql)
        console.log(table, result.values[0][0], "rows")
      })
  }

  changes(onChange) {
  }

  async load_protobuf(){
    let proto_folder = this.settings.sql_folder+"/proto/"
    let proto_files = fs.readdirSync(proto_folder)
                        .map(fname => proto_folder+fname)
    this.proto_root = await protobuf.load(proto_files)
  }

  async ensure_schema(){
    let sql_folder = this.settings.sql_folder+"/sql/"
    let sql_files = fs.readdirSync(sql_folder)
    await Promise.all(sql_files.map(async (filename) => {
      let sql = fs.readFileSync(sql_folder+filename)
      try {
        let result = await this.select(sql)
        if (result.error) {
          console.log(filename, "table create err", result.error)
        }
      } catch(e) {
        console.log('ensure_schema err',e)
      }
      return this
    }))
  }

  async activity_add(a) {
    console.log('acivity_add', a)
    return {errors: 0}
  }

  async select(sql) {
    let r = await this.api.select(sql.toString())
    let result = r.body.results[0]
    if(!result.values) {
      result.values = []
    }
    return result
  }

  async find_user_by(e) {
    let sql = squel.select().from("user").where("email = ?", e.email_downcase)
    let result = await this.select(sql)
    if(result.values.length > 0) {
      let row = result.values[0]
      let user = this.proto_root.lookupType('icecondor.User').create({
        id: row[result.columns.indexOf('id')],
        email: row[result.columns.indexOf('email')],
        username: row[result.columns.indexOf('email')],
        createdat: row[result.columns.indexOf('createdat')],
      })
      await this.user_load_devices(user)
      return user
    } else {
      return Promise.reject({err:"not found"})
    }
  }

  async user_load_devices(user) {
    let sql = squel.select().from("device").where("userid = ?", user.id)
    let result = await this.select(sql)
    user['devices'] = result.values
  }

  async user_add_device(d) {
    console.log('user_add_device', d)
  }

  async ensure_user(u) {
    try {
      await this.find_user_by({email_downcase: u.email.toLowerCase()})
    } catch(e) {
      await this.create_user(u)
    }
  }

  async create_user(u) {
    let new_user = {
      Id: ulid().toLowerCase(),
      Email: u.email,
      CreatedAt: u.created_at
    }
    let sql = squel.insert().into("user").setFields(new_user)
    let sql2 = squel.insert().into("device").setFields({
      Id: u.devices[0],
      UserId: new_user.Id
    })
    let r = await this.api.select([sql.toString(), sql2.toString()], {transaction: true})
    let result = r.body.results[0]
    if (result.error) {
      console.log('ensure_user', result.error)
    }
  }
}

