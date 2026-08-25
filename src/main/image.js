/**
 * 图片预处理：保存前强制压缩。
 * - 最大边长 1200px（等比缩放，小图不放大）
 * - JPEG 质量 80
 * 供 IPC 图片保存链路使用。
 */
const sharp = require('sharp')

const MAX_EDGE = 1200
const QUALITY = 80

/**
 * 压缩图片 buffer。
 * @param {Buffer} input 原始图片字节
 * @param {object} opts 可选 { maxEdge, quality }
 * @returns {Promise<{ buffer: Buffer, width: number, height: number, format: string }>}
 */
async function compressImage(input, opts = {}) {
  const maxEdge = opts.maxEdge || MAX_EDGE
  const quality = opts.quality || QUALITY
  const pipeline = sharp(input)
  let meta
  try {
    meta = await pipeline.metadata()
  } catch {
    throw new Error('无法识别的图片格式')
  }
  if (!meta.width || !meta.height) {
    throw new Error('无法识别的图片格式')
  }
  const out = await pipeline
    .resize(maxEdge, maxEdge, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality })
    .toBuffer()
  const outMeta = await sharp(out).metadata()
  return { buffer: out, width: outMeta.width, height: outMeta.height, format: outMeta.format }
}

module.exports = { compressImage, MAX_EDGE, QUALITY }
