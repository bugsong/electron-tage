import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { createRequire } from 'node:module'

// 用 CJS require 加载混淆器：正常环境走 node_modules 解析；
// 在符号链接受限的环境下可通过 NODE_PATH 兜底，兼容性更好
const require = createRequire(import.meta.url)
const obfuscator = require('javascript-obfuscator')

/**
 * 构建期混淆插件（仅作用于主进程 / preload 产物）
 *
 * - 授权校验、数据库、反调试等敏感逻辑都在主进程，混淆收益最大；
 * - 渲染进程（Vue 应用）不混淆：代码量大、运行时开销明显、且主进程已兜底；
 * - 关闭 controlFlowFlattening / deadCodeInjection / selfDefending，
 *   避免明显的运行性能开销与格式化误伤；
 * - 可用环境变量 TAGE_NO_OBFUSCATE=1 临时关闭（排查问题时用）。
 */
function obfuscateBundlePlugin() {
  const isObfuscateEnabled = process.env.TAGE_NO_OBFUSCATE !== '1'
  return {
    name: 'obfuscate-bundle',
    apply: 'build', // 仅 electron-vite build（生产构建）生效
    enforce: 'post',
    generateBundle(_options, bundle) {
      if (!isObfuscateEnabled) return
      for (const fileName of Object.keys(bundle)) {
        const chunk = bundle[fileName]
        if (chunk.type !== 'chunk' || !fileName.endsWith('.js')) continue
        const code = chunk.code
        if (!code || code.length < 200) continue // 跳过过小 chunk，避免无谓开销
        try {
          chunk.code = obfuscator
            .obfuscate(code, {
              compact: true,
              controlFlowFlattening: false,
              deadCodeInjection: false,
              identifierNamesGenerator: 'hexadecimal',
              renameGlobals: false,
              selfDefending: false,
              stringArray: true,
              stringArrayEncoding: ['base64'],
              stringArrayThreshold: 0.75,
              numbersToExpressions: true,
              simplify: true,
              splitStrings: true,
              splitStringsChunkLength: 8,
              transformObjectKeys: false,
              unicodeEscapeSequence: false
            })
            .getObfuscatedCode()
        } catch (err) {
          // 单个 chunk 混淆失败不应阻断整个构建
          console.error(`[obfuscate] 混淆失败，跳过: ${fileName} ->`, err.message)
        }
      }
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), obfuscateBundlePlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin(), obfuscateBundlePlugin()]
  },
  renderer: {
    plugins: [vue()]
  }
})
