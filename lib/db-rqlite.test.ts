import * as db from '../lib/db-rqlite'

test('connect', () => {
  (new db.Db({})).connect(()=>{})
})

