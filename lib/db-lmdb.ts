import * as fs from 'fs'
import * as path from 'path'
// import * as levelup from 'levelup'
// import * as lmdb from 'zetta-lmdb'
import * as lmdb from 'node-lmdb'
import * as mkdirp from 'mkdirp'
import * as Reader from 'native-readdir-stream'

import { Db as DbBase } from './db'
import * as noun from './nouns'

let db_name = 'icecondor'
let schema = {
  'user': {
    indexes: [
      ['username', ['username'], {unique: true, lowercase: true}],
      ['email', ['email'], {unique: true, lowercase: true}]
    ]
  },
  'device': {
    indexes: [
      ['user_id_did', ['user_id', 'device_id'], {}]
    ]
  },
  'friendship': {
    indexes: [
      ['user_id_friend_id', ['user_id', 'friend_user_id'], {}],
      ['friend_id_user_id', ['friend_user_id', 'user_id'], {}]
    ]
  },
  'access': {
    indexes: [['user_id_key', ['user_id', 'key'], {}]]
  },
  'heartbeat': {
    indexes: [['user_id', ['user_id'], {multi: true}]]
  },
  'config': {
    indexes: [['user_id_id', ['user_id', 'id'], {}]]
  },
  'location': {
    indexes: [
      ['date', ['date'], {multi: true}],
      ['user_id_date', ['user_id', 'date'], {}]
    ]
  },
  'fence': {
    indexes: [
      ['user_id_id', ['user_id', 'id'], {}]
    ]
  },
  'rule': {
    indexes: [
      ['user_id_id', ['user_id', 'id'], {}]
    ]
  }
}

export class Db extends DbBase {
  api: any
  db: any
  onChange: any
  keySeperator = '/' // - used by uuid, : used by isotime

