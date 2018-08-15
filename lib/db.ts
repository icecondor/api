import { ulid } from 'ulid'

export abstract class Db {
  settings: any

  abstract connect(onConnect: Function)
  abstract changes(onChange: Function)

  constructor(settings: any) {
    this.settings = settings
  }

  new_id(tableName: string) {
    return (tableName+'-'+ulid()).toLowerCase()
  }
}