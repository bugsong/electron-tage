const { ipcMain, dialog } = require('electron')
const { getDb, dbPath, configuredDataDir, moveDb } = require('./db')
const { parseExcel } = require('./excel')
const { sanitizeHtml } = require('../shared/sanitize')
const { saveImage, getImage } = require('./images')

const now = () => Date.now()

/* ---------------- 通用工具 ---------------- */

function parseOptions(text) {
  try {
    const arr = JSON.parse(text)
    return Array.isArray(arr) ? arr : ['', '', '', '']
  } catch {
    return ['', '', '', '']
  }
}

function questionRow(q) {
  if (!q) return null
  return {
    id: q.id,
    categoryId: q.category_id,
    type: q.type,
    stem: q.stem,
    options: parseOptions(q.options),
    answer: q.answer,
    analysis: q.analysis,
    source: q.source,
    createdAt: q.created_at,
    updatedAt: q.updated_at
  }
}

/** 返回某分类（含其子孙分类）的全部 category id */
function subtreeIds(categoryId) {
  const cid = Number(categoryId)
  if (!Number.isFinite(cid)) return []
  const all = getDb().prepare('SELECT id, parent_id FROM categories').all()
  const children = new Map()
  for (const c of all) {
    if (!children.has(c.parent_id)) children.set(c.parent_id, [])
    children.get(c.parent_id).push(c.id)
  }
  const ids = [cid]
  const queue = [cid]
  while (queue.length) {
    const cur = queue.shift()
    for (const child of children.get(cur) || []) {
      ids.push(child)
      queue.push(child)
    }
  }
  return ids
}

function categoryStats(ids) {
  const ph = ids.map(() => '?').join(',')
  const total = getDb()
    .prepare(`SELECT COUNT(*) AS c FROM questions WHERE category_id IN (${ph})`)
    .get(...ids).c
  const done = getDb()
    .prepare(
      `SELECT COUNT(DISTINCT q.id) AS c
       FROM questions q JOIN question_progress p ON p.question_id = q.id
       WHERE q.category_id IN (${ph})`
    )
    .get(...ids).c
  return { total, done }
}

function buildCategoryTree() {
  const cats = getDb().prepare('SELECT * FROM categories ORDER BY sort, id').all()
  const nodeById = new Map()
  for (const c of cats) {
    const ids = subtreeIds(c.id)
    const st = categoryStats(ids)
    nodeById.set(c.id, {
      id: c.id,
      parentId: c.parent_id,
      name: c.name,
      total: st.total,
      done: st.done,
      children: []
    })
  }
  const roots = []
  for (const n of nodeById.values()) {
    if (n.parentId && nodeById.has(n.parentId)) {
      nodeById.get(n.parentId).children.push(n)
    } else {
      roots.push(n)
    }
  }
  return roots
}

/* ---------------- 分类 ---------------- */

function registerCategoryHandlers() {
  ipcMain.handle('category:tree', () => buildCategoryTree())
}

/* ---------------- 题目 ---------------- */

