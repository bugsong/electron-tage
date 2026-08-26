import { api } from '../api'

/**
 * 会话类型 → 返回来源路由
 * 原 SessionView / ResultView 各写了一份相同的 origin 计算，统一到此。
 */
export function sessionOrigin(type) {
  if (type === 'wrong_review') return '/wrong'
  if (type === 'favorite') return '/favorites'
  return '/practice'
}

/**
 * 进度百分比（已做/总题数）
 * 原 HomeView / PracticeView 各写了一份相同的 barPercent，统一到此。
 */
export function barPercent(node) {
  if (!node || !node.total) return 0
  return Math.round((node.done / node.total) * 100)
}

/**
 * 把错题/收藏/笔记列表行归一成 QuestionCard 需要的题目形状
 * 原 ReviewView 的错题/笔记/收藏三个分支各写了一份相同的 .map(...)，统一到此。
 */
export function normalizeQuestion(row) {
  return {
    id: row.questionId,
    questionId: row.questionId,
    stem: row.stem,
    options: row.options,
    answer: row.answer,
    analysis: row.analysis,
    categoryName: row.categoryName
  }
}
