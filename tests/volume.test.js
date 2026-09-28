import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  playSound, soundPresetIds, windowStub,
  softClip, normalizeVolume, MASTER_GAIN, VOLUME_MAX, LIMIT_KNEE, LIMIT_DRIVE, DEFAULT_CFG,
} from './helpers.js'

// 音量/限幅回归护栏：把 playSound 真正跑一遍，捕获它建出的音频图，再按 Web Audio 的
// 指数 ramp 语义重建包络。输出峰值必须 ≤ 1.0（硬削波是失真，不是「更响」），
// 同时 100% 以上确实要更响（软限幅抬 RMS）。

const RAMP_FLOOR = 0.0001 // playSound 里指数 ramp 的终点
const RAMP_UP = 0.02      // 每个音符的起振时间
const STEP = 0.0005

const recorder = (() => {
  const gains = []
  const oscs = []
  const shapers = []
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
    createWaveShaper() {
      const node = { kind: 'shaper', curve: null, oversample: 'none', targets: [] }
      node.connect = (target) => { node.targets.push(target) }
      shapers.push(node)
      return node
    },
  }
  return { audio, gains, oscs, shapers }
})()

windowStub.AudioContext = function AudioContextStub() { return recorder.audio }

/**
 * 播放一次并还原音频图，返回与音量无关的「音符包络」+ master 的衰减时长。
 * 注意 master 走的是 exponentialRampToValueAtTime(0.0001)，其 dB/s 斜率取决于起始
 * 增益 —— 所以信号必须按 (v0, decay) 重新合成，不能简单地把包络乘以倍率。
 */
function render(soundId, volume) {
  recorder.gains.length = 0
  recorder.oscs.length = 0
  recorder.shapers.length = 0
  playSound(soundId, volume)

  const shaper = recorder.shapers.find((s) => s.targets.includes(recorder.audio.destination))
  const pre = shaper ? recorder.gains.find((g) => g.targets.includes(shaper)) : undefined
  const master = pre
    ? recorder.gains.find((g) => g.targets.includes(pre))
    : recorder.gains.find((g) => g.targets.includes(recorder.audio.destination))
  const empty = { shaper, pre, master: null, notes: [], decay: 0, masterGain: 0 }
  if (!master || master.set === null) return empty

  const start = master.set.time
  const end = master.ramps.length > 0 ? master.ramps[master.ramps.length - 1].time : start
  const decay = Math.max(end - start, 1e-6)
  const voices = recorder.gains
    .filter((g) => g !== master && g !== pre)
    .map((g) => {
      const osc = recorder.oscs.find((o) => o.targets.includes(g))
      const [up, down] = g.ramps
      return { up, down, start: osc ? osc.start : up ? up.time - RAMP_UP : 0 }
    })
    .filter((n) => n.up && n.down)

  const horizon = Math.max(end, ...voices.map((n) => n.down.time))
  const notes = []
  for (let t = start; t <= horizon; t += STEP) {
    let sum = 0
    for (const n of voices) {
      if (t < n.start || t > n.down.time) continue
      if (t <= n.up.time) {
        sum += RAMP_FLOOR * Math.pow(n.up.value / RAMP_FLOOR, (t - n.start) / Math.max(n.up.time - n.start, 1e-6))
      } else {
        sum += n.up.value * Math.pow(RAMP_FLOOR / n.up.value, (t - n.up.time) / Math.max(n.down.time - n.up.time, 1e-6))
      }
    }
    notes.push(sum)
  }
  return { shaper, pre, master, notes, decay, masterGain: master.set.value }
}

/** 按 master 起始增益 v0 合成实际输出信号（master 与音符都是指数 ramp）。 */
function signalOf(graph, v0, limited) {
  return graph.notes.map((note, index) => {
    const t = index * STEP
    const envelope = v0 <= RAMP_FLOOR || t > graph.decay ? 0 : v0 * Math.pow(RAMP_FLOOR / v0, t / graph.decay)
    const x = note * envelope
    return limited ? softClip(x) : x
  })
}

