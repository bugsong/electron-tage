// 验证 better-sqlite3-multiple-ciphers 在 Electron 运行时能否加载（ABI 兼容性检查）
const { app } = require('electron')

app.whenReady().then(() => {
  try {
    const db = require('better-sqlite3-multiple-ciphers')(':memory:')
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, data BLOB)')
    const buf = Buffer.from([1, 2, 3, 4, 5])
    db.prepare('INSERT INTO t (data) VALUES (?)').run(buf)
    const r = db.prepare('SELECT data FROM t WHERE id=1').get()
    console.log('ELECTRON_BETTER_SQLITE3_OK roundtrip=' + (Buffer.compare(r.data, buf) === 0))
    db.close()
  } catch (err) {
    console.error('ELECTRON_BETTER_SQLITE3_FAIL ' + (err && err.message ? err.message : String(err)))
    process.exitCode = 1
  } finally {
    app.exit(process.exitCode || 0)
  }
})
