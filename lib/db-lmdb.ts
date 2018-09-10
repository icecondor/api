import * as fs from 'fs'
import * as path from 'path'
// import * as levelup from 'levelup'
// import * as lmdb from 'zetta-lmdb'
import * as lmdb from 'node-lmdb'
import * as mkdirp from 'mkdirp'
import * as walk from 'fs-walk'

import { Db as DbBase } from './db'
import * as noun from './nouns'

let db_name = 'icecondor'
let schema = {
  'user': {
    indexes: [
      'username',
      'email'
      //['friends', ['friends'], { multi: true }]
    ]
  },
  'device': {
    indexes: [
      ['idid_date', ['user_id', 'device_id']]
    ]
  },
  'heartbeat': {
    indexes: []
  },
  'location': {
    indexes: [
      'date',
      'user_id',
      ['user_id_date', ['user_id', 'date']]
    ]
  },
  'fence': {
    indexes: [
      'user_id',
      ['geojson', ['geojson'], { geo: true }]]
  },
  'rule': {
    indexes: [
      'user_id',
      'fence_id'
    ]
  }
}

export class Db extends DbBase {
  api: any
  db: any

  mkdir(dir: string) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir)
      console.log('warning: created', dir)
    }
  }

  async connect(onConnect) {
    this.pathFix(this.settings, 'path')
    this.pathFix(this.settings.lmdb, 'path')
    this.api = new lmdb.Env()
    this.mkdir(this.settings.path)
    this.mkdir(this.settings.lmdb.path)
    this.api.open(this.settings.lmdb)
    this.db = {}
    this.ensure_schema()
    return await onConnect()
  }

  pathFix(obj, attr) {
    var spath = obj[attr]
    var longpath = path.resolve(spath)
    if(longpath != spath) {
      obj[attr] = longpath
      console.log('warning: fixed up path', spath, '=>', longpath)
    }
  }

  changes(onChange) {
  }

  ensure_schema(resync: boolean = false) {
    for (const typeName in schema) {
      for (const index of schema[typeName].indexes) {
        let indexName = this.indexName(index)
        let dbname = this.dbName(typeName, indexName)
        if (resync) this.api.openDbi({name: dbname, create: true}).drop()
        this.db[dbname] = this.api.openDbi({name: dbname, create: true})
      }
    }
    if (resync) this.syncIndexes()
  }

  async schema_dump() {
    for(const dbName in this.db) {
      let db = this.db[dbName]
      var txn = this.api.beginTxn()
      let stat = db.stat(txn)
      txn.commit()
      console.log('index', dbName, 'count', stat.entryCount)
    }
  }


  indexName(index) { return Array.isArray(index) ? index[0] : index }

  syncIndexes() {
    walk.filesSync(this.settings.path, (dir, filename, stat) => {
      let p1 = dir.substr(this.settings.path.length+1)
      let id = p1.replace(/\//g, '-')+'-'+filename
      let value = JSON.parse(this.loadFile(id))
      this.saveIndexes(value)
    })
  }

  dbName(typeName, indexName) { return typeName+'.'+indexName }

  save(value) {
    this.saveFile(value)
    this.saveIndexes(value)
  }

  saveIndexes(value) {
    let typeName = value.type
    var indexes = schema[typeName].indexes
    if (indexes) {
      for (const index of indexes) {
        let indexName = this.indexName(index)
        let dbname = this.dbName(typeName, indexName)
        let key = this.makeKey(index, value)
        if (key) {
          var txn = this.api.beginTxn()
          console.log('PUT', dbname, key, value.id)
          txn.putString(this.db[dbname], key, value.id)
          txn.commit()
        } else {
          console.log('key generation failed for index', dbname)
        }
      }
    } else {
      console.log('warning: no indexes defined for', value.type)
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

  getLast(typeName, indexName) {
    let dbname = this.dbName(typeName, indexName)
    let txn = this.api.beginTxn()
    let cursor = new lmdb.Cursor(txn, this.db[dbname])
    let last = cursor.goToLast()
    cursor.close()
    txn.commit()
    return last
  }

  getBetween(typeName, indexName, start, end) {
    console.log('GETBETWEEN start', typeName, indexName, start, end)
    let startkeyList = Array.isArray(start) ? [start] : start
    let startkey = startkeyList.join(':')
    let dbname = this.dbName(typeName, indexName)
    let txn = this.api.beginTxn()
    let cursor = new lmdb.Cursor(txn, this.db[dbname])
    let results = []
    let firstKey = cursor.goToRange(startkey)
    console.log('GETBETWEEN loopprep', dbname, firstKey)
    if(firstKey != null) {
      let endkeyList = Array.isArray(end) ? [end] : end
      let endkey = endkeyList.join(':')
      let schemakeyList = schema[typeName].indexes.filter(i => {return i[0] == indexName})[0][1]
      console.log('GETBETWEEN endtest1', endkey, indexName, schema[typeName].indexes, schemakeyList)
      //let endkeyKey = cursor.goToRange(endkey)
      let nextKey = firstKey
      while (nextKey !== null) {
        console.log('GETBETWEEN win', startkey, endkey, nextKey, endkeyList.length, schemakeyList.length)
        if(endkeyList.length < schemakeyList.length) {
          if(endkey == nextKey.substr(0, endkey.length)) {
            results.push(nextKey)
            nextKey = cursor.goToNext()
          } else {
            nextKey = null
          }
        } else {
          if(nextKey <= endkey) {
            results.push(nextKey)
          }
          nextKey = cursor.goToNext()
        }
      }
      cursor.close()
      console.log('GETBETWEEN end', dbname, start, startkey, end, endkey, results.length, 'results')
      txn.commit()
    }
    return results
  }

  makeKey(index, value) {
    let key_parts
    if (typeof index == 'string') {
      key_parts = [value[index]]
    }
    if (Array.isArray(index)) {
      key_parts = index[1].map(i => value[i])
    }
    if(key_parts.every(i => i)) {
      return key_parts.map(part => part.toLowerCase()).join(':')
    } else {
      console.log('warning: index', index, 'creation failed due to missing values in', value)
    }
  }

  saveFile(value) {
    var filepath = this.settings.path+'/'+value.id.replace(/-/g,'/')
    mkdirp.sync(path.dirname(filepath))
    console.log('file save', value.id, filepath)
    fs.writeFileSync(filepath, JSON.stringify(value))
  }

  loadFile(id) {
    var filepath = this.settings.path+'/'+id.replace(/-/g,'/')
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
      let result = this.save(thing)
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
      let result = this.save(thing)
    }
    return { errors: 0 }
  }

  activity_last_date() {
    return this.getLast('location', 'date')
  }

  find_user_by(e) {
    let index, key
    if (e.email_downcase || e.email) {
      index = 'email'
      key = (e.email_downcase || e.email).toLowerCase()
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
      full_user.devices = this.user_load_devices(full_user.id)
      return full_user
    } else {
      throw "find_user_by reject "+index+" "+key
    }
  }

  user_load_devices(user_id) {
    let devices = this.getBetween('device', 'idid_date', [user_id], [user_id])
    return devices.map(d => {id: d})
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
    return this.save(new_device)
  }

  async user_find_device(user_id, device_id) {

  }

  ensure_user(u) {
    try {
      return this.find_user_by({ email_downcase: u.email })
    } catch (e) {
      // not found
      console.log('ensure_user creating', u.email, u.id)
      this.create_user(u)
      let user: noun.User = this.find_user_by({ email_downcase: u.email.toLowerCase() })
      if (u.devices) {
        if (u.devices.length > 0) console.log('adding', u.devices.length, 'devices')
        for(const device_id of u.devices) this.user_add_device(user.id, device_id)
      }
      if (u.access) {
        if (Object.keys(u.access).length > 0) console.log('adding', Object.keys(u.access).length, 'access keys')
        for (const key of Object.keys(u.access)) this.user_add_access(user.id, key)
      }
      if (u.friends) {
        if (u.friends.length > 0) console.log('adding', u.friends.length, 'friends')
        for (const friend of u.friends) this.user_add_friend(user.id, friend)
      }

      return this.find_user_by({ email: u.email })
    }
  }

  create_user(u) {
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

