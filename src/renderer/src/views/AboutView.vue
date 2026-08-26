<script setup>
import { ref, computed, onMounted } from 'vue'
import { api } from '../api'
import { useToastStore } from '../stores/toast'
import UpdateBlock from '../components/UpdateBlock.vue'

const toast = useToastStore()

const showWechat = ref(false)
const wechatId = 'zaozhuangqiuzhi'

function toggleWechat() {
  showWechat.value = !showWechat.value
}

async function copyWechat() {
  try {
    await navigator.clipboard.writeText(wechatId)
    toast.success('已复制微信号')
  } catch {
    toast.error('复制失败')
  }
}

// 授权状态：{ activated, activatedAt?, expiresAt? }
const status = ref({ activated: false })
const code = ref('')
const activating = ref(false)

// 普通版 vs 进阶版对比（开发阶段全量开放，仅做展示，不参与功能开关）
const FEATURES = [
  {
    name: '记忆功能',
    normal: '做完即过，不保留做题痕迹',
    pro: '持久保留做题痕迹，随时回顾思路细节'
  },
  {
    name: '笔迹',
    normal: '仅红色画笔，不可调粗细颜色',
    pro: '粗细颜色自由调，记忆上次状态'
  },
  {
    name: '橡皮',
    normal: '仅像素擦除，无范围提示，容易多擦',
    pro: '像素擦除 + 整笔擦除，带范围提示，舒心刷题'
  },
  {
    name: '倒计时',
    normal: '仅正计时，自由掌控节奏',
    pro: '倒计时限定作答，到点自动交卷，沉浸专注'
  }
]

const activated = computed(() => status.value.activated)

const expireText = computed(() => {
  const ts = status.value.expiresAt
  if (!activated.value || !ts) return ''
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
})

onMounted(async () => {
  try {
    status.value = await api.getLicenseStatus()
  } catch {
    status.value = { activated: false }
  }
})

async function activate() {
  const c = code.value.trim()
  if (!c || activating.value) return
  activating.value = true
  try {
    const r = await api.verifyActivationCode(c)
    if (r && r.ok) {
      toast.success('激活成功，已开启进阶版')
      status.value = { activated: true, activatedAt: r.activatedAt, expiresAt: r.expiresAt }
      code.value = ''
    } else {
      toast.error((r && r.reason) || '激活失败')
    }
  } catch (err) {
    toast.error(err.message || '激活失败')
  } finally {
    activating.value = false
  }
}
</script>

