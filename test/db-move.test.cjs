/**
 * 数据位置迁移（moveDb）测试
 * - 已有数据库 → 在线备份迁移到新位置：数据完整、路径配置更新、旧文件清理
 * - 目标已存在数据库文件 → need_confirm，force 后覆盖
 * - 当前无数据库 → 新位置自动初始化
 * - 新位置与当前位置相同 → 报错
 */
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { freshUserData } = require('./helpers.cjs')

test('已有数据库迁移到新位置：数据完整、路径更新、旧文件清理', async () => {
  const oldDir = freshUserData()
  const { initDb, getDb, dbPath, moveDb } = require('../src/main/db')
  initDb()
  const db = getDb()

  // 写入一些数据
  const t = Date.now()
  const catId = db.prepare("SELECT id FROM categories WHERE name = '新思想'").get().id
  db.prepare(
    'INSERT INTO questions (category_id, type, stem, options, answer, analysis, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(catId, 'single', '迁移测试题', '["a","b","c","d"]', 'A', '解析', 'manual', t, t)
  db.prepare("INSERT INTO settings (key, value) VALUES ('k1', 'v1')").run()

  const newDir = path.join(oldDir, '..', 'moved-data')
  const res = await moveDb(newDir)
  assert.equal(res.status, 'ok')
  assert.equal(res.action, 'migrate')
  assert.equal(res.newPath, path.join(path.resolve(newDir), 'tage.db'))

  // 路径配置已更新
  assert.equal(dbPath(), path.join(path.resolve(newDir), 'tage.db'))
  // 数据完整
  const db2 = getDb()
  const q = db2.prepare("SELECT * FROM questions WHERE stem = '迁移测试题'").get()
  assert.ok(q, '迁移后题目应存在')
  assert.equal(db2.prepare("SELECT value FROM settings WHERE key = 'k1'").get().value, 'v1')
  // 旧文件已清理、新文件存在
  assert.ok(!fs.existsSync(path.join(oldDir, 'tage.db')), '旧 tage.db 应被清理')
  assert.ok(fs.existsSync(res.newPath), '新位置 tage.db 应存在')
})

test('目标已存在数据库文件：未强制返回 need_confirm，force 后覆盖迁移', async () => {
  const oldDir = freshUserData()
  const { initDb, getDb, dbPath, moveDb } = require('../src/main/db')
  initDb()
  const db = getDb()
  const catId = db.prepare("SELECT id FROM categories WHERE name = '新思想'").get().id
  const t = Date.now()
  db.prepare(
    'INSERT INTO questions (category_id, type, stem, options, answer, analysis, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(catId, 'single', '覆盖测试题', '["a","b","c","d"]', 'B', '', 'manual', t, t)

  // 第一次迁移到 newDirA
  const newDirA = path.join(oldDir, '..', 'moved-a')
  assert.equal((await moveDb(newDirA)).status, 'ok')

  // 在 newDirB 放一个占位数据库文件
  const newDirB = path.join(oldDir, '..', 'moved-b')
  fs.mkdirSync(newDirB, { recursive: true })
  fs.writeFileSync(path.join(newDirB, 'tage.db'), 'placeholder')

  // 未强制 → need_confirm
  const info = await moveDb(newDirB)
  assert.equal(info.status, 'need_confirm')
  assert.ok(info.message && info.message.length > 0)
  assert.equal(dbPath(), path.join(path.resolve(newDirA), 'tage.db'), '确认前路径不应改变')

  // force → 覆盖迁移成功
  const res = await moveDb(newDirB, { force: true })
  assert.equal(res.status, 'ok')
  assert.equal(res.action, 'migrate')
  assert.equal(dbPath(), path.join(path.resolve(newDirB), 'tage.db'))
  const q = getDb().prepare("SELECT * FROM questions WHERE stem = '覆盖测试题'").get()
  assert.ok(q, 'force 覆盖后数据应来自当前库')
})

test('当前无数据库：在新位置自动初始化', async () => {
  const oldDir = freshUserData()
  const { initDb, getDb, dbPath, moveDb } = require('../src/main/db')
  initDb()
  // 模拟“当前没有数据库”：先关闭连接再删除文件（Windows 下需先释放句柄）
  getDb().close()
  fs.rmSync(path.join(oldDir, 'tage.db'), { force: true })
  assert.ok(!fs.existsSync(path.join(oldDir, 'tage.db')))

  const newDir = path.join(oldDir, '..', 'fresh-data')
  const res = await moveDb(newDir)
  assert.equal(res.status, 'ok')
  assert.equal(res.action, 'init')
  assert.equal(dbPath(), path.join(path.resolve(newDir), 'tage.db'))
  assert.ok(fs.existsSync(path.join(path.resolve(newDir), 'tage.db')), '新位置应创建数据库')
  // 新库已完成初始化（种子分类存在）
  const cats = getDb().prepare('SELECT COUNT(*) AS c FROM categories').get()
  assert.ok(cats.c > 0, '新库应完成初始化（种子分类存在）')
})

test('新位置与当前数据库位置相同时报错', async () => {
  freshUserData()
  const { initDb, dbPath, moveDb } = require('../src/main/db')
  initDb()
  const current = path.dirname(dbPath())
  await assert.rejects(moveDb(current), /新位置与当前数据库位置相同/)
})

test('旧库 comate.db 自动迁移为 tage.db（保留既有数据）', () => {
  const dir = freshUserData()
  const { initDb, getDb, dbPath } = require('../src/main/db')
  initDb()
  // 写入一条数据，然后模拟"旧命名"：关闭连接，把 tage.db 改名为 comate.db
  getDb().prepare("INSERT INTO settings (key, value) VALUES ('legacy_test', 'yes')").run()
  getDb().close()
  fs.renameSync(path.join(dir, 'tage.db'), path.join(dir, 'comate.db'))

  // 重新初始化：应自动把 comate.db 迁移回 tage.db，且数据保留
  initDb()
  assert.equal(dbPath(), path.join(dir, 'tage.db'))
  assert.ok(!fs.existsSync(path.join(dir, 'comate.db')), '旧 comate.db 应被重命名迁移')
  const row = getDb().prepare("SELECT value FROM settings WHERE key = 'legacy_test'").get()
  assert.equal(row.value, 'yes', '旧库数据应保留')
})
