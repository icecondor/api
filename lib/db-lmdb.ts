import * as fs from 'fs'
import * as path from 'path'
// import * as levelup from 'levelup'
import * as lmdb from 'node-lmdb'
import * as mkdirp from 'mkdirp'

let schema = {
  'user': {
    indexes: [
      ['username', ['username'], { unique: true, lowercase: true }],
      ['email', ['email'], { unique: true, lowercase: true }]
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
    indexes: [
      ['key', ['key'], { unique: true }],
      ['user_id_key', ['user_id', 'key'], { unique: true }]
    ]
  },
  'heartbeat': {
    indexes: [['user_id', ['user_id'], { multi: true }]]
  },
  'config': {
    indexes: [['user_id_id', ['user_id', 'id'], {}]]
  },
  'location': {
    indexes: [
      ['date', ['date'], { multi: true }],
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
      ['user_id_id', ['user_id', 'id'], {}],
      ['fence_id_id', ['fence_id', 'id'], {}]
    ]
  }
}

export class Db {
  api: any
  settings: any
  db: any
  onChange: any
  keySeperator = '/' // - used by uuid, : used by isotime

  constructor(settings: any) {
    this.settings = settings
  }

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
    if (longpath != spath) {
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
        let mdb = this.ensure_index(dbname, resync)
        this.db[dbname] = mdb
      }
    }
    if (resync) await this.syncIndexes()
  }

  ensure_index(dbname, resync) {
    let mdb
    try {
      mdb = this.api.openDbi({ name: dbname })
      if (resync) {
        console.log("** ensure schema dropping index", dbname)
        mdb.drop()
        throw "create"
      }
    } catch (e) {
      console.log('** ensure schema creating index', dbname)
      mdb = this.api.openDbi({ name: dbname, create: true })
    }
    return mdb
  }

  async schema_dump() {
    let ramtotal = 0
    for (const dbName in this.db) {
      let db = this.db[dbName]
      var txn = this.api.beginTxn()
      let stat = db.stat(txn)
      txn.commit()
      let ram = stat.pageSize * (stat.treeBranchPageCount + stat.treeLeafPageCount)
      ramtotal += ram
      console.log('index', dbName, stat.entryCount, 'entries', (ram / 1024 / 1024).toFixed(1) + 'mb',
        (ram / stat.entryCount).toFixed(0), 'b/each')
    }
    console.log('ram total', (ramtotal / 1024 / 1024).toFixed(1), 'MB')
  }

  async syncIndexes(typeName?: string) {
    console.log('** Sync walk begin on', this.settings.path, typeName ? "for type " + typeName : "for all types")
    let groupSize = 1000
    let fileCount = 0
    let fileTotal = 0
    let hitCount = 0
    let now = new Date()
    let that = this // this get munged in filewalker

    let dir = await fs.promises.opendir(this.settings.path)
    for await (const dirent of dir) {
      if (dirent.name == "." || dirent.name == "..") return
      fileCount += 1
      fileTotal += 1
      if (fileCount % groupSize == 0) {
        let elapsed = (new Date).getTime() - now.getTime()
        console.log('** Sync walk reading', (groupSize / (elapsed / 1000)).toFixed(0), 'rows/sec of',
          fileTotal, 'read so far', (typeName ? "with " + hitCount + " " + typeName : ''))
        fileCount = 0
        hitCount = 0
        now = new Date()
      }
      let value = that.loadFile(dirent.name)
      if (!typeName || (typeName && value.type === typeName)) {
        that.saveIndexes(value)
        hitCount += 1
      }
    }
    let durationSeconds = (new Date().getTime() - now.getTime()) / 1000
    console.log('** Sync walk end', (durationSeconds / 60).toFixed(1), 'minutes')
  }

  dbName(typeName, indexName) { return typeName + '.' + indexName }

  save(value) {
    this.saveIndexes(value)
    this.saveFile(value)
  }

  del(id) {
    let value = this.loadFile(id)
    this.saveIndexes(value, true)
    this.delFile(value.id)
  }

  saveIndexes(value, del = false) {
    let typeName = value.type
    let scheme = schema[typeName]
    if (scheme) {
      let indexes = scheme.indexes
      for (const index of indexes) {
        this.put(typeName, index[0], value, del)
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
    if (key_parts.every(i => i)) {
      return key_parts.map(part => index[2].lowercase ? part.toLowerCase() : part).join(this.keySeperator)
    }
  }

  put(typeName, indexName, record, del = false) {
    let index = this.findIndex(typeName, indexName)
    let dbname = this.dbName(typeName, index[0])
    let key = this.makeKey(index, record)
    if (key) {
      var txn = this.api.beginTxn()
      if (index[2].unique) {
        let exists = this.get(typeName, indexName, key)
        if (exists) {
          if (exists != record.id) {
            txn.abort()
            throw "unique constraint failed on " + dbname + " writing key/id: " + key + '/' + record.id + " collided with id" + exists
          }
        }
      }
      if (del) {
        //console.log('DEL', dbname, key)
        if (index[2].multi) {
          // TODO
        } else {
          txn.del(this.db[dbname], key)
        }
      } else {
        let value = index[2].multi ? null : record.id
        //console.log('PUT', dbname, key, '->', value)
        txn.putString(this.db[dbname], key, value)
      }
      txn.commit()
      if (this.onChange) this.onChange({ index: dbname, key: key, new_val: record })
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
      var txn = this.api.beginTxn({ readOnly: true })
      id = txn.getString(this.db[dbname], key)
      //console.log('GET', dbname, key, '->', id)
      txn.commit()
    }
    return id
  }

  getLastKey(typeName, indexName) {
    let dbname = this.dbName(typeName, indexName)
    let txn = this.api.beginTxn()
    let cursor = new lmdb.Cursor(txn, this.db[dbname])
    let value = cursor.goToLast()
    cursor.close()
    txn.commit()
    return value
  }

  getIdxBetween(typeName, indexName, start, end, count?: number, order?: boolean) {
    let index = this.findIndex(typeName, indexName)
    let startkeyList = Array.isArray(start) ? start : [start]
    let startKey = startkeyList.join(this.keySeperator)
    let endkeyList = Array.isArray(end) ? end : [end]
    let endKey = endkeyList.join(this.keySeperator)

    let dbname = this.dbName(typeName, indexName)
    let db = this.db[dbname]
    let txn = this.api.beginTxn()
    let cursor = new lmdb.Cursor(txn, db)

    let kvs = {}
    let schemakeyList = index[1]
    if (endkeyList.length < schemakeyList.length) {
      if (order) {
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
      Object.keys(kvs).length + (count ? '/' + count : ''), 'found')
    return kvs
  }

  idxPrefixMatch(kvs, startKey, endKey, count, txn, cursor, db) {
    let nextKey = cursor.goToRange(startKey)
    while (nextKey !== null) {
      if (endKey == nextKey.substr(0, endKey.length)) {
        kvs[nextKey] = txn.getString(db, nextKey)
        nextKey = cursor.goToNext()
      } else {
        nextKey = null
      }
      if (count && Object.keys(kvs).length == count) nextKey = null
    }
  }

  idxKeyCompare(kvs, startKey, endKey, count, txn, cursor, db, descending) {
    let nextKey = cursor.goToRange(startKey)
    console.log('idxKeycompare startKey', startKey, 'nextKey', nextKey)
    if (descending) {
      console.log('idxKeycompare reverse first key attempt', endKey)
      // simulate goToRange in reverse
      nextKey = cursor.goToKey(endKey)
      if (!nextKey) {
        nextKey = cursor.goToPrev()
        console.log('idxKeycompare reverse first key attempt failed. Prev is', nextKey)
      }
    }
    while (nextKey !== null) {
      if (descending ? nextKey >= startKey : nextKey <= endKey) {
        kvs[nextKey] = txn.getString(db, nextKey)
        nextKey = descending ? cursor.goToPrev() : cursor.goToNext()
      } else {
        nextKey = null
      }
      if (count && Object.keys(kvs).length == count) nextKey = null
    }
  }

  idToFilepath(id: string): string {
    return this.settings.path + '/' + id
  }

  serialize(value: any): string {
    return JSON.stringify(value)
  }

  deserialize(blob: string): any {
    return JSON.parse(blob)
  }

  saveFile(value) {
    var filepath = this.idToFilepath(value.id)
    fs.writeFileSync(filepath, this.serialize(value))
  }

  delFile(id) {
    var filepath = this.idToFilepath(id)
    fs.unlinkSync(filepath)
  }

  loadFile(id) {
    var filepath = this.idToFilepath(id)
    let json = fs.readFileSync(filepath, 'utf8')
    let data = this.deserialize(json)
    return data
  }

}