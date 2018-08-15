import * as fs from 'fs'
import * as rqlite from 'rqlite-js'
import * as squel from 'squel'
import * as protobuf from 'protobufjs'

import { Db as DbBase } from './db'

let db_name = 'icecondor'
let schema = {
  'users': {
    indexes: ['username',
      ['email_downcase', ''],
      ['friends', ['friends'], { multi: true }]
    ]
  },
  'activities': {
    indexes: ['date',
      'user_id',
      ['user_id_date', ['user_id', 'date']]
    ]
  },
  'fences': {
    indexes: ['user_id',
      ['geojson', ['geojson'], { geo: true }]]
  },
  'rules': { indexes: ['user_id', 'fence_id'] }
}

export class Db extends DbBase {
  api: any
  proto_root: any


  async connect(onConnect) {
    this.api = await rqlite('http://' + this.settings.host + ':4001')
    await this.load_protobuf()
    await this.ensure_schema()
    await onConnect()
  }

  async schema_dump() {
    let result = await this.select("select * from sqlite_master")
    result.values.forEach(async row => {
      let table = row[1]
      if (!table.match(/^sqlite_/)) {
        let sql = squel.select().field("COUNT(*)").from(table)
        let result = await this.select(sql)
        let msg
        if (result.error) {
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

  async load_protobuf() {
    let proto_folder = this.settings.sql_folder + "/proto/"
    let proto_files = fs.readdirSync(proto_folder)
      .map(fname => proto_folder + fname)
    this.proto_root = await protobuf.load(proto_files)
  }

  async ensure_schema() {
    let sql_folder = this.settings.sql_folder + "/sql/"
    let sql_files = fs.readdirSync(sql_folder)
    let sql_promises = sql_files.map(async (filename) => {
      let sql = fs.readFileSync(sql_folder + filename)
      try {
        let result = await this.table_create(sql)
        if (result.error) {
          console.log(filename, "table create err", result.error)
          return Promise.reject(new Error("table create err"))
        }
      } catch (e) {
        console.log('ensure_schema err', filename, e.code)
        return Promise.reject(new Error("other ensure schema err"))
      }
      return this
    })
    await Promise.all(sql_promises)
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
    if (!result.values) {
      result.values = []
    }
    //    this.sql_log(sql, result)
    return result
  }

  sql_log(sql, result) {
    console.log('SQL:', JSON.stringify(sql.toString()))
    console.log('ROW:', typeof result.values == "object" ? result.values[0] : result.values)
  }

  async activity_add(a) {
    const Location = this.proto_root.lookupType('icecondor.Location')
    let location = Location.create({
      Id: a.id || this.new_id("location"),
      UserId: a.user_id,
      Date: a.date,
      Latitude: a.latitude,
      Longitude: a.longitude
    })
    let new_location = Location.toObject(location)
    let sql = squel.insert().into("location").setFields(new_location)
    let result = await this.insert(sql)
    return { errors: 0 }
  }

  async find_user_by(e) {
    let sql
    if (e.email_downcase) {
      sql = squel.select().from("user").where("email = ?", e.email_downcase)
    }
    if (e.username) {
      sql = squel.select().from("user").where("username = ?", e.username)
    }
    if (e.id) {
      sql = squel.select().from("user").where("id = ?", e.id)
    }
    let result = await this.select(sql)
    if (result.values.length > 0) {
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
      return Promise.reject({ err: "not found" })
    }
  }

  async user_load_devices(user) {
    let sql = squel.select().from("device").where("userid = ?", user.id)
    let result = await this.select(sql)
    user['devices'] = result.values.map(row => row[0])
  }

  async user_add_device(user_id, device_id) {
    console.log('user_add_device', 'user_id', user_id, 'device_id', device_id)
    let new_device = {
      Id: device_id,
      UserId: user_id
    }
    let sql = squel.insert().into("device").setFields(new_device)
    await this.insert(sql) // best effort
    return this.find_user_by({ id: user_id })
  }

  async ensure_user(u) {
    try {
      return await this.find_user_by({ email_downcase: u.email.toLowerCase() })
    } catch (e) {
      console.log('ensure_user creating', u.email)
      return await this.create_user(u)
    }
  }

  async create_user(u) {
    let new_user = {
      Id: this.new_id("user"),
      Email: u.email,
      CreatedAt: u.created_at
    }
    let sql = squel.insert().into("user").setFields(new_user)
    let r = await this.api.insert(sql.toString())
    let result = r.body.results[0]
    if (result.error) {
      return Promise.reject(result.error)
    } else {
      this.user_add_device(new_user.Id, u.devices[0])
      return this.find_user_by({ id: new_user.Id })
    }
  }

  async get_user(user_id: string) {
    return this.find_user_by({ id: user_id })
  }

  async friending_me(user_id: string) {
    return []
  }

  async fences_intersect(point) {
    return { toArray: () => Promise.resolve([]) } // quack like rethinkdb
  }

  async update_user_latest(user_id: string, latest) {
    console.log('update_user_latest', user_id, latest)
  }

  async update_user_by(user_id, params) {
    let sql = squel.update().table("user")
    if (params.username) {
      sql = sql.set("username", params.username)
      console.log('updating user', user_id, 'username', params.username)
    }
    sql = sql.where("id = ?", user_id)
    let result = await this.update(sql)
    return {}
  }

  async find_locations_for(user_id, start, stop, count, type, order) {
    start = start || new Date("2008-08-01").toISOString()
    stop = stop || new Date().toISOString()
    let sql = squel.select()
      .from("location")
      .where("userid = ?", user_id)
      .where("date > ?", start)
      .where("date < ?", stop)
      .order("date")
      .limit(count)
    let result = await this.select(sql)
    let proto_location = this.proto_root.lookupType('icecondor.Location')
    let locations = result.values.map(row =>
        ({ type: 'location',
         id: row[result.columns.indexOf('id')],
         userid: row[result.columns.indexOf('userid')],
         latitude: row[result.columns.indexOf('latitude')],
         longitude: row[result.columns.indexOf('longitude')],
         date: row[result.columns.indexOf('date')]})
 /*     proto_location.create({
        Id: row[result.columns.indexOf('id')],
        UserId: row[result.columns.indexOf('userid')],
        Latitude: row[result.columns.indexOf('latitude')],
        Longitude: row[result.columns.indexOf('longitude')],
        Date: row[result.columns.indexOf('date')],
      }) */
    )
    return locations
  }
}

