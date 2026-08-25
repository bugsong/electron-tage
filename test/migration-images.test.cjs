/**
 * 阶段3测试：图片 BLOB 存储与数据库迁移
 * - images 表由 db.js 初始化创建
 * - saveImage 压缩入库、getImage BLOB 读回且为合法 JPEG
 * - migrateImages：base64 data URI → BLOB，HTML 引用替换为 local-image://{id}
 * - migrateImages：file:// 路径 → BLOB
 * - 幂等：二次运行不再转换
 */
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const sharp = require('sharp')
const { freshUserData } = require('./helpers.cjs')

async function makeImage(width, height) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 100, g: 150, b: 200 } }
  }).png().toBuffer()
}

test('db.js 初始化自动创建 images 表', () => {
  freshUserData()
  const { initDb, getDb } = require('../src/main/db')
  initDb()
  const db = getDb()
  const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='images'").get()
  assert.ok(t, 'images 表应存在')
})

test('saveImage 压缩入库，getImage 读回合法 JPEG', async () => {
  freshUserData()
  const { initDb } = require('../src/main/db')
  initDb()
  const { saveImage, getImage } = require('../src/main/images')

  const big = await makeImage(2000, 1500)
  const { id, width, height } = await saveImage(big)
  assert.ok(id && id.length > 10, '应返回 uuid id')

  const img = getImage(id)
  assert.ok(img, '应能读回')
  assert.equal(img.mime, 'image/jpeg')
  assert.equal(width, 1200, '保存时已压缩到 1200')
  assert.equal(height, 900, '保持宽高比')
  const meta = await sharp(img.data).metadata()
  assert.equal(meta.format, 'jpeg', 'BLOB 应为合法 JPEG')
  assert.equal(meta.width, 1200)

  // 不存在时返回 null
  assert.equal(getImage('no-such-id'), null)
})

test('migrateImages：base64 data URI 转换为 BLOB 引用', async () => {
  freshUserData()
  const { initDb, getDb } = require('../src/main/db')
  initDb()
  const db = getDb()
  const { migrateImages, getImage } = require('../src/main/images')

  // 插入一条含 base64 图片的题干
  const png = await makeImage(800, 600)
  const b64 = png.toString('base64')
  const catId = db.prepare("SELECT id FROM categories WHERE name = '新思想'").get().id
  const t = Date.now()
  db.prepare(
    'INSERT INTO questions (category_id, type, stem, options, answer, analysis, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(catId, 'single', `<p>题目</p><img src="data:image/png;base64,${b64}">`, '[]', 'A', '', 'demo', t, t)

  const res = await migrateImages()
  assert.ok(!res.skipped, '首次迁移不应跳过')
  assert.equal(res.converted, 1)

  const row = db.prepare("SELECT stem FROM questions WHERE stem LIKE '%题目%'").get()
  assert.match(row.stem, /local-image:\/\/[0-9a-f-]{36}/, '引用应替换为 local-image://id')

  const id = row.stem.match(/local-image:\/\/([0-9a-f-]{36})/)[1]
  const img = getImage(id)
  assert.ok(img, '迁移的图片应存入 BLOB')
  const meta = await sharp(img.data).metadata()
  assert.ok(meta.format === 'jpeg' && meta.width <= 1200)
})

test('migrateImages：file:// 路径转换为 BLOB 引用', async () => {
  freshUserData()
  const { initDb, getDb } = require('../src/main/db')
  initDb()
  const db = getDb()
  const { migrateImages } = require('../src/main/images')

  // 写一个临时图片文件
  const png = await makeImage(500, 400)
  const tmpFile = path.join(os.tmpdir(), 'comate-test-img-' + Date.now() + '.png')
  fs.writeFileSync(tmpFile, png)
  const fileUrl = 'file:///' + tmpFile.replace(/\\/g, '/')

  const catId = db.prepare("SELECT id FROM categories WHERE name = '时事政治'").get().id
  const t = Date.now()
  db.prepare(
    'INSERT INTO questions (category_id, type, stem, options, answer, analysis, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(catId, 'single', `<p>时事题</p><img src="${fileUrl}">`, '[]', 'A', '', 'demo', t, t)

  const res = await migrateImages()
  assert.equal(res.converted, 1)
  const row = db.prepare("SELECT stem FROM questions WHERE stem LIKE '%时事题%'").get()
  assert.match(row.stem, /local-image:\/\//, 'file 引用应替换为 local-image')
  fs.rmSync(tmpFile, { force: true })
})

test('migrateImages 幂等：二次运行不重复转换', async () => {
  freshUserData()
  const { initDb, getDb } = require('../src/main/db')
  initDb()
  const db = getDb()
  const { migrateImages } = require('../src/main/images')

  const png = await makeImage(600, 400)
  const b64 = png.toString('base64')
  const catId = db.prepare("SELECT id FROM categories WHERE name = '新思想'").get().id
  const t = Date.now()
  db.prepare(
    'INSERT INTO questions (category_id, type, stem, options, answer, analysis, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(catId, 'single', `<img src="data:image/png;base64,${b64}">`, '[]', 'A', '', 'demo', t, t)

  const first = await migrateImages()
  assert.equal(first.converted, 1)
  const second = await migrateImages()
  assert.equal(second.skipped, true, '二次运行应跳过')
  const imgCount = db.prepare('SELECT COUNT(*) AS c FROM images').get().c
  assert.equal(imgCount, 1, '不应产生重复图片记录')
})
