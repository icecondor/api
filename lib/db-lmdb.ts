import * as fs from 'fs'
import * as path from 'path'
// import * as levelup from 'levelup'
// import * as lmdb from 'zetta-lmdb'
import * as lmdb from 'node-lmdb'
import * as mkdirp from 'mkdirp'
import * as filewalker from 'filewalker'

import { Db as DbBase } from './db'
import * as noun from './nouns'

let db_name = 'icecondor'
let schema = {
  'user': {
    indexes: [
      ['username', ['username'], {unique: true, lowercase: true}],
      ['email', ['email'], {unique: true, lowercase: true}]
      //['friends', ['friends'], { multi: true }]
    ]
  },
  'device': {
    indexes: [
      ['user_id_did', ['user_id', 'device_id'], {}]
    ]
  },
  'friendship': {
    indexes: [['user_id_friend_id', ['user_id', 'friend_user_id'], {}]]
  },
  'access': {
    indexes: [['user_id_key', ['user_id', 'key'], {}]]
  },
  'heartbeat': {
    indexes: [['user_id_id', ['user_id', 'id'], {}]]
  },
  'config': {
    indexes: [['user_id_id', ['user_id', 'id'], {}]]
  },
  'location': {
    indexes: [
      ['date', ['date'], {}],
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
  onChange: any

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
    this.onChange = onChange
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
    let ramtotal = 0
    for(const dbName in this.db) {
      let db = this.db[dbName]
      var txn = this.api.beginTxn()
      let stat = db.stat(txn)
      txn.commit()
      let ram = stat.pageSize*(stat.treeBranchPageCount+stat.treeLeafPageCount)
      ramtotal += ram
      console.log('index', dbName, stat.entryCount, 'entries', (ram/1024/1024).toFixed(1)+'mb',
                     (ram/stat.entryCount).toFixed(0), 'b/each')
    }
    console.log('ram total', (ramtotal/1024/1024).toFixed(1), 'MB')
  }

  syncIndexes() {
    console.log('** Sync walk begin')
    let groupSize = 1000
    let fileCount = 0
    let now = new Date()
    let that = this // this get munged in filewalker
    filewalker(this.settings.path)
      .on('file', function(filename, s) {
        console.log('file: %s, %d bytes', filename, s.size);
        fileCount += 1
        if(fileCount % groupSize == 0) {
          let elapsed = (new Date).getTime() - now.getTime()
          console.log('** Sync walk', (groupSize/(elapsed/1000)).toFixed(0), 'rows/sec')
          fileCount = 0
          now = new Date()
        }
        let value = that.loadFile(filename)
        that.saveIndexes(value)
      })
      .on('error', function(err) {
        console.error(err);
      })
      .on('done', function() {
        console.log('%d dirs, %d files, %d bytes', this.dirs, this.files, this.bytes);
      })
    .walk();
  }

  dbName(typeName, indexName) { return typeName+'.'+indexName }

  save(value) {
    this.saveFile(value)
    this.saveIndexes(value)
  }

  saveIndexes(value) {
    let typeName = value.type
    let scheme = schema[typeName]
    if (scheme) {
      let indexes = scheme.indexes
      for (const index of indexes) {
        this.put(typeName, index[0], value)
      }
    } else {
      console.log('warning: no schema for', value.type, value.id)
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
          if (exists != value.id) {
            throw "type "+typeName+" index "+index[0]+" key "+key+" is "+exists+" (should be"+value.id+")"
          }
        }
      }
      var txn = this.api.beginTxn()
      //console.log('PUT', dbname, key, '->', value.id)
      txn.putString(this.db[dbname], key, value.id)
      txn.commit()
      if (this.onChange) this.onChange({index: dbname, key: key, new_val: value})
      return value.id
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
      //console.log('GET', dbname, key, '->', id)
      txn.commit()
    }
    return id
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
    let startkeyList = Array.isArray(start) ? start: [start]
    let startKey = startkeyList.join(':')
    let endkeyList = Array.isArray(end) ? end : [end]
    let endKey = endkeyList.join(':')

    let dbname = this.dbName(typeName, indexName)
    let db = this.db[dbname]
    let txn = this.api.beginTxn()
    let cursor = new lmdb.Cursor(txn, db)

    let kvs = {}
    let schemakeyList = schema[typeName].indexes.filter(i => {return i[0] == indexName})[0][1]
    if(endkeyList.length < schemakeyList.length) {
      if(order) {
        throw "descending order not available for prefix match"
      } else {
        this.idxPrefixMatch(kvs, startKey, endKey, count, txn, cursor, db)
      }
    } else {
      this.idxKeyCompare(kvs, startKey, endKey, count, txn, cursor, db, order)
    }
    cursor.close()
    txn.commit()
    console.log('getIdxBetween', typeName, 'endkeyList', endkeyList, 'schemakeyList', schemakeyList,
                 endkeyList.length < schemakeyList.length ? "idxPrefixMatch" : "idxKeyCompare",
                 Object.keys(kvs).length, 'found')
    return kvs
  }

  idxPrefixMatch(kvs, startKey, endKey, count, txn, cursor, db) {
    let nextKey = cursor.goToRange(startKey)
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

  idxKeyCompare(kvs, startKey, endKey, count, txn, cursor, db, descending) {
    let nextKey = cursor.goToRange(startKey)
    console.log('idxKeycompare startKey', startKey, 'nextKey', nextKey)
    if(descending) {
      console.log('idxKeycompare reverse first key attempt', endKey)
      // simulate goToRange in reverse
      nextKey = cursor.goToKey(endKey)
      if(!nextKey) {
        nextKey = cursor.goToPrev()
        console.log('idxKeycompare reverse first key attempt failed. Prev is', nextKey)
      }
    }
    while (nextKey !== null) {
      if(descending ? nextKey >= startKey : nextKey <= endKey) {
        kvs[nextKey] = txn.getString(db, nextKey)
        nextKey = descending ? cursor.goToPrev() : cursor.goToNext()
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
      return key_parts.map(part => index[2].lowercase ? part.toLowerCase() : part).join(':')
    }
  }

  saveFile(value) {
    var filepath = this.settings.path+'/'+value.id //.replace(/-/g,'/')
    //mkdirp.sync(path.dirname(filepath))
    //console.log('file save', value.type, value.id, filepath)
    fs.writeFileSync(filepath, JSON.stringify(value))
  }

  loadFile(id) {
    var filepath = this.settings.path+'/'+id //.replace(/-/g,'/')
    let json = fs.readFileSync(filepath, 'utf8')
    let data = JSON.parse(json)
    //console.log('file loaded', data.type, filepath)
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
        battery_percentage: a.battery ? a.battery.percentage : null,
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
    let user_id = this.get('user', index, key)
    if (user_id) {
      let user = this.loadFile(user_id)
      let full_user: any = {
        id: user.id,
        email: user.email,
        username: user.username,
        created_at: user.created_at,
      }
      full_user.devices = this.user_load_devices(full_user.id)
      full_user.friends = this.user_load_friends(full_user.id)
      full_user.access = this.user_load_access(full_user.id)
      return full_user
    } else {
      throw "find_user_by reject "+index+" "+key
    }
  }

  user_load_devices(user_id) {
    let kvs = this.getIdxBetween('device', 'user_id_did', [user_id], [user_id])
    let device_ids = Object.keys(kvs).map(k => k.split(':').pop())
    return device_ids
  }

  user_load_friends(user_id) {
    let kvs = this.getIdxBetween('friendship', 'user_id_friend_id', [user_id], [user_id])
    let friend_ids = Object.keys(kvs).map(k => k.split(':').pop())
    return friend_ids
  }

  user_load_access(user_id) {
    let kvs = this.getIdxBetween('access', 'user_id_key', [user_id], [user_id])
    let access_data = Object.keys(kvs).map(k => this.loadFile(kvs[k]))
    let access = access_data.reduce((m,kv) => {m[kv['key']] = {created_at: kv['created_at'], scopes: ['read']}; return m}, {})
    return access
  }

  async user_add_access(user_id, key, value) {
    console.log('user_add_access', user_id, key, value)
    let access: noun.Access = {
      id: this.new_id(),
      type: "access",
      created_at: new Date(value.created_at).toISOString(),
      expires_at: value.expires_at ? new Date(value.expires_at).toISOString() : null,
      user_id: user_id,
      key: key
    }
    console.log('user_add_access =', access)
    this.save(access)
    return this.user_find_access(user_id, key)
  }

  async user_find_access(user_id, key) {
  }

  async user_add_friend(user_id, friend_id) {
    let friendship: noun.Friendship = {
      id: this.new_id(),
      type: "friendship",
      user_id: user_id,
      friend_user_id: friend_id,
      created_at: new Date().toISOString()
    }
    this.save(friendship)
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
        for (const key of Object.keys(u.access)) this.user_add_access(user.id, key, u.access[key])
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

  async find_locations_for(user_id: string, start, stop, count:number, type:string, order:string) {
    let desc = order == "newest" ? true : false
    console.log('getIdxBetween', 'start', typeof start, 'stop', typeof stop)
    if(typeof start != "string") start = start.toISOString()
    if(typeof stop != "string") stop = stop.toISOString()
    console.log('getIdxBetween', 'start', typeof start, 'stop', typeof stop)

    let kvs = this.getIdxBetween('location', 'user_id_date', [user_id, start],
                                                             [user_id, stop], count, desc)
    return Object.keys(kvs).map(k => {
      return this.loadFile(kvs[k])
    })
  }
}

