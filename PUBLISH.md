# 发布清单（dsh-reasoning-bridge → npm / GitHub）

> ⏳ **v0.1.0 发布中**（2026-09-05）：GitHub main + `v0.1.0` 标签 + Release ✅；
> npm publish 因账号 2FA 需在本机终端完成（见 §1）。

## 0. 发布面已确认

`npm pack --dry-run` 通过，产物含且仅含 20 个文件（23.7 kB）：

```
CHANGELOG.md  DESIGN.md  LICENSE  README.md  dsh.plugin.json
lib/index.js  package.json
skills/reasoning-bridge/SKILL.md
skills/reasoning-bridge/references/*.md  (7 份契约)
skills/reasoning-bridge/scripts/*.mjs     (4 个确定性脚本)
```

无 tests/、无 .github、无 node_modules。`files` 白名单在 package.json；
若新增顶层目录或改白名单，先重跑 `npm pack --dry-run`。

## 1. npm 发布（需 2FA，本机终端执行）

沿用 dsh-versions 的教训：聊天内传 OTP 因 30 秒有效期 + 往返延迟不可靠，
由本机终端直接完成（本人输入 OTP）：

```sh
cd C:\Users\Hepu\dsh-plugins\dsh-reasoning-bridge
npm whoami                 # 应输出 shangdi178
npm publish --access public
```

发布后自查：

```sh
npm view dsh-reasoning-bridge version    # 应输出 0.1.0
npm view dsh-reasoning-bridge files      # 应为 20 个发布文件
npm view dsh-reasoning-bridge dist-tags  # latest: 0.1.0
```

## 2. GitHub 仓库 ✅

- 仓库：https://github.com/shangdi178/dsh-reasoning-bridge（public，MIT）
- `main` + `v0.1.0` 标签均已推送；Release：`https://github.com/shangdi178/dsh-reasoning-bridge/releases/tag/v0.1.0`
- CI：ubuntu/windows × node 20/22 全绿（`npm test` + `npm run doctor` + packet/pair 冒烟）

> git push 遇 `Failed to connect ... port 443` 时按 proxy-git-push skill 处理：
> 先探测代理（当前常无可用代理），多为瞬时抖动，直接重试即可。

## 3. 发布后真机验证（可选但推荐）

用临时 profile 验证三种安装方式（`--profile` 必须紧跟 `plugin`）：

```sh
# 方式一（npm 发布后）
dsh plugin --profile sandbox add dsh-reasoning-bridge

# 方式二（GitHub 源码）
git clone https://github.com/shangdi178/dsh-reasoning-bridge /tmp/drb
dsh plugin --profile sandbox add ./drb

# 方式三（离线 tarball）
npm pack
dsh plugin --profile sandbox add ./dsh-reasoning-bridge-0.1.0.tgz
```

验证完删除临时 profile：`rmdir /s /q C:\Users\Hepu\.dsh\profiles\sandbox`。

## 4. 后续版本流程

1. 改代码 → `npm test` 全绿 → CHANGELOG 加段 → `npm version patch|minor`（会自动提交+打标签）
2. `git push --follow-tags` → GitHub Release
3. 本机终端 `npm publish --access public`
4. 本清单勾销记录
