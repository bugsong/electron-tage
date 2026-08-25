/**
 * 阶段1测试：数据库依赖层（better-sqlite3）BLOB 能力
 * - 同步 API + BLOB（Buffer）写入/读取往返
 * - 真实 db.js 初始化路径（createSchema/seed/migrate）在 better-sqlite3 下正常
 */
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { freshUserData } = require('./helpers.cjs')

test('better-sqlite3 可加载且为同步 API', () => {
  const Database = require('better-sqlite3')
  const db = new Database(':memory:')
  assert.equal(typeof db.prepare, 'function')
  // 同步执行：直接返回结果，无需 await
  const r = db.prepare('SELECT 1 AS v').get()
  assert.equal(r.v, 1)
  db.close()
})

test('BLOB 写入与读取往返一致', () => {
  const Database = require('better-sqlite3')
  const db = new Database(':memory:')
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, data BLOB)')

  // PNG 文件头等二进制数据
  const pngHead = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])
  db.prepare('INSERT INTO t (data) VALUES (?)').run(pngHead)

  const row = db.prepare('SELECT data FROM t WHERE id = 1').get()
  assert.ok(Buffer.isBuffer(row.data), 'BLOB 应读取为 Buffer')
  assert.equal(row.data.length, pngHead.length)
  assert.ok(Buffer.compare(row.data, pngHead) === 0, '字节内容应完全一致')
  db.close()
})

test('真实 db.js 初始化（createSchema+seed+migrate）在 better-sqlite3 下正常，且支持 BLOB', () => {
  freshUserData()
  const { initDb, getDb } = require('../src/main/db')
  initDb()
  const db = getDb()

  // 分类表已建好（seedIfEmpty 执行）
  const cats = db.prepare('SELECT COUNT(*) AS c FROM categories').get()
  assert.ok(cats.c > 0, '分类应已初始化')

  // BLOB 列往返：建一张 images 风格的表验证（阶段3会正式建表，这里仅验证驱动能力）
  db.exec('CREATE TABLE IF NOT EXISTS _blob_test (id INTEGER PRIMARY KEY, data BLOB)')
  const bytes = Buffer.from(Array.from({ length: 64 }, (_, i) => i))
  db.prepare('INSERT INTO _blob_test (data) VALUES (?)').run(bytes)
  const back = db.prepare('SELECT data FROM _blob_test WHERE id = 1').get()
  assert.ok(Buffer.compare(back.data, bytes) === 0, '真实 db.js 实例 BLOB 往返应一致')
  db.exec('DROP TABLE _blob_test')
  db.close()
})

test('migrateCategorySchema 幂等（二次初始化不破坏结构）', () => {
  freshUserData()
  const { initDb, getDb } = require('../src/main/db')
  initDb()
  initDb() // 第二次
  const db = getDb()
  const politics = db.prepare("SELECT id FROM categories WHERE name = '政治理论' AND parent_id IS NULL").get()
  assert.ok(politics, '政治理论顶级分类应存在')
  const kids = db.prepare('SELECT COUNT(*) AS c FROM categories WHERE parent_id = ?').get(politics.id)
  assert.equal(kids.c, 4, '政治理论应有 4 个子分类（新思想/时事政治/马克思主义/毛中特）')
  db.close()
})

test('数据库文件生成于 userData 目录', () => {
  const dir = freshUserData()
  const { initDb } = require('../src/main/db')
  initDb()
  const dbFile = path.join(dir, 'tage.db')
  assert.ok(fs.existsSync(dbFile), 'tage.db 应存在于 userData 目录')
})
