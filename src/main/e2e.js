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
    const xszl = politics.children.find(c => c.name === '新思想')
    const s = await api.startPractice({
      type: 'special',
      title: '专项智能练习（新思想）',
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

    // ---- 图片 BLOB + local-image 协议链路 ----
    const canvas = document.createElement('canvas')
    canvas.width = 2000
    canvas.height = 1500
    const cx = canvas.getContext('2d')
    cx.fillStyle = '#4a90d9'
    cx.fillRect(0, 0, 2000, 1500)
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'))
    const imgBuf = new Uint8Array(await blob.arrayBuffer())
    const saved = await api.saveImage(imgBuf)
    out.图片保存 = saved.id ? saved.id.length > 10 : false
    const got = await api.getImage(saved.id)
    out.图片压缩 = got ? got.mime + ':' + got.width + 'x' + got.height : 'null'
    const resp = await fetch('local-image://' + saved.id)
    out.协议加载 = resp.status + ':' + resp.headers.get('content-type')

    // 含 local-image 引用的题目保存与回读
    const csTree = await api.categoryTree()
    const cs = csTree.find((n) => n.name === '常识判断')
    const law = cs.children.find((c) => c.name === '法律常识')
    const imgQ = await api.saveQuestion({
      id: null,
      categoryId: law.id,
      stem: '<p>含图题目</p><img src="local-image://' + saved.id + '">',
      options: ['', '', '', ''],
      answer: 'A',
      analysis: ''
    })
    const imgQGet = await api.getQuestion(imgQ.id)
    out.题目图引用 = /local-image:\\/\\//.test(imgQGet.stem)
    out.空选项题目 = JSON.stringify(imgQGet.options)

    return 'PASS ' + JSON.stringify(out, null, 1)
  } catch (err) {
    return 'FAIL: ' + (err && err.stack ? err.stack : String(err))
  }
})()
`

const UI_SCRIPT = `
(async () => {
  const api = window.api
  const wait = (ms) => new Promise((res) => setTimeout(res, ms))
  const routes = ['/home', '/practice', '/wrong', '/notes', '/favorites', '/questions', '/settings', '/practice/session', '/practice/result']
  const results = []
  for (const r of routes) {
    location.hash = '#' + r
    await wait(500)
    const main = document.querySelector('.app-main')
    results.push(r + ' => ' + (main ? main.innerText.replace(/\\n+/g, ' ').slice(0, 50) : 'NO MAIN'))
  }
  // 富文本编辑器冒烟：打开「新增题目」，检查 WangEditor 工具栏挂载
  location.hash = '#/questions'
  await wait(600)
  const addBtn = [...document.querySelectorAll('button')].find((b) => b.innerText.includes('新增题目'))
  if (addBtn) {
    addBtn.click()
    await wait(1500)
    const rte = document.querySelector('.w-e-toolbar')
    const rteEditor = document.querySelector('.w-e-text-container')
    results.push('rte-editor => ' + (rte && rteEditor ? 'OK' : 'NOT_MOUNTED'))
  } else {
    results.push('rte-editor => NO_ADD_BUTTON')
  }

  // 草纸工具栏冒烟：首次打开应渲染工具栏按钮
  try {
    let tree = await api.categoryTree()
    if (!tree.length) {
      const bigCanvas = document.createElement('canvas')
      bigCanvas.width = 2200
      bigCanvas.height = 1600
      const bctx = bigCanvas.getContext('2d')
      bctx.fillStyle = '#c0392b'
      bctx.fillRect(0, 0, 2200, 1600)
      const bigBlob = await new Promise((r) => bigCanvas.toBlob(r, 'image/png'))
      const savedImg = await api.saveImage(new Uint8Array(await bigBlob.arrayBuffer()))
      await api.importRows([
        { category1: 'UI测试', category2: '子类', stem: '草纸UI测试题1<img src="local-image://' + savedImg.id + '">', options: ['a', 'b', 'c', 'd'], answer: 'A', analysis: '' },
        { category1: 'UI测试', category2: '子类', stem: '草纸UI测试题2<img src="local-image://' + savedImg.id + '">', options: ['a', 'b', 'c', 'd'], answer: 'B', analysis: '' }
      ])
      tree = await api.categoryTree()
    }
    const top = tree[0]
    const sid = await api.startPractice({ type: 'special', title: '草纸UI测试', categoryIds: [top.id], count: 2 })
    location.hash = '#/practice/session?sessionId=' + sid.id
    await wait(1200)

    const cards = document.querySelectorAll('.q-card')
    const sessPage = document.querySelector('.session-page')
    const sessMain = document.querySelector('.app-main')
    results.push('session-width => page=' + (sessPage ? Math.round(sessPage.getBoundingClientRect().width) : -1) + ' card=' + (cards[0] ? Math.round(cards[0].getBoundingClientRect().width) : -1) + ' win=' + window.innerWidth + ' appMain=' + (sessMain ? Math.round(sessMain.getBoundingClientRect().width) : -1))
    const btn0 = cards[0] && cards[0].querySelector('.q-head-right button[title="草纸"]')
    if (btn0) {
      btn0.click()
      await wait(800)
      const tools0 = cards[0].querySelector('.paper-tools')
      const overlay0 = cards[0].querySelector('.paper-overlay')
      const inBounds0 = tools0 && overlay0
        ? tools0.getBoundingClientRect().right <= overlay0.getBoundingClientRect().right + 1
        : false
      results.push('paper-1st-open => ' + (tools0 ? 'OK(' + tools0.querySelectorAll('.tool-btn').length + 'btns' + (inBounds0 ? '' : '/OUT_OF_BOUNDS') + ')' : 'TOOLBAR_MISSING'))
      results.push('paper-1st-overlay => ' + (overlay0 ? overlay0.getBoundingClientRect().width + 'x' + overlay0.getBoundingClientRect().height : 'NO_OVERLAY'))
      const exitBtn = tools0 && tools0.querySelector('.tool-btn.exit')
      if (exitBtn) exitBtn.click()
      await wait(400)
    } else {
      results.push('paper-1st-open => NO_PAPER_BTN')
    }

    if (cards[1]) {
      const btn1 = cards[1].querySelector('.q-head-right button[title="草纸"]')
      if (btn1) {
        btn1.click()
        await wait(800)
        const tools1 = cards[1].querySelector('.paper-tools')
        const overlay1 = cards[1].querySelector('.paper-overlay')
        const inBounds1 = tools1 && overlay1
          ? tools1.getBoundingClientRect().right <= overlay1.getBoundingClientRect().right + 1
          : false
        results.push('paper-2nd-open => ' + (tools1 ? 'OK(' + tools1.querySelectorAll('.tool-btn').length + 'btns' + (inBounds1 ? '' : '/OUT_OF_BOUNDS') + ')' : 'TOOLBAR_MISSING'))
      }
    }

    // 编辑回显冒烟：打开含图题目的编辑弹窗，题干富文本应回显图片
    const echoStem = '编辑回显测试' + Date.now()
    const echoCanvas = document.createElement('canvas')
    echoCanvas.width = 800
    echoCanvas.height = 500
    echoCanvas.getContext('2d').fillStyle = '#2f7bf6'
    echoCanvas.getContext('2d').fillRect(0, 0, 800, 500)
    const echoBlob = await new Promise((r) => echoCanvas.toBlob(r, 'image/png'))
    const echoImg = await api.saveImage(new Uint8Array(await echoBlob.arrayBuffer()))
    await api.importRows([
      { category1: 'UI测试', category2: '子类', stem: echoStem + '<img src="local-image://' + echoImg.id + '">', options: ['a', 'b', 'c', 'd'], answer: 'A', analysis: '' }
    ])
    location.hash = '#/questions'
    await wait(1200)
    const qmRows = [...document.querySelectorAll('.qm-row')]
    const target = qmRows.find((r) => r.innerText.includes('编辑回显测试'))
    if (target) {
      const editBtn = [...target.querySelectorAll('button')].find((b) => b.innerText.trim() === '编辑')
      if (editBtn) {
        editBtn.click()
        await wait(1200)
        const rteContainer = document.querySelector('.w-e-text-container')
        const hasImg = rteContainer ? !!rteContainer.querySelector('img') : false
        const rteHtml = rteContainer ? rteContainer.innerHTML.slice(0, 500) : ''
        const rteText = rteContainer ? rteContainer.innerText.slice(0, 40) : ''
        results.push('edit-echo => ' + (hasImg ? 'OK(has-img)' : 'NO_IMG') + ' text=' + rteText.replace(/\\n/g, '|'))
        results.push('edit-echo-html => ' + rteHtml.replace(/\\n/g, ' '))
        const closeBtn = [...document.querySelectorAll('.modal-header button, .modal-footer button')].find(
          (b) => b.innerText.includes('取消') || b.innerText.includes('关闭')
        )
        if (closeBtn) closeBtn.click()
        await wait(300)
      } else {
        results.push('edit-echo => NO_EDIT_BTN')
      }
    } else {
      results.push('edit-echo => NO_ROW')
    }

    // 空选项题目：做题时应显示 A/B/C/D 四个槽
    try {
      await api.importRows([{ category1: '空选项分类', category2: '', stem: '空选项占位题', options: ['a', 'b', 'c', 'd'], answer: 'A', analysis: '' }])
      const t3 = await api.categoryTree()
      const emptyCat = t3.find((n) => n.name === '空选项分类')
      const qs3 = await api.listQuestions({ categoryId: emptyCat.id, page: 1, pageSize: 10 })
      for (const q of qs3.items) await api.deleteQuestion(q.id)
      const eq = await api.saveQuestion({ id: null, categoryId: emptyCat.id, stem: '空选项题目测试', options: ['', '', '', ''], answer: 'A', analysis: '' })
      const eqs = await api.startPractice({ type: 'special', title: '空选项测试', categoryIds: [emptyCat.id], count: 1 })
      location.hash = '#/practice/session?sessionId=' + eqs.id
      await wait(1000)
      const card = document.querySelector('.q-card')
      const optCount = card ? card.querySelectorAll('.q-option').length : 0
      const letters = card ? [...card.querySelectorAll('.q-letter')].map((s) => s.innerText).join('') : ''
      results.push('empty-options => slots=' + optCount + ' letters=' + letters)

      // 回看页冒烟：答题卡点查看进入独立回看页，草纸工具栏应正常、页面宽为应用内容区80%
      location.hash = '#/practice/review?sessionId=' + eqs.id + '&index=0'
      await wait(1000)
      const rvPage = document.querySelector('.review-page')
      const appMain = document.querySelector('.app-main')
      const mcs = appMain ? getComputedStyle(appMain) : null
      const contentW = appMain && mcs
        ? appMain.clientWidth - parseFloat(mcs.paddingLeft) - parseFloat(mcs.paddingRight)
        : window.innerWidth
      const rvW = rvPage ? Math.round((rvPage.getBoundingClientRect().width / contentW) * 100) : -1
      results.push('review-width => ' + rvW + '%')
      results.push('review-w-abs => ' + (rvPage ? Math.round(rvPage.getBoundingClientRect().width) : -1))
      results.push('window-info => win=' + window.innerWidth + ' appMain=' + (appMain ? appMain.getBoundingClientRect().width : -1) + ' content=' + Math.round(contentW))
      const rvCard = rvPage ? rvPage.querySelector('.q-card') : null
      const rvBtn = rvCard ? rvCard.querySelector('.q-head-right button[title="草纸"]') : null
      if (rvBtn) {
        rvBtn.click()
        await wait(600)
        const rvTools = rvPage.querySelector('.paper-tools')
        const rvIn = rvTools
          ? rvTools.getBoundingClientRect().right <= rvCard.getBoundingClientRect().right + 1
          : false
        results.push('review-paper => ' + (rvTools ? 'OK(' + rvTools.querySelectorAll('.tool-btn').length + 'btns' + (rvIn ? '' : '/OUT_OF_BOUNDS') + ')' : 'TOOLBAR_MISSING'))
        const rvExit = rvTools && rvTools.querySelector('.tool-btn.exit')
        if (rvExit) rvExit.click()
      } else {
        results.push('review-paper => NO_PAPER_BTN')
      }

      // 错题复盘冒烟：错题本 → 复盘 → 独立回看页（与答题卡查看一致：QuestionCard + 草纸 + 80% 宽）
      try {
        await api.submitPractice(eqs.id, ['B'], 10)
        location.hash = '#/wrong'
        await wait(800)
        const wrongRows = document.querySelectorAll('.wrong-row')
        const fkBtn = wrongRows[0]
          ? [...wrongRows[0].querySelectorAll('button')].find((b) => b.innerText.trim() === '复盘')
          : null
        if (fkBtn) {
          fkBtn.click()
          await wait(1000)
          const wPage = document.querySelector('.review-page')
          const wTitle = wPage ? wPage.querySelector('.rv-title') : null
          const wAppMain = document.querySelector('.app-main')
          const wMcs = wAppMain ? getComputedStyle(wAppMain) : null
          const wContentW = wAppMain && wMcs
            ? wAppMain.clientWidth - parseFloat(wMcs.paddingLeft) - parseFloat(wMcs.paddingRight)
            : window.innerWidth
          const wW = wPage ? Math.round((wPage.getBoundingClientRect().width / wContentW) * 100) : -1
          const wCard = wPage ? wPage.querySelector('.q-card') : null
          const wBtn = wCard ? wCard.querySelector('.q-head-right button[title="草纸"]') : null
          results.push('wrong-review-page => ' + (wPage ? 'OK title=' + (wTitle ? wTitle.innerText : '') + ' w=' + wW + '% cards=' + wPage.querySelectorAll('.q-card').length : 'NO_PAGE'))
          if (wBtn) {
            wBtn.click()
            await wait(800)
            const wTools = document.querySelector('.paper-tools')
            const wIn = wTools
              ? wTools.getBoundingClientRect().right <= wCard.getBoundingClientRect().right + 1
              : false
            results.push('wrong-review-paper => ' + (wTools ? 'OK(' + wTools.querySelectorAll('.tool-btn').length + 'btns' + (wIn ? '' : '/OUT_OF_BOUNDS') + ')' : 'TOOLBAR_MISSING'))
            const wExit = wTools && wTools.querySelector('.tool-btn.exit')
            if (wExit) wExit.click()
            await wait(300)
          } else {
            results.push('wrong-review-paper => NO_PAPER_BTN')
          }
        } else {
          results.push('wrong-review-page => NO_WRONG_ROW')
        }
      } catch (err) {
        results.push('wrong-review-page => ERR ' + String(err).slice(0, 100))
      }

      // 笔记/收藏过滤冒烟：两个页面都应具备 搜索题干/全部分类/搜索/重置，且按关键词过滤生效
      try {
        await api.toggleFavorite(eq.id)
        await api.saveNote(eq.id, '过滤测试笔记内容')
        const polCat = (await api.categoryTree()).find((n) => n.name === '政治理论')
        const polQ = polCat ? await api.listQuestions({ categoryId: polCat.id, page: 1, pageSize: 1 }) : null
        if (polQ && polQ.items && polQ.items.length) {
          const favs = await api.listFavorites({})
          if (!favs.some((f) => f.questionId === polQ.items[0].id)) await api.toggleFavorite(polQ.items[0].id)
        }

        location.hash = '#/notes'
        await wait(800)
        const nFilter = document.querySelector('.page .filter-bar')
        const nSel = nFilter ? nFilter.querySelector('select') : null
        const nBtns = nFilter ? [...nFilter.querySelectorAll('button')].map((b) => b.innerText.trim()).join(',') : ''
        results.push('notes-filter => ' + (nFilter ? 'OK sel=' + (nSel ? nSel.options.length : 0) + ' btns=' + nBtns : 'NO_FILTER'))
        const emptyCat = (await api.categoryTree()).find((n) => n.name === '空选项分类')
        if (nSel && emptyCat) {
          nSel.value = String(emptyCat.id)
          nSel.dispatchEvent(new Event('change'))
          await wait(800)
          results.push('notes-filter-cat => ' + document.querySelectorAll('.note-item').length + 'items')
        }
        if (nSel) {
          nSel.value = ''
          nSel.dispatchEvent(new Event('change'))
          await wait(400)
        }
        if (nFilter) {
          const nInput = nFilter.querySelector('input')
          nInput.value = '过滤测试'
          nInput.dispatchEvent(new Event('input'))
          const nSearch = [...nFilter.querySelectorAll('button')].find((b) => b.innerText.trim() === '搜索')
          if (nSearch) {
            nSearch.click()
            await wait(800)
          }
          results.push('notes-filter-search => ' + document.querySelectorAll('.note-item').length + 'items')
        }

        location.hash = '#/favorites'
        await wait(800)
        const fFilter = document.querySelector('.page .filter-bar')
        const fSel = fFilter ? fFilter.querySelector('select') : null
        const fBtns = fFilter ? [...fFilter.querySelectorAll('button')].map((b) => b.innerText.trim()).join(',') : ''
        results.push('favorites-filter => ' + (fFilter ? 'OK sel=' + (fSel ? fSel.options.length : 0) + ' btns=' + fBtns : 'NO_FILTER'))
        if (fSel && emptyCat) {
          fSel.value = String(emptyCat.id)
          fSel.dispatchEvent(new Event('change'))
          await wait(800)
          results.push('favorites-filter-cat => ' + document.querySelectorAll('.fav-row').length + 'items')
        }
        if (fSel && polCat) {
          fSel.value = String(polCat.id)
          fSel.dispatchEvent(new Event('change'))
          await wait(800)
          results.push('favorites-filter-topcat => ' + document.querySelectorAll('.fav-row').length + 'items')
        }
        if (fSel) {
          fSel.value = ''
          fSel.dispatchEvent(new Event('change'))
          await wait(400)
        }
        if (fFilter) {
          const fInput = fFilter.querySelector('input')
          fInput.value = '空选项题目'
          fInput.dispatchEvent(new Event('input'))
          const fSearch = [...fFilter.querySelectorAll('button')].find((b) => b.innerText.trim() === '搜索')
          if (fSearch) {
            fSearch.click()
            await wait(800)
          }
          results.push('favorites-filter-search => ' + document.querySelectorAll('.fav-row').length + 'items')
        }
      } catch (err) {
        results.push('notes-filter => ERR ' + String(err).slice(0, 100))
      }
    } catch (err) {
      results.push('empty-options => ERR ' + String(err).slice(0, 100))
    }
  } catch (err) {
    results.push('paper-test => ERR ' + String(err && err.stack ? err.stack : err).slice(0, 120))
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
