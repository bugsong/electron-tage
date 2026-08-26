const { contextBridge, ipcRenderer } = require('electron')

const api = {
  // 分类
  categoryTree: () => ipcRenderer.invoke('category:tree'),

  // 题目
  listQuestions: (filter) => ipcRenderer.invoke('question:list', filter),
  getQuestion: (id) => ipcRenderer.invoke('question:get', id),
  saveQuestion: (payload) => ipcRenderer.invoke('question:save', payload),
  deleteQuestion: (id) => ipcRenderer.invoke('question:delete', id),
  deleteQuestions: (ids) => ipcRenderer.invoke('question:deleteMany', ids),
  pickExcel: () => ipcRenderer.invoke('dialog:pickExcel'),
  parseExcel: (filePath) => ipcRenderer.invoke('excel:parse', filePath),
  importRows: (rows) => ipcRenderer.invoke('question:importRows', rows),

  // 错题
  listWrong: (filter) => ipcRenderer.invoke('wrong:list', filter),
  removeWrong: (questionId) => ipcRenderer.invoke('wrong:remove', questionId),

  // 收藏
  toggleFavorite: (questionId) => ipcRenderer.invoke('favorite:toggle', questionId),
  listFavorites: (filter) => ipcRenderer.invoke('favorite:list', filter),

  // 笔记
  getNote: (questionId) => ipcRenderer.invoke('note:get', questionId),
  saveNote: (questionId, content) => ipcRenderer.invoke('note:save', questionId, content),
  listNotes: (filter) => ipcRenderer.invoke('note:list', filter),

  // 草稿笔迹
  getDraft: (questionId) => ipcRenderer.invoke('draft:get', questionId),
  saveDraft: (questionId, paths) => ipcRenderer.invoke('draft:save', questionId, paths),
  clearDraft: (questionId) => ipcRenderer.invoke('draft:clear', questionId),

  // 练习会话
  startPractice: (payload) => ipcRenderer.invoke('practice:start', payload),
  getActivePractice: () => ipcRenderer.invoke('practice:getActive'),
  getSession: (id) => ipcRenderer.invoke('practice:getSession', id),
  savePracticeProgress: (id, answers, elapsedMs) =>
    ipcRenderer.invoke('practice:saveProgress', id, answers, elapsedMs),
  submitPractice: (id, answers, elapsedMs) =>
    ipcRenderer.invoke('practice:submit', id, answers, elapsedMs),
  abandonPractice: (id) => ipcRenderer.invoke('practice:abandon', id),
  clearPracticeProgress: (categoryId) => ipcRenderer.invoke('practice:clearProgress', categoryId),

  // 图片（BLOB 存储）
  saveImage: (data) => ipcRenderer.invoke('image:save', data),
  getImage: (id) => ipcRenderer.invoke('image:get', id),

  // 统计与设置
  getStats: () => ipcRenderer.invoke('stats:home'),
  getSettings: () => ipcRenderer.invoke('settings:getAll'),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  getDbPath: () => ipcRenderer.invoke('app:dbPath'),

  // 数据位置（数据库目录迁移/初始化）
  pickDbDir: () => ipcRenderer.invoke('dialog:pickDbDir'),
  moveDb: (dir, opts) => ipcRenderer.invoke('app:moveDb', dir, opts),

  // 授权：硬件信息采集与验签均在主进程，渲染进程只拿结果做展示
  getMachineCode: () => ipcRenderer.invoke('get-machine-code'),
  verifyActivationCode: (code) => ipcRenderer.invoke('verify-activation-code', code),
  getLicenseStatus: () => ipcRenderer.invoke('license:status'),

  // 版本更新：检查/下载/安装全部在主进程执行，公开产物仓库零认证
  getUpdaterState: () => ipcRenderer.invoke('updater:getState'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  cancelDownload: () => ipcRenderer.invoke('updater:cancelDownload'),
  openManualDownload: () => ipcRenderer.invoke('updater:openManualDownload'),
  onUpdaterEvent: (callback) => {
    const listener = (_e, payload) => callback(payload)
    ipcRenderer.on('updater:state-changed', listener)
    return () => ipcRenderer.removeListener('updater:state-changed', listener)
  },
  onUpdaterProgress: (callback) => {
    const listener = (_e, payload) => callback(payload)
    ipcRenderer.on('updater:download-progress', listener)
    return () => ipcRenderer.removeListener('updater:download-progress', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
