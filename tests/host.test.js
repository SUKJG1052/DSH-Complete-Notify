import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, __test } from '../lib/index.js'

const { cleanRecap, lastAnswerText, kindOfEvent } = __test

test('host cleanRecap：去 markdown 噪音 + 折叠空白', () => {
  assert.equal(cleanRecap('  **修复** 了 `登录` bug  '), '修复 了 登录 bug')
})

test('host cleanRecap：链接转链接文字', () => {
  assert.equal(cleanRecap('见 [README](https://x) 文档'), '见 README 文档')
})

test('host cleanRecap：空 / 纯空白返回空串', () => {
  assert.equal(cleanRecap(''), '')
  assert.equal(cleanRecap('   '), '')
  assert.equal(cleanRecap(undefined), '')
})

test('host cleanRecap：超过 50 字截断加省略号', () => {
  const out = cleanRecap('结'.repeat(60))
  assert.equal(out.length, 50 + 1)
  assert.ok(out.endsWith('…'))
})

test('host lastAnswerText：倒序取最后一条 assistant/message 的纯文本', () => {
  const session = {
    events: [
      { type: 'user/message', data: {} },
      { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '第一轮回答' }] } } },
      { type: 'tool/call', data: {} },
      {
        type: 'assistant/message',
        data: {
          message: {
            content: [
              { type: 'text', text: '最终回答第一段' },
              { type: 'tool-call', callId: 'c', name: 'bash', argsRaw: '{}' },
              { type: 'text', text: '最终回答第二段' },
            ],
          },
        },
      },
    ],
  }
  assert.equal(lastAnswerText(session), '最终回答第一段\n最终回答第二段')
})

test('host lastAnswerText：无 assistant 文本返回空串', () => {
  assert.equal(lastAnswerText({ events: [] }), '')
  assert.equal(lastAnswerText(null), '')
  assert.equal(lastAnswerText({ events: [{ type: 'user/message', data: {} }] }), '')
})

test('host kindOfEvent：提取 turn/end 结果状态', () => {
  assert.equal(kindOfEvent({ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }), 'completed')
  assert.equal(kindOfEvent({ type: 'turn/end', data: { turn: 1, reason: { kind: 'blocked' } } }), 'blocked')
  assert.equal(kindOfEvent({ type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted' } } }), 'aborted')
  assert.equal(kindOfEvent({ type: 'turn/end', data: { turn: 1, reason: { kind: 'error' } } }), 'error')
  assert.equal(kindOfEvent({ type: 'turn/end', data: { turn: 1, reason: { kind: 'max-tokens' } } }), 'max-tokens')
  assert.equal(kindOfEvent({ type: 'turn/end', data: { turn: 1, reason: {} } }), 'unknown')
  assert.equal(kindOfEvent({ type: 'assistant/message', data: {} }), null)
  assert.equal(kindOfEvent(null), null)
})

function createHostHarness(options = {}) {
  const listeners = new Map()
  let recapHandler = null
  let releaseSecond
  const secondGate = new Promise((resolve) => { releaseSecond = resolve })
  const llm = options.llm || {
    async *stream({ messages }) {
      const prompt = messages[0].content[0].text
      if (prompt.includes('第二轮最终回答')) await secondGate
      yield { type: 'text-delta', text: prompt.includes('第二轮最终回答') ? '第二轮摘要' : '第一轮摘要' }
    },
  }
  const ctx = {
    on(name, listener) { listeners.set(name, listener) },
    get(name) {
      if (name === 'llm') return llm
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'test', model: 'test' }) }
      return undefined
    },
    inject(_deps, setup) {
      setup({
        webServer: {
          register(route) {
            recapHandler = route.handler
            return () => {}
          },
        },
        effect(register) { return register() },
      })
    },
  }
  apply(ctx)
  return {
    emitRunning(sessionId) {
      listeners.get('agent/status')({
        status: 'running',
        agent: { id: sessionId, session: { header: { id: sessionId }, events: [] } },
      })
    },
    emitIdle(sessionId, answer) {
      listeners.get('agent/status')({
        status: 'idle',
        agent: {
          id: sessionId,
          session: {
            header: { id: sessionId },
            events: [{
              type: 'assistant/message',
              data: { message: { content: [{ type: 'text', text: answer }] } },
            }],
          },
        },
      })
    },
    releaseSecond,
    async fetchRecap(sessionId) {
      let body = ''
      await recapHandler(
        { method: 'GET', url: '/dsh-complete-notify/recap?sessionId=' + encodeURIComponent(sessionId) },
        { writeHead() {}, end(chunk = '') { body += chunk } },
      )
      return JSON.parse(body)
    },
  }
}

async function waitForRecap(harness, sessionId, expected) {
  for (let i = 0; i < 50; i++) {
    const info = await harness.fetchRecap(sessionId)
    if (info.recap === expected) return info
    await new Promise((resolve) => setImmediate(resolve))
  }
  assert.fail('recap did not become ' + expected)
}

test('host recap：新一轮摘要生成期间不得返回上一轮摘要', async () => {
  const harness = createHostHarness()
  const sessionId = 'same-session-two-runs'
  harness.emitIdle(sessionId, '第一轮最终回答')
  await waitForRecap(harness, sessionId, '第一轮摘要')

  harness.emitIdle(sessionId, '第二轮最终回答')
  try {
    const pending = await harness.fetchRecap(sessionId)
    assert.equal(pending.recap, null)
  } finally {
    harness.releaseSecond()
  }
  await waitForRecap(harness, sessionId, '第二轮摘要')
})

test('host recap：新一轮开始运行时立即废弃上一轮摘要', async () => {
  const harness = createHostHarness()
  const sessionId = 'same-session-run-start'
  harness.emitIdle(sessionId, '第一轮最终回答')
  await waitForRecap(harness, sessionId, '第一轮摘要')

  harness.emitRunning(sessionId)
  const running = await harness.fetchRecap(sessionId)
  assert.equal(running.recap, null)
})

test('host recap：较慢的旧轮生成结果不得覆盖较新的摘要', async () => {
  let releaseFirst
  const firstGate = new Promise((resolve) => { releaseFirst = resolve })
  const harness = createHostHarness({
    llm: {
      async *stream({ messages }) {
        const prompt = messages[0].content[0].text
        if (prompt.includes('第一轮最终回答')) await firstGate
        yield { type: 'text-delta', text: prompt.includes('第一轮最终回答') ? '第一轮摘要' : '第二轮摘要' }
      },
    },
  })
  const sessionId = 'same-session-race'
  harness.emitIdle(sessionId, '第一轮最终回答')
  harness.emitIdle(sessionId, '第二轮最终回答')
  await waitForRecap(harness, sessionId, '第二轮摘要')

  releaseFirst()
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  const settled = await harness.fetchRecap(sessionId)
  assert.equal(settled.recap, '第二轮摘要')
})