function registerQuestionHandlers() {
  ipcMain.handle('question:list', (e, filter = {}) => {
    const { categoryId = null, keyword = '', page = 1, pageSize = 50 } = filter
    const conds = []
    const params = []
    if (categoryId) {
      const ids = subtreeIds(categoryId)
      conds.push(`category_id IN (${ids.map(() => '?').join(',')})`)
      params.push(...ids)
    }
    if (keyword) {
      conds.push('stem LIKE ?')
      params.push(`%${keyword}%`)
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
    const total = getDb().prepare(`SELECT COUNT(*) AS c FROM questions ${where}`).get(...params).c
    const items = getDb()
      .prepare(`SELECT * FROM questions ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...params, pageSize, (page - 1) * pageSize)
      .map(questionRow)
    return { total, items }
  })

  ipcMain.handle('question:get', (e, id) => {
    return questionRow(getDb().prepare('SELECT * FROM questions WHERE id = ?').get(id))
  })

  ipcMain.handle('question:save', (e, payload) => {
    const { id = null, categoryId, stem, options, answer, analysis } = payload || {}
    if (!categoryId) throw new Error('请选择分类')
    if (!stem || !String(stem).trim()) throw new Error('题干不能为空')
    // 选项允许为空（截图已包含选项时无需填写）
    if (!Array.isArray(options)) throw new Error('选项格式不正确')
    if (!['A', 'B', 'C', 'D'].includes(answer)) throw new Error('答案必须为 A/B/C/D')
    const cleanStem = sanitizeHtml(String(stem).trim())
    const cleanAnalysis = sanitizeHtml(String(analysis || ''))
    const opts = JSON.stringify(options.map((o) => String(o || '')))
    const t = now()
    if (id) {
      getDb()
        .prepare(
          `UPDATE questions SET category_id = ?, stem = ?, options = ?, answer = ?, analysis = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(categoryId, cleanStem, opts, answer, cleanAnalysis, t, id)
      return { id }
    }
    const r = getDb()
      .prepare(
        `INSERT INTO questions (category_id, type, stem, options, answer, analysis, source, created_at, updated_at)
         VALUES (?, 'single', ?, ?, ?, ?, 'manual', ?, ?)`
      )
      .run(categoryId, cleanStem, opts, answer, cleanAnalysis, t, t)
    return { id: Number(r.lastInsertRowid) }
  })

  ipcMain.handle('question:delete', (e, id) => {
    getDb().prepare('DELETE FROM questions WHERE id = ?').run(id)
    return { ok: true }
  })

  // Excel 导入
  ipcMain.handle('dialog:pickExcel', async () => {
    const r = await dialog.showOpenDialog({
      title: '选择题库 Excel 文件',
      properties: ['openFile'],
      filters: [{ name: 'Excel 文件', extensions: ['xlsx', 'xls'] }]
    })
    return r.canceled ? null : r.filePaths[0]
  })

  ipcMain.handle('excel:parse', (e, filePath) => {
    return parseExcel(filePath)
  })

  ipcMain.handle('question:importRows', (e, rows) => {
    const db = getDb()
    const findCat = db.prepare('SELECT id FROM categories WHERE parent_id IS ? AND name = ?')
    const findChild = db.prepare('SELECT id FROM categories WHERE parent_id = ? AND name = ?')
    const insertCat = db.prepare(
      'INSERT INTO categories (parent_id, name, sort) VALUES (?, ?, ?)'
    )
    const findQ = db.prepare('SELECT id FROM questions WHERE stem = ? LIMIT 1')
    const insertQ = db.prepare(
      `INSERT INTO questions (category_id, type, stem, options, answer, analysis, source, created_at, updated_at)
       VALUES (?, 'single', ?, ?, ?, ?, 'import', ?, ?)`
    )
    const t = now()
    let inserted = 0
    let duplicates = 0
    const seen = new Set()

    const resolveCategory = (row) => {
      const c1 = String(row.category1 || '').trim()
      const c2 = String(row.category2 || '').trim()
      const cat = String(row.category || '').trim()
      let name1 = c1 || ''
      let name2 = c2 || ''
      if (!name1) {
        if (cat) {
          // 只有一列分类：优先当作政治理论的二级分类，其次一级分类
          const child = findChild.get(getPoliticsId(), cat)
          if (child) return child.id
          name1 = cat
        } else {
          name1 = '未分类'
        }
      }
      let top = findCat.get(null, name1)
      if (!top) {
        const r = insertCat.run(null, name1, 100)
        top = { id: Number(r.lastInsertRowid) }
      }
      if (!name2) return top.id
      let child = findChild.get(top.id, name2)
      if (!child) {
        const r = insertCat.run(top.id, name2, 0)
        child = { id: Number(r.lastInsertRowid) }
      }
      return child.id
    }

    for (const row of rows) {
      const stem = sanitizeHtml(String(row.stem || '').trim())
      if (!stem) continue
      const opts = (row.options || []).map((o) => String(o || ''))
      const answer = String(row.answer || '').toUpperCase()
      if (!['A', 'B', 'C', 'D'].includes(answer)) continue
      const dupKey = stem + '|' + JSON.stringify(opts)
      if (seen.has(dupKey)) continue
      seen.add(dupKey)
      if (findQ.get(stem)) {
        duplicates++
        continue
      }
      const categoryId = resolveCategory(row)
      insertQ.run(
        categoryId,
        stem,
        JSON.stringify(opts),
        answer,
        sanitizeHtml(String(row.analysis || '')),
        t,
        t
      )
      inserted++
    }
    return { inserted, duplicates }
  })
}

function getPoliticsId() {
  return getDb().prepare("SELECT id FROM categories WHERE name = '政治理论'").get().id
}

/* ---------------- 错题 / 收藏 / 笔记 / 草稿 ---------------- */

function registerRecordHandlers() {
  ipcMain.handle('wrong:list', (e, filter = {}) => {
    const { keyword = '', categoryId = null } = filter
    const conds = ['wr.removed = 0']
    const params = []
    if (categoryId) {
      const ids = subtreeIds(categoryId)
      conds.push(`q.category_id IN (${ids.map(() => '?').join(',')})`)
      params.push(...ids)
    }
    if (keyword) {
      conds.push('q.stem LIKE ?')
      params.push(`%${keyword}%`)
    }
    const where = conds.join(' AND ')
    return getDb()
      .prepare(
        `SELECT wr.question_id AS questionId, wr.wrong_count AS wrongCount, wr.last_wrong_at AS lastWrongAt,
                q.stem, q.answer, q.analysis, q.options, q.category_id AS categoryId,
                c.name AS categoryName
         FROM wrong_records wr
         JOIN questions q ON q.id = wr.question_id
         LEFT JOIN categories c ON c.id = q.category_id
         WHERE ${where}
         ORDER BY wr.last_wrong_at DESC`
      )
      .all(...params)
      .map((r) => ({ ...r, options: parseOptions(r.options) }))
  })

  ipcMain.handle('wrong:remove', (e, questionId) => {
    getDb().prepare('UPDATE wrong_records SET removed = 1, last_wrong_at = ? WHERE question_id = ?').run(now(), questionId)
    return { ok: true }
  })

  ipcMain.handle('favorite:toggle', (e, questionId) => {
    const db = getDb()
    const existing = db.prepare('SELECT question_id FROM favorites WHERE question_id = ?').get(questionId)
    if (existing) {
      db.prepare('DELETE FROM favorites WHERE question_id = ?').run(questionId)
      return false
    }
    db.prepare('INSERT INTO favorites (question_id, created_at) VALUES (?, ?)').run(questionId, now())
    return true
  })

  ipcMain.handle('favorite:list', (e, filter = {}) => {
    const { keyword = '', categoryId = null } = filter
    const conds = []
    const params = []
    if (categoryId) {
      const ids = subtreeIds(categoryId)
      conds.push(`q.category_id IN (${ids.map(() => '?').join(',')})`)
      params.push(...ids)
    }
    if (keyword) {
      conds.push('q.stem LIKE ?')
      params.push(`%${keyword}%`)
    }
    const where = conds.length ? ' WHERE ' + conds.join(' AND ') : ''
    return getDb()
      .prepare(
        `SELECT f.question_id AS questionId, f.created_at AS createdAt,
                q.stem, q.answer, q.analysis, q.options, q.category_id AS categoryId,
                c.name AS categoryName
         FROM favorites f
         JOIN questions q ON q.id = f.question_id
         LEFT JOIN categories c ON c.id = q.category_id
         ${where}
         ORDER BY f.created_at DESC`
      )
      .all(...params)
      .map((r) => ({ ...r, options: parseOptions(r.options) }))
  })

  ipcMain.handle('note:get', (e, questionId) => {
    return getDb().prepare('SELECT content, updated_at AS updatedAt FROM notes WHERE question_id = ?').get(questionId) || null
  })

  ipcMain.handle('note:save', (e, questionId, content) => {
    const t = now()
    const clean = sanitizeHtml(String(content || ''))
    const db = getDb()
    const existing = db.prepare('SELECT question_id FROM notes WHERE question_id = ?').get(questionId)
    if (existing) {
      db.prepare('UPDATE notes SET content = ?, updated_at = ? WHERE question_id = ?').run(clean, t, questionId)
    } else {
      db.prepare('INSERT INTO notes (question_id, content, created_at, updated_at) VALUES (?, ?, ?, ?)').run(questionId, clean, t, t)
    }
    return { updatedAt: t }
  })

  ipcMain.handle('note:list', (e, filter = {}) => {
    const { keyword = '', categoryId = null } = filter
    const conds = []
    const params = []
    if (categoryId) {
      const ids = subtreeIds(categoryId)
      conds.push(`q.category_id IN (${ids.map(() => '?').join(',')})`)
      params.push(...ids)
    }
    if (keyword) {
      conds.push('(q.stem LIKE ? OR n.content LIKE ?)')
      params.push(`%${keyword}%`, `%${keyword}%`)
    }
    const where = conds.length ? ' WHERE ' + conds.join(' AND ') : ''
    return getDb()
      .prepare(
        `SELECT n.question_id AS questionId, n.content, n.created_at AS createdAt, n.updated_at AS updatedAt,
                q.stem, q.answer, q.analysis, q.options, q.category_id AS categoryId,
                c.name AS categoryName
         FROM notes n
         JOIN questions q ON q.id = n.question_id
         LEFT JOIN categories c ON c.id = q.category_id
         ${where}
         ORDER BY n.updated_at DESC`
      )
      .all(...params)
      .map((r) => ({ ...r, options: parseOptions(r.options) }))
  })

  ipcMain.handle('draft:get', (e, questionId) => {
    const r = getDb().prepare('SELECT paths FROM drafts WHERE question_id = ?').get(questionId)
    if (!r) return []
    try {
      const arr = JSON.parse(r.paths)
      return Array.isArray(arr) ? arr : []
    } catch {
      return []
    }
  })

  ipcMain.handle('draft:save', (e, questionId, paths) => {
    const t = now()
    const json = JSON.stringify(Array.isArray(paths) ? paths : [])
    const db = getDb()
    const existing = db.prepare('SELECT question_id FROM drafts WHERE question_id = ?').get(questionId)
    if (existing) {
      db.prepare('UPDATE drafts SET paths = ?, updated_at = ? WHERE question_id = ?').run(json, t, questionId)
    } else {
      db.prepare('INSERT INTO drafts (question_id, paths, updated_at) VALUES (?, ?, ?)').run(questionId, json, t)
    }
    return { ok: true }
  })

  ipcMain.handle('draft:clear', (e, questionId) => {
    getDb().prepare('DELETE FROM drafts WHERE question_id = ?').run(questionId)
    return { ok: true }
  })
}

/* ---------------- 练习会话 ---------------- */

function loadQuestionsInOrder(ids) {
  if (!ids.length) return []
  const ph = ids.map(() => '?').join(',')
  const rows = getDb()
    .prepare(
      `SELECT q.*, c.name AS categoryName
       FROM questions q LEFT JOIN categories c ON c.id = q.category_id
       WHERE q.id IN (${ph})`
    )
    .all(...ids)
  const byId = new Map(rows.map((r) => [r.id, r]))
  return ids.map((id) => byId.get(id)).filter(Boolean).map((r) => ({
    ...questionRow(r),
    categoryName: r.categoryName
  }))
}

function getSession(sessionId) {
  const s = getDb().prepare('SELECT * FROM practice_sessions WHERE id = ?').get(sessionId)
  if (!s) return null
  let questionIds = []
  let answers = []
  let result = []
  try {
    questionIds = JSON.parse(s.questions_json)
  } catch {}
  try {
    answers = JSON.parse(s.answers_json || '[]')
  } catch {}
  try {
    result = JSON.parse(s.result_json || '[]')
  } catch {}
  return {
    id: s.id,
    type: s.type,
    title: s.title,
    status: s.status,
    total: s.total,
    correct: s.correct,
    durationMs: s.duration_ms,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
    questions: loadQuestionsInOrder(questionIds),
    answers,
    result
  }
}

function getActiveSession() {
  const s = getDb()
    .prepare("SELECT * FROM practice_sessions WHERE status = 'in_progress' ORDER BY updated_at DESC LIMIT 1")
    .get()
  if (!s) return null
  const full = getSession(s.id)
  const answered = full.answers.filter((a) => a != null).length
  return {
    id: full.id,
    type: full.type,
    title: full.title,
    total: full.total,
    answered,
    updatedAt: full.updatedAt
  }
}

function registerPracticeHandlers() {
  ipcMain.handle('practice:getActive', () => getActiveSession())

  ipcMain.handle('practice:getSession', (e, id) => getSession(id))

  ipcMain.handle('practice:start', (e, payload = {}) => {
    const { type = 'special', title = '练多分', categoryIds = [], count = 20, wrongCategoryId = null } = payload
    const db = getDb()
    let ids = []
    if (type === 'wrong_review') {
      const conds = ['wr.removed = 0']
      const params = []
      if (wrongCategoryId) {
        const subs = subtreeIds(wrongCategoryId)
        conds.push(`q.category_id IN (${subs.map(() => '?').join(',')})`)
        params.push(...subs)
      }
      ids = db
        .prepare(
          `SELECT wr.question_id AS id FROM wrong_records wr
           JOIN questions q ON q.id = wr.question_id
           WHERE ${conds.join(' AND ')} ORDER BY RANDOM() LIMIT ?`
        )
        .all(...params, count)
        .map((r) => r.id)
    } else if (type === 'favorite') {
      ids = db
        .prepare('SELECT question_id AS id FROM favorites ORDER BY RANDOM() LIMIT ?')
        .all(count)
        .map((r) => r.id)
    } else {
      const all = categoryIds.flatMap((cid) => subtreeIds(cid))
      if (!all.length) throw new Error('未选择分类')
      const ph = all.map(() => '?').join(',')
      ids = db
        .prepare(`SELECT id FROM questions WHERE category_id IN (${ph}) ORDER BY RANDOM() LIMIT ?`)
        .all(...all, count)
        .map((r) => r.id)
    }
    if (!ids.length) throw new Error('该范围暂无可练习的题目')
    const t = now()
    const r = db
      .prepare(
        `INSERT INTO practice_sessions (type, title, status, total, duration_ms, questions_json, created_at, updated_at)
         VALUES (?, ?, 'in_progress', ?, 0, ?, ?, ?)`
      )
      .run(type, title, ids.length, JSON.stringify(ids), t, t)
    return { id: Number(r.lastInsertRowid) }
  })

  ipcMain.handle('practice:saveProgress', (e, sessionId, answers, elapsedMs) => {
    getDb()
      .prepare(
        `UPDATE practice_sessions SET answers_json = ?, duration_ms = ?, updated_at = ?
         WHERE id = ? AND status = 'in_progress'`
      )
      .run(JSON.stringify(Array.isArray(answers) ? answers : []), Math.max(0, elapsedMs || 0), now(), sessionId)
    return { ok: true }
  })

  ipcMain.handle('practice:submit', (e, sessionId, answers, elapsedMs) => {
    const db = getDb()
    const s = db.prepare('SELECT * FROM practice_sessions WHERE id = ?').get(sessionId)
    if (!s) throw new Error('练习会话不存在')
    const questions = loadQuestionsInOrder(JSON.parse(s.questions_json || '[]'))
    const ans = Array.isArray(answers) ? answers : []
    const result = questions.map((q, i) => (ans[i] != null ? ans[i] === q.answer : false))
    const correct = result.filter(Boolean).length
    const t = now()

    db.prepare(
      `UPDATE practice_sessions SET status = 'done', answers_json = ?, result_json = ?, correct = ?,
       duration_ms = ?, updated_at = ? WHERE id = ?`
    ).run(JSON.stringify(ans), JSON.stringify(result), correct, Math.max(0, elapsedMs || 0), t, sessionId)

    const upsertProgress = db.prepare(
      `INSERT INTO question_progress (question_id, attempt_count, correct_count, last_answer_at)
       VALUES (?, 1, ?, ?)
       ON CONFLICT(question_id) DO UPDATE SET
         attempt_count = attempt_count + 1,
         correct_count = correct_count + excluded.correct_count,
         last_answer_at = excluded.last_answer_at`
    )
    const upsertWrong = db.prepare(
      `INSERT INTO wrong_records (question_id, wrong_count, last_wrong_at, removed)
       VALUES (?, 1, ?, 0)
       ON CONFLICT(question_id) DO UPDATE SET
         wrong_count = wrong_count + 1,
         last_wrong_at = excluded.last_wrong_at,
         removed = 0`
    )
    questions.forEach((q, i) => {
      if (ans[i] == null) return // 未作答不记进度
      upsertProgress.run(q.id, result[i] ? 1 : 0, t)
      if (!result[i]) upsertWrong.run(q.id, t)
    })
    return { total: questions.length, correct, result }
  })

  ipcMain.handle('practice:abandon', (e, sessionId) => {
    getDb().prepare("UPDATE practice_sessions SET status = 'abandoned', updated_at = ? WHERE id = ?").run(now(), sessionId)
    return { ok: true }
  })
}

/* ---------------- 首页统计 / 设置 ---------------- */

function registerStatsHandlers() {
  ipcMain.handle('stats:home', () => {
    const db = getDb()
    const agg = db
      .prepare('SELECT COALESCE(SUM(attempt_count),0) AS attempts, COALESCE(SUM(correct_count),0) AS corrects FROM question_progress')
      .get()
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    const todayAnswered = db
      .prepare('SELECT COUNT(*) AS c FROM question_progress WHERE last_answer_at >= ?')
      .get(startOfToday.getTime()).c
    const wrongCount = db.prepare('SELECT COUNT(*) AS c FROM wrong_records WHERE removed = 0').get().c
    const favoriteCount = db.prepare('SELECT COUNT(*) AS c FROM favorites').get().c
    const noteCount = db.prepare('SELECT COUNT(*) AS c FROM notes').get().c
    const totalQuestions = db.prepare('SELECT COUNT(*) AS c FROM questions').get().c
    const doneQuestions = db.prepare('SELECT COUNT(*) AS c FROM question_progress').get().c
    const recentNotes = db
      .prepare(
        `SELECT n.question_id AS questionId, n.content, n.updated_at AS updatedAt, q.stem
         FROM notes n JOIN questions q ON q.id = n.question_id
         ORDER BY n.updated_at DESC LIMIT 5`
      )
      .all()
      .map((r) => ({
        ...r,
        plain: r.content.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 80)
      }))
    return {
      totalAnswered: agg.attempts,
      totalCorrect: agg.corrects,
      correctRate: agg.attempts ? Math.round((agg.corrects / agg.attempts) * 100) : 0,
      todayAnswered,
      wrongCount,
      favoriteCount,
      noteCount,
      totalQuestions,
      doneQuestions,
      categoryProgress: buildCategoryTree(),
      recentNotes,
      activeSession: getActiveSession()
    }
  })
}

