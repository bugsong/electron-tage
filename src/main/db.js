const path = require('node:path')
const fs = require('node:fs')
const { app } = require('electron')
// better-sqlite3-multiple-ciphers：better-sqlite3 的 SQLCipher fork，
// 同步 API、原生支持 BLOB（Buffer）绑定，v13 起为 N-API 实现，node 与 Electron ABI 通用，
// 额外支持 SQLCipher 的 PRAGMA key / rekey，用于数据库整体加密。
const Database = require('better-sqlite3-multiple-ciphers')
const { loadKey, wipeKey } = require('./keyring')

/** 数据库文件名（曾用名 comate.db，已改名 tage.db） */
const DB_FILE = 'tage.db'
const LEGACY_DB_FILE = 'comate.db'

let db = null

function getDb() {
  if (!db) throw new Error('数据库尚未初始化')
  return db
}

/** 数据目录配置文件（存放在 userData，userData 本身永不迁移） */
function dataDirConfigFile() {
  return path.join(app.getPath('userData'), 'data-dir.json')
}

/** 读取用户配置的数据目录；未配置过则回退到默认 userData */
function configuredDataDir() {
  try {
    const cfg = JSON.parse(fs.readFileSync(dataDirConfigFile(), 'utf8'))
    if (cfg && typeof cfg.dir === 'string' && cfg.dir) return cfg.dir
  } catch {
    /* 无配置文件或读取失败时使用默认位置 */
  }
  return app.getPath('userData')
}

function dbPath() {
  return path.join(configuredDataDir(), DB_FILE)
}

/** 旧库文件名 comate.db → tage.db 的一次性重命名迁移（保留既有数据） */
function migrateLegacyDbFile(dir) {
  const next = path.join(dir, DB_FILE)
  if (fs.existsSync(next)) return
  const main = path.join(dir, LEGACY_DB_FILE)
  if (!fs.existsSync(main)) return
  fs.renameSync(main, next) // 主库文件必须迁移成功，否则抛出错误阻止启动空库
  for (const suffix of ['-wal', '-shm']) {
    const old = path.join(dir, LEGACY_DB_FILE + suffix)
    if (!fs.existsSync(old)) continue
    try {
      fs.renameSync(old, path.join(dir, DB_FILE + suffix))
    } catch {
      /* WAL/SHM 单文件失败不阻断，SQLite 会自动重建 */
    }
  }
}

/**
 * 把数据库迁移到新目录（或在新目录初始化）：
 * - 原位置已有数据库 → 关闭连接合并 WAL 后整文件复制到新位置（加密属性随文件保留）
 * - 原位置没有数据库 → 直接在新位置初始化
 * - 目标已存在数据库文件且未强制 → 返回 need_confirm，由前端确认后带 force 重试
 * 成功后持久化配置并重新打开新库；失败则回滚配置、恢复原库。
 * @param {string} newDir 目标文件夹（不存在会自动创建）
 * @param {{force?: boolean}} opts force=true 时允许覆盖目标已有数据库
 */
