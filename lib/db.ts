import * as uuid from 'node-uuid'
//import { ulid } from 'ulid'
import { Db as DbDriver } from './db-lmdb'
import * as noun from './nouns'

export class Db extends DbDriver {

  new_id() {
    return uuid.v4()
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
        recording_frequency: a.frequency ? parseFloat(a.frequency) * 60 : undefined,
        source: a.source || null
      }
      let result = this.save(thing)
    }
    return { errors: 0 }
  }

  activity_count_user(noun, user_id, start, stop) {
    return {}
  }

  activity_count(noun, start, stop) {
    let kvs = this.getIdxBetween(noun, 'date', [start], [stop])
    let nouns = Object.keys(kvs)
    let lastseen = {}
    for (const id of nouns) {
      let key = id.split(this.keySeperator).pop()
      let location = this.loadFile(key)
      let user = this.loadFile(location.user_id)
      let previous = lastseen[user.username] || 0
      lastseen[user.username] = previous + 1
    }
    let users = Object.keys(lastseen)
    let u_avg = Math.floor(nouns.length / users.length)
    let u_dev = Math.floor(standardDeviation(Object.keys(lastseen).map(k => lastseen[k])))
    return {
      type: noun, start: start, stop: stop, user_count: users.length,
      user_avg: u_avg, user_stddev: u_dev, count: nouns.length
    }
  }

  activity_last_date() {
    let key = this.getLastKey('location', 'date')
    console.log('activity_last_date', key)
    return key ? key.split(this.keySeperator).shift() : null
  }

  activity_last_date_user(user) {
    let key = this.getLastKey('location', 'date')
    console.log('activity_last_date', key)
    return key ? key.split(this.keySeperator).shift() : null
  }

  async find_user_id_by(e: { [key: string]: any }) {
    console.log('find_user_id_by', e)
    let index, key
    if (e.email_downcase || e.email) {
      index = 'email'
      key = (e.email_downcase || e.email).toLowerCase()
    }
    if (e.username) {
      index = 'username'
      key = e.username
    }
    if (e.id) {
      index = 'id'
      key = e.id
    }
    let user_id = this.get('user', index, key)
    if (user_id) {
      return user_id
    } else {
      throw "find_user_id_by index '" + index + "' key not found: " + key
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
    let access = access_data.reduce((m, kv) => {
      let scope = kv['level'] || 'read'
      let rec: any = {
        created_at: kv['created_at'],
        scopes: [scope]
      }
      if (kv['expires_at']) rec.expires_at = kv['expires_at']
      m[kv['key']] = rec
      return m
    }, {})
    return access
  }

  findAccess(key) {
    var key = this.get('access', 'key', key)
    if (key) return this.loadFile(key)
  }

  async user_add_access(user_id, key, value) {
    console.log('user_add_access', user_id, key, value)
    let access: noun.Access = {
      id: this.new_id(),
      type: "access",
      created_at: new Date(value.created_at).toISOString(),
      expires_at: value.expires_at ? new Date(value.expires_at).toISOString() : undefined,
      user_id: user_id,
      key: key,
      level: value.scopes[0]
    }
    console.log('user_add_access ', JSON.stringify(access))
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
      return await this.find_user_id_by({ email_downcase: u.email })
    } catch (e) {
      // not found
      console.log('ensure_user creating', u.email, u.id)
      this.create_user(u)
      let user: noun.User = await this.find_user_id_by({ email_downcase: u.email.toLowerCase() }).then(this.get_user.bind(this))
      if (u.devices) {
        if (u.devices.length > 0) console.log('adding', u.devices.length, 'devices')
        for (const device_id of u.devices) this.user_add_device(user.id, device_id)
      }
      if (u.access) {
        if (Object.keys(u.access).length > 0) console.log('adding', Object.keys(u.access).length, 'access keys')
        for (const key of Object.keys(u.access)) this.user_add_access(user.id, key, u.access[key])
      }
      if (u.friends) {
        if (u.friends.length > 0) console.log('adding', u.friends.length, 'friends')
        for (const friend of u.friends) this.user_add_friend(user.id, friend)
      }

      return this.find_user_id_by({ email: u.email }).then(this.get_user.bind(this))
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
    let user = this.loadFile(user_id)
    console.log('get_user', user_id, user.username)
    let full_user: any = {
      id: user.id,
      email: user.email,
      username: user.username,
      created_at: user.created_at,
    }
    full_user.devices = this.user_load_devices(full_user.id)
    full_user.friends = this.user_load_friends(full_user.id)
    full_user.access = this.user_load_access(full_user.id)
    full_user.latest = this.user_latest_location(user_id)
    return full_user
  }

  user_latest_location(user_id) {
    // last pt
    let start = new Date("2008-08-01").toISOString()
    let stop = new Date().toISOString()
    let kvs = this.getIdxBetween('location', 'user_id_date', [user_id, start],
      [user_id, stop], 1, true)
    let location_keys = Object.keys(kvs)
    if (location_keys.length == 1) {
      return kvs[location_keys[0]]
    }
  }

  user_location_stats(user_id: string) {
    let start = new Date("2008-08-01").toISOString()
    let stop = new Date().toISOString()
    let kvs = this.getIdxBetween('location', 'user_id_date',
      [user_id, start],
      [user_id, stop], undefined, true)
    let kvs_length = Object.keys(kvs).length
    let stats: any = { count: kvs_length }
    if (kvs_length > 0) {
      let first = this.loadFile(kvs[Object.keys(kvs)[0]])
      let last = this.loadFile(kvs[Object.keys(kvs)[kvs_length - 1]])
      stats.first_date = first.date
      stats.last_date = last.date
    }
    return stats
  }

  async friending_me(user_id: string) {
    let kvs = this.getIdxBetween('friendship', 'friend_id_user_id', [user_id], [user_id])
    let friend_ids = Object.keys(kvs).map(k => k.split(this.keySeperator).pop())
    return friend_ids
  }

  async device_list(user_id) {
    let kvs = this.getIdxBetween('device', 'user_id_did', [user_id], [user_id])
    let values = Object.keys(kvs).map(k => this.loadFile(kvs[k]))
    return { toArray: () => Promise.resolve(values) } // quack like rethinkdb
  }

  async device_add(device) {
    device.type = 'device'
    this.save(device)
    return { inserted: 1 } // quack like rethinkdb
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
    this.fence_add(fence)
  }

  async fence_get(id) {
    return this.loadFile(id)
  }

  async fence_del(id) {
    this.del(id)
  }

  async fences_intersect(point) {
    return { toArray: () => Promise.resolve([]) } // quack like rethinkdb
  }

  async rule_add(rule) {
    rule.type = 'rule'
    this.save(rule)
  }

  async rule_get(rule_id) {
    return this.loadFile(rule_id)
  }

  async rule_del(rule_id) {
    return this.del(rule_id)
  }

  async rule_list(user_id) {
    let kvs = this.getIdxBetween('rule', 'user_id_id', [user_id], [user_id])
    let values = Object.keys(kvs).map(k => this.loadFile(kvs[k]))
    return { toArray: () => Promise.resolve(values) } // quack like rethinkdb
  }

  async rule_list_by_fence(fence_id) {
    let kvs = this.getIdxBetween('rule', 'fence_id_id', [fence_id], [fence_id])
    let values = Object.keys(kvs).map(k => this.loadFile(kvs[k]))
    return { toArray: () => Promise.resolve(values) } // quack like rethinkdb
  }

  async update_user_latest(user_id: string, latest) {
    console.log('update_user_latest[noop]', user_id, latest)
  }

  async update_user_by(user_id, params) {
    let user = this.loadFile(user_id)
    if (params.username) {
      console.log('updating user', user_id, 'username', params.username)
      user.username = params.username
    }
    this.save(user)
  }

  async update_user_access(user_id, access) {
    // rethink holdover, remove previous accesses
    let kvs = this.getIdxBetween('access', 'user_id_key', [user_id], [user_id])
    Object.keys(kvs).map(k => this.del(kvs[k]))
    for (const key of Object.keys(access)) {
      this.user_add_access(user_id, key, access[key])
    }
  }

  async find_locations(start, stop, count: number, desc: boolean) {
    let kvs = this.getIdxBetween('location', 'date', [start],
      [stop], count, desc)
    return Object.keys(kvs).map(k => {
      let key = k.split(this.keySeperator).pop()
      return this.loadFile(key)
    })
  }

  async find_locations_for(user_id: string, start, stop, count: number, type: string, order: string) {
    let desc = order == "newest" ? true : false
    if (typeof start != "string") start = start.toISOString()
    if (typeof stop != "string") stop = stop.toISOString()

    let kvs = this.getIdxBetween('location', 'user_id_date', [user_id, start],
      [user_id, stop], count, desc)
    return Object.keys(kvs).map(k => {
      return this.loadFile(kvs[k])
    })
  }
}

function standardDeviation(values) {
  var avg = average(values);

  var squareDiffs = values.map(function(value) {
    var diff = value - avg;
    var sqrDiff = diff * diff;
    return sqrDiff;
  });

  var avgSquareDiff = average(squareDiffs);

  var stdDev = Math.sqrt(avgSquareDiff);
  return stdDev;
}

function average(data) {
  var sum = data.reduce(function(sum, value) {
    return sum + value;
  }, 0);

  var avg = sum / data.length;
  return avg;
}
