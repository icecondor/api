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
      ['username', ['username'], {unique: true}],
      ['email', ['email'], {unique: true}]
      //['friends', ['friends'], { multi: true }]
    ]
  },
  'device': {
    indexes: [
      ['idid_date', ['user_id', 'device_id'], {}]
    ]
  },
  'heartbeat': {
    indexes: []
  },
  'location': {
    indexes: [
      ['date', ['date'], {}],
      ['user_id', ['user_id'], {}],
      ['user_id_date', ['user_id', 'date'], {}]
    ]
  },
  'fence': {
    indexes: [
      ['user_id', ['user_id'], {}],
      ['geojson', ['geojson'], { geo: true }]]
  },
  'rule': {
    indexes: [
      ['user_id', ['user_id'], {}],
      ['fence_id', ['fence_id'], {}],
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
      return true
    }
  }

  connect(onConnect) {
    this.pathFix(this.settings, 'path')
    this.pathFix(this.settings.lmdb, 'path')
    this.api = new lmdb.Env()
    this.mkdir(this.settings.path)
    let resync = this.mkdir(this.settings.lmdb.path)
    this.api.open(this.settings.lmdb)
    this.db = {}
    this.ensure_schema(resync)
    return onConnect()
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
        let dbname = this.dbName(typeName, index[0])
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


  syncIndexes() {
    walk.filesSync(this.settings.path, (dir, filename, stat) => {
      let p1 = dir.substr(this.settings.path.length+1)
      let id = p1.replace(/\//g, '-')+'-'+filename
      let value = this.loadFile(id)
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
        this.put(typeName, index[0], value)
      }
    } else {
      console.log('warning: no indexes defined for', value.type)
    }
  }

  findIndex(typeName, indexName) {
    var indexes = schema[typeName].indexes
    if (indexes) {
      for (const index of indexes) {
        if (index[0] == indexName) return index
      }
    }
  }

  put(typeName, indexName, value) {
    let index = this.findIndex(typeName, indexName)
    let dbname = this.dbName(typeName, index[0])
    let key = this.makeKey(index, value)
    if (key) {
      if (index[2].unique) {
        let exists = this.get(typeName, indexName, key)
        if(exists) {
          throw "type "+typeName+" index "+index[0]+" exists for "+key
        }
      }
      var txn = this.api.beginTxn()
      console.log('PUT', dbname, key, '->', value.id)
      txn.putString(this.db[dbname], key, value.id)
      txn.commit()
    } else {
      console.log('Warning: key generation failed for index', dbname)
    }
  }

  get(typeName, indexName, key) {
    let id
    if (indexName == 'id') {
      id = key
    } else {
      let dbname = this.dbName(typeName, indexName)
      var txn = this.api.beginTxn()
      id = txn.getString(this.db[dbname], key)
      console.log('GET', dbname, key, '->', id)
      txn.commit()
    }

    if(id) {
      return this.loadFile(id)
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

  getIdxBetween(typeName, indexName, start, end, count?: number, order?: boolean) {
    let startkeyList = Array.isArray(start) ? [start] : start
    let startkey = startkeyList.join(':')
    let dbname = this.dbName(typeName, indexName)
    let db = this.db[dbname]
    let txn = this.api.beginTxn()
    let cursor = new lmdb.Cursor(txn, db)
    let kvs = {}
    let firstKey = cursor.goToRange(startkey)
    if(firstKey != null) {
      let endkeyList = Array.isArray(end) ? [end] : end
      let endKey = endkeyList.join(':')
      let schemakeyList = schema[typeName].indexes.filter(i => {return i[0] == indexName})[0][1]
      console.log('getIdxBetween comparison', 'endkeyList', endkeyList, 'schemakeyList', schemakeyList,
                   endkeyList.length < schemakeyList.length ? "idxPrefixMatch" : "idxKeyCompare")
      if(endkeyList.length < schemakeyList.length) {
        if(order) {
          throw "order not available for prefix match"
        } else {
          this.idxPrefixMatch(kvs, firstKey, endKey, count, txn, cursor, db)
        }
      } else {
        this.idxKeyCompare(kvs, firstKey, endKey, count, txn, cursor, db, order)
      }
    }
    cursor.close()
    txn.commit()
    return kvs
  }

  idxPrefixMatch(kvs, nextKey, endKey, count, txn, cursor, db) {
    while (nextKey !== null) {
      if(endKey == nextKey.substr(0, endKey.length)) {
        kvs[nextKey] = txn.getString(db, nextKey)
        nextKey = cursor.goToNext()
      } else {
        nextKey = null
      }
      if(count && Object.keys(kvs).length == count) nextKey = null
    }
  }

  idxKeyCompare(kvs, nextKey, endKey, count, txn, cursor, db, order) {
    while (nextKey !== null) {
      if(nextKey <= endKey) {
        kvs[nextKey] = txn.getString(db, nextKey)
        nextKey = cursor.goToNext()
      } else {
        nextKey = null
      }
      if(count && Object.keys(kvs).length == count) nextKey = null
    }
  }

  makeKey(index, value) {
    let key_parts
    key_parts = index[1].map(i => value[i])
    if(key_parts.every(i => i)) {
      return key_parts.map(part => part.toLowerCase()).join(':')
    }
  }

  saveFile(value) {
    var filepath = this.settings.path+'/'+value.id.replace(/-/g,'/')
    mkdirp.sync(path.dirname(filepath))
    console.log('file save', value.type, value.id, filepath)
    fs.writeFileSync(filepath, JSON.stringify(value))
  }

  loadFile(id) {
    var filepath = this.settings.path+'/'+id.replace(/-/g,'/')
    let json = fs.readFileSync(filepath, 'utf8')
    let data = JSON.parse(json)
    console.log('file load', data.type, filepath)
    return data
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

  async find_user_by(e) {
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
    let kvs = this.getIdxBetween('device', 'idid_date', [user_id], [user_id])
    let device_ids = Object.keys(kvs).map(r => r.split(':').pop())
    return device_ids
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

  async ensure_user(u) {
    try {
      console.log('ensure_user checking', u.email, u.id)
      return await this.find_user_by({ email_downcase: u.email })
    } catch (e) {
      // not found
      console.log('ensure_user creating', u.email, u.id)
      this.create_user(u)
      let user: noun.User = await this.find_user_by({ email_downcase: u.email.toLowerCase() })
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

  async find_locations_for(user_id: string, start:string, stop:string, count:number, type:string, order:string) {
    /*
    let sql = squel.select()
      .from("location")
      .where("user_id = ?", user_id)
      .where("date > ?", start)
      .where("date < ?", stop)
      .order("date", false)
      .limit(count)
    let result = await this.select(sql)
    return locations
    */
    let desc = order == "newest" ? true : false
    console.log('getIdxBetween order', order, desc)

    let kvs = this.getIdxBetween('location', 'user_id_date', [user_id, start],
                                                             [user_id, stop], count, desc)
    return Object.keys(kvs).map(k => {
      return this.get('location', 'id', kvs[k])
    })
  }
}

