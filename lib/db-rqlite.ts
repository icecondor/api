import * as rqlite from 'rqlite-js'
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
  api: object

  constructor(settings: object) {
  }

  async connect(f) {
    this.api = await rqlite.connect('http://localhost:4001')
  }

  changes() {
  }
}
