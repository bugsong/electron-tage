const fs = require('node:fs')
const p = 'C:/Users/84888/AppData/Local/Temp/comate-e2e-test/tage.db'
if (!fs.existsSync(p)) {
  console.log('no db')
  process.exit(0)
}
const Database = require('better-sqlite3-multiple-ciphers')
const db = new Database(p, { readonly: true })
const row = db.prepare("SELECT value FROM settings WHERE key = 'license.state'").get()
console.log('license.state:', row ? row.value : '(none)')
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name)
console.log('tables:', tables.join(','))
db.close()
