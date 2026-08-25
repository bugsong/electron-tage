const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
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

    // 草纸画笔/橡皮参数持久化
    await api.setSetting('penSize', 'bold')
    await api.setSetting('penColor', '#e5484d')
    await api.setSetting('eraserSize', 'thin')
    await api.setSetting('eraserMode', 'stroke')
    const paperPrefs = await api.getSettings()
    out.纸笔参数 = JSON.stringify({
      penSize: paperPrefs.penSize,
      penColor: paperPrefs.penColor,
      eraserSize: paperPrefs.eraserSize,
      eraserMode: paperPrefs.eraserMode
    })

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

    // 批量删除（题库管理模式）：保存后按 id 批量删除
    const bdQ = await api.saveQuestion({
      id: null,
      categoryId: politics.id,
      stem: 'E2E批量删除测试题',
      options: ['甲', '乙', '丙', '丁'],
      answer: 'A',
      analysis: ''
    })
    const bdRes = await api.deleteQuestions([bdQ.id, 999999])
    out.批量删除 = JSON.stringify(bdRes)
    out.批量删除后 = (await api.listQuestions({ keyword: 'E2E批量删除测试题' })).total

    // ---- 数据位置迁移：迁到子目录 → 校验数据完整 → 迁回原位置 ----
    const oldDbPath = await api.getDbPath()
    const dbBase = oldDbPath.replace(/[\\\\/]tage\.db$/, '')
    const qTotalBefore = (await api.listQuestions({})).total
    const wrongBefore = (await api.listWrong({})).length
    const r1 = await api.moveDb(dbBase + '/migrated')
    out.迁移1 = JSON.stringify(r1)
    out.迁移后路径 = await api.getDbPath()
    out.迁移后题目数 = (await api.listQuestions({})).total
    out.迁移后错题 = (await api.listWrong({})).length
    out.迁移后分类 = (await api.categoryTree()).map((n) => n.name).join(',')
    const r2 = await api.moveDb(dbBase)
    out.迁移回 = JSON.stringify(r2)
    out.迁回后路径 = await api.getDbPath()
    out.数据一致 = (await api.listQuestions({})).total === qTotalBefore && (await api.listWrong({})).length === wrongBefore

    return 'PASS ' + JSON.stringify(out, null, 1)
  } catch (err) {
    return 'FAIL: ' + (err && err.stack ? err.stack : String(err))
  }
})()
`

/**
 * 关于页授权冒烟（可被全量 UI_SCRIPT 引用，也可用 COMATE_UI_SCOPE=about 单独跑）。
 * __TEST_ACTIVATION_CODE__ 为占位符，运行时替换为主进程用测试密钥对生成的合法进阶码；
 * 测试公钥通过 license._test.setPublicKey 注入，私钥仅在内存生成、不落盘。
 */
const ABOUT_CHECK = `
  // 关于页授权冒烟：非法进阶码被拒 → 合法进阶码激活 → 输入框消失/已激活提示 → 进阶版金色高亮 → 重进持久化
  try {
    location.hash = '#/about'
    await wait(500)
    const licCard = [...document.querySelectorAll('.card')].find((c) => c.innerText.includes('授权进阶版'))
    const cmpCard = [...document.querySelectorAll('.card')].find((c) => c.innerText.includes('草纸进阶版对比'))
    const input = licCard && licCard.querySelector('.license-form input')
    const actBtn = licCard && licCard.querySelector('.license-form button')

    // 初始状态：未激活时展示输入框与「进阶」按钮、无「已激活进阶版」提示
    const initialOk = !!input && !!actBtn && !!cmpCard && actBtn.innerText.includes('进阶') && !licCard.innerText.includes('已激活进阶版')

    // 1) 非法进阶码：点击进阶后仍保持未激活
    let invalidRejected = false
    if (input) {
      input.value = 'invalid-code-without-pipe'
      input.dispatchEvent(new Event('input'))
      await wait(80)
      actBtn.click()
      await wait(600)
      invalidRejected = licCard && !licCard.innerText.includes('已激活进阶版')
    }

    // 2) 合法进阶码：进阶成功，输入框消失、显示「已激活进阶版」
    const input2 = licCard && licCard.querySelector('.license-form input')
    const actBtn2 = licCard && licCard.querySelector('.license-form button')
    let activated = false
    if (input2) {
      input2.value = '__TEST_ACTIVATION_CODE__'
      input2.dispatchEvent(new Event('input'))
      await wait(80)
      actBtn2.click()
      await wait(800)
      activated = licCard && !licCard.querySelector('.license-form') && licCard.innerText.includes('已激活进阶版')
    }

    // 3) 激活后：对比表进阶版列金色高亮（pro-active 生效）；生成提示文案不再展示
    const proHighlight = cmpCard && cmpCard.classList.contains('pro-active')
    const noteHidden = licCard && !licCard.innerText.includes('进阶码由开发者')

    // 4) 激活后：设置页不再展示「设备唯一信息」卡片；持久化（重进关于页仍显示已激活）
    location.hash = '#/settings'
    await wait(500)
    const stCard = [...document.querySelectorAll('.st-card')].find((c) => c.innerText.includes('设备唯一信息'))
    const settingsCardHidden = !stCard
    location.hash = '#/about'
    await wait(500)
    const licCard2 = [...document.querySelectorAll('.card')].find((c) => c.innerText.includes('授权进阶版'))
    const persisted = licCard2 && licCard2.innerText.includes('已激活进阶版')

    // 5) 直接 IPC：非法进阶码返回 { ok:false }
    const ipcBad = await api.verifyActivationCode('bad-code')
    results.push('about-license => ' + (initialOk && invalidRejected && activated && proHighlight && noteHidden && settingsCardHidden && persisted && !ipcBad.ok ? 'OK' : 'initial=' + initialOk + ' invalid=' + invalidRejected + ' activated=' + activated + ' pro=' + proHighlight + ' note=' + noteHidden + ' settingsCard=' + settingsCardHidden + ' persisted=' + persisted + ' ipcBad=' + JSON.stringify(ipcBad)))
  } catch (err) {
    results.push('about-license => ERR ' + String(err).slice(0, 120))
  }
