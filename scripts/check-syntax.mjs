#!/usr/bin/env node
// 跨平台语法检查：`node --check` 不接受 glob（Windows 的 cmd/PowerShell 也不会替它
// 展开），所以这里自己枚举文件再逐个交给 `node --check`。
import { readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(process.argv[2] ?? '.')
const roots = ['lib', 'client', 'tests', 'scripts']
const files = []

function walk(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch (err) {
    return
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') walk(path)
      continue
    }
    if (/\.(?:js|mjs|cjs)$/.test(entry.name)) files.push(path)
  }
}

for (const dir of roots) walk(join(root, dir))

let failed = 0
for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
  if (result.status !== 0) {
    failed += 1
    console.error(`✗ ${relative(root, file)}`)
    console.error(((result.stderr || '') + (result.stdout || '')).trim())
  }
}

if (failed > 0) {
  console.error(`\n${failed} file(s) failed the syntax check`)
  process.exit(1)
}
console.log(`✓ syntax check passed for ${files.length} file(s)`)