function registerSettingsHandlers() {
  ipcMain.handle('app:dbPath', () => dbPath())

  // 选择数据库存储文件夹
  ipcMain.handle('dialog:pickDbDir', async () => {
    const r = await dialog.showOpenDialog({
      title: '选择数据库存储文件夹',
      defaultPath: configuredDataDir(),
      properties: ['openDirectory', 'createDirectory']
    })
    return r.canceled ? null : r.filePaths[0]
  })

  // 迁移/初始化数据库到新位置
  ipcMain.handle('app:moveDb', (e, dir, opts) => moveDb(dir, opts))

  ipcMain.handle('settings:getAll', () => {
    const rows = getDb().prepare('SELECT key, value FROM settings').all()
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
    return {
      fontSize: map.fontSize || 'normal',
      theme: map.theme || 'light',
      // 草纸画笔 / 橡皮参数
      penSize: map.penSize || 'normal',
      penColor: map.penColor || '#20242c',
      eraserSize: map.eraserSize || 'normal',
      eraserMode: map.eraserMode || 'pixel',
      // 侧边栏抽屉状态（'1' 收起）
      sidebarCollapsed: map.sidebarCollapsed || '0'
    }
  })

  ipcMain.handle('settings:set', (e, key, value) => {
    getDb()
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(String(key), String(value))
    return { ok: true }
  })
}

/* ---------------- 图片（BLOB） ---------------- */

function registerImageHandlers() {
  // 保存图片：压缩后入库，返回 local-image://{id} 的 id
  ipcMain.handle('image:save', async (e, data) => {
    if (!data) throw new Error('图片数据为空')
    return saveImage(data)
  })

  // 读取图片 BLOB（供前端预览等场景）
  ipcMain.handle('image:get', (e, id) => {
    const img = getImage(id)
    if (!img) return null
    return { data: img.data, mime: img.mime, width: img.width, height: img.height }
  })
}

/* ---------------- 注册 ---------------- */

function registerIpc() {
  registerCategoryHandlers()
  registerQuestionHandlers()
  registerRecordHandlers()
  registerPracticeHandlers()
  registerStatsHandlers()
  registerSettingsHandlers()
  registerImageHandlers()
}

module.exports = { registerIpc }
