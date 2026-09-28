import { test } from 'node:test'
import assert from 'node:assert/strict'
import { playSound, soundPresetIds, windowStub, MASTER_GAIN } from './helpers.js'

// 音量回归护栏：把 playSound 真正跑一遍，捕获它建出的音频图，再按 Web Audio 的
// 指数 ramp 语义重建包络求峰值。输出到 destination 的峰值必须 ≤ 1.0，否则会被
// 音频输出级硬削波（那是失真，不是「更响」）。

const RAMP_FLOOR = 0.0001 // playSound 里指数 ramp 的终点
const RAMP_UP = 0.02      // 每个音符的起振时间（playSound 里的 0.02）

// playSound 内部把 AudioContext 缓存在模块级，所以所有用例共用一份录制器，
// 每次调用前清空记录。
const recorder = (() => {
  const gains = []
  const oscs = []
  const audio = {
    state: 'running',
    currentTime: 0,
    destination: { kind: 'destination' },
    resume: () => Promise.resolve(),
    createGain() {
      const node = { kind: 'gain', set: null, ramps: [], targets: [] }
      node.gain = {
        setValueAtTime(value, time) { node.set = { value, time } },
        exponentialRampToValueAtTime(value, time) { node.ramps.push({ value, time }) },
      }
      node.connect = (target) => { node.targets.push(target) }
      gains.push(node)
      return node
    },
    createOscillator() {
      const node = { kind: 'osc', type: 'sine', freq: null, targets: [], start: null, stop: null }
      node.frequency = { setValueAtTime(value, time) { node.freq = { value, time } } }
      node.connect = (target) => { node.targets.push(target) }
      node.start = (time) => { node.start = time }
      node.stop = (time) => { node.stop = time }
      oscs.push(node)
      return node
    },
  }
  return { audio, gains, oscs }
})()

windowStub.AudioContext = function AudioContextStub() { return recorder.audio }

/** 采样重建输出峰值（master 与各音符 gain 都走指数 ramp）。 */
function peakOf(gains, oscs, audio) {
  const master = gains.find((g) => g.targets.includes(audio.destination))
  if (!master || master.set === null) return 0
  const v0 = master.set.value
  const start = master.set.time
  const end = master.ramps.length > 0 ? master.ramps[master.ramps.length - 1].time : start
  const decay = Math.max(end - start, 1e-6)
  const notes = gains
    .filter((g) => g !== master)
    .map((g) => {
      const osc = oscs.find((o) => o.targets.includes(g))
      const [up, down] = g.ramps
      return { up, down, start: osc ? osc.start : up ? up.time - RAMP_UP : 0 }
    })
    .filter((n) => n.up && n.down)
  const horizon = Math.max(end, ...notes.map((n) => n.down.time))
  let peak = 0
  const step = 0.0005
  for (let t = start; t <= horizon; t += step) {
    const masterAmp = v0 <= RAMP_FLOOR || t > end ? 0 : v0 * Math.pow(RAMP_FLOOR / v0, (t - start) / decay)
    let sum = 0
    for (const n of notes) {
      if (t < n.start || t > n.down.time) continue
      if (t <= n.up.time) {
        sum += RAMP_FLOOR * Math.pow(n.up.value / RAMP_FLOOR, (t - n.start) / Math.max(n.up.time - n.start, 1e-6))
      } else {
        sum += n.up.value * Math.pow(RAMP_FLOOR / n.up.value, (t - n.up.time) / Math.max(n.down.time - n.up.time, 1e-6))
      }
    }
    peak = Math.max(peak, sum * masterAmp)
  }
  return peak
}

/** 播放一次并取回这次新建的节点与峰值。 */
function render(soundId, volume) {
  recorder.gains.length = 0
  recorder.oscs.length = 0
  playSound(soundId, volume)
  return {
    gains: recorder.gains.slice(),
    oscs: recorder.oscs.slice(),
    peak: peakOf(recorder.gains, recorder.oscs, recorder.audio),
  }
}

function masterGainOf(gains, audio) {
  const master = gains.find((g) => g.targets.includes(audio.destination))
  assert.ok(master, '没有找到 master gain（未接到 destination）')
  return master
}

test('音量：任一预设 × 任一合法音量的输出峰值 ≤ 1.0（不削波）', () => {
  for (const id of soundPresetIds) {
    if (id === 'silent') continue
    for (const volume of [0, 0.1, 0.25, 0.5, 0.6, 0.75, 0.9, 1]) {
      const { peak } = render(id, volume)
      assert.ok(peak <= 1.0, `${id} @ ${volume} 峰值 ${peak.toFixed(3)} > 1.0（会硬削波）`)
    }
  }
})

test('音量：100% 时最响的预设仍留至少 20% headroom', () => {
  let worst = { id: null, peak: 0 }
  for (const id of soundPresetIds) {
    if (id === 'silent') continue
    const { peak } = render(id, 1)
    if (peak > worst.peak) worst = { id, peak }
  }
  assert.ok(worst.peak <= 0.8, `${worst.id} @ 1.0 峰值 ${worst.peak.toFixed(3)} 吃掉太多 headroom`)
  assert.ok(worst.peak > 0.5, `${worst.id} @ 1.0 峰值 ${worst.peak.toFixed(3)} 太小，增益没生效`)
})

test('音量：默认 0.6 比上游裸 vol 明显更响，但仍留 headroom', () => {
  const { peak } = render('soft-chime', 0.6)
  // 上游把 vol 直接当 master gain（实测峰值约 0.23）；这里应更响，但不越过 1.0。
  assert.ok(peak > 0.35, `默认音量峰值 ${peak.toFixed(3)} 太小，增益没生效`)
  assert.ok(peak <= 1.0, `默认音量峰值 ${peak.toFixed(3)} 会削波`)
})

test('音量：master gain = volume × MASTER_GAIN', () => {
  const { gains } = render('soft-chime', 0.6)
  const master = masterGainOf(gains, recorder.audio)
  assert.equal(MASTER_GAIN, 1.75)
  assert.equal(master.set.value, 0.6 * MASTER_GAIN)
})

test('音量：非法音量回落默认 0.6（不再出现越界放大）', () => {
  for (const bad of [2, 1.5, -1, NaN, '0.9', null, undefined]) {
    const { gains } = render('soft-chime', bad)
    const master = masterGainOf(gains, recorder.audio)
    assert.equal(master.set.value, 0.6 * MASTER_GAIN, `音量 ${String(bad)} 未被校验`)
    assert.ok(master.set.value < 2, `音量 ${String(bad)} 产生了越界 master gain`)
  }
})

test('音量：静音预设不建任何音频节点', () => {
  const { gains, oscs } = render('silent', 1)
  assert.equal(gains.length, 0)
  assert.equal(oscs.length, 0)
})