async function moveDb(newDir, opts = {}) {
  if (!db) throw new Error('数据库尚未初始化')
  if (!newDir || typeof newDir !== 'string' || !newDir.trim()) throw new Error('请选择有效的文件夹')

  const targetDir = path.resolve(newDir.trim())
  const current = path.resolve(dbPath())
  const target = path.join(targetDir, DB_FILE)
  // Windows 路径不区分大小写，统一小写比较
  const samePath =
    process.platform === 'win32'
      ? current.toLowerCase() === target.toLowerCase()
      : current === target
  if (samePath) throw new Error('新位置与当前数据库位置相同')

  const sourceExists = fs.existsSync(current)
  const targetExists = fs.existsSync(target)

  // 目标已存在数据库文件：非强制时先让用户确认，避免误覆盖
  if (targetExists && !opts.force) {
    return {
      status: 'need_confirm',
      message: sourceExists
        ? `目标文件夹已存在 ${DB_FILE} 数据库文件，迁移将覆盖该文件。\n建议选择空文件夹，确认后将继续。`
        : `目标文件夹已存在 ${DB_FILE} 数据库文件，确认后将打开并使用该数据库。`,
      currentPath: current,
      newPath: target,
      sourceExists,
      targetExists
    }
  }

  const oldDir = configuredDataDir()
  fs.mkdirSync(targetDir, { recursive: true })

  // 原位置有数据库：关闭连接（close 自动 checkpoint，把 WAL 合并进主文件）后整文件复制到新位置。
  // SQLCipher 加密库无法在线 backup 到未加密目标（incompatible source and target），
  // 文件级复制保证迁移产物仍是同密钥加密的完整数据库。
  if (sourceExists) {
    // force 覆盖时先移除旧目标，避免复制到非 SQLite 文件（或旧库）上
    if (targetExists) {
      try { fs.unlinkSync(target) } catch {}
    }
    try {
      db.close()
      db = null
      fs.copyFileSync(current, target)
    } catch (err) {
      try { db = null; initDb() } catch {}
      throw new Error('迁移失败，未能复制数据库：' + ((err && err.message) || err))
    }
  }

  // 持久化新位置
  fs.writeFileSync(dataDirConfigFile(), JSON.stringify({ dir: targetDir }))

  // 关闭旧连接，在新位置重新打开
  try {
    if (db) {
      db.close()
      db = null
    }
    initDb()
  } catch (err) {
    // 失败回滚：恢复原配置并重新打开原库，保证数据可用
    try { fs.writeFileSync(dataDirConfigFile(), JSON.stringify({ dir: oldDir })) } catch {}
    try { if (db) db.close() } catch {}
    db = null
    initDb()
    throw new Error('迁移失败，已恢复原数据库：' + ((err && err.message) || err))
  }

  // 迁移成功后清理原位置文件（含 WAL/SHM 残留）
  if (sourceExists) {
    for (const f of [DB_FILE, DB_FILE + '-wal', DB_FILE + '-shm']) {
      try { fs.unlinkSync(path.join(oldDir, f)) } catch {}
    }
  }

  return {
    status: 'ok',
    action: sourceExists ? 'migrate' : targetExists ? 'use' : 'init',
    currentPath: current,
    newPath: target
  }
}

/**
 * 以 SQLCipher 加密方式打开数据库：
 * - 自动探测是否已加密：无密钥打开后能读取 sqlite_master 说明未加密，否则视为已加密
 * - 未加密（含全新空库）→ 原地 PRAGMA rekey 迁移为加密库
 * - 已加密 → 以密钥重新打开
 * 调用方负责在 initDb 的 finally 中擦除密钥。
 * @param {string} file 数据库文件路径
 * @param {Buffer} key 32 字节密钥（使用后由调用方擦除）
 */
function openEncryptedDb(file, key) {
  const keyHex = key.toString('hex')

  let encrypted = true
  let probe = null
  try {
    probe = new Database(file)
    probe.prepare('SELECT count(*) FROM sqlite_master').get()
    encrypted = false
  } catch {
    encrypted = true
  } finally {
    if (probe) {
      try { probe.close() } catch {}
    }
  }

  db = new Database(file)
  if (encrypted) {
    db.pragma(`key = "x'${keyHex}'"`)
  } else {
    db.pragma(`rekey = "x'${keyHex}'"`)
  }
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
}

function initDb() {
  const dir = configuredDataDir()
  fs.mkdirSync(dir, { recursive: true })
  migrateLegacyDbFile(dir)

  const key = loadKey()
  try {
    openEncryptedDb(dbPath(), key)
    createSchema()
    seedIfEmpty()
    migrateCategorySchema()
    // 图片 BLOB 表（历史 base64/file 引用的迁移在应用启动后异步执行）
    const { createImagesSchema } = require('./images')
    createImagesSchema(db)
  } catch (err) {
    try { if (db) db.close() } catch {}
    db = null
    throw err
  } finally {
    wipeKey(key)
  }
  return db
}

function createSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id INTEGER,
      name TEXT NOT NULL,
      sort INTEGER DEFAULT 0,
      UNIQUE (parent_id, name)
    );

    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'single',
      stem TEXT NOT NULL,
      options TEXT NOT NULL,
      answer TEXT NOT NULL,
      analysis TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'import',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_questions_category ON questions(category_id);

    CREATE TABLE IF NOT EXISTS question_progress (
      question_id INTEGER PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      correct_count INTEGER NOT NULL DEFAULT 0,
      last_answer_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS wrong_records (
      question_id INTEGER PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
      wrong_count INTEGER NOT NULL DEFAULT 1,
      last_wrong_at INTEGER,
      removed INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS favorites (
      question_id INTEGER PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notes (
      question_id INTEGER PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
      content TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS drafts (
      question_id INTEGER PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
      paths TEXT NOT NULL DEFAULT '[]',
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS practice_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'in_progress',
      total INTEGER NOT NULL DEFAULT 0,
      correct INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      questions_json TEXT NOT NULL,
      answers_json TEXT NOT NULL DEFAULT '[]',
      result_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_status ON practice_sessions(status);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  // 迁移：为 practice_sessions 添加计时模式字段
  const cols = db.prepare('PRAGMA table_info(practice_sessions)').all()
  if (!cols.some((c) => c.name === 'timer_mode')) {
    db.exec("ALTER TABLE practice_sessions ADD COLUMN timer_mode TEXT NOT NULL DEFAULT 'forward'")
  }
  if (!cols.some((c) => c.name === 'timer_limit_ms')) {
    db.exec('ALTER TABLE practice_sessions ADD COLUMN timer_limit_ms INTEGER NOT NULL DEFAULT 0')
  }
}

/* ---------------- 种子数据 ---------------- */

/**
 * 分类结构（一级 + 二级）。
 * 一级分类在练习界面展开时，前端会在最前面渲染一个虚拟「全部」，
 * 因此这里不存储「全部」，只存储真实分类。
 */
const CATEGORY_SCHEMA = [
  { name: '政治理论', children: ['新思想', '时事政治', '马克思主义', '毛中特'] },
  { name: '常识判断', children: ['经济常识', '法律常识', '科技常识', '人文常识', '地理国情', '管理常识', '公文写作与处理', '综合分析题'] },
  { name: '言语理解与表达', children: ['片段阅读', '逻辑填空', '语句表达'] },
  { name: '数量关系', children: ['数学运算'] },
  { name: '判断推理', children: ['图形推理', '逻辑判断', '类比推理', '定义判断', '综合判断推理'] },
  { name: '资料分析', children: ['文字资料', '统计表', '统计图', '综合资料', '基期与现期', '简单计算', '增长率', '增长量', '比重问题', '平均数问题', '倍数与比值相关', '综合分析'] }
]

/** 旧分类名 -> 新分类名（历史数据合并） */
const CATEGORY_RENAME = {
  新思想总论: '新思想',
  五位一体建设: '新思想',
  其他建设: '新思想'
}

/**
 * 旧版本中直接挂在一级分类下的题目，按题干关键词映射到二级分类。
 * 未命中的题目保留在一级分类下（仍可通过「全部」练习）。
 */
const ORPHAN_MAPPING = {
  常识判断: [
    [/宪法|法律|法规|刑法|民法|行政法|诉讼|立法|监察/, '法律常识'],
    [/能源|科技|技术|物理|化学|生物|航天|量子|计算机|人工智能/, '科技常识'],
    [/经济|市场|货币|财政|税收|金融|GDP|通货膨胀|汇率/, '经济常识'],
    [/历史|文学|诗词|成语|典故|文化|名人|著作/, '人文常识'],
    [/地理|气候|地形|河流|山脉|城市|省份|国土|资源/, '地理国情'],
    [/管理|领导|组织|决策|行政职能/, '管理常识'],
    [/公文|通知|请示|报告|函|纪要|批复/, '公文写作与处理']
  ],
  言语理解与表达: [
    [/___+|填入|横线|依次填入|划横线/, '逻辑填空'],
    [/排序|连贯|衔接|语句排列/, '语句表达'],
    [/主旨|意图|中心|标题|细节|推断|理解/, '片段阅读']
  ],
  数量关系: [[/.*/, '数学运算']],
  判断推理: [
    [/图形|折叠|立体|空间|正方体/, '图形推理'],
    [/类比|词项|关系最/, '类比推理'],
    [/定义|概念/, '定义判断'],
    [/综合判断|复合/, '综合判断推理'],
    [/.*/, '逻辑判断']
  ],
  资料分析: [
    [/同比|环比|增长|增速|增长率/, '增长率'],
    [/比重|占比/, '比重问题'],
    [/平均|每|均/, '平均数问题'],
    [/倍数|比值/, '倍数与比值相关'],
    [/基期|现期/, '基期与现期'],
    [/文字资料|材料中/, '文字资料'],
    [/表格|统计表/, '统计表'],
    [/图形|统计图|折线|柱状/, '统计图'],
    [/综合/, '综合分析'],
    [/.*/, '简单计算']
  ]
}

function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM categories').get().c
  if (count === 0) {
    const insCat = db.prepare('INSERT INTO categories (parent_id, name, sort) VALUES (?, ?, ?)')
    CATEGORY_SCHEMA.forEach((top, i) => {
      const r = insCat.run(null, top.name, i + 1)
      top.children.forEach((name, j) => insCat.run(Number(r.lastInsertRowid), name, j + 1))
    })
    // 新装用户已是当前结构，直接标记，避免重复迁移
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('category_schema', 'v2')
       ON CONFLICT(key) DO UPDATE SET value = 'v2'`
    ).run()
  }

  const qCount = db.prepare('SELECT COUNT(*) AS c FROM questions').get().c
  if (qCount === 0) {
    seedDemoQuestions()
  }
}

/** 将历史分类结构升级到当前 CATEGORY_SCHEMA（合并旧分类、补齐新分类、整理题目归属） */
function migrateCategorySchema() {
  const ver = db.prepare("SELECT value FROM settings WHERE key = 'category_schema'").get()
  if (ver && ver.value === 'v2') return

  db.exec('BEGIN')
  try {
    const findTop = db.prepare('SELECT id FROM categories WHERE parent_id IS NULL AND name = ?')
    const findChild = db.prepare('SELECT id, name FROM categories WHERE parent_id = ?')
    const findByName = db.prepare('SELECT id FROM categories WHERE parent_id = ? AND name = ?')
    const insCat = db.prepare('INSERT INTO categories (parent_id, name, sort) VALUES (?, ?, ?)')
    const delCat = db.prepare('DELETE FROM categories WHERE id = ?')
    const moveQ = db.prepare('UPDATE questions SET category_id = ? WHERE category_id = ?')
    const setSort = db.prepare('UPDATE categories SET sort = ? WHERE id = ?')

    for (const top of CATEGORY_SCHEMA) {
      const topRow = findTop.get(top.name)
      if (!topRow) continue
      const existing = findChild.all(topRow.id)

      // 1) 旧分类：可合并的合并，其余先挂回一级分类后删除（题目随后做关键词映射）
      for (const c of existing) {
        if (CATEGORY_RENAME[c.name]) {
          const target = findByName.get(topRow.id, CATEGORY_RENAME[c.name])
          if (target) {
            moveQ.run(target.id, c.id)
            delCat.run(c.id)
          } else {
            moveQ.run(topRow.id, c.id)
            delCat.run(c.id)
          }
        } else if (!top.children.includes(c.name)) {
          moveQ.run(topRow.id, c.id)
          delCat.run(c.id)
        }
      }

      // 2) 补齐缺失的子分类并校正排序
      top.children.forEach((name, i) => {
        const row = findByName.get(topRow.id, name)
        if (row) {
          setSort.run(i + 1, row.id)
        } else {
          insCat.run(topRow.id, name, i + 1)
        }
      })
    }

    // 3) 一级分类下直接挂的题目 -> 关键词映射到二级分类
    const topIds = CATEGORY_SCHEMA.map((t) => findTop.get(t.name).id)
    const topById = new Map(CATEGORY_SCHEMA.map((t, i) => [topIds[i], { id: topIds[i], ...t }]))
    const orphans = db
      .prepare(`SELECT id, category_id, stem FROM questions WHERE category_id IN (${topIds.map(() => '?').join(',')})`)
      .all(...topIds)
    const moveOne = db.prepare('UPDATE questions SET category_id = ? WHERE id = ?')
    for (const q of orphans) {
      const top = topById.get(q.category_id)
      if (!top) continue
      const mapping = ORPHAN_MAPPING[top.name]
      if (!mapping) continue
      for (const [re, childName] of mapping) {
        if (re.test(q.stem)) {
          const childRow = findByName.get(top.id, childName)
          if (childRow) moveOne.run(childRow.id, q.id)
          break
        }
      }
    }

    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('category_schema', 'v2')
       ON CONFLICT(key) DO UPDATE SET value = 'v2'`
    ).run()
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

function catId(name) {
  return db.prepare('SELECT id FROM categories WHERE name = ?').get(name).id
}

function seedDemoQuestions() {
  const ins = db.prepare(`
    INSERT INTO questions (category_id, type, stem, options, answer, analysis, source, created_at, updated_at)
    VALUES (?, 'single', ?, ?, ?, ?, 'demo', ?, ?)
  `)
  const now = Date.now()
  const add = (catName, stem, options, answer, analysis) => {
    ins.run(catId(catName), stem, JSON.stringify(options), answer, analysis, now, now)
  }

  add('新思想',
    '中国特色社会主义进入新时代，我国社会主要矛盾已经转化为人民日益增长的____需要和不平衡不充分的发展之间的矛盾。',
    ['物质文化', '美好生活', '精神文化', '幸福生活'], 'B',
    '十九大报告指出，我国社会主要矛盾转化为人民日益增长的美好生活需要和不平衡不充分的发展之间的矛盾。')

  add('新思想',
    '中国特色社会主义最本质的特征是____。',
    ['人民民主专政', '中国共产党领导', '人民代表大会制度', '依法治国'], 'B',
    '党的领导是中国特色社会主义最本质的特征和最大优势。')

  add('时事政治',
    '中央经济工作会议强调，要坚持____工作总基调，完整、准确、全面贯彻新发展理念。',
    ['稳中求进', '全面深化', '高质量发展', '扩大内需'], 'A',
    '稳中求进是近年中央经济工作会议一以贯之的工作总基调。')

  add('法律常识',
    '我国现行宪法是哪一年颁布的？',
    ['1949年', '1954年', '1978年', '1982年'], 'B',
    '1954年宪法是我国第一部社会主义宪法，现行宪法为1982年宪法。')

  add('科技常识',
    '下列能源中属于可再生能源的是____。',
    ['煤炭', '石油', '太阳能', '天然气'], 'C',
    '太阳能取之不尽，属可再生能源；煤、石油、天然气均为化石能源。')

  add('逻辑填空',
    '现代社会分工越来越细，每个人只有____、各展所长，整体才能形成合力。',
    ['各司其职', '各行其是', '各自为政', '各奔前程'], 'A',
    '“各司其职”指各自负责本职，与“各展所长”“形成合力”语境吻合。')

  add('逻辑填空',
    '“看待问题不能只看一面，还要看到另一面”，意在强调要____地认识问题。',
    ['全面', '片面', '静止', '孤立'], 'A',
    '“看到另一面”即从多个角度认识，强调全面性。')

  add('数学运算',
    '甲、乙两人从相距100千米的两地同时相向而行，甲每小时行5千米，乙每小时行4千米，问几小时后两人相遇？',
    ['10小时', '11小时', '约11.1小时', '9小时'], 'C',
    '相遇时间 = 总路程 ÷ 速度和 = 100 ÷ (5+4) ≈ 11.1 小时。')

  add('数学运算',
    '一件商品原价100元，先提价10%，再降价10%，现价为____元。',
    ['100', '99', '101', '90'], 'B',
    '100×1.1×0.9 = 99 元，先涨后降最终低于原价。')

  add('逻辑判断',
    '已知：所有党员都缴纳党费，张三是党员。由此可以推出____。',
    ['缴纳党费的都是党员', '张三缴纳了党费', '非党员都不缴纳党费', '张三不是党员'], 'B',
    '三段论：张三（党员）属于“党员”集合，必缴纳党费。')

  add('逻辑判断',
    '如果所有的猫都是动物，那么以下说法必然正确的是____。',
    ['所有动物都是猫', '有些动物是猫', '没有动物是猫', '有些猫不是动物'], 'B',
    '“所有猫都是动物”等价于“猫”集合是“动物”集合的子集，故至少有些动物是猫。')

  add('增长率',
    '某市去年GDP为1000亿元，今年同比增长8%，则今年GDP为____亿元。',
    ['1080', '1008', '800', '1180'], 'A',
    '1000 × (1+8%) = 1080 亿元。')
}

module.exports = { initDb, getDb, dbPath, configuredDataDir, moveDb }
