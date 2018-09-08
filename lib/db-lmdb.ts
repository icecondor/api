import * as fs from 'fs'
import * as path from 'path'
// import * as levelup from 'levelup'
// import * as lmdb from 'zetta-lmdb'
import * as lmdb from 'node-lmdb'
import * as mkdirp from 'mkdirp'

import { Db as DbBase } from './db'
import * as noun from './nouns'

let db_name = 'icecondor'
let schema = {
  'user': {
    indexes: ['username',
      'email',
      ['friends', ['friends'], { multi: true }]
    ]
  },
  'heartbeat': {
    indexes: []
  },
  'location': {
    indexes: ['date',
      'user_id',
      ['user_id_date', ['user_id', 'date']]
    ]
  },
  'fence': {
    indexes: ['user_id',
      ['geojson', ['geojson'], { geo: true }]]
  },
  'rule': { indexes: ['user_id', 'fence_id'] }
}

export class Db extends DbBase {
  api: any
  db: any
  storage_path: string

  mkdir(dir: string) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir)
      console.log('warning: created', dir)
    }
  }

  async connect(onConnect) {
    this.api = new lmdb.Env()
    this.storage_path = "./datalake/"
    this.mkdir(this.storage_path)
    this.mkdir(this.settings.path)
    this.api.open(this.settings)
    this.db = {}
    await this.ensure_schema()
    await onConnect()
  }

  async schema_dump() {
  }

  changes(onChange) {
  }

  async ensure_schema() {
    for (const typeName in schema) {
      for (const index of schema[typeName].indexes) {
        let indexName = Array.isArray(index) ? index[0] : index
        let dbname = this.dbName(typeName, indexName)
        this.db[dbname] = this.api.openDbi({name: dbname, create: true})
        var txn = this.api.beginTxn()
        let cursor = new lmdb.Cursor(txn, this.db[dbname])
        let count = 0
        for (var found = cursor.goToFirst(); found !== null; found = cursor.goToNext()) { count += 1 }
        txn.commit()
        console.log('opened index', dbname, count)
      }
    }
  }

  dbName(typeName, indexName) { return typeName+'.'+indexName }

  async save(value) {
    this.saveFile(value)
    let typeName = value.type
    var indexes = schema[typeName].indexes
    if (indexes) {
      for (const indexName of indexes) {
        let key = this.makeKey(indexName, value)
        if (key) {
          let dbname = this.dbName(typeName, indexName)
          console.log('SAVE', dbname, key+"="+value.id)
          var txn = this.api.beginTxn()
          console.log('db', this.db[dbname])
          txn.putString(this.db[dbname], key, value.id)
          txn.commit()
        } else {
          console.log('save failed for', value.type, 'index', indexName)
        }
      }
    } else {
      console.log('warning: no index defined for', value.type)
    }
  }

  get(typeName, indexName, key) {
    let id
    if (indexName == 'id') {
      id = key
    } else {
      let dbname = this.dbName(typeName, indexName)
      var txn = this.api.beginTxn()
      console.log('GET', dbname, key)
      id = txn.getString(this.db[dbname], key)
      if(!id) { console.log('get fail', dbname, key, 'is null') }
      txn.commit()
    }

    if(id) {
      let data = this.loadFile(id)
      if (data) {
        return JSON.parse(data)
      }
    } else {
      console.log('get fail. no id for index', typeName, indexName, key)
    }
  }

  makeKey(index, value) {
    if (typeof index == 'string') {
      return value[index]
    }
    if (Array.isArray(index)) {
      let values = index[1].map(i => value[i])
      if(values.every(i => i)) {
        return values.join(':')
      } else {
        console.log('warning: index', index, 'creation failed due to missing values')
      }
    }
  }

  saveFile(value) {
    var filepath = this.storage_path+value.id.replace(/-/g,'/')
    mkdirp.sync(path.dirname(filepath))
    console.log('file save', filepath)
    fs.writeFileSync(filepath, JSON.stringify(value))
  }

  loadFile(id) {
    var filepath = this.storage_path+id.replace(/-/g,'/')
    console.log('file load', filepath)
    return fs.readFileSync(filepath, 'utf8')
  }

