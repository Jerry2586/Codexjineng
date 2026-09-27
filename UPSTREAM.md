# 原作者更新吸收规则

上游仓库：`emilkowalski/skills`

## 运行方式

`.github/workflows/upstream-sync.yml` 每周检查一次，也可以手工运行。

发现上游更新后，工作流会：

1. 获取上游 `main`；
2. 在独立同步分支合并更新；
3. 强制恢复并保护智构开发系统的产品首页、安装入口和专属文件；
4. 保留用户产品品牌，不吸收上游 README；
5. 运行当前版本完整校验；
6. 创建 Pull Request，等待审查后合并。

不会自动把上游内容直接写进本仓库 `main`，避免原作者更新覆盖用户自己的智能体。

## 受保护内容

- `skills/auto-dev/**`
- `README.md`
- `LICENSE`
- `SMARTBUILD.md`
- `VERSION`
- `CHANGELOG.md`
- `UPSTREAM.md`
- `scripts/ensure-smartbuild-readme.mjs`
- `scripts/install-smartbuild.ps1`
- `scripts/validate-smartbuild.mjs`
- `scripts/test-auto-dev-functional.mjs`
- `scripts/test-auto-dev-behavior.mjs`
- `.github/workflows/upstream-sync.yml`
- `.github/workflows/validate-smartbuild.yml`

上游如果以后出现同名 `skills/auto-dev`，仍以本仓库的智构版本为准；是否吸收其内容必须人工审查，不能自动覆盖。
