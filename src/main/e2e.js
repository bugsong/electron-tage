const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { app } = require('electron')

/**
 * 端到端自检（COMATE_TEST=1 时启用）：
 * 通过真实 preload 桥接层驱动 window.api，验证 主进程 IPC + SQLite 全链路。
 * 使用独立临时 userData，跑完自动退出。
 */
const TEST_SCRIPT = `
(async () => {
  const api = window.api
  const out = {}
  try {
    const tree = await api.categoryTree()
    out.categories = tree.map(n => n.name + '(' + n.total + '/' + n.done + ')')

    out.list = (await api.listQuestions({ page: 1, pageSize: 5 })).total

    const politics = tree.find(n => n.name === '政治理论')
    const xszl = politics.children.find(c => c.name === '新思想总论')
    const s = await api.startPractice({
      type: 'special',
      title: '专项智能练习（新思想总论）',
      categoryIds: [xszl.id],
      count: 2
    })
    let ses = await api.getSession(s.id)
    out.抽题数 = ses.questions.length
    out.题1答案 = ses.questions[0].answer
    out.题2答案 = ses.questions[1].answer

    await api.savePracticeProgress(s.id, ['A', 'B'], 65000)
    ses = await api.getSession(s.id)
    out.进度保存 = JSON.stringify(ses.answers) + ' / ' + ses.durationMs

    // 交卷：第1题答A(错)、第2题答B(对)
    const res = await api.submitPractice(s.id, ['A', 'B'], 70000)
    out.交卷 = JSON.stringify({ total: res.total, correct: res.correct, result: res.result })

    out.错题数 = (await api.listWrong({})).length
    const wrongs = await api.listWrong({})
    out.错题明细 = wrongs.map(w => w.questionId + ':' + w.wrongCount + ':' + w.categoryName)

    const qid = ses.questions[0].id
    out.收藏开 = await api.toggleFavorite(qid)
    out.收藏列表 = (await api.listFavorites()).length
    out.收藏关 = await api.toggleFavorite(qid)

    await api.saveNote(qid, '<b>重点</b>错因：概念混淆')
    out.笔记 = JSON.stringify(await api.getNote(qid))
    out.笔记总数 = (await api.listNotes()).length

    const paths = [
      { tool: 'pen', points: [{ x: 10, y: 10 }, { x: 40, y: 40 }, { x: 80, y: 30 }], lineWidth: 3, color: '#20242c' },
      { tool: 'eraser', points: [{ x: 30, y: 20 }, { x: 50, y: 30 }], lineWidth: 26, color: '#20242c' }
    ]
    await api.saveDraft(qid, paths)
    out.草稿读写 = JSON.stringify(await api.getDraft(qid))
    await api.clearDraft(qid)
    out.草稿清空 = (await api.getDraft(qid)).length

    const st = await api.getStats()
    out.统计 = JSON.stringify({ 累计: st.totalAnswered, 正确率: st.correctRate, 错题: st.wrongCount, 收藏: st.favoriteCount, 笔记: st.noteCount, 进行中: st.activeSession })

    await api.setSetting('fontSize', 'large')
    await api.setSetting('theme', 'dark')
    out.设置 = JSON.stringify(await api.getSettings())

    const importRes = await api.importRows([
      { category1: '政治理论', category2: '时事政治', stem: 'E2E测试题：导入功能验证', options: ['甲', '乙', '丙', '丁'], answer: 'C', analysis: '测试解析' }
    ])
    out.导入 = JSON.stringify(importRes)
    out.导入后搜索 = (await api.listQuestions({ keyword: 'E2E测试题' })).total

    // 错题重练入口
    const wr = await api.startPractice({ type: 'wrong_review', title: '错题重练', count: 5 })
    out.错题重练抽题 = (await api.getSession(wr.id)).questions.length

    return 'PASS ' + JSON.stringify(out, null, 1)
  } catch (err) {
    return 'FAIL: ' + (err && err.stack ? err.stack : String(err))
  }
})()
`

const UI_SCRIPT = `
(async () => {
  const routes = ['/home', '/practice', '/wrong', '/notes', '/favorites', '/questions', '/settings', '/practice/session', '/practice/result']
  const results = []
  for (const r of routes) {
    location.hash = '#' + r
    await new Promise((res) => setTimeout(res, 500))
    const main = document.querySelector('.app-main')
    results.push(r + ' => ' + (main ? main.innerText.replace(/\\n+/g, ' ').slice(0, 50) : 'NO MAIN'))
  }
  return results.join('\\n')
})()
`

function runE2eTest(win) {
  win.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      try {
        const result = await win.webContents.executeJavaScript(TEST_SCRIPT, true)
        console.log('==== E2E RESULT ====')
        console.log(result)
        if (!/^PASS/.test(result)) process.exitCode = 1
      } catch (err) {
        console.error('==== E2E FAILED ====', err)
        process.exitCode = 1
      } finally {
        try {
          fs.rmSync(path.join(os.tmpdir(), 'comate-e2e-test'), {
            recursive: true,
            force: true
          })
        } catch {}
        app.exit(process.exitCode || 0)
      }
    }, 2500)
  })
}

function runUiSmoke(win) {
  win.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      try {
        const result = await win.webContents.executeJavaScript(UI_SCRIPT, true)
        console.log('==== UI SMOKE ====')
        console.log(result)
      } catch (err) {
        console.error('==== UI SMOKE FAILED ====', err)
        process.exitCode = 1
      } finally {
        app.exit(process.exitCode || 0)
      }
    }, 2500)
  })
}

module.exports = { runE2eTest, runUiSmoke }
