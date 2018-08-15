export interface Db {
  connect(onConnect: Function, onFail: Function)
  changes(onChange: Function)
}