/** 峰值与能量（∫y²dt）。 */
function analyze(signal) {
  let peak = 0
  let energy = 0
  for (const y of signal) {
    const a = y < 0 ? -y : y
    if (a > peak) peak = a
    energy += y * y * STEP
  }
  return { peak, energy, db: energy > 0 ? 10 * Math.log10(energy) : -Infinity }
}

function measure(soundId, volume) {
  const graph = render(soundId, volume)
  const limited = graph.shaper !== undefined
  return { ...graph, limited, signal: signalOf(graph, graph.masterGain, limited), ...analyze(signalOf(graph, graph.masterGain, limited)) }
}

/** 用同一个预设的包络，对比不同 (增益, 是否软限幅) 配置的响度。 */
function compare(soundId, plans) {
  const base = render(soundId, 1)
  const limited = base.shaper !== undefined
  return plans.map((plan) => ({
    label: plan.label,
    ...analyze(signalOf(base, plan.masterGain, plan.limited === undefined ? limited : plan.limited)),
  }))
}

test('音量：任一预设 × 任一合法音量的输出峰值 ≤ 1.0（不硬削波）', () => {
  for (const id of soundPresetIds) {
    if (id === 'silent') continue
    for (const volume of [0, 0.1, 0.25, 0.5, 0.6, 0.8, 1, 1.2, VOLUME_MAX]) {
      const { peak } = measure(id, volume)
      assert.ok(peak <= 1.0, `${id} @ ${volume} 峰值 ${peak.toFixed(3)} > 1.0（会硬削波）`)
    }
  }
})

test('音量：软限幅级接在 master 与 destination 之间', () => {
  const graph = measure('soft-chime', 1)
  assert.ok(graph.shaper, '没有接 WaveShaper 软限幅')
  assert.ok(graph.pre, '没有 pre-gain（信号会撞上 WaveShaper 的定义域上限）')
  assert.equal(Math.round(1 / graph.pre.set.value), Math.round(LIMIT_DRIVE))
  assert.equal(graph.shaper.oversample, '2x')
  assert.ok(graph.shaper.curve instanceof Float32Array)
  assert.equal(graph.shaper.curve.length, 2048)
})

test('音量：默认音量（80%）完全在线性区，音色零改变', () => {
  const graph = measure('soft-chime', DEFAULT_CFG.volume)
  const linear = analyze(signalOf(graph, graph.masterGain, false))
  assert.equal(DEFAULT_CFG.volume, 0.8)
  assert.equal(graph.masterGain, DEFAULT_CFG.volume * MASTER_GAIN)
  for (const value of graph.signal) {
    assert.ok(Math.abs(value) <= LIMIT_KNEE, `默认音量已进入软限幅区（|${value.toFixed(3)}| > ${LIMIT_KNEE}）`)
  }
  assert.equal(graph.peak, linear.peak)
  assert.ok(graph.peak > 0.7, `默认音量峰值 ${graph.peak.toFixed(3)} 太小`)
})

test('音量：100% 时最响的预设已接近满刻度', () => {
  let worst = { id: null, peak: 0 }
  for (const id of soundPresetIds) {
    if (id === 'silent') continue
    const { peak } = measure(id, 1)
    if (peak > worst.peak) worst = { id, peak }
  }
  assert.ok(worst.peak > 0.9, `${worst.id} @ 100% 峰值只有 ${worst.peak.toFixed(3)}，上限没抬到位`)
  assert.ok(worst.peak <= 1.0, `${worst.id} @ 100% 峰值 ${worst.peak.toFixed(3)} 超了`)
})

test('音量：新默认（80% × 2.55）比旧默认（60% × 1.75）响 5 dB 以上', () => {
  const [oldDefault, newDefault] = compare('soft-chime', [
    { label: 'old 60% x1.75', masterGain: 0.6 * 1.75, limited: false },
    { label: 'new 80% x2.55', masterGain: 0.8 * MASTER_GAIN, limited: true },
  ])
  const gain = newDefault.db - oldDefault.db
  assert.ok(gain > 5, `默认音量只提升了 ${gain.toFixed(2)} dB`)
  assert.ok(newDefault.peak <= 1.0)
})

