import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createWatcher, snapOf, statusOf } from './helpers.js'

// 夹具遵循真实投影形状：列表行只有 id/displayTitle/running/retainedBy/blank/updatedAt，
// 阻塞与「未读完成」来自 sessionStatus（useSessionStatus 下发的 Map）。

test('首次快照只初始化不触发（含未读完成的旧任务）', () => {
  const w = createWatcher()
  const events = w.diff(null, snapOf([{ id: 'a' }, { id: 'b', running: true }]), statusOf([{ id: 'a', unread: true }, { id: 'b', running: true }]))
  assert.equal(events.length, 0)
})

test('会话 运行→停止 触发完成事件', () => {
  const w = createWatcher()
  const prev = snapOf([{ id: 'a', running: true }])
  w.diff(null, prev, statusOf([{ id: 'a', running: true }]))
  const events = w.diff(prev, snapOf([{ id: 'a' }]), statusOf([{ id: 'a' }]))
  assert.equal(events.length, 1)
  assert.equal(events[0].sessionId, 'a')
  assert.equal(events[0].kind, undefined) // 无 kind = 完成（kind 由 Host/推断兜底决定）
})

test('completionUnread 粘性期间不重复提醒', () => {
  const w = createWatcher()
  const prev = snapOf([{ id: 'a', running: true }, { id: 'b' }])
  w.diff(null, prev, statusOf([{ id: 'a', running: true }, { id: 'b' }]))
  const done = snapOf([{ id: 'a' }, { id: 'b' }])
  const doneStatus = statusOf([{ id: 'a', unread: true }, { id: 'b' }])
  const events = w.diff(prev, done, doneStatus)
  assert.equal(events.length, 1)
  assert.equal(events[0].sessionId, 'a')
  assert.equal(w.diff(done, done, doneStatus).length, 0)
})

test('错过运行边沿时 completionUnread 兜底触发一次（0.1.7 取代已删除的 completed）', () => {
  const w = createWatcher()
  const idle = snapOf([{ id: 'a' }, { id: 'b' }])
  w.diff(null, idle, statusOf([{ id: 'a' }, { id: 'b' }]))
  const doneStatus = statusOf([{ id: 'a', unread: true }, { id: 'b' }])
  const events = w.diff(idle, idle, doneStatus)
  assert.equal(events.length, 1)
  assert.equal(events[0].sessionId, 'a')
  // 用户看过之后 completionUnread 清除，不补发第二次
  assert.equal(w.diff(idle, idle, statusOf([{ id: 'a' }, { id: 'b' }])).length, 0)
})

test('会话重新运行后再次完成会再次触发', () => {
  const w = createWatcher()
  const run1 = snapOf([{ id: 'a', running: true }])
  const idle1 = snapOf([{ id: 'a' }])
  w.diff(null, run1, statusOf([{ id: 'a', running: true }]))
  assert.equal(w.diff(run1, idle1, statusOf([{ id: 'a' }])).length, 1)
  const run2 = snapOf([{ id: 'a', running: true }])
  w.diff(idle1, run2, statusOf([{ id: 'a', running: true }]))
  const events = w.diff(run2, snapOf([{ id: 'a' }]), statusOf([{ id: 'a' }]))
  assert.equal(events.length, 1)
})

test('子代理会话被过滤', () => {
  const w = createWatcher()
  const prev = snapOf([{ id: 'root', running: true }, { id: 'sub', running: true, origin: 'subagent' }])
  w.diff(null, prev, statusOf([{ id: 'root', running: true }, { id: 'sub', running: true }]))
  const events = w.diff(
    prev,
    snapOf([{ id: 'root' }, { id: 'sub', origin: 'subagent' }]),
    statusOf([{ id: 'root' }, { id: 'sub', unread: true }]),
  )
  assert.equal(events.length, 1)
  assert.equal(events[0].sessionId, 'root')
})

test('多会话同时完成产生多个事件', () => {
  const w = createWatcher()
  const prev = snapOf([{ id: 'a', running: true }, { id: 'b', running: true }])
  w.diff(null, prev, statusOf([{ id: 'a', running: true }, { id: 'b', running: true }]))
  const events = w.diff(prev, snapOf([{ id: 'a' }, { id: 'b' }]), statusOf([{ id: 'a' }, { id: 'b' }]))
  assert.equal(events.length, 2)
})

test('标题取自 displayTitle', () => {
  const w = createWatcher()
  const prev = snapOf([{ id: 'a', running: true, title: '修复登录' }])
  w.diff(null, prev, statusOf([{ id: 'a', running: true }]))
  const events = w.diff(prev, snapOf([{ id: 'a', title: '修复登录' }]), statusOf([{ id: 'a' }]))
  assert.equal(events[0].title, '修复登录')
})

