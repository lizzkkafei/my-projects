# 发布 / 上架记录

本文件记录插件已发布的状态与后续步骤，避免下次接手时重新摸索。

## 已发布

| 项 | 值 |
|---|---|
| 仓库 | `lizzkkafei/my-projects` |
| 目录 | `zhizhen-liyin/` |
| 包名 | `zhizhen-liyin` |
| 版本 | 1.0.1 |
| 最新提交 | `6fed06d` 路由访问检查 |
| 提交 | `5f57b4c` 新增 → `7b5334b` 图标修正 → `fc1eb10` 标识统一 |
| 安装 | `dsh plugin --profile <profile> add github:lizzkkafei/my-projects#path:/zhizhen-liyin` |

远端可访问性已验证（`raw.githubusercontent.com` 返回 200）：`package.json`、`cordis.patch.yml`、`icon.svg`、`docs/icon-180.png`、`locale/{en,zh}.json`、`README.md`、音频素材。

## 插件市场

| 项 | 值 |
|---|---|
| PR | [#15409 Add zhizhen liyin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/15409) |
| 分支 | `lizzkkafei/awesome-dsh-plugin:add-zhizhen-liyin` |
| 基线提交 | `1cdd13c`（上游 main） |
| PR 提交 | `cdd7def` |
| 改动 | **1 个文件 / +7 行**：`data/plugins/lizzkkafei__my-projects--zhizhen-liyin.yml` |

PR 正文见 `PR.md`。市场只认 `data/plugins/<owner>__<repo>.yml` 一个文件，条目不要放进插件目录。

### 首次提交踩的坑（已修）

第一次推的分支基于旧提交 `4f51706`，把已合并的 `zhizhen-cut.yml` 当成新增，导致：

- `changed_files: 2`（多了一个不该动的文件）
- `mergeable_state: dirty`（与上游冲突）

修法：`git fetch` 上游最新 → 基于 `upstream/main` 重建分支 → 只加自己的一个文件 → force-push。
重建前务必确认 `git diff --stat upstream/main..HEAD` 里只有你自己的文件。

### 提交门禁（Submission gate）逐项核对

`pr-gate.yml` 只校验**新增**条目背后的仓库，四项实测全部通过：

| 检查 | 结果 |
|---|---|
| `package.json` 声明 `dsh.bundle`（monorepo 任意层级） | ✓ `zhizhen-liyin/package.json` → `./cordis.patch.yml` |
| 仓库存在且未归档 | ✓ |
| 仓库年龄 ≥ 1 天 | ✓ 190 天 |
| 不是 DSH 本体 | ✓ |
| 带 `dsh-plugin` topic | ✓ |

另：`pr-check.yml` 有一条「改动了 README 就必须与 `data/plugins/` 一致」的规则——本 PR **未触碰 README**，走的是 regenerate 分支，不会因此失败。

- [x] `package.json` 声明 `dsh.bundle.patch`
- [x] 仓库根/子包声明了 manifest（子包 `zhizhen-liyin/` 即安装根）
- [x] 真实可用代码，非占位
- [x] 仓库创建满 1 天（2026-05-08 创建）
- [x] 已带 `dsh-plugin` topic
- [x] 描述只陈述已实现行为，无营销词
- [x] 分类 `tools`，与同仓 `zhizhen-cut` 一致

## 重新生成图标位图

`docs/icon-180.png` 由 `icon.svg` 渲染：

```sh
node scripts/make-icon.mjs
```

改动 `icon.svg` 后必须重跑，否则市场卡片仍是旧图。

## 发版检查清单

1. 改 `package.json` 的 `version`
2. `node scripts/build.mjs`
3. `node scripts/test-host.mjs` 与 `node scripts/test-client.mjs`
4. 从全新 `git clone` 副本再跑一次自检（避免依赖本地符号链接）
5. 同步到 `my-projects` 仓库并推送
6. 市场条目一般无需改动，除非功能描述变化

## 审核反馈与修复（2026-11-16）

PR #15409 **已合并**，审核员 fkysly 指出：

> 它的 HTTP 路由是用 `webServer.register` 挂的，DSH 对这类路由不做 Host / Origin 准入，所以我在描述里写了「HTTP 路由没有 DSH 的访问检查」。

市场条目因此被加了一句限制说明。审核员给了两条修法：

1. handler 入口先过 `ctx.connection.requestRejection(req)` —— **采用**
2. 或改用 `ctx.connection.fetch.register` 的精确路由 —— 不适用（见下）

### 为什么选 requestRejection

`fetch.register` 只支持**精确路径**，而本插件是一个 prefix 路由服务整个静态目录，外加一个代理前缀。无法逐个文件注册路径，所以保留 prefix 路由并在入口加检查。

### 改动（v1.0.1）

- `inject` 增加 `connection`
- 每个 handler 入口先调 `requestRejection`，非 `undefined` 即回写状态码并终止
- `connection` 不可用时返回 **503 拒绝服务**，不放行
- 测试改用 DSH 真实的 `isTrustedApiRequest`，覆盖 5 类攻击 + 同源放行 + 缺服务拒服

### 验证结果

16 项检查：同源 iframe 与子资源放行，cross-site / 外部 Origin / DNS rebinding / 不透明 Origin 全部 403。同源 iframe 端到端：6 轨、5 素材、五线谱、嵌入模式正常，无控制台错误。

## 待办

- [x] 提交 PR 到 `awesome-dsh-plugin` → [#15409](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/15409)
- [x] PR #15409 已合并
- [x] v1.0.1 修复路由访问检查
- [ ] **提 PR 更新条目，删掉限制句**：分支 `update-zhizhen-liyin-access` 已推送
      https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/compare/main...lizzkkafei:awesome-dsh-plugin:update-zhizhen-liyin-access?expand=1
- [ ] 等待新 PR 的 CI 与 review
- [ ] 可选：发布到 npm，安装时可跳过源码构建
- [ ] 可选：打 GitHub Release 并附预构建 tarball

### CI 挂住时怎么办

不要空等。可以先确认三件事：

1. `mergeable: True` —— 冲突已解决
2. `changed_files: 1` —— 只动了该动的文件
3. 未触碰 `README.md` / `README.zh.md` —— 不会触发一致性校验

若 `npm ci` 长时间不结束，这是上游已知的基础设施问题，重跑工作流通常即可恢复。