`

/**
 * 普通版草纸冒烟：未激活时草纸无粗细/颜色/擦除方式设置、画笔固定红色、橡皮仅像素擦除。
 * 嵌入全量 UI_SCRIPT，也可用 COMATE_UI_SCOPE=paper 单独跑。
 */
const PAPER_FREE_CHECK = `
  // 普通版草纸冒烟：无设置面板、画笔固定红色、橡皮仅像素擦除
  try {
    const tree = await api.categoryTree()
    const top = tree[0]
    const sid = await api.startPractice({ type: 'special', title: '普通版草纸测试', categoryIds: [top.id], count: 1 })
    location.hash = '#/practice/session?sessionId=' + sid.id
    await wait(1200)
    const card = document.querySelector('.q-card')
    const pbtn = card && card.querySelector('.q-head-right button[title="草纸"]')
    if (pbtn) {
      pbtn.click()
      await wait(800)
      const tools = card.querySelector('.paper-tools')
      const settingsHidden = tools && !tools.querySelector('.tool-settings')
      // 画笔固定红色：画一笔并读取像素（#e5484d）
      let penRed = false
      const penBtn = tools && [...tools.querySelectorAll('.tool-btn')].find((b) => b.title === '画笔')
      if (penBtn) {
        penBtn.click()
        await wait(150)
        const cv = card.querySelector('.paper-canvas')
        const rect = cv.getBoundingClientRect()
        const dpr = window.devicePixelRatio || 1
        const mk = (type, x, y) => cv.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: rect.left + x, clientY: rect.top + y }))
        const y0 = 200, x0 = 320
        mk('mousedown', x0, y0)
        for (let i = 1; i <= 6; i++) { mk('mousemove', x0 + i * 8, y0); await wait(25) }
        mk('mouseup', x0 + 48, y0)
        await wait(200)
        const px = cv.getContext('2d').getImageData(Math.round((x0 + 24) * dpr), Math.round(y0 * dpr), 1, 1).data
        penRed = px[3] > 30 && px[0] > 180 && px[1] < 120 && px[2] < 130
      }
      // 橡皮仅像素擦除：无「整笔擦除」选项
      let pixelOnly = false
      const eraserBtn = tools && [...tools.querySelectorAll('.tool-btn')].find((b) => b.title === '橡皮')
      if (eraserBtn) {
        eraserBtn.click()
        await wait(150)
        pixelOnly = ![...tools.querySelectorAll('.ts-btn')].some((b) => b.innerText.trim() === '整笔擦除')
      }
      results.push('paper-free => ' + (settingsHidden && penRed && pixelOnly ? 'OK' : 'settings=' + (settingsHidden ? 'hidden' : 'SHOWN') + ' red=' + penRed + ' pixelOnly=' + pixelOnly))
      const exitBtn = tools && tools.querySelector('.tool-btn.exit')
      if (exitBtn) exitBtn.click()
      await wait(300)
    } else {
      results.push('paper-free => NO_PAPER_BTN')
    }
    try { await api.abandonPractice(sid.id) } catch {}
  } catch (err) {
    results.push('paper-free => ERR ' + String(err).slice(0, 120))
  }
