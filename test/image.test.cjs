/**
 * 阶段2测试：图片预处理压缩（sharp）
 * - 大图压缩到最大边长 1200px 内、JPEG 质量 80
 * - 等比缩放不拉伸
 * - 小图不放大
 * - 非图片输入报错
 */
const { test } = require('node:test')
const assert = require('node:assert')
const sharp = require('sharp')
const { compressImage } = require('../src/main/image')

/** 生成纯色测试图 */
async function makeImage(width, height, format = 'png') {
  return sharp({
    create: { width, height, channels: 3, background: { r: 180, g: 90, b: 30 } }
  })[format]().toBuffer()
}

test('大图被压缩到最大边长 1200 内且保持宽高比', async () => {
  const big = await makeImage(2000, 1500)
  const { buffer, width, height, format } = await compressImage(big)
  assert.equal(format, 'jpeg', '应输出 JPEG')
  assert.ok(Math.max(width, height) <= 1200, '最大边长应 <= 1200')
  assert.equal(width, 1200, '宽度应缩放到 1200')
  assert.equal(height, 900, '高度应按 2000:1500 比例缩放为 900')
})

test('小图不被放大（withoutEnlargement）', async () => {
  const small = await makeImage(600, 400)
  const { width, height } = await compressImage(small)
  assert.equal(width, 600, '小图宽度保持不变')
  assert.equal(height, 400, '小图高度保持不变')
})

test('自定义质量参数生效', async () => {
  const img = await makeImage(1000, 800)
  const q50 = await compressImage(img, { quality: 50 })
  const q90 = await compressImage(img, { quality: 90 })
  // 同尺寸下质量越高体积越大
  assert.ok(q90.buffer.length > q50.buffer.length, '高质量输出体积应更大')
})

test('PNG 透明图压缩为 JPEG 不抛错', async () => {
  const png = await sharp({
    create: { width: 800, height: 600, channels: 4, background: { r: 10, g: 200, b: 100, alpha: 0.5 } }
  }).png().toBuffer()
  const { format, width } = await compressImage(png)
  assert.equal(format, 'jpeg')
  assert.equal(width, 800)
})

test('非图片输入抛错', async () => {
  await assert.rejects(() => compressImage(Buffer.from('not an image at all')), /无法识别/)
})

test('空输入抛错', async () => {
  await assert.rejects(() => compressImage(Buffer.alloc(0)))
})
