# 🧭 GitHubCompass

> 面向中国大陆用户的 GitHub 访问辅助工具：以本地 hosts 将 GitHub 官方域名指向其官方真实 IP——自动探测、本机实测选优、备份写入、闭环保活。全程**无代理、无流量转发、不收集任何数据**。
> 界面与文档仅提供简体中文。

> ⭐ 如果它帮到了你，欢迎点一个 Star —— 这是本项目持续维护的最大动力。

## 它做什么、不做什么

| 做 | 不做 |
| --- | --- |
| 将 GitHub 官方域名解析到其**官方真实 IP**（写入系统 hosts 标记块） | 不提供代理服务 |
| 本地实测（TLS + HTTP 质量）选出当前网络下最快的 IP | 不转发任何流量 |
| 写入前自动备份，随时一键回滚 | 不收集任何用户数据 |
| 应用内定时器静默巡检：劣化自动切换、候选池枯竭自动扩池、守护域缺失自动自愈 | 不修改 hosts 中标记块以外的任何内容 |

## 核心原理

1. **交叉解析**：目标域名 × 多家公共 DNS（223.5.5.5 / 119.29.29.29 / 114.114.114.114 / 8.8.8.8 / 1.1.1.1）取并集；
2. **归属预过滤**：仅保留属于 GitHub 官方 meta 段与 Fastly 公布段的 IP，防 DNS 污染；
3. **TLS 终判**：TCP 443 握手，SNI 使用真实域名，校验证书链与 SAN——证书匹配才是最终依据，永不跳过；
4. **本地选优**：候选池在**用户本机**实测（TLS 握手 + HTTP 首字节质量），按传输质量排序选优——海外探测结果仅作参考；
5. **闭环保活**：应用内定时器周期性健康检查（不依赖系统计划任务）；劣化 IP 自动切换候选池最优；候选池枯竭时本地扩池（多源 DNS + 官方段抽样 + 实测）；守护域意外丢失时自动恢复。

## 快速开始

### 方式一：直接使用 hosts 片段（无需安装）

将 [data/hosts.txt](data/hosts.txt) 的内容追加到系统 hosts 文件末尾（仅 `# GitHubCompass Host Start/End` 标记块）：

- Windows：`C:\Windows\System32\drivers\etc\hosts`
- macOS / Linux：`/etc/hosts`

亦可作为远程订阅源（SwitchHosts、AdGuard 等）：

```
https://raw.githubusercontent.com/amyaxy/github-compass/main/data/hosts.txt
```

### 方式二：桌面客户端（推荐）

从 [Releases](https://github.com/amyaxy/github-compass/releases) 下载对应平台安装包。客户端提供：

- 首启向导（环境检测 → 拉取探测 → 应用/只读导出）；
- 仪表盘（域名健康、延迟可视化、最近活动）；
- 探测详情（候选池实测明细，按域名单选写入）；
- 备份回滚（diff 预览 + 二次确认）；
- 自动保活（应用内定时器静默巡检与自动切换，不注册系统计划任务、无需授权）。

完整操作说明见 [使用手册](docs/USAGE.md)。

### 方式三：源码构建

```bash
pnpm install
pnpm client:dev      # 开发模式（COMPASS_LOCAL_DATA 可指向本地 data 目录联调）
pnpm client:build    # 生产构建
pnpm -C packages/client dist   # 打包安装包（Windows / macOS）
```

环境要求：Node.js ≥ 20、pnpm ≥ 9。

## 项目结构

```
├── packages/
│   ├── core/      # 纯逻辑内核：探测、归属过滤、选优、闭环决策、扩池（零依赖，可单测）
│   ├── client/    # Electron + Vue3 桌面客户端（主进程保活定时器 / 渲染进程 / IPC）
│   └── probe/     # 数据管道 CLI：交叉解析 → 归属过滤 → TLS 终判 → 产出 data/
├── data/          # 探测产物（版本化）：candidates.json / hosts.json / hosts.txt
├── docs/          # 使用手册等公开文档（架构设计文档仅项目内部维护，不随仓库发布）
├── e2e/           # Playwright 端到端测试（全隔离：临时 hosts / 临时 userData）
└── scripts/       # 诊断与自检脚本
```

## 开发与测试

| 命令 | 作用 |
| --- | --- |
| `pnpm typecheck` | 内核与数据管道类型检查 |
| `pnpm test` | 单元 / 集成测试（vitest） |
| `pnpm client:build` | 客户端生产构建 |
| `pnpm test:e2e` | 端到端测试（隔离环境，不触碰真实系统 hosts） |
| `pnpm test:all` | 上述全链路 |
| `pnpm verify:all` | 类型 + 自检 + 探测 + 数据校验 + 构建 |
| `pnpm core:selftest` / `pnpm client:selftest` | 模块级自检 |

## 数据管道

- `.github/workflows/probe.yml`：每 6 小时运行探测并提交 `data/`（内容指纹无变化则跳过提交）；
- `.github/workflows/heartbeat.yml`：周期性保活提交，防止仓库因长期无活动被平台停用；
- `.github/workflows/test.yml`：CI 全链路测试。

`data/` 中的候选池仅作为**种子**：客户端写入前一律以本机实测结果为准。

> **时间规范**：项目内所有时间——界面显示、运行日志、数据文件字段、备份文件名——统一为
> 东八区中国时间（ISO 8601 带 `+08:00` 偏移，如 `2026-09-25T22:58:03+08:00`），机器可直接解析。

## 平台支持

| 能力 | Windows | macOS |
| --- | --- | --- |
| 探测 / 选优 / hosts 写入与备份 / 回滚 / 托盘 / 开机自启 | ✅ | ✅ |
| 自动保活（定时检查） | ✅ 应用内定时器 | ✅ 应用内定时器 |
| 安装包 | ✅ NSIS `.exe` | ✅ `.dmg` |

自动保活**不注册系统计划任务、不写 LaunchAgent**——由应用内定时器驱动，
配合「托盘常驻 + 开机自启」实现长期运行；也因此不会触发安全软件对计划任务
持久化行为的告警。Linux 客户端在路线图中。

## 安全与隐私

- TLS 校验永不跳过：SNI 必须为真实域名，验证证书链与 SAN，从机制上杜绝写入劫持 IP；
- hosts 仅替换标记块内容，写入前自动备份，写坏可回滚；
- 全部探测与决策在本机完成，无上报、无遥测；
- 自动保活为应用内定时器，不注册系统计划任务；仅在实际写入 hosts 且权限不足时
  请求一次系统授权（UAC / 管理员密码）。

## 免责声明

本项目与 GitHub 官方无关，仅优化本地 DNS 解析（将 GitHub 官方域名指向其官方真实 IP），
不提供任何代理服务，不转发任何流量，不收集任何用户数据。

## ⭐ 支持项目

如果 GitHubCompass 帮你在大陆更顺畅地访问 GitHub，欢迎给一个 **Star**：

- 让更多遇到同样问题的用户发现这个"本地 hosts 优化、不做代理"的轻量方案；
- Star 与 Issue / PR 一样，是驱动本项目持续探测、持续维护的最直接反馈。

## License

[MIT](LICENSE)