<template>
  <div class="page about-page">
    <span class="page-title-tag">关于</span>

    <div class="card st-card">
      <div class="st-title">压力开发者₍•ʚ•₎•ʚ•₎•ʚ•₎</div>
      <div class="st-desc">🛰微信：
        <span @click="toggleWechat" class="wechat-toggle">
          {{ showWechat ? wechatId : '***********' }}
        </span>
        <button v-if="showWechat" class="btn btn-sm" @click="copyWechat">复制</button>
      </div>
      <!-- 浅色字体写点东西 -->
      <div class="st-desc st-desc-note">提点新功能；催TA修BUG；用爽了，请TA喝咖啡；进阶码营业中。。。</div>

    </div>

    <div class="card st-card">
      <div class="st-title">授权进阶版</div>
      <div class="st-desc">解锁进阶版全部能力（草纸 + 倒计时）</div>

      <!-- 已激活：输入框消失，显示金色提示 -->
      <div v-if="activated" class="license-active">
        <svg class="license-crown" viewBox="0 0 24 24" width="26" height="26" fill="currentColor">
          <path d="M3 17l3.4-7.8 4.9 4.4L15.9 9.2 21 17z" />
          <path d="M3 20.5h18" />
          <circle cx="6.2" cy="5.6" r="1.4" />
          <circle cx="17.8" cy="5.6" r="1.4" />
          <circle cx="12" cy="3.2" r="1.4" />
        </svg>
        <div>
          <div class="license-active-title">已激活进阶版</div>
          <div v-if="expireText" class="license-active-sub">有效期至 {{ expireText }}</div>
        </div>
      </div>

      <!-- 未激活：输入进阶码 + 进阶按钮 -->
      <div v-else class="license-form">
        <input
          v-model="code"
          class="input"
          placeholder="请输入进阶码"
          autocomplete="off"
          spellcheck="false"
          @keyup.enter="activate"
        />
        <button class="btn btn-primary" :disabled="activating || !code.trim()" @click="activate">
          {{ activating ? '进阶中…' : '进阶' }}
        </button>
      </div>

      <!-- 已激活后不再展示生成提示 -->
      <div v-if="!activated" class="st-desc st-desc-note">进阶码由开发者根据本机设备信息生成，请先在「设置」页复制设备唯一信息发送给开发者</div>
    </div>

    <div class="card st-card about-cmp" :class="{ 'pro-active': activated }">
      <div class="st-title">草纸进阶版对比</div>
      <table class="feat-table">
        <thead>
          <tr>
            <th class="feat-name">功能</th>
            <th>普通版</th>
            <th class="feat-pro">进阶版</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="f in FEATURES" :key="f.name">
            <td class="feat-name">{{ f.name }}</td>
            <td class="feat-normal">{{ f.normal }}</td>
            <td class="feat-pro">{{ f.pro }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="activated" class="pro-unlocked">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
          <path d="M12 2l2.5 5.2 5.7.8-4.2 4 1 5.7L12 15l-5 2.7 1-5.7-4.2-4 5.7-.8z" />
        </svg>
        已解锁进阶版全部能力，以上金色功能现已可用
      </div>
    </div>
    <UpdateBlock />
    <div class="st-about">题迹 · 仅本地使用 · 数据不出本机</div>
  </div>
</template>

<style scoped>
.about-page {
  max-width: 620px;
  margin: 0 auto;
}
.st-card {
  padding: 1.1rem 1.3rem;
  margin-top: 1rem;
}
.st-title {
  font-weight: 700;
  font-size: 1rem;
}
.about-cmp .st-title {
  text-align: center;
  margin-bottom: 0.8rem;
}
.st-desc {
  color: var(--text-2);
  font-size: 0.85rem;
  margin: 0.2rem 0 0.8rem;
}
.st-desc-note {
  margin: 0.8rem 0 0;
  font-size: 0.8rem;
}

.st-about {
  text-align: center;
  color: var(--text-2);
  font-size: 0.8rem;
  margin-top: 1.2rem;
}

.wechat-toggle {
  cursor: pointer;
  user-select: none;
  color: var(--text);
}

.btn-sm {
  padding: 0.15rem 0.5rem;
  font-size: 0.75rem;
  margin-left: 0.4rem;
}

/* 授权输入区 */
.license-form {
  display: flex;
  gap: 0.6rem;
}
.license-form .input {
  flex: 1;
  font-family: Consolas, 'Courier New', monospace;
}

/* 已激活提示（尊贵金色） */
.license-active {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.7rem 1rem;
  border-radius: 10px;
  border: 1px solid var(--gold-border);
  background: linear-gradient(135deg, var(--gold-weak), transparent);
}
.license-crown {
  color: var(--gold);
  flex-shrink: 0;
}
.license-active-title {
  font-weight: 700;
  font-size: 1rem;
  color: var(--gold);
}
.license-active-sub {
  font-size: 0.8rem;
  color: var(--gold);
  opacity: 0.85;
}

/* 对比表 */
.feat-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}
.feat-table th,
.feat-table td {
  border: 1px solid var(--border);
  padding: 0.55rem 0.7rem;
  text-align: center;
  vertical-align: middle;
  line-height: 1.6;
}
.feat-table th {
  background: var(--card-hover);
  font-weight: 600;
}
.feat-name {
  width: 5.5rem;
  white-space: nowrap;
  font-weight: 600;
}
.feat-normal {
  color: var(--text-2);
}
.feat-pro {
  color: var(--text-2);
}

/* 激活后：进阶版列以尊贵金色高亮 */
.about-cmp.pro-active .feat-pro {
  color: var(--gold);
  font-weight: 600;
  background: var(--gold-weak);
}
.pro-unlocked {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.8rem;
  color: var(--gold);
  font-size: 0.85rem;
  font-weight: 600;
}
</style>
