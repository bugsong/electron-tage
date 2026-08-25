/**
 * 轻量 HTML 清洗：本地单机应用，数据自产自用，
 * 主要防止意外引入 script/style/内联事件破坏界面。
 * 主进程与渲染进程共用。
 */
export function sanitizeHtml(input) {
  if (typeof input !== 'string') return ''
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/href\s*=\s*["']?\s*javascript:[^"'\s>]*/gi, '')
    .replace(/src\s*=\s*["']?\s*javascript:[^"'\s>]*/gi, '')
}
