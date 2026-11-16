# 发布 / 上架记录

本文件记录插件已发布的状态与后续步骤，避免下次接手时重新摸索。

## 已发布

| 项 | 值 |
|---|---|
| 仓库 | `lizzkkafei/my-projects` |
| 目录 | `zhizhen-liyin/` |
| 包名 | `zhizhen-liyin` |
| 版本 | 1.0.0 |
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

## 待办

- [x] 提交 PR 到 `awesome-dsh-plugin` → [#15409](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/15409)
- [ ] 等待 CI：`PR check` 里的 `npm ci` 已知会因 registry 503/504 挂起几十分钟（工作流注释有记录），与本次改动无关
- [ ] 等待 `Submission gate` 结果（依赖 PR check 完成触发）
- [ ] 维护者人工 review
- [ ] 可选：发布到 npm，安装时可跳过源码构建
- [ ] 可选：打 GitHub Release 并附预构建 tarball

### CI 挂住时怎么办

不要空等。可以先确认三件事：

1. `mergeable: True` —— 冲突已解决
2. `changed_files: 1` —— 只动了该动的文件
3. 未触碰 `README.md` / `README.zh.md` —— 不会触发一致性校验

若 `npm ci` 长时间不结束，这是上游已知的基础设施问题，重跑工作流通常即可恢复。