`

/**
 * 进阶版草纸冒烟：激活后草纸展示粗细/颜色/擦除方式设置，整笔擦除可用（拖影自动清除）。
 * 嵌入全量 UI_SCRIPT（紧随关于页激活之后），也可用 COMATE_UI_SCOPE=about 与关于页一起跑。
 */
const PAPER_PRO_CHECK = `
  // 进阶版草纸冒烟：设置面板出现、整笔擦除拖影清除
  try {
    const tree = await api.categoryTree()
    const top = tree[0]
    const sid = await api.startPractice({ type: 'special', title: '进阶版草纸测试', categoryIds: [top.id], count: 1 })
    location.hash = '#/practice/session?sessionId=' + sid.id
    await wait(1200)
    const card = document.querySelector('.q-card')
    const pbtn = card && card.querySelector('.q-head-right button[title="草纸"]')
    if (pbtn) {
      pbtn.click()
      await wait(800)
      const tools = card.querySelector('.paper-tools')
      const settingsShown = !!(tools && tools.querySelector('.tool-settings'))
      const swatches = tools ? tools.querySelectorAll('.ts-swatch').length : 0
      const eraserBtn = tools && [...tools.querySelectorAll('.tool-btn')].find((b) => b.title === '橡皮')
      if (eraserBtn) eraserBtn.click()
      await wait(150)
      const modeBtns = tools ? tools.querySelectorAll('.ts-mode').length : 0
      // 整笔擦除：空白处划过后拖影应自动清除（画布上不残留蓝色高亮像素）
      let trailOk = false
      const strokeBtn = tools && [...tools.querySelectorAll('.ts-btn')].find((b) => b.innerText.trim() === '整笔擦除')
      if (strokeBtn) {
        strokeBtn.click()
        await wait(150)
        const cv = card.querySelector('.paper-canvas')
        const rect = cv.getBoundingClientRect()
        const dpr = window.devicePixelRatio || 1
        const mk = (type, x, y) => cv.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: rect.left + x, clientY: rect.top + y }))
        const path = [[24, 24], [70, 34], [120, 44]]
        mk('mousedown', path[0][0], path[0][1])
        for (let i = 1; i < path.length; i++) { mk('mousemove', path[i][0], path[i][1]); await wait(30) }
        mk('mouseup', path[path.length - 1][0], path[path.length - 1][1])
        await wait(250)
        const cctx = cv.getContext('2d')
        let blue = 0
        for (const [x, y] of path) {
          const d = cctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data
          if (d[3] > 20 && d[2] > d[0] + 40 && d[2] > 120) blue++
        }
        trailOk = blue === 0
      }
      results.push('paper-pro-options => ' + (settingsShown && swatches > 0 && modeBtns >= 2 && trailOk ? 'OK(swatches=' + swatches + ' modes=' + modeBtns + ')' : 'settings=' + (settingsShown ? 'Y' : 'N') + ' swatches=' + swatches + ' modes=' + modeBtns + ' trail=' + trailOk))
      const exitBtn = tools && tools.querySelector('.tool-btn.exit')
      if (exitBtn) exitBtn.click()
      await wait(300)
    } else {
      results.push('paper-pro-options => NO_PAPER_BTN')
    }
    try { await api.abandonPractice(sid.id) } catch {}
  } catch (err) {
    results.push('paper-pro-options => ERR ' + String(err).slice(0, 120))
  }
