import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  { path: '/', redirect: '/home' },
  { path: '/home', name: 'home', component: () => import('./views/HomeView.vue'), meta: { title: '首页' } },
  { path: '/practice', name: 'practice', component: () => import('./views/PracticeView.vue'), meta: { title: '专项练习' } },
  { path: '/practice/session', name: 'session', component: () => import('./views/SessionView.vue'), meta: { title: '刷题' } },
  { path: '/practice/result', name: 'result', component: () => import('./views/ResultView.vue'), meta: { title: '练习结果' } },
  { path: '/wrong', name: 'wrong', component: () => import('./views/WrongView.vue'), meta: { title: '错题' } },
  { path: '/notes', name: 'notes', component: () => import('./views/NotesView.vue'), meta: { title: '笔记' } },
  { path: '/favorites', name: 'favorites', component: () => import('./views/FavoritesView.vue'), meta: { title: '收藏' } },
  { path: '/questions', name: 'questions', component: () => import('./views/QuestionsView.vue'), meta: { title: '题目管理' } },
  { path: '/settings', name: 'settings', component: () => import('./views/SettingsView.vue'), meta: { title: '设置' } }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
