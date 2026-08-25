const XLSX = require('xlsx')

/**
 * 解析 Excel 题库文件，返回规范化题目行。
 * 列名兼容常见写法（大小写/中英文标点不做强要求）：
 *   一级分类 / 二级分类 / 分类 | 题干 / 题目 | A B C D（或 选项A、A选项）
 *   答案 / 正确答案 | 解析 / 答案解析
 */
function normalizeKey(key) {
  return String(key == null ? '' : key).trim().toLowerCase().replace(/[\s：:。.（）()]/g, '')
}

function detectColumn(header) {
  const k = normalizeKey(header)
  if (!k) return null
  if (k.includes('一级') || k.includes('大类')) return 'category1'
  if (k.includes('二级') || k.includes('小类')) return 'category2'
  if (k === '分类' || k === '类别') return 'category'
  if (k.includes('题干') || k.includes('题目') || k === '题' || k.includes('题干内容')) return 'stem'
  if (k.includes('解析') || k.includes('答案解释')) return 'analysis'
  if (k.includes('答案') || k === '正确' || k === '正确答案') return 'answer'
  const m = k.match(/^([abcd])(选项)?$/) || k.match(/^选项([abcd])$/) || k.match(/^([abcd])选项$/)
  if (m) return 'option' + m[1].toUpperCase()
  return null
}

function normalizeRow(raw, rowIndex) {
  const mapped = { rowIndex }
  for (const [header, value] of Object.entries(raw)) {
    const col = detectColumn(header)
    if (!col) continue
    if (col.startsWith('option')) {
      mapped[col] = String(value == null ? '' : value).trim()
    } else if (col === 'answer') {
      mapped.answer = String(value == null ? '' : value).trim().toUpperCase()
    } else {
      mapped[col] = String(value == null ? '' : value).trim()
    }
  }

  const errors = []
  if (!mapped.stem) errors.push('缺少题干')
  if (!mapped.optionA && !mapped.optionB && !mapped.optionC && !mapped.optionD) errors.push('缺少选项')
  if (!['A', 'B', 'C', 'D'].includes(mapped.answer)) errors.push('答案必须为 A/B/C/D')

  return {
    category1: mapped.category1 || '',
    category2: mapped.category2 || '',
    category: mapped.category || '',
    stem: mapped.stem || '',
    options: [mapped.optionA || '', mapped.optionB || '', mapped.optionC || '', mapped.optionD || ''],
    answer: mapped.answer || '',
    analysis: mapped.analysis || '',
    rowIndex,
    errors
  }
}

/**
 * 读取 Excel 第一个工作表，返回 { rows, errors }
 * rows 为通过校验的题目行；errors 为带错误说明的行
 */
function parseExcel(filePath) {
  const wb = XLSX.readFile(filePath)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rawRows = XLSX.utils.sheet_to_json(ws, { defval: '', header: 'A' })
  // sheet_to_json 默认把首行当表头；header:'A' 时返回 {A:..,B:..}，首行是表头
  // 上面用 header:'A' 取到的是带列键的对象，需要转成 {表头: 值}
  const headerRow = rawRows[0] || {}
  const dataRows = rawRows.slice(1)
  const headerMap = {}
  for (const [key, val] of Object.entries(headerRow)) {
    if (String(val).trim()) headerMap[key] = String(val).trim()
  }
  const normalized = []
  dataRows.forEach((row, idx) => {
    const values = Object.values(row).filter((v) => String(v).trim() !== '')
    if (values.length === 0) return // 跳过空行
    const obj = {}
    for (const [key, val] of Object.entries(row)) {
      if (headerMap[key]) obj[headerMap[key]] = val
    }
    normalized.push(normalizeRow(obj, idx + 2))
  })
  const valid = normalized.filter((r) => r.errors.length === 0)
  const errors = normalized.filter((r) => r.errors.length > 0).map((r) => ({
    rowIndex: r.rowIndex,
    errors: r.errors,
    stem: r.stem ? r.stem.slice(0, 50) : ''
  }))
  return { rows: valid, errors }
}

module.exports = { parseExcel }
