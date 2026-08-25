/**
 * 图片 BLOB 存储（SQLite images 表）
 * - 保存时经 sharp 压缩（质量 80、最大边长 1200）
 * - 返回 local-image://{id} 引用，供富文本编辑器插入
 * - 提供历史数据迁移：base64 data URI / file:// 路径 → BLOB
 */
const crypto = require('node:crypto')
const fs = require('node:fs')
const { getDb } = require('./db')
const { compressImage } = require('./image')

const MIME = 'image/jpeg'

/** 匹配 HTML 中的图片引用：base64 data URI 或 file:// 路径 */
const IMG_REF_RE = /src="(data:image\/(?:png|jpe?g|gif|webp);base64,([A-Za-z0-9+/=]+)|file:\/\/\/([^"]+))"/g

function createImagesSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS images (
      id TEXT PRIMARY KEY,
      data BLOB NOT NULL,
      width INTEGER,
      height INTEGER,
      mime TEXT NOT NULL DEFAULT 'image/jpeg',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_images_created ON images(created_at);
  `)
}

/**
 * 保存图片：压缩后写入 images 表。
 * @param {Buffer|Uint8Array} input 原始图片字节
 * @returns {Promise<{id: string, width: number, height: number}>}
 */
async function saveImage(input) {
  const { buffer, width, height } = await compressImage(Buffer.from(input))
  const id = crypto.randomUUID()
  getDb()
    .prepare('INSERT INTO images (id, data, width, height, mime, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, buffer, width, height, MIME, Date.now())
  return { id, width, height }
}

/**
 * 读取图片 BLOB。
 * @returns {{ data: Buffer, mime: string, width: number, height: number } | null}
 */
function getImage(id) {
  const row = getDb()
    .prepare('SELECT data, mime, width, height FROM images WHERE id = ?')
    .get(String(id))
  if (!row) return null
  return { data: row.data, mime: row.mime, width: row.width, height: row.height }
}

/**
 * 迁移历史数据：把题干/解析/笔记中的 base64 data URI 与 file:// 图片引用
 * 转为 BLOB 存储，HTML 引用替换为 local-image://{id}。
 * 幂等：通过 settings.image_schema 标记。
 * @returns {Promise<{converted: number, skipped: boolean}>}
 */
async function migrateImages() {
  const ver = getDb().prepare("SELECT value FROM settings WHERE key = 'image_schema'").get()
  if (ver && ver.value === 'v1') return { converted: 0, skipped: true }

  const db = getDb()
  createImagesSchema(db)

  let converted = 0
  const tables = [
    { sql: 'SELECT id, stem, analysis FROM questions', idCol: 'id', htmlCols: ['stem', 'analysis'], updateSql: 'UPDATE questions SET stem = ?, analysis = ? WHERE id = ?' },
    { sql: 'SELECT question_id AS id, content FROM notes', idCol: 'id', htmlCols: ['content'], updateSql: 'UPDATE notes SET content = ? WHERE question_id = ?' }
  ]

  for (const table of tables) {
    for (const row of db.prepare(table.sql).all()) {
      // 收集本行所有图片引用
      const refs = []
      let m
      const htmls = {}
      for (const col of table.htmlCols) htmls[col] = String(row[col] || '')
      const combined = Object.values(htmls).join('\u0000')
      IMG_REF_RE.lastIndex = 0
      while ((m = IMG_REF_RE.exec(combined))) {
        refs.push({ full: m[0], b64: m[2], file: m[3] })
      }
      if (!refs.length) continue

      let changed = false
      for (const ref of refs) {
        try {
          let buf
          if (ref.b64) {
            buf = Buffer.from(ref.b64, 'base64')
          } else {
            buf = fs.readFileSync(decodeURIComponent(ref.file))
          }
          const { id } = await saveImage(buf)
          // 仅替换出现过的列
          for (const col of table.htmlCols) {
            if (htmls[col].includes(ref.full)) {
              htmls[col] = htmls[col].split(ref.full).join(`src="local-image://${id}"`)
            }
          }
          converted++
          changed = true
        } catch {
          /* 单个图片失败不影响其余 */
        }
      }
      if (changed) {
        const stmt = db.prepare(table.updateSql)
        if (table.htmlCols.length === 2) stmt.run(htmls.stem, htmls.analysis, row.id)
        else stmt.run(htmls.content, row.id)
      }
    }
  }

  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('image_schema', 'v1')
     ON CONFLICT(key) DO UPDATE SET value = 'v1'`
  ).run()
  return { converted }
}

module.exports = { createImagesSchema, saveImage, getImage, migrateImages, MIME }