test('音量：150% 比 100% 更响（软限幅抬 RMS 而不是削平）', () => {
  const [at100, at150] = compare('soft-chime', [
    { label: '100%', masterGain: 1 * MASTER_GAIN, limited: true },
    { label: '150%', masterGain: VOLUME_MAX * MASTER_GAIN, limited: true },
  ])
  assert.ok(at150.peak > at100.peak, `150% 峰值 ${at150.peak.toFixed(3)} 没有超过 100% 的 ${at100.peak.toFixed(3)}`)
  assert.ok(at150.peak <= 1.0, `150% 峰值 ${at150.peak.toFixed(3)} 超了满刻度`)
  const gain = at150.db - at100.db
  assert.ok(gain > 1.5, `100% → 150% 只提升了 ${gain.toFixed(2)} dB`)
})

test('音量：150% 比旧版本上限（100% × 1.75）明显更响', () => {
  const [oldMax, newMax] = compare('soft-chime', [
    { label: 'old max', masterGain: 1 * 1.75, limited: false },
    { label: 'new max', masterGain: VOLUME_MAX * MASTER_GAIN, limited: true },
  ])
  assert.ok(newMax.peak > oldMax.peak, '上限没提高')
  assert.ok(newMax.db - oldMax.db > 3, `上限只提高了 ${(newMax.db - oldMax.db).toFixed(2)} dB`)
})

test('音量归一化：非法值回落默认，越界值截到上限（绝不放大）', () => {
  for (const bad of [NaN, Infinity, -1, '0.9', null, undefined]) {
    assert.equal(normalizeVolume(bad), DEFAULT_CFG.volume, `音量 ${String(bad)} 未被校验`)
  }
  assert.equal(normalizeVolume(2), VOLUME_MAX)
  assert.equal(normalizeVolume(VOLUME_MAX), VOLUME_MAX)
  assert.equal(normalizeVolume(0.6), 0.6)
  assert.equal(normalizeVolume(0), 0)
})

test('音量：非法音量不会产生越界 master gain', () => {
  for (const bad of [2, 99, -1, NaN, '0.9']) {
    const { masterGain } = measure('soft-chime', bad)
    assert.ok(masterGain <= VOLUME_MAX * MASTER_GAIN, `音量 ${String(bad)} 产生了越界 master gain ${masterGain}`)
  }
})

test('音量：软限幅函数本身单调、奇对称、有界', () => {
  assert.equal(softClip(0), 0)
  assert.equal(softClip(0.5), 0.5)
  assert.equal(softClip(LIMIT_KNEE), LIMIT_KNEE)
  assert.equal(softClip(-0.6), -softClip(0.6))
  assert.ok(softClip(1.5) < 1 && softClip(50) <= 1)
  let previous = -1
  for (let x = 0; x <= 4; x += 0.05) {
    const y = softClip(x)
    assert.ok(y >= previous, `softClip 在 ${x.toFixed(2)} 处不单调`)
    previous = y
  }
})

test('音量：静音预设不建任何音频节点', () => {
  const { master, shaper } = measure('silent', 1)
  assert.equal(master, null)
  assert.equal(shaper, undefined)
  assert.equal(recorder.gains.length, 0)
  assert.equal(recorder.oscs.length, 0)
})

test('音量：没有 createWaveShaper 的极旧实现退化为直连 destination', () => {
  const saved = recorder.audio.createWaveShaper
  delete recorder.audio.createWaveShaper
  try {
    const graph = render('soft-chime', 1)
    assert.equal(graph.shaper, undefined)
    assert.ok(graph.master && graph.master.targets.includes(recorder.audio.destination))
  } finally {
    recorder.audio.createWaveShaper = saved
  }
})