`

const UI_SCRIPT = `
(async () => {
  const api = window.api
  const wait = (ms) => new Promise((res) => setTimeout(res, ms))
  const routes = ['/home', '/practice', '/wrong', '/notes', '/favorites', '/questions', '/settings', '/about', '/practice/session', '/practice/result']
  const results = []

  // 等待应用与路由真正就绪（冷启动/机器繁忙时主线程可能延迟数秒），避免导航竞态
  async function waitAppReady() {
    for (let i = 0; i < 60; i++) {
      location.hash = '#/practice'
      await wait(400)
      const main = document.querySelector('.app-main')
      const tag = main && main.querySelector('.page-title-tag')
      if (tag && tag.innerText.includes('练习')) return true
    }
    return false
  }
  results.push('app-ready => ' + (await waitAppReady() ? 'OK' : 'TIMEOUT'))

  for (const r of routes) {
    location.hash = '#' + r
    await wait(500)
    const main = document.querySelector('.app-main')
    results.push(r + ' => ' + (main ? main.innerText.replace(/\\n+/g, ' ').slice(0, 50) : 'NO MAIN'))
  }
  // 练习进度条冒烟：一级分类渲染进度条，展开后子分类也有进度条
  try {
    location.hash = '#/practice'
    await wait(600)
    const topBars = document.querySelectorAll('.pnode > .pprogress .progress-fill')
    const firstArrow = document.querySelector('.ptree .parrow')
    if (firstArrow) {
      firstArrow.click()
      await wait(400)
    }
    const childBars = document.querySelectorAll('.pchild .progress-fill')
    results.push('practice-progress => top=' + topBars.length + ' child=' + childBars.length)
  } catch (err) {
    results.push('practice-progress => ERR ' + String(err).slice(0, 80))
  }
  // 自定义刷题弹窗：分类树默认全部收起（政治理论不应展开）
  try {
    location.hash = '#/practice'
    await wait(500)
    const composeBtn = [...document.querySelectorAll('button')].find((b) => b.innerText.includes('自定义刷题'))
    if (composeBtn) {
      composeBtn.click()
      await wait(500)
      const openGroups = document.querySelectorAll('.cc-group .cc-children').length
      const openArrows = document.querySelectorAll('.cc-arrow.open').length
      results.push('custom-compose-collapsed => ' + (openGroups === 0 && openArrows === 0 ? 'OK' : 'EXPANDED(groups=' + openGroups + ',arrows=' + openArrows + ')'))
      const closeBtn = [...document.querySelectorAll('.modal-footer button, .modal-header button')].find(
        (b) => b.innerText.includes('取消') || b.innerText.includes('关闭')
      )
      if (closeBtn) closeBtn.click()
      await wait(300)
    } else {
      results.push('custom-compose-collapsed => NO_BTN')
    }
  } catch (err) {
    results.push('custom-compose-collapsed => ERR ' + String(err).slice(0, 80))
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

  // 题库冒烟：标题「题库」、每页输入、分页按钮、管理模式（勾选/全选/批量删除二次确认）
  try {
    // 先关闭可能遗留的弹窗（新增题目），避免遮挡
    const openModalClose = [...document.querySelectorAll('.modal-footer button, .modal-header button')].find(
      (b) => b.innerText.includes('取消') || b.innerText.includes('关闭')
    )
    if (openModalClose) {
      openModalClose.click()
      await wait(400)
    }
    location.hash = '#/questions'
    await wait(800)
    const titleTag = document.querySelector('.page-title-tag')
    const sizeInput = document.querySelector('.qm-size-input')
    const pageInputEl = document.querySelector('.qm-page-input')
    const pagerBtns = document.querySelectorAll('.qm-pager .btn').length
    let manageOk = 'NO_MANAGE_BTN'
    const manageBtn = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === '管理')
    if (manageBtn) {
      manageBtn.click()
      await wait(400)
      const checks = document.querySelectorAll('.qm-row .qm-check').length
      const manageBar = document.querySelector('.qm-manage-bar')
      if (checks > 0 && manageBar) {
        const allChk = manageBar.querySelector('.qm-check-all input')
        if (allChk) allChk.click()
        await wait(200)
        const delBtn = manageBar.querySelector('button.btn-danger')
        if (delBtn && !delBtn.disabled) {
          delBtn.click()
          await wait(400)
          const confirmTitle = [...document.querySelectorAll('.modal-title')].some((t) => t.innerText.includes('批量删除'))
          manageOk = confirmTitle ? 'OK' : 'NO_CONFIRM'
          const cancelBtn = [...document.querySelectorAll('.modal-footer button')].find((b) => b.innerText.includes('取消'))
          if (cancelBtn) cancelBtn.click()
          await wait(300)
        } else {
          manageOk = 'NO_SELECTED'
        }
      } else {
        manageOk = 'NO_CHECKS'
      }
      const exitBtn = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === '管理')
      if (exitBtn) exitBtn.click()
      await wait(300)
    }
    results.push('bank-page => ' + (titleTag && titleTag.innerText === '题库' ? 'OK' : 'TITLE=' + (titleTag ? titleTag.innerText : '')) + ' size=' + (sizeInput ? 'Y' : 'N') + ' pager=' + pagerBtns + ' pageInput=' + (pageInputEl ? 'Y' : 'N') + ' manage=' + manageOk)
  } catch (err) {
    results.push('bank-page => ERR ' + String(err).slice(0, 80))
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

    // 随题笔记内联冒烟：点题卡「笔记」按钮应在卡内展开富文本编辑区，而非弹窗
    try {
      const noteBtn0 = cards[0] && cards[0].querySelector('.q-head-right button[title="随题笔记"]')
      if (noteBtn0) {
        noteBtn0.click()
        await wait(600)
        const inlineNote = cards[0].querySelector('.inline-note')
        const modalShown = !!document.querySelector('.modal-mask')
        results.push('card-note-inline => ' + (inlineNote ? 'OK(editor=' + (inlineNote.querySelector('.note-toolbar') ? 'Y' : 'N') + ' modal=' + (modalShown ? 'Y' : 'N') + ')' : 'NO_EDITOR'))
        noteBtn0.click()
        await wait(300)
      } else {
        results.push('card-note-inline => NO_NOTE_BTN')
      }
    } catch (err) {
      results.push('card-note-inline => ERR ' + String(err).slice(0, 80))
    }

    const btn0 = cards[0] && cards[0].querySelector('.q-head-right button[title="草纸"]')
    if (btn0) {
      btn0.click()
      await wait(800)
      const tools0 = cards[0].querySelector('.paper-tools')
      const overlay0 = cards[0].querySelector('.paper-overlay')
      const outside0 = tools0 && overlay0
        ? tools0.getBoundingClientRect().left >= overlay0.getBoundingClientRect().right - 1
        : false
      results.push('paper-1st-open => ' + (tools0 ? 'OK(' + tools0.querySelectorAll('.tool-btn').length + 'btns' + (outside0 ? '' : '/OVERLAPS_CARD') + ')' : 'TOOLBAR_MISSING'))
      results.push('paper-1st-overlay => ' + (overlay0 ? overlay0.getBoundingClientRect().width + 'x' + overlay0.getBoundingClientRect().height : 'NO_OVERLAY'))

      // 整笔擦除：空白处划过后，拖影应自动清除（画布上不残留蓝色高亮像素）
      try {
        const eraserBtn = [...tools0.querySelectorAll('.tool-btn')].find((b) => b.title === '橡皮')
        if (eraserBtn) {
          eraserBtn.click()
          await wait(150)
          const strokeModeBtn = [...document.querySelectorAll('.paper-tools .ts-btn')].find((b) => b.innerText.trim() === '整笔擦除')
          if (strokeModeBtn) {
            strokeModeBtn.click()
            await wait(150)
            const cv = cards[0].querySelector('.paper-canvas')
            const rect = cv.getBoundingClientRect()
            const dpr = window.devicePixelRatio || 1
            const mk = (type, x, y) => cv.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: rect.left + x, clientY: rect.top + y }))
            const path = [[24, 24], [70, 34], [120, 44], [170, 54]]
            mk('mousedown', path[0][0], path[0][1])
            for (let i = 1; i < path.length; i++) {
              mk('mousemove', path[i][0], path[i][1])
              await wait(30)
            }
            mk('mouseup', path[path.length - 1][0], path[path.length - 1][1])
            await wait(250)
            const cctx = cv.getContext('2d')
            let blue = 0
            for (const [x, y] of path) {
              const d = cctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data
              if (d[3] > 20 && d[2] > d[0] + 40 && d[2] > 120) blue++
            }
            results.push('eraser-trail-clear => ' + (blue === 0 ? 'OK' : 'TRAIL_LEFT(' + blue + ')'))
          } else {
            // 普通版无「整笔擦除」选项（进阶版专属），仅像素擦除
            results.push('eraser-trail-clear => FREE_PIXEL_ONLY')
          }
        } else {
          results.push('eraser-trail-clear => NO_ERASER_BTN')
        }
      } catch (err) {
        results.push('eraser-trail-clear => ERR ' + String(err).slice(0, 80))
      }

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
        const outside1 = tools1 && overlay1
          ? tools1.getBoundingClientRect().left >= overlay1.getBoundingClientRect().right - 1
          : false
        results.push('paper-2nd-open => ' + (tools1 ? 'OK(' + tools1.querySelectorAll('.tool-btn').length + 'btns' + (outside1 ? '' : '/OVERLAPS_CARD') + ')' : 'TOOLBAR_MISSING'))
      }
    }
