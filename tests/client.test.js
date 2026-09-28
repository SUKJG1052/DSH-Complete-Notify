import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openSessionInView, isPendingStatus, isCompletionUnread } from './helpers.js'

// openSessionInView 的版本适配：0.1.7 由 uiWorkspace.openSession() 切换主视图，
// sessions.open() 是 ≤0.1.5 的旧入口（0.1.7 已移除，旧代码因此静默失效）。

test('打开会话：优先使用 uiWorkspace.openSession（0.1.7）', () => {
  const calls = []
  const services = {
    workspace: { openSession: (id) => calls.push(['workspace', id]) },
    sessions: { open: (id) => calls.push(['sessions', id]) },
  }
  openSessionInView(() => services, 'sess-1')
  assert.deepEqual(calls, [['workspace', 'sess-1']])
})

test('打开会话：没有 uiWorkspace 时回退 sessions.open（≤0.1.5）', () => {
  const calls = []
  openSessionInView(() => ({ sessions: { open: (id) => calls.push(id) } }), 'sess-2')
  assert.deepEqual(calls, ['sess-2'])
})

test('打开会话：服务缺失 / 抛错 / 无 id 时静默不抛', () => {
  assert.doesNotThrow(() => openSessionInView(() => ({}), 'x'))
  assert.doesNotThrow(() => openSessionInView(() => { throw new Error('boom') }, 'x'))
  assert.doesNotThrow(() => openSessionInView(undefined, 'x'))
  assert.doesNotThrow(() => openSessionInView(() => ({ workspace: { openSession() { throw new Error('nope') } } }), 'x'))
  assert.doesNotThrow(() => openSessionInView(() => ({ workspace: { openSession() { throw new Error('nope') } } }), ''))
})

test('阻塞判定：sessionStatus 为权威，行字段仅作旧版本回退', () => {
  assert.equal(isPendingStatus({ pendingInteraction: { key: 'k' } }, {}), true)
  assert.equal(isPendingStatus({ pendingInteraction: undefined }, {}), false)
  assert.equal(isPendingStatus(undefined, { pendingInteraction: { key: 'k' } }), true)
  assert.equal(isPendingStatus(undefined, {}), false)
  assert.equal(isPendingStatus(null, { pendingInteraction: null }), false)
})

test('未读完成判定：completionUnread 为权威，completed 仅作旧版本回退', () => {
  assert.equal(isCompletionUnread({ completionUnread: true }, {}), true)
  assert.equal(isCompletionUnread({ completionUnread: false }, {}), false)
  assert.equal(isCompletionUnread(undefined, { completed: true }), true)
  assert.equal(isCompletionUnread(undefined, {}), false)
})
