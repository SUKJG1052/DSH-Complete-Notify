# dsh-complete-notify

> **来源声明 / Attribution**
>
> 本仓库是 [kaixinbaba/dsh-complete-notify](https://github.com/kaixinbaba/dsh-complete-notify) 的 **fork（衍生作品）**。
> 上游作者与版权所有者：**kaixinbaba**；许可证 **[MIT](LICENSE)**（原文保留、未修改）。
> 本仓库基于上游 **v0.6.2（commit `da84f428`）**；在此之上的改动见 [CHANGELOG](CHANGELOG.md) 与本仓库提交历史。
>
> This repository is a fork of [kaixinbaba/dsh-complete-notify](https://github.com/kaixinbaba/dsh-complete-notify),
> distributed under the same MIT License. Upstream copyright is retained — see [LICENSE](LICENSE).

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-complete-notify"><img src="https://img.shields.io/npm/v/dsh-complete-notify" alt="npm version"></a>
  <a href="https://github.com/kaixinbaba/dsh-complete-notify/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/dsh-complete-notify" alt="license"></a>
</p>

<p align="center">
  <img src="assets/cover.png" alt="dsh-complete-notify cover" width="720">
</p>

DeepSeek Harness（DSH）任务完成通知插件：任务完成时播放**提示音**并弹出**小通知**。

- **纯浏览器方案**：音效用 Web Audio 合成、弹窗是页面内 toast、页面在后台时改用系统通知（Web Notification API）——零系统依赖、零音频文件，Windows / macOS / Linux 通用
- **不依赖任何系统通知命令**（无 osascript / notify-send / PowerShell），通知权限是浏览器站点级授权，授权一次即可
- 与官方运行指示灯同源的完成检测：`shell.overlay` 标准 prop `useSessions`（会话列表快照的 `running` 边缘）+ `useSessionStatus`（`pendingInteraction` 阻塞、`completionUnread` 未读完成）
- toast 与系统通知附带**运行统计**（时长 / tokens / 步骤）与**一句话小结**（💬 recap，≤50 字），点击直达对应会话

## 安装

```sh
# 从本 fork 安装（含 0.6.3–0.6.5 的修复，推荐）
dsh plugin --profile web add "github:SUKJG1052/DSH-Complete-Notify"
# 或从 npm 安装上游版本
dsh plugin --profile web add dsh-complete-notify
# 重启 dsh web 生效（launchd 托管时）：
launchctl kickstart -k gui/$(id -u)/com.dsh.dsh-web
```

本地开发时用源码安装（`link:` 指向本地目录，改代码后重启即生效，无需每次走 npm）：

```sh
dsh plugin --profile web add link:/path/to/dsh-complete-notify
```

## 使用

1. 任务完成后：听到「叮咚」提示音 + 右上角弹出**状态着色**的小卡片（绿 ✓ 任务完成 / 黄 ⚠ 等待你的反馈 / 红 ✕ 任务中断或失败 / 橙 ⚠ 达到 token 上限），包含**一句话小结**（💬 recap，≤50 字）、**运行统计**（时长 ⏱ / tokens ⚡ / 步骤 🔧）与「点击打开会话」提示；点击卡片快速跳转到对应会话，5 秒自动消失
2. 页面切到后台/其他标签页时完成任务：收到**系统通知**（标题与正文按结果状态区分，同样带小结与统计，点击通知会聚焦窗口并打开对应会话）+ 提示音 + 标签页标题闪烁
3. **设置 → 任务完成通知**：
   - 启用提醒 / 提示音 / 系统通知（页面在后台时）开关、音量滑块（0–150%，默认 80%）
   - 分别为绿色完成、黄色阻塞、红色中断选择不同音效
   - 下拉框按当前浏览器识别的操作系统分组：macOS / Windows / Linux 推荐预设 + 通用预设 + 静音
   - 「测试音效」「测试通知」按钮；首次点「测试通知」会请求浏览器通知权限，点**允许**
   - 全部设置保存在浏览器 localStorage（`dsh.completeNotify.v1`）

### 音效选择说明

音效由浏览器 Web Audio API 合成，不读取系统原生声音文件，因此跨操作系统稳定工作。预设名称是对应系统提示音的**风格**，不是调用 macOS/Windows/Linux 的系统音频文件；每个状态可以独立选择，也可以单独设为静音。

### 音量与软限幅

音量滑块 **0–150%，默认 80%**。100% 时最响的预设已经贴着满刻度（峰值 ≈0.93），再线性放大就会撞上输出级**硬削波**（刺耳的方波化失真，听起来不是「更响」而是「破音」）。所以 100% 以上走**软限幅**：`|x| ≤ 0.8` 完全线性、音色零改变（默认音量正落在这一区间），之上用 tanh 平滑饱和到满刻度——峰值不再增长，但衰减尾巴被整体抬起来（RMS 更高），听感确实更响。

实测（soft-chime 预设，输出能量口径）：

| 配置 | 峰值 | 相对 0.6.3 |
|---|---|---|
| 0.6.3 默认（60% × 1.75） | 0.403 | — |
| 0.6.3 上限（100% × 1.75） | 0.662 | +4.2 dB |
| **0.6.4 默认（80% × 2.55）** | 0.768 | **+5.5 dB** |
| 0.6.4 100% | 0.929 | +7.3 dB |
| **0.6.4 上限（150%）** | 0.999 | **+5.7 dB** |

任何合法音量下的峰值都 ≤ 1.0（由 `tests/volume.test.js` 守着）。

## 结果状态

结果状态以 Host 端 `turn/end` 的 `reason.kind` 为权威来源（客户端兜底推断：`turn-error` / `turn-max-tokens` 节点、被打断的 assistant 消息）：

| 状态 | 颜色 | 文案 |
|---|---|---|
| `completed` | 🟢 绿 | 任务完成 |
| `blocked` | 🟡 黄 | 等待你的反馈（模型提问 / 等待审批） |
| `aborted` | 🔴 红 | 任务已中断 |
| `error` | 🔴 红 | 任务失败 |
| `max-tokens` | 🟠 橙 | 达到 token 上限 |

### 弹窗效果预览

<p align="center">
  <img src="assets/screenshot-toast-completed.png" alt="任务完成（绿）" width="270">
  <img src="assets/screenshot-toast-blocked.png" alt="等待你的反馈（黄）" width="270">
  <img src="assets/screenshot-toast-aborted.png" alt="任务已中断（红）" width="270">
</p>

> **关于小结（recap）**：弹窗先立即显示降级小结（最终回答前 50 字的清洗版），随后由 Host 端异步调用 LLM 生成真正的一句话小结（≤50 字）并自动升级替换。每次运行结束调用一次 LLM（输入为最终回答，输出约 50 字，成本极小）。小结覆盖**整轮运行**（多轮 goal 任务取最终回答），与运行统计的「最后一轮」口径不同。

## 行为细节

| 场景 | 行为 |
|---|---|
| 页面可见，任一会话完成 | toast（小结 + 时长/token/steps）+ 对应状态音效 |
| 页面在后台，会话完成 | 系统通知（含小结与统计）+ 对应状态音效 + 标题闪烁 |
| 完成发生在别的会话（不在主视图） | 由 `completionUnread` 兜底提醒一次——即使完成瞬间页面刚刷新/被浏览器节流也能补上 |
| 会话正在等待你的反馈（提问 / 审批挂起） | 立即弹黄色 toast + 阻塞音效（agent 仍在运行时也会提醒），此时不误报「任务完成」 |
| 系统通知权限被拒 | 降级为长时 toast（30 秒，回来也能看到）+ 标题闪烁 |
| 一次完成 | 只提醒一次（按会话去重，重新运行后再完成会再次提醒） |
| 点击 toast / 系统通知 | 通过 `uiWorkspace.openSession()` 切到对应会话（≤0.1.5 回退 `sessions.open()`） |
| 子代理（subagent）会话 | 不提醒 |
| 多会话同时完成 | toast 栈最多 3 条（FIFO） |

> 运行统计口径为「最后一轮」（turn 号最大的已结束轮次）：时长来自 `turnTimings`，tokens 为 assistant 消息 `usage` 的输入+输出之和，steps 为工具调用块数量。单轮任务即为本次运行的完整数据；多轮 goal 运行显示最后一轮。

> 兼容性：完成/阻塞信号在 DSH **0.1.7-rc.2 与 0.2.0-rc.1** 上实测（两版的插槽标准 prop、`sessionStatus` 形态、`Session.snapshotEvents()`、`uiWorkspace.openSession()` 逐项核对过）；0.1.5 时代的会话行字段（`completed` / `pendingInteraction`）与 `sessions.open()` 仍保留回退分支。

### DSH 版本与插件元数据

- **支持的运行时窗口：`>=0.1.5-0 <0.3.0-0`**（`engines.dsh` 与 `peerDependencies` 一致声明）。
  DSH 0.2.0 起，安装与 profile 启动会按插件声明的 `@deepseek-ai/dsh*` peer 范围对照 `dsh --version`
  做**兼容性门禁**：不满足的插件会被明确拒绝加载（并提示 `dsh plugin allow-version` 精确版本豁免），
  而不是带着不匹配的契约静默运行。本插件声明了它真正绑定的 8 个运行时包
  （`dsh-session` / `dsh-llm` / `dsh-agent` / `dsh-agent-default-model` / `dsh-host-webserver` /
  `dsh-client-ui-slots` / `dsh-client-ui-session` / `dsh-client-locale`），因此
  **0.2.0-rc.1 上不会被跳过**；升到 0.3.0 时会被门禁挡下并给出明确提示。
  这些 peer 标记为 `optional`——它们由 DSH 运行时提供，不需要 npm 再装一份。
- **插件展示信息**走 0.2.0 的读取方式：`package.json#icon`（`assets/icon.svg`）+ 导出的
  `locale/en.json` / `locale/zh.json` 里的 `meta.title` / `meta.description`。插件管理器里显示为
  **Completion Notify / 任务完成通知** 与对应简介；`dsh.displayName` / `dsh.category` / `dsh.image`
  这类字段 DSH 从不读取，已从清单中移除（`npm run verify:plugin` 会对它们告警）。

## 已知限制

- 标签页必须开着（浏览器限制）；标签页关闭后系统通知也收不到。如需关页推送可后续接 Push API（需推送服务器）
- toast 为深色样式，暂未跟随明暗主题切换
- 浏览器自动播放策略：首次用户交互（点击/按键）后音效才可用——DSH 里发第一条消息时即自然解锁

## 开发

```sh
npm test             # 语法检查 + 单测（watcher / 音量 / 客户端适配 / 统计 / 宿主）+ 装配集成测试
npm run verify:plugin  # DSH 插件标准校验（含 npm pack 制品检查）
npm run smoke:install  # 在隔离 DSH_HOME 里真实安装一次（需要已安装 dsh）
```

结构：

```
lib/index.js      # 宿主入口（事件监听、recap LLM 与路由装配）
client/client.js  # 客户端单文件（DSH 模块加载器格式；全部逻辑在此）
cordis.patch.yml  # bundle insert 声明
tests/            # node --test 单测（夹具遵循真实投影形状）
scripts/          # 语法检查 / 插件标准校验 / 隔离安装 smoke
```

## 卸载

```sh
dsh plugin --profile web remove dsh-complete-notify
```

## License

MIT