  mkdir(dir: string) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir)
      console.log('warning: created', dir)
      return true
    }
  }

  async connect(onConnect) {
    this.pathFix(this.settings, 'path')
    this.pathFix(this.settings.lmdb, 'path')
    this.api = new lmdb.Env()
    this.mkdir(this.settings.path)
    let resync = this.mkdir(this.settings.lmdb.path)
    this.api.open(this.settings.lmdb)
    this.db = {}
    await this.ensure_schema(resync)
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

  async ensure_schema(resync: boolean = false) {
    for (const typeName in schema) {
      for (const index of schema[typeName].indexes) {
        let dbname = this.dbName(typeName, index[0])
        if (resync) this.api.openDbi({name: dbname, create: true}).drop()
        this.db[dbname] = this.api.openDbi({name: dbname, create: true})
      }
    }
    if (resync) await this.syncIndexes()
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

  async syncIndexes() {
    console.log('** Sync walk begin on', this.settings.path)
    let groupSize = 1000
    let fileCount = 0
    let fileTotal = 0
    let now = new Date()
    let that = this // this get munged in filewalker

    return new Promise((res, rej) => {
      new Reader(this.settings.path)
      .on('data', function (filename) {
        if(filename == "." || filename == "..") return
        fileCount += 1
        fileTotal += 1
        if(fileCount % groupSize == 0) {
          let elapsed = (new Date).getTime() - now.getTime()
          console.log('** Sync walk', (groupSize/(elapsed/1000)).toFixed(0), 'rows/sec', fileTotal, 'done')
          fileCount = 0
          now = new Date()
        }
        let value = that.loadFile(filename)
        that.saveIndexes(value)
      })
      .once('end', function () {
        console.log('sync end')
        res()
      })
      .once('error', function (error) {
        console.log('!!sync error', error)
        rej(error)
      })
    })
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

  makeKey(index, value) {
    let key_parts
    key_parts = index[1].map(i => value[i])
    if (index[2].multi) key_parts.push(value.id)
    if(key_parts.every(i => i)) {
      return key_parts.map(part => index[2].lowercase ? part.toLowerCase() : part).join(this.keySeperator)
    }
  }

  put(typeName, indexName, record) {
    let index = this.findIndex(typeName, indexName)
    let dbname = this.dbName(typeName, index[0])
    let key = this.makeKey(index, record)
    if (key) {
      var txn = this.api.beginTxn()
      if (index[2].unique) {
        let exists = this.get(typeName, indexName, key)
        if(exists) {
          if (exists != record.id) {
            txn.abort()
            throw "type "+typeName+" index "+index[0]+" key "+key+" is "+exists+" (should be"+record.id+")"
          }
        }
      }
      let value = index[2].multi ? null : record.id
      //console.log('PUT', dbname, key, '->', value)
      txn.putString(this.db[dbname], key, value)
      txn.commit()
      if (this.onChange) this.onChange({index: dbname, key: key, new_val: record})
      return record.id
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
    let value = cursor.goToLast()
    cursor.close()
    txn.commit()
    return value
  }

  getIdxBetween(typeName, indexName, start, end, count?: number, order?: boolean) {
    let startkeyList = Array.isArray(start) ? start: [start]
    let startKey = startkeyList.join(this.keySeperator)
    let endkeyList = Array.isArray(end) ? end : [end]
    let endKey = endkeyList.join(this.keySeperator)

    let dbname = this.dbName(typeName, indexName)
    let db = this.db[dbname]
    let txn = this.api.beginTxn()
    let cursor = new lmdb.Cursor(txn, db)

    let kvs = {}
    let schemakeyList = schema[typeName].indexes.filter(i => {return i[0] == indexName})[0][1]
    if(endkeyList.length < schemakeyList.length) {
      if(order) {
        txn.abort()
        throw "descending order not available for prefix match"
      } else {
        this.idxPrefixMatch(kvs, startKey, endKey, count, txn, cursor, db)
      }
    } else {
      this.idxKeyCompare(kvs, startKey, endKey, count, txn, cursor, db, order)
    }
    cursor.close()
    txn.commit()
    console.log('getIdxBetween', typeName, schemakeyList, startkeyList, '<->', endkeyList,
                 endkeyList.length < schemakeyList.length ? "idxPrefixMatch" : "idxKeyCompare",
                 Object.keys(kvs).length+(count ? '/'+count : ''), 'found')
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
    let key = this.getLast('location', 'date')
    console.log('activity_last_date', key)
    return key ? key.split(this.keySeperator).shift() : null
  }

  async find_user_by(e) {
    console.log('find_user_by', e)
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
      console.log('find_user_by', e, 'DONE')
      return full_user
    } else {
      throw "find_user_by reject "+index+" "+key
    }
  }

  user_load_devices(user_id) {
    let kvs = this.getIdxBetween('device', 'user_id_did', [user_id], [user_id])
    let device_ids = Object.keys(kvs).map(k => k.split(this.keySeperator).pop())
    return device_ids
  }

  user_load_friends(user_id) {
    let kvs = this.getIdxBetween('friendship', 'user_id_friend_id', [user_id], [user_id])
    let friend_ids = Object.keys(kvs).map(k => k.split(this.keySeperator).pop())
    return friend_ids
  }

  user_load_access(user_id) {
    let kvs = this.getIdxBetween('access', 'user_id_key', [user_id], [user_id])
    let access_data = Object.keys(kvs).map(k => this.loadFile(kvs[k]))
    let access = access_data.reduce((m,kv) => {
      let rec: any = {created_at: kv['created_at'],
                 scopes: ['read']}
      if(kv['expires_at']) rec.expires_at = kv['expires_at']
      m[kv['key']] = rec
      return m
    }, {})
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
    let user = await this.find_user_by({ id: user_id })
    let start = new Date("2008-08-01").toISOString()
    let stop = new Date().toISOString()
    let kvs = this.getIdxBetween('location', 'user_id_date', [user_id, start],
                                                             [user_id, stop], 2, true)
    let location_keys = Object.keys(kvs)
    if(location_keys.length == 2) {
      user.latest = { location_id: kvs[location_keys[1]]}
    }
    return user
  }

  async friending_me(user_id: string) {
    let kvs = this.getIdxBetween('friendship', 'friend_id_user_id', [user_id], [user_id])
    let friend_ids = Object.keys(kvs).map(k => k.split(this.keySeperator).pop())
    return friend_ids
  }

  async fence_list(user_id) {
    let kvs = this.getIdxBetween('fence', 'user_id_id', [user_id], [user_id])
    let values = Object.keys(kvs).map(k => this.loadFile(kvs[k]))
    return { toArray: () => Promise.resolve(values) } // quack like rethinkdb
  }

  async fence_add(fence) {
    // fence.id = uuid.v4().substr(0, 18)
    // fence.created_at = new Date()
    // fence.name = msg.params.name
    // fence.user_id = client.flags.authenticated.user_id
    fence.type = 'fence'
    this.save(fence)
    return { inserted: 1 } // quack like rethinkdb
  }

  async fence_update(fence) {
    // name, geojson, area
  }

  async fence_get(id) {
    return this.loadFile(id)
  }

  async fences_intersect(point) {
    return { toArray: () => Promise.resolve([]) } // quack like rethinkdb
  }

  async rule_add(rule) {
    rule.type = 'rule'
    this.save(rule)
  }

  async rule_list(user_id) {
    let kvs = this.getIdxBetween('rule', 'user_id_id', [user_id], [user_id])
    let values = Object.keys(kvs).map(k => this.loadFile(kvs[k]))
    return { toArray: () => Promise.resolve(values) } // quack like rethinkdb
  }

  async update_user_latest(user_id: string, latest) {
    console.log('update_user_latest[noop]', user_id, latest)
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

  async find_locations(start, stop, count:number, desc: boolean) {
    let kvs = this.getIdxBetween('location', 'date', [start],
                                                     [stop], count, desc)
    return Object.keys(kvs).map(k => {
      let key = k.split(this.keySeperator).pop()
      return this.loadFile(key)
    })
  }

  async find_locations_for(user_id: string, start, stop, count:number, type:string, order:string) {
    let desc = order == "newest" ? true : false
    if(typeof start != "string") start = start.toISOString()
    if(typeof stop != "string") stop = stop.toISOString()

    let kvs = this.getIdxBetween('location', 'user_id_date', [user_id, start],
                                                             [user_id, stop], count, desc)
    return Object.keys(kvs).map(k => {
      return this.loadFile(kvs[k])
    })
  }
}

