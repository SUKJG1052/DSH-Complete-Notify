# Changelog

> 本文件顶部是**本 fork 的改动记录**；`0.6.2` 及以下为上游
> [kaixinbaba/dsh-complete-notify](https://github.com/kaixinbaba/dsh-complete-notify) 的原始记录，未作改动。

## 0.6.5 — 2026-09-29

适配 DSH **0.2.0-rc.1**（运行时已升级；0.2.0 引入了插件兼容性门禁与新的插件元数据读取方式）。

- **声明运行时兼容窗口，接入 0.2.0 的兼容性门禁。** DSH 0.2.0 起，安装与 profile 启动会按插件声明的 `@deepseek-ai/dsh*` peer 范围对照 `dsh --version` 判定，不满足者被明确拒绝加载（可 `dsh plugin allow-version` 精确豁免）。本插件此前只声明了 `@deepseek-ai/cordis`，等于**没有声明**，门禁无从判定。现声明真正绑定的 8 个运行时包（`dsh-session`、`dsh-llm`、`dsh-agent`、`dsh-agent-default-model`、`dsh-host-webserver`、`dsh-client-ui-slots`、`dsh-client-ui-session`、`dsh-client-locale`），范围为 `>=0.1.5-0 <0.3.0-0`，并与 `engines.dsh` 保持一致。这些 peer 标记 `optional`——由 DSH 运行时提供，不让 npm/pnpm 再拉一棵树。
- **采用 0.2.0 的插件展示元数据。** 新增 `package.json#icon`（`assets/icon.svg`，包内相对路径、≤256 KiB）与导出的 `locale/en.json` / `locale/zh.json`（`meta.title` / `meta.description`），插件管理器据此显示 **Completion Notify / 任务完成通知** 与对应简介；`exports` 增加 `"./locale/*.json"`，否则 DSH 的 ESM 解析取不到词典。
- **移除死配置。** 删除 `dsh.displayName` / `dsh.category` / `dsh.image`（DSH 从不读取这些字段；`dsh` 清单只认 `manifestVersion` / `bundle` / `profile` / `client`），并补上 `manifestVersion: 1`。
- **`verify-plugin.mjs` 增加元数据校验**：图标必须是包内相对路径、合法扩展名、≤256 KiB；`locale/` 下每个 `.json` 的文件名必须是语言 id、必须有 `en.json`、必须被 `exports` 暴露；`dsh.*` 出现 schema 之外的键会告警；打包检查要求图标与 `locale/en.json` 实际进入 tarball。
- **新增 `tests/manifest.test.js`**（5 个用例）锁定上述清单契约，含「不得再引用已删除的 `@deepseek-ai/dsh-client-runtime`」「dsh peer 范围必须覆盖 ≤0.2 且排除 0.3」。
- **复核结论（只读核对，无需改代码）**：0.2.0-rc.1 与本插件用到的全部平台契约一致——`shell.overlay` / `settings.section` 的标准 prop 仍含 `useSessions` + `useSessionStatus`，`ui-session` 的 `sessionStatus` 形态（`running` / `pendingInteraction` / `completionUnread`）未变，`Session.snapshotEvents()`、`UiWorkspace.openSession()`、`webServer.register({kind:'exact'})`、`agent/status` 载荷、`turn/end.reason.kind`、`ctx.locale.register(ns, dicts)` 与 `ctx.slots.register({..., inject: () => ({})})` 均照旧；插件已在运行中的 0.2.0-rc.1 客户端模块清单里正常下发，宿主 recap 路由正常响应。

## 0.6.4 — 2026-09-28

音量上限与响度（反馈「声音不够大」）：

- **音量滑块上限 100% → 150%，默认音量 60% → 80%。** 实测（soft-chime，能量口径）：默认音量比 0.6.3 响 **+5.5 dB**，新上限（150%）比 0.6.3 的上限响 **+5.7 dB**。
- **新增软限幅级**（pre-gain → WaveShaper（tanh 软膝）→ destination）：`|x| ≤ 0.8` 时完全线性、音色零改变（默认音量正落在这一区间），之上平滑饱和到满刻度。于是 100% 以上可以继续变响（衰减尾巴被抬起、RMS 更高），而不会出现输出级硬削波那种刺耳的方波化失真。
- 新增回归护栏 `tests/volume.test.js`：断言任一预设 × 任一合法音量（含 150%）的输出峰值 ≤ 1.0，并断言默认音量仍在线性区、150% 确实比 100% 响。
- 音量归一化：非数字 / 负值回落默认，超过上限截到上限（历史补丁曾把 200% 存进 localStorage，现在只会得到 150%，不再产生越界增益）。
- 极旧浏览器缺少 `createWaveShaper` 时退化为直连 destination，不影响出声。
- 设置页音量行下新增说明文案（中英）。

## 0.6.3 — 2026-09-28

在 DSH **0.1.7-rc.2** 上实测复核后修复的一批缺陷（本地未提交补丁中真正有效的部分已并入仓库）：

- **修复：LLM 一句话小结从未生成。** 宿主取「最终回答」时读 `session.events`，而 `Session` 没有这个成员（真名 `session.snapshotEvents()`）→ 恒为空 → `computeRecap` 永不执行，toast 里永远是客户端降级的「回答前 50 字」。现优先走 `snapshotEvents()`，旧字段仅作回退（`lib/index.js`）。
- **修复：阻塞（黄色「等待你的反馈」）提醒从未触发。** 会话列表行从来没有 `pendingInteraction` 字段；0.1.7 的权威来源是 `useSessionStatus` 下发的 `sessionStatus`（`Map<sessionId, { running, pendingInteraction, completionUnread }>`）。现从该标准 prop 读取，并把 `statuses` 纳入检测 effect 的依赖（阻塞状态变化时列表快照可能完全没变）。
- **修复：漏报后无法恢复。** 粘性完成信号 `entry.completed` 在 0.1.7 已从会话行移除，一旦「运行→停止」边缘没被看到（页面刷新、后台标签节流、订阅晚于完成时刻）就永久漏报。现以 `sessionStatus.completionUnread`（语义正是「不在主视图时完成」）兜底。
- **修复：快照更新会掐断进行中的提醒。** 完成检测 effect 每次 diff 都返回 cleanup 取消上一轮异步通知，而 `notified` 去重又阻止重试 → 永久丢提醒。改为只在真正卸载时停止。
- **修复：点击 toast / 系统通知打不开会话。** `sessions.open()` 是 ≤0.1.5 的入口，0.1.7 已移除（调用被 try/catch 静默吞掉）。现优先 `uiWorkspace.openSession()`，旧入口仅作回退。
- **修复：音量越界与硬削波。** 移除未提交补丁中的 `VOLUME_BOOST = 10`（默认音量下 master gain = 6.0，峰值 ≈3.0，滑块约 10% 以上全程削波，比上游响 +20 dB）。改为固定管线增益 `MASTER_GAIN = 1.75`：默认音量峰值 ≈0.40、100% 时最响的预设 ≈0.67，全程 < 1.0，比上游响约 5 dB 且不失真。
- **修复：服务读取竞态。** `ctx.get('sessions')` 由「激活时捕获」改为渲染/调用时惰性解析。
- **工程：** `npm test` 在 Windows 上不再因 `node --check tests/integration/*.test.js` 的 glob 直接失败（新增 `scripts/check-syntax.mjs` 自行枚举文件）；`verify-plugin.mjs` / `smoke-install.mjs` 在 Windows 上能正确调用 `npm` / `dsh`（`.cmd` 需经 shell），打包校验不再抛 `Cannot read properties of undefined (reading 'trim')`；`files[]` 补上 README 引用的 3 张截图；`dsh.client.inject` 去掉运行版不存在的 `@deepseek-ai/dsh-client-runtime`，补上真正提供插槽与会话状态的 `@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-session`。
- **测试：** 单测夹具改为**真实投影形状**（不再编造 `completed` / `pendingInteraction` / `current`），新增 `sessionStatus` 用例、音量峰值回归护栏（把 `playSound` 跑一遍并按 Web Audio 指数 ramp 重建包络）与会话打开/版本回退用例。单测 51 + 集成 4 全绿（此前 40 + 4 全绿却漏掉上述全部缺陷）。
- 兼容：0.1.5 的 `completed` / `pendingInteraction` 行字段与 `sessions.open()` 仍走回退分支，旧版本行为不变。

## fork — 2026-09-28

- 建立 fork，基线为上游 **v0.6.2**（commit `da84f428`）；保留 `LICENSE` 原文与完整上游提交历史。
- 新增代码审查报告 `REVIEW-0.6.2-and-local-patch.md`（只读审查，不含任何代码改动）。
- 待修复项见该报告第 6 节：音量回归（`VOLUME_BOOST`）、阻塞提醒来源（应为 `useSessionStatus`）、
  宿主 recap 的 `session.snapshotEvents()`、以及 `entry.completed` 缺失导致的漏报。

## 0.6.2 — 2026-08-23

- 修复：同一会话连续运行时立即废弃上一轮 recap，并阻止较慢的旧轮异步结果覆盖新轮摘要，避免完成通知显示落后一轮的小结。

## 0.6.1 — 2026-08-18

- 工程规范：迁移至 DSH 插件 canonical standard，新增 Host/client 合约与装配集成测试、制品验证脚本、隔离安装 smoke 和 Node 22/24 CI。

## 0.6.0 — 2026-08-17

- 新特性：根据当前操作系统提供音效预设下拉框（macOS / Windows / Linux 推荐 + 通用预设 + 静音）
- 新特性：绿色完成、黄色阻塞、红色中断可分别指定音效；error 复用红色音效，max-tokens 复用黄色音效
- 设置页增加音效选择说明与状态音效配置行
- 文档：README 说明音效为 Web Audio 合成风格、不读取系统原生音频文件

## 0.5.0 — 2026-08-17

- 修复：Host 用 `ctx.inject` 等待 `webServer` 服务就绪后再注册 recap 路由（0.4.0 中路由未注册，导致结果状态/LLM 小结永远无法送达客户端——中断显示为绿色的根因）
- 新特性：watcher 监听 `pendingInteraction`（提问/审批挂起）→ 实时弹出黄色「等待你的反馈」，不再依赖运行状态切换
- 新特性：设置页「状态预览」按钮（测试完成 / 测试阻塞 / 测试中断），可随时预览三种状态的弹窗
- 文档：README 新增三种状态弹窗效果预览图

## 0.4.0 — 2026-08-17

- 新特性：通知按**结果状态**区分——绿「任务完成」/ 黄「等待你的反馈（阻塞）」/ 红「任务已中断 / 任务失败」/ 橙「达到 token 上限」；toast 图标、标题、左边框按状态着色，系统通知标题同步区分
- Host 记录每个根会话最近一次 `turn/end` 的 `reason.kind`（`session/event` 监听），经 recap 路由一并返回给客户端；客户端兜底推断（`turn-error` / `turn-max-tokens` 节点、被打断的 assistant）
- 修复：阻塞（等待反馈）时 agent 回到 idle 原会被误报为「任务完成」，现正确显示黄色「等待你的反馈」
- 新增结果状态相关单测（共 27 个用例全绿）

## 0.3.0 — 2026-08-17

- 新特性：toast 与系统通知附带**一句话小结（💬 recap）**——弹窗先显示降级小结（最终回答前 50 字清洗版），Host 端异步调用 LLM 生成真正的 ≤50 字小结并自动升级替换；小结覆盖整轮运行
- Host 半从空壳变为真实实现：监听 `agent/status` idle 触发 recap 生成（每次运行一次 LLM 调用），经 webserver 路由 `GET /dsh-complete-notify/recap` 供客户端拉取
- 新增 Host 与客户端小结/回答提取单测（共 24 个用例全绿）
- 文档：说明 recap 的降级/升级机制与「最后一轮统计 vs 整轮小结」的口径差异

## 0.2.0 — 2026-08-16

- 新特性：toast 与系统通知附带**运行统计**——时长（⏱，`turnTimings` 最后一轮）、tokens（⚡，assistant 消息 `usage` 输入+输出之和）、步骤数（🔧，工具调用块计数）
- toast 增加「点击打开会话」提示，点击直达对应会话；系统通知点击同样聚焦并打开会话
- 新增运行统计模块单元测试（共 16 个用例全绿）
- 文档：安装方式改为 npm 优先，新增 CHANGELOG

## 0.1.0 — 2026-08-16

- 首发：任务完成时播放 Web Audio 合成「叮咚」提示音 + 页面内 toast；页面在后台时发送系统通知 + 标题闪烁
- 完成检测与官方运行指示灯同源（会话列表 `running` / `completed`），按会话去重、子代理过滤、多会话 toast 栈限 3 条
- 设置页（设置 → 任务完成通知）：总开关 / 音效 / 系统通知 / 音量 / 测试音效与测试通知，localStorage 持久化
- 发布到 GitHub（kaixinbaba/dsh-complete-notify）与 npm（dsh-complete-notify）
