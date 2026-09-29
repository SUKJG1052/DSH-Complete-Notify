import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, isAbsolute, resolve, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

// DSH 0.2.0 的插件清单契约（dsh-package-manifest + dsh-app-boot 的 readPluginMeta）：
//   - `dsh` 只认 manifestVersion / bundle / profile / client，其余字段从不读取；
//   - 展示元数据只来自 package.json#icon（包内相对路径，SVG/PNG/JPEG/WebP，≤256 KiB）
//     与通过包导出可见的 `locale/<lang>.json` 里的 meta.title / meta.description；
//   - 插件运行时兼容性由 `@deepseek-ai/dsh*` 的 peerDependencies 范围声明，profile
//     启动与安装会按这些范围对照 `dsh --version`（不满足则拒绝加载，除非用户显式
//     授予精确版本豁免）。范围必须覆盖 ≤0.2 且排除 0.3（含预发布）。

const root = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

/** 本插件声明支持的 DSH 运行时窗口（与 engines.dsh 必须一致）。 */
const DSH_RANGE = '>=0.1.5-0 <0.3.0-0'

/** 插件真正绑定的 DSH 包：任一缺失/改名都意味着契约变动。 */
const DSH_PEERS = [
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-agent-default-model',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-ui-session',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-host-webserver',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-session',
]

test('manifest: dsh 清单只含 schema 认识的字段', () => {
  assert.deepEqual(Object.keys(manifest.dsh).sort(), ['bundle', 'client', 'manifestVersion'])
  assert.equal(manifest.dsh.manifestVersion, 1)
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  // 0.1.x 时期从来没有被读取过的死字段（旧代码曾依赖它们做展示）
  for (const dead of ['displayName', 'category', 'image']) {
    assert.equal(manifest.dsh[dead], undefined, `dsh.${dead} 不是 DSH manifest 字段`)
  }
})

test('manifest: 声明的客户端模块都真实存在且不再引用已删除的 dsh-client-runtime', () => {
  const inject = manifest.dsh.client.inject
  assert.ok(Array.isArray(inject) && inject.length > 0)
  assert.ok(!inject.includes('@deepseek-ai/dsh-client-runtime'), 'dsh-client-runtime 在 0.1.7/0.2.0 的客户端图里都不存在')
  assert.ok(inject.includes('@deepseek-ai/dsh-client-ui-slots'))
  assert.ok(inject.includes('@deepseek-ai/dsh-client-ui-session'))
})

test('manifest: 运行时兼容性用 dsh peer 范围声明，且与 engines.dsh 一致', () => {
  assert.equal(manifest.engines.dsh, DSH_RANGE)
  for (const name of DSH_PEERS) {
    assert.equal(manifest.peerDependencies[name], DSH_RANGE, `${name} 必须声明支持的 DSH 窗口`)
    // 这些包由 DSH 运行时提供，不由 npm 安装（否则 CI 与 profile 会多拉一整棵树）
    assert.equal(manifest.peerDependenciesMeta?.[name]?.optional, true, `${name} 必须标记 optional`)
  }
  assert.equal(manifest.peerDependencies['@deepseek-ai/cordis'], '>=4.0.1 <5.0.0')
})

test('manifest: 图片图标满足 0.2.0 的读取约束', () => {
  assert.equal(manifest.icon, 'assets/icon.svg')
  assert.ok(!isAbsolute(manifest.icon) && !win32.isAbsolute(manifest.icon))
  assert.ok(['.svg', '.png', '.jpg', '.jpeg', '.webp'].includes(extname(manifest.icon).toLowerCase()))
  const file = resolve(root, manifest.icon)
  assert.ok(existsSync(file), 'icon 文件必须随包发布')
  const stat = statSync(file)
  assert.ok(stat.isFile())
  assert.ok(stat.size <= 256 * 1024, '图标上限 256 KiB')
  assert.ok(manifest.files.includes('assets/icon.svg'), 'files[] 必须包含图标')
  const source = readFileSync(file, 'utf8')
  assert.match(source, /<svg[\s>]/)
  assert.match(source, /<\/svg>\s*$/)
})

test('manifest: locale 字典满足 0.2.0 的读取约束（文件名即语言 id、必须有 en、必须导出）', () => {
  const localeDir = resolve(root, 'locale')
  const entries = readdirSync(localeDir)
  assert.ok(entries.includes('en.json'), 'en.json 是其他语言文件的锚点')
  assert.equal(manifest.exports['./locale/*.json'], './locale/*.json', 'DSH 通过包导出解析 locale/<lang>.json')
  assert.ok(manifest.files.includes('locale'), 'files[] 必须包含 locale 目录')
  for (const entry of entries) {
    assert.match(entry, /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*\.json$/, `locale/${entry} 的文件名必须是语言 id`)
    const parsed = JSON.parse(readFileSync(resolve(localeDir, entry), 'utf8'))
    assert.equal(typeof parsed.meta, 'object')
    assert.ok(typeof parsed.meta.title === 'string' && parsed.meta.title.trim() !== '')
    assert.ok(typeof parsed.meta.description === 'string' && parsed.meta.description.trim() !== '')
  }
  const zh = JSON.parse(readFileSync(resolve(localeDir, 'zh.json'), 'utf8'))
  assert.match(zh.meta.title, /任务完成通知/)
})
