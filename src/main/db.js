const path = require('node:path')
const fs = require('node:fs')
const { app } = require('electron')

// 使用 Node 内置 node:sqlite（Electron 36+ / Node 22.13+ 起可用），
// 避免 better-sqlite3 原生模块在 Windows 上编译/重编译的麻烦。
let DatabaseSync = null
try {
  ;({ DatabaseSync } = require('node:sqlite'))
} catch {
  DatabaseSync = null
}

let db = null

function getDb() {
  if (!db) throw new Error('数据库尚未初始化')
  return db
}

function dbPath() {
  return path.join(app.getPath('userData'), 'comate.db')
}

function initDb() {
  if (!DatabaseSync) {
    throw new Error('当前 Electron 内置的 Node 版本不支持 node:sqlite（需 Node 22.13+）')
  }
  const dir = app.getPath('userData')
  fs.mkdirSync(dir, { recursive: true })
  db = new DatabaseSync(dbPath())
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  createSchema()
  seedIfEmpty()
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
}

/* ---------------- 种子数据 ---------------- */

const TOP_CATEGORIES = [
  '政治理论',
  '常识判断',
  '言语理解与表达',
  '数量关系',
  '判断推理',
  '资料分析'
]

const POLITICS_CHILDREN = [
  '新思想',
  '新思想总论',
  '五位一体建设',
  '其他建设',
  '时事政治',
  '马克思主义',
  '毛中特'
]

function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM categories').get().c
  if (count === 0) {
    const insCat = db.prepare('INSERT INTO categories (parent_id, name, sort) VALUES (?, ?, ?)')
    TOP_CATEGORIES.forEach((name, i) => insCat.run(null, name, i + 1))
    const politics = db.prepare("SELECT id FROM categories WHERE name = '政治理论'").get().id
    POLITICS_CHILDREN.forEach((name, i) => insCat.run(politics, name, i + 1))
  }

  const qCount = db.prepare('SELECT COUNT(*) AS c FROM questions').get().c
  if (qCount === 0) {
    seedDemoQuestions()
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

  add('新思想总论',
    '中国特色社会主义进入新时代，我国社会主要矛盾已经转化为人民日益增长的____需要和不平衡不充分的发展之间的矛盾。',
    ['物质文化', '美好生活', '精神文化', '幸福生活'], 'B',
    '十九大报告指出，我国社会主要矛盾转化为人民日益增长的美好生活需要和不平衡不充分的发展之间的矛盾。')

  add('新思想总论',
    '中国特色社会主义最本质的特征是____。',
    ['人民民主专政', '中国共产党领导', '人民代表大会制度', '依法治国'], 'B',
    '党的领导是中国特色社会主义最本质的特征和最大优势。')

  add('时事政治',
    '中央经济工作会议强调，要坚持____工作总基调，完整、准确、全面贯彻新发展理念。',
    ['稳中求进', '全面深化', '高质量发展', '扩大内需'], 'A',
    '稳中求进是近年中央经济工作会议一以贯之的工作总基调。')

  add('常识判断',
    '我国现行宪法是哪一年颁布的？',
    ['1949年', '1954年', '1978年', '1982年'], 'B',
    '1954年宪法是我国第一部社会主义宪法，现行宪法为1982年宪法。')

  add('常识判断',
    '下列能源中属于可再生能源的是____。',
    ['煤炭', '石油', '太阳能', '天然气'], 'C',
    '太阳能取之不尽，属可再生能源；煤、石油、天然气均为化石能源。')

  add('言语理解与表达',
    '现代社会分工越来越细，每个人只有____、各展所长，整体才能形成合力。',
    ['各司其职', '各行其是', '各自为政', '各奔前程'], 'A',
    '“各司其职”指各自负责本职，与“各展所长”“形成合力”语境吻合。')

  add('言语理解与表达',
    '“看待问题不能只看一面，还要看到另一面”，意在强调要____地认识问题。',
    ['全面', '片面', '静止', '孤立'], 'A',
    '“看到另一面”即从多个角度认识，强调全面性。')

  add('数量关系',
    '甲、乙两人从相距100千米的两地同时相向而行，甲每小时行5千米，乙每小时行4千米，问几小时后两人相遇？',
    ['10小时', '11小时', '约11.1小时', '9小时'], 'C',
    '相遇时间 = 总路程 ÷ 速度和 = 100 ÷ (5+4) ≈ 11.1 小时。')

  add('数量关系',
    '一件商品原价100元，先提价10%，再降价10%，现价为____元。',
    ['100', '99', '101', '90'], 'B',
    '100×1.1×0.9 = 99 元，先涨后降最终低于原价。')

  add('判断推理',
    '已知：所有党员都缴纳党费，张三是党员。由此可以推出____。',
    ['缴纳党费的都是党员', '张三缴纳了党费', '非党员都不缴纳党费', '张三不是党员'], 'B',
    '三段论：张三（党员）属于“党员”集合，必缴纳党费。')

  add('判断推理',
    '如果所有的猫都是动物，那么以下说法必然正确的是____。',
    ['所有动物都是猫', '有些动物是猫', '没有动物是猫', '有些猫不是动物'], 'B',
    '“所有猫都是动物”等价于“猫”集合是“动物”集合的子集，故至少有些动物是猫。')

  add('资料分析',
    '某市去年GDP为1000亿元，今年同比增长8%，则今年GDP为____亿元。',
    ['1080', '1008', '800', '1180'], 'A',
    '1000 × (1+8%) = 1080 亿元。')
}

module.exports = { initDb, getDb, dbPath }
