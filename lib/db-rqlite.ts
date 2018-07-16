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
      await onConnect()
    } catch(e) {
      console.log('connect err',e)
    }
  }

  async schema_dump() {
      let result = await this.select("select * from sqlite_master")
      result.values.forEach(async row => {
        let table = row[1]
        if(!table.match(/^sqlite_/)) {
          let sql = squel.select().field("COUNT(*)").from(table)
          let result = await this.select(sql)
          let msg
          if(result.error) {
            msg = result.error
          } else {
            msg = result.values[0][0] + " rows"
          }
          console.log(table, msg)
        }
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
        let result = await this.table_create(sql)
        if (result.error) {
          console.log(filename, "table create err", result.error)
        }
      } catch(e) {
        console.log('ensure_schema err',e)
      }
      return this
    }))
  }

  async table_create(sql) {
    return await this.dbgo(sql, this.api.table.create)
  }

  async select(sql) {
    return await this.dbgo(sql, this.api.select)
  }

  async insert(sql) {
    return await this.dbgo(sql, this.api.insert)
  }

  async update(sql) {
    return await this.dbgo(sql, this.api.update)
  }

  async dbgo(sql, dbmethod) {
    let r = await dbmethod(sql.toString())
    let result = r.body.results[0]
    if(!result.values) {
      result.values = []
    }
    console.log(sql.toString(), "("+result.values.length+")", result.values[0])
    return result
  }

  async activity_add(a) {
    const Location = this.proto_root.lookupType('icecondor.Location')
    let location = Location.create({
      Id: a.id || this.new_id(),
      UserId: a.user_id,
      Date: a.date,
      Latitude: a.latitude,
      Longitude: a.longitude
    })
    let new_location = Location.toObject(location)
    let sql = squel.insert().into("location").setFields(new_location)
    let result = await this.insert(sql)
    return {errors: 0}
  }

  async find_user_by(e) {
    let sql
    if (e.email_downcase) {
      sql = squel.select().from("user").where("email = ?", e.email_downcase)
    }
    if (e.id) {
      sql = squel.select().from("user").where("id = ?", e.id)
    }
    let result = await this.select(sql)
    if(result.values.length > 0) {
      let row = result.values[0]
      let user = this.proto_root.lookupType('icecondor.User').create({
        id: row[result.columns.indexOf('id')],
        email: row[result.columns.indexOf('email')],
        username: row[result.columns.indexOf('username')],
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
    user['devices'] = result.values.map(row => row[0])
  }

  async user_add_device(d) {
    console.log('user_add_device', d)
  }

  async ensure_user(u) {
    try {
      return await this.find_user_by({email_downcase: u.email.toLowerCase()})
    } catch(e) {
      console.log('ensure_user creating', u.email)
      return await this.create_user(u)
    }
  }

  new_id() {
    return ulid().toLowerCase()
  }

  async create_user(u) {
    let new_user = {
      Id: this.new_id(),
      Email: u.email,
      CreatedAt: u.created_at
    }
    let sql = squel.insert().into("user").setFields(new_user)
    let sql2 = squel.insert().into("device").setFields({
      Id: u.devices[0],
      UserId: new_user.Id
    })
    let r = await this.api.insert([sql.toString(), sql2.toString()], {transaction: true})
    let result = r.body.results[0]
    if (result.error) {
      return Promise.reject(result.error)
    } else {
      return this.find_user_by({id: new_user.Id})
    }
  }

  async get_user(user_id: string) {
    return this.find_user_by({id: user_id})
  }

  async friending_me(user_id: string) {
    return []
  }

  async fences_intersect(point) {
    return {toArray: () => Promise.resolve([])} // quack like rethinkdb
  }

  async update_user_latest(user_id: string, latest) {
    console.log('update_user_latest', user_id, latest)
  }

  async update_user_by(user_id, params) {
    let sql = squel.update().table("user")
    if (params.username) {
      sql = sql.set("username", params.username)
    }
    sql = sql.where("id = ?", user_id)
    let result = await this.update(sql)
    return {}
  }
}

