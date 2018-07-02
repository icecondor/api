export interface Db {
  connect(onConnect: Function)
  changes(onChange: Function)
}