${PAPER_FREE_CHECK}

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
        const rvOut = rvTools
          ? rvTools.getBoundingClientRect().left >= rvCard.getBoundingClientRect().right - 1
          : false
        results.push('review-paper => ' + (rvTools ? 'OK(' + rvTools.querySelectorAll('.tool-btn').length + 'btns' + (rvOut ? '' : '/OVERLAPS_CARD') + ')' : 'TOOLBAR_MISSING'))
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
            const wOut = wTools
              ? wTools.getBoundingClientRect().left >= wCard.getBoundingClientRect().right - 1
              : false
            results.push('wrong-review-paper => ' + (wTools ? 'OK(' + wTools.querySelectorAll('.tool-btn').length + 'btns' + (wOut ? '' : '/OVERLAPS_CARD') + ')' : 'TOOLBAR_MISSING'))
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

  // 笔记回看冒烟：点击笔记条目应进入独立回看页（而非弹窗）
  try {
    location.hash = '#/notes'
    await wait(800)
    const firstNote = document.querySelector('.note-item')
    if (firstNote) {
      firstNote.click()
      await wait(1000)
      const nPage = document.querySelector('.review-page')
      const nTitle = nPage ? nPage.querySelector('.rv-title') : null
      const nCard = nPage ? nPage.querySelector('.q-card') : null
      const nNote = nPage ? nPage.querySelector('.rv-note') : null
      results.push('notes-review-page => ' + (nPage ? 'OK title=' + (nTitle ? nTitle.innerText : '') + ' card=' + (nCard ? 1 : 0) + ' note-block=' + (nNote ? 'Y' : 'N') : 'NO_PAGE'))
      const backBtn = nPage && [...nPage.querySelectorAll('button')].find((b) => b.innerText.includes('笔记'))
      if (backBtn) backBtn.click()
      await wait(300)
    } else {
      results.push('notes-review-page => NO_NOTE_ITEM')
    }
  } catch (err) {
    results.push('notes-review-page => ERR ' + String(err).slice(0, 80))
  }

  // 切换题目自动关闭草纸覆层：回看页开草纸后点「下一题」，覆层应随题目切换关闭
  try {
    location.hash = '#/notes'
    await wait(800)
    const noteItem = document.querySelector('.note-item')
    if (noteItem) {
      noteItem.click()
      await wait(1000)
      const rvPage = document.querySelector('.review-page')
      const nextBtn = rvPage && [...rvPage.querySelectorAll('button')].find((b) => b.innerText.trim() === '下一题')
      const paperBtn = rvPage && rvPage.querySelector('.q-head-right button[title="草纸"]')
      if (paperBtn && nextBtn && !nextBtn.disabled) {
        paperBtn.click()
        await wait(500)
        const open1 = !!rvPage.querySelector('.paper-overlay')
        nextBtn.click()
        await wait(500)
        const open2 = !!rvPage.querySelector('.paper-overlay')
        results.push('review-switch-paper => ' + (open1 && !open2 ? 'OK' : 'open=' + open1 + '->' + open2))
        const backBtn = [...rvPage.querySelectorAll('button')].find((b) => b.innerText.includes('笔记'))
        if (backBtn) backBtn.click()
        await wait(300)
      } else {
        results.push('review-switch-paper => NO_NAV')
      }
    } else {
      results.push('review-switch-paper => NO_NOTE')
    }
  } catch (err) {
    results.push('review-switch-paper => ERR ' + String(err).slice(0, 80))
  }

  // 收藏回看冒烟：点击收藏条目应进入独立回看页（而非弹窗）
  try {
    location.hash = '#/favorites'
    await wait(800)
    const firstFav = document.querySelector('.fav-row')
    if (firstFav) {
      const viewBtn = [...firstFav.querySelectorAll('button')].find((b) => b.innerText.trim() === '查看')
      if (viewBtn) viewBtn.click()
      else {
        const stem = firstFav.querySelector('.fav-stem')
        if (stem) stem.click()
      }
      await wait(1000)
      const fPage = document.querySelector('.review-page')
      const fTitle = fPage ? fPage.querySelector('.rv-title') : null
      const fCard = fPage ? fPage.querySelector('.q-card') : null
      results.push('fav-review-page => ' + (fPage ? 'OK title=' + (fTitle ? fTitle.innerText : '') + ' card=' + (fCard ? 1 : 0) : 'NO_PAGE'))
      const backBtn = fPage && [...fPage.querySelectorAll('button')].find((b) => b.innerText.includes('收藏'))
      if (backBtn) backBtn.click()
      await wait(300)
    } else {
      results.push('fav-review-page => NO_FAV_ROW')
    }
  } catch (err) {
    results.push('fav-review-page => ERR ' + String(err).slice(0, 80))
  }

  // 笔记缩略省略冒烟：富文本块级内容的缩略应单行省略号
  try {
    const longNote = '<div>这是一条很长的笔记内容用来验证省略号显示效果是否生效请多写一些字保证超出一行</div><div>第二行的块内容也会被内联化拼到同一行显示</div>'
    const treeL = await api.categoryTree()
    const qsL = await api.listQuestions({ categoryId: treeL[0].id, page: 1, pageSize: 1 })
    const targetQ = qsL.items && qsL.items[0]
    if (targetQ) {
      await api.saveNote(targetQ.id, longNote)
      location.hash = '#/notes'
      await wait(800)
      const body = document.querySelector('.note-body')
      if (body) {
        const cs = getComputedStyle(body)
        const oneLine = body.scrollHeight <= body.clientHeight + 1
        results.push('note-ellipsis => ' + (cs.textOverflow === 'ellipsis' && cs.whiteSpace === 'nowrap' && oneLine ? 'OK' : 'style=' + cs.whiteSpace + ',' + cs.textOverflow + ' oneLine=' + oneLine))
      } else {
        results.push('note-ellipsis => NO_BODY')
      }
    } else {
      results.push('note-ellipsis => NO_Q')
    }
  } catch (err) {
    results.push('note-ellipsis => ERR ' + String(err).slice(0, 80))
  }

  // 侧边栏抽屉冒烟：收起后宽度为 0，收起/展开按钮同位置，状态持久化到数据库
  try {
    const aside = document.querySelector('.sidebar')
    // 若初始为收起状态（上次残留），先恢复展开，保证从展开态开始测试
    const fab0 = document.querySelector('.sidebar-corner-btn[title="展开导航"]')
    if (fab0) {
      fab0.click()
      await wait(400)
    }
    const collapseBtn = aside && aside.querySelector('.sidebar-corner-btn[title="收起导航"]')
    if (collapseBtn && aside) {
      const w0 = Math.round(aside.getBoundingClientRect().width)
      const cbRect = collapseBtn.getBoundingClientRect()
      collapseBtn.click()
      await wait(400)
      const w1 = Math.round(aside.getBoundingClientRect().width)
      const fab = document.querySelector('.sidebar-corner-btn[title="展开导航"]')
      const fabRect = fab ? fab.getBoundingClientRect() : null
      const stored1 = (await api.getSettings()).sidebarCollapsed
      const samePos = fabRect && Math.round(cbRect.left) === Math.round(fabRect.left) && Math.round(cbRect.top) === Math.round(fabRect.top)
      const okCollapsed = w1 === 0 && !!fab && samePos && stored1 === '1'
      if (fab) fab.click()
      await wait(400)
      const w2 = Math.round(aside.getBoundingClientRect().width)
      const stored2 = (await api.getSettings()).sidebarCollapsed
      const okRestore = w2 > 0 && stored2 === '0'
      results.push('sidebar-drawer => ' + (okCollapsed && okRestore ? 'OK w=' + w0 + '->' + w1 + '->' + w2 + ' pos=' + (samePos ? 'same' : 'diff') : 'w=' + w0 + '->' + w1 + '->' + w2 + ' pos=' + (samePos ? 'same' : 'diff') + ' stored=' + stored1 + ',' + stored2 + ' fab=' + (fab ? 'Y' : 'N')))
    } else {
      results.push('sidebar-drawer => NO_BTN')
    }
  } catch (err) {
    results.push('sidebar-drawer => ERR ' + String(err).slice(0, 80))
  }

  // 设置页设备唯一信息冒烟：卡片展示 64 位 hex 机器码（主进程采集硬件生成）且有复制按钮
  try {
    location.hash = '#/settings'
    await wait(400)
    const card = [...document.querySelectorAll('.st-card')].find((c) => c.innerText.includes('设备唯一信息'))
    let mcText = ''
    // 机器码读取为异步（主进程采集硬件），轮询等待出现 hex 串
    for (let i = 0; i < 20 && !/^[0-9a-f]{64}$/.test(mcText); i++) {
      await wait(300)
      mcText = (card && card.innerText.match(/[0-9a-f]{64}/) || [''])[0] || ''
    }
    const copyBtn = card && [...card.querySelectorAll('button')].find((b) => b.innerText.includes('复制'))
    const direct = await api.getMachineCode()
    results.push('settings-device-info => ' + (/^[0-9a-f]{64}$/.test(mcText) && direct === mcText && copyBtn ? 'OK' : 'no-card=' + (card ? 'N' : 'Y') + ' copyBtn=' + (copyBtn ? 'Y' : 'N') + ' text=' + mcText + ' direct=' + direct))
  } catch (err) {
    results.push('settings-device-info => ERR ' + String(err).slice(0, 80))
  }