test('会话从列表移除后状态清理，同 id 重新出现从头开始', () => {
  const w = createWatcher()
  const prev = snapOf([{ id: 'a', running: true }])
  w.diff(null, prev, statusOf([{ id: 'a', running: true }]))
  assert.equal(w.diff(prev, snapOf([{ id: 'a' }]), statusOf([{ id: 'a' }])).length, 1)
  w.diff(snapOf([{ id: 'a' }]), snapOf([]), statusOf([])) // 移除
  const run = snapOf([{ id: 'a', running: true }])
  w.diff(null, run, statusOf([{ id: 'a', running: true }]))
  const events = w.diff(run, snapOf([{ id: 'a' }]), statusOf([{ id: 'a' }]))
  assert.equal(events.length, 1)
})

test('同一快照重复 diff 不重复触发（StrictMode 双调用安全）', () => {
  const w = createWatcher()
  const prev = snapOf([{ id: 'a', running: true }])
  const idle = snapOf([{ id: 'a' }])
  w.diff(null, prev, statusOf([{ id: 'a', running: true }]))
  assert.equal(w.diff(prev, idle, statusOf([{ id: 'a' }])).length, 1)
  assert.equal(w.diff(idle, idle, statusOf([{ id: 'a' }])).length, 0)
})

test('sessionStatus.pendingInteraction 出现 → kind:blocked，粘性不重复，清除后再次触发', () => {
  const w = createWatcher()
  const idle = snapOf([{ id: 'a' }])
  w.diff(null, idle, statusOf([{ id: 'a' }]))
  const pending = statusOf([{ id: 'a', pending: true }])
  const events = w.diff(idle, idle, pending)
  assert.equal(events.length, 1)
  assert.equal(events[0].sessionId, 'a')
  assert.equal(events[0].kind, 'blocked')
  // 粘性：pending 保持期间不重复
  assert.equal(w.diff(idle, idle, pending).length, 0)
  // 清除后可再次触发
  w.diff(idle, idle, statusOf([{ id: 'a' }]))
  const again = w.diff(idle, idle, pending)
  assert.equal(again.length, 1)
  assert.equal(again[0].kind, 'blocked')
})

test('首次快照已有 pendingInteraction 不补发（历史阻塞）', () => {
  const w = createWatcher()
  const idle = snapOf([{ id: 'a' }])
  const pending = statusOf([{ id: 'a', pending: true }])
  assert.equal(w.diff(null, idle, pending).length, 0)
  w.diff(idle, idle, statusOf([{ id: 'a' }]))
  assert.equal(w.diff(idle, idle, pending).length, 1)
})

test('子代理的 pendingInteraction 被过滤', () => {
  const w = createWatcher()
  const idle = snapOf([{ id: 'root' }, { id: 'sub', origin: 'subagent' }])
  w.diff(null, idle, statusOf([{ id: 'root' }, { id: 'sub' }]))
  const events = w.diff(idle, idle, statusOf([{ id: 'root', pending: true }, { id: 'sub', pending: true }]))
  assert.equal(events.length, 1)
  assert.equal(events[0].sessionId, 'root')
})

test('阻塞等待时不发完成提醒（提问挂起后 agent 转 idle 不是完成）', () => {
  const w = createWatcher()
  const running = snapOf([{ id: 'a', running: true }])
  w.diff(null, running, statusOf([{ id: 'a', running: true }]))
  // 同一快照：agent 停下 + 交互挂起 → 只应报「等待你的反馈」
  const events = w.diff(running, snapOf([{ id: 'a' }]), statusOf([{ id: 'a', pending: true }]))
  assert.equal(events.length, 1)
  assert.equal(events[0].kind, 'blocked')
})

test('没有 sessionStatus 时（旧版本/源缺失）仍按运行边缘工作', () => {
  const w = createWatcher()
  const prev = snapOf([{ id: 'a', running: true }])
  w.diff(null, prev)
  const events = w.diff(prev, snapOf([{ id: 'a' }]))
  assert.equal(events.length, 1)
  assert.equal(events[0].sessionId, 'a')
})

test('≤0.1.5 行字段回退：completed / pendingInteraction 仍被识别', () => {
  const w = createWatcher()
  const legacy = (id, extra) => ({ ids: [id], byId: { [id]: { id, displayTitle: id, running: false, ...extra } }, phase: 'ready' })
  // completed 粘性兜底
  const w1 = createWatcher()
  w1.diff(null, legacy('a', {}))
  const done = w1.diff(legacy('a', {}), legacy('a', { completed: true }))
  assert.equal(done.length, 1)
  // pendingInteraction 行字段兜底
  w.diff(null, legacy('a', {}))
  const blocked = w.diff(legacy('a', {}), legacy('a', { pendingInteraction: { kind: 'question' } }))
  assert.equal(blocked.length, 1)
  assert.equal(blocked[0].kind, 'blocked')
})