// model stuff
  async activity_add(a) {
    let now = new Date().toISOString()
    if (a.type == 'location') {
      let thing: noun.Location = {
        id: a.id || this.new_id(),
        type: 'location',
        date: a.date || now,
        received_at: a.received_at || now,
        user_id: a.user_id,
        device_id: a.device_id,
        latitude: a.latitude,
        longitude: a.longitude,
        accuracy: a.accuracy,
        provider: a.provider
      }
      let result = this.save(thing)
    }
    if (a.type == 'heartbeat') {
      let thing: noun.Heartbeat = {
        id: a.id || this.new_id(),
        type: "heartbeat",
        date: a.date || now,
        received_at: a.received_at || now,
        user_id: a.user_id,
        device_id: a.device_id,
        charging: a.power,
        cell_data: a.celldata,
        wifi_data: a.wifidata,
        battery_percentage: a.battery.percentage,
        memory_free: a.memory ? a.memory.free : null,
        memory_total: a.memory ? a.memory.total : null
      }
      //let sql = squel.insert().into("heartbeat").setFields(thing)
      //let result = await this.insert(sql)
    }
    if (a.type == 'config') {
      let thing: noun.Config = {
        id: a.id || this.new_id(),
        type: "config",
        date: a.date || now,
        received_at: a.received_at || now,
        user_id: a.user_id,
        device_id: a.device_id,
        recording: a.recording == "on" ? true : false,
        recording_frequency: a.frequency ? parseFloat(a.frequency)*60 : null,
        source: a.source || null
      }
      //let sql = squel.insert().into("config").setFields(thing)
      //let result = await this.insert(sql)
    }
    return { errors: 0 }
  }

  async activity_last_date() {
    //let sql = squel.select().from('location').order('date', false).limit(1)
    let result = {}//await this.select(sql)
    //if (result.values.length > 0) {
      //return result.values[0][result.columns.indexOf('date')]
    //}
  }

  async find_user_by(e) {
    let index, key
    if (e.email_downcase) {
      index = 'email'
      key = e.email_downcase
    }
    if (e.username) {
      index ='username'
      key = e.username
    }
    if (e.id) {
      index ='id'
      key = e.id
    }
    let user: any = this.get('user', index, key)
    if (user) {
      let full_user: any = {
        id: user.id,
        email: user.email,
        username: user.username,
        created_at: user.created_at,
      }
      full_user.devices = await this.user_load_devices(full_user.id)
      return full_user
    } else {
      return Promise.reject({ err: "find_user_by reject "+index+" "+key })
    }
  }

  async user_load_devices(user_id) {
    //let sql = squel.select().from("device").where("user_id = ?", user_id)
    return [] //result.values.map(row => row[result.columns.indexOf('device_id')])
  }

  async user_add_access(user_id, key) {
    let new_access: noun.Access = {
      id: this.new_id(),
      type: "access",
      created_at: new Date().toISOString(),
      user_id: user_id,
    }
    //let sql = squel.insert().into('access').setFields(new_access)
    //await this.insert(sql) // best effort
    return this.user_find_access(user_id, key)
  }

  async user_find_access(user_id, key) {
  }

  async user_add_friend(user_id, friend_id) {
    let new_friendship: noun.Friendship = {
      id: this.new_id(),
      type: "friendship",
      user_id: user_id,
      friend_user_id: friend_id,
      created_at: new Date().toISOString()
    }
    //let sql = squel.insert().into('friendship').setFields(new_friendship)
    //await this.insert(sql) // best effort
  }

  async user_add_device(user_id, device_id) {
    let new_device: noun.Device = {
      id: this.new_id(),
      type: "device",
      device_id: device_id,
      created_at: new Date().toISOString(),
      user_id: user_id
    }
    //let sql = squel.insert().into("device").setFields(new_device)
    //await this.insert(sql) // best effort
    return this.user_find_device(user_id, device_id)
  }

  async user_find_device(user_id, device_id) {

  }

  async ensure_user(u) {
    try {
      return await this.find_user_by({ email_downcase: u.email.toLowerCase() })
    } catch (e) {
      // not found
      console.log('ensure_user creating', u.email, u.id)
      await this.create_user(u)
      let user: noun.User = await this.find_user_by({ email_downcase: u.email.toLowerCase() })
      if (u.devices) {
        if (u.devices.length > 0) console.log('adding', u.devices.length, 'devices')
        for(const device_id of u.devices) await this.user_add_device(user.id, device_id)
      }
      if (u.access) {
        if (Object.keys(u.access).length > 0) console.log('adding', Object.keys(u.access).length, 'access keys')
        for (const key of Object.keys(u.access)) await this.user_add_access(user.id, key)
      }
      if (u.friends) {
        if (u.friends.length > 0) console.log('adding', u.friends.length, 'friends')
        for (const friend of u.friends) await this.user_add_friend(user.id, friend)
      }

      return {}//await this.find_user_by({ email_downcase: u.email.toLowerCase() })
    }
  }

  async create_user(u) {
    let new_user: noun.User = {
      id: u.id || this.new_id(),
      type: "user",
      email: u.email,
      username: u.username,
      created_at: u.created_at || new Date().toISOString()
    }
    this.save(new_user)
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
    //let sql = squel.update().table("user")
    if (params.username) {
      //sql = sql.set("username", params.username)
      console.log('updating user', user_id, 'username', params.username)
    }
    //sql = sql.where("id = ?", user_id)
    //let result = await this.update(sql)
    return {}
  }

  async find_locations_for(user_id, start, stop, count, type, order) {
    start = start || new Date("2008-08-01").toISOString()
    stop = stop || new Date().toISOString()
    /*
    let sql = squel.select()
      .from("location")
      .where("user_id = ?", user_id)
      .where("date > ?", start)
      .where("date < ?", stop)
      .order("date", false)
      .limit(count)
    let result = await this.select(sql)
    let locations: noun.Location[] = result.values.map(row =>
      ({
        type: 'location',
        id: row[result.columns.indexOf('id')],
        user_id: row[result.columns.indexOf('user_id')],
        device_id: row[result.columns.indexOf('device_id')],
        latitude: parseFloat(row[result.columns.indexOf('latitude')]),
        longitude: parseFloat(row[result.columns.indexOf('longitude')]),
        date: row[result.columns.indexOf('date')],
        accuracy: parseFloat(row[result.columns.indexOf('accuracy')]),
        provider: row[result.columns.indexOf('provider')],
      })
    return locations
    */
  }
}