${ABOUT_CHECK}
${PAPER_PRO_CHECK}
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

/**
 * 生成仅供 UI 冒烟使用的合法进阶码：
 * 运行时临时生成 ed25519 密钥对，公钥注入授权模块、私钥仅存于内存，
 * Electron 代码与磁盘上均不落任何私钥。
 */
async function buildTestActivationCode() {
  const license = require('./license')
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  license._test.setPublicKey(publicKey.export({ type: 'spki', format: 'pem' }))
  const mc = await license.getMachineCode()
  if (!mc.ok) throw new Error('无法获取本机机器码，无法生成测试进阶码')
  const meta = JSON.stringify({ machineCode: mc.code, expiresAt: Date.now() + 24 * 3600 * 1000 })
  const sig = crypto.sign(null, Buffer.from(meta, 'utf8'), privateKey)
  return Buffer.from(meta, 'utf8').toString('base64') + '|' + sig.toString('base64')
}

/** 组装冒烟脚本：默认全量 UI_SCRIPT；COMATE_UI_SCOPE 支持按功能局部跑 */
async function buildUiSmokeScript() {
  const testCode = await buildTestActivationCode()
  const scope = process.env.COMATE_UI_SCOPE
  if (scope === 'about') {
    return `
(async () => {
  const api = window.api
  const wait = (ms) => new Promise((res) => setTimeout(res, ms))
  const results = []
  // 等待应用与路由就绪
  location.hash = '#/home'
  await wait(800)
  for (let i = 0; i < 30; i++) {
    const main = document.querySelector('.app-main')
    const tag = main && main.querySelector('.page-title-tag')
    if (tag && tag.innerText.includes('首页')) break
    await wait(300)
  }
${ABOUT_CHECK}
${PAPER_PRO_CHECK}
  return results.join('\\n')
})()
`.replace('__TEST_ACTIVATION_CODE__', testCode)
  }
  if (scope === 'paper') {
    return `
(async () => {
  const api = window.api
  const wait = (ms) => new Promise((res) => setTimeout(res, ms))
  const results = []
  location.hash = '#/home'
  await wait(800)
  for (let i = 0; i < 30; i++) {
    const main = document.querySelector('.app-main')
    const tag = main && main.querySelector('.page-title-tag')
    if (tag && tag.innerText.includes('首页')) break
    await wait(300)
  }
${PAPER_FREE_CHECK}
  return results.join('\\n')
})()
`
  }
  return UI_SCRIPT.replace('__TEST_ACTIVATION_CODE__', testCode)
}

function runUiSmoke(win) {
  win.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      try {
        const script = await buildUiSmokeScript()
        const result = await win.webContents.executeJavaScript(script, true)
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
