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
- `skills/aoci-workflow/**`
- `skills/ponytail-audit/**`
- `skills/ponytail-review/**`
- `skills/humanizer/**`
- `skills/backend-contract/**`
- `skills/database-design/**`
- `skills/api-integration/**`
- `skills/security-baseline/**`
- `skills/environment-setup/**`
- `skills/deployment-release/**`
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
- `scripts/test-task-runtime.mjs`
- `scripts/test-skill-library.mjs`
- `scripts/test-skill-router.mjs`
- `scripts/test-workflow-audit.mjs`
- `scripts/test-panel.mjs`
- `scripts/golden/**`
- `scripts/test-install-smartbuild.ps1`
- `.github/workflows/upstream-sync.yml`
- `.github/workflows/validate-smartbuild.yml`

`skills/auto-dev/references/profiles.json` 是生成物，由 `build-profiles.mjs` 维护；上游同步和技能库更新都不得直接改写它，只能通过重新生成更新。

## 技能库更新不会中断系统（韧性约束）

技能库由用户独立维护，随时可能新增、更新或移除技能。以下约束保证任何更新都不会让工作台失去可用能力：

1. **安装完整**：`install-smartbuild.ps1` 复制 `skills/` 下所有含 `SKILL.md` 的目录，不再写死技能名，并在安装后调用 `build-profiles.mjs <技能根> --check` 重建档案。
2. **缺失不报错**：`loadProfiles` 遇到未安装的技能目录时跳过并上报 `skill-not-installed`，不抛出、不中断路由。
3. **过期仍可用**：技能内容变化使摘要不符时，档案进入 `profile-stale` 状态，仍参与推荐但排序降低并在 `warnings` 中报告；校验脚本提示重新生成，而不是让能力消失。
4. **可自愈**：`node skills/auto-dev/scripts/build-profiles.mjs <技能根> --check` 幂等重建，只在内容不一致时写入，可安全地反复运行。
5. **核心不被覆盖**：`auto-dev` 与 `aoci-workflow` 由智构安装器维护，技能库批量更新和回退都会拒绝它们。

上游如果以后出现同名 `skills/auto-dev`，仍以本仓库的智构版本为准；是否吸收其内容必须人工审查，不能自动覆盖。

以上是产品源码的上游同步；用户技能库的逐项 Git 来源与批量更新使用 [技能库维护合同](skills/auto-dev/references/skill-library.md)，不会绕过智构核心保护。

## 固定质量技能来源

以下技能随 1.2.0 发行，保留原始 SKILL.md 与各自 LICENSE。来源版本由本机已核实的技能库登记提供：

| 技能 | 原作者仓库 | 来源目录 | 固定提交 |
|---|---|---|---|
| `ponytail-audit` | https://github.com/DietrichGebert/ponytail.git | `skills/ponytail-audit` | `96608e078b2d5ea607c5c3b8b5a54d1c1fba6846` |
| `ponytail-review` | https://github.com/DietrichGebert/ponytail.git | `skills/ponytail-review` | `96608e078b2d5ea607c5c3b8b5a54d1c1fba6846` |
| `humanizer` | https://github.com/blader/humanizer.git | `.` | `0ef9fe5bc3572734fd3ae6c448fe00a30cd5dcf0` |

这三个目录属于本项目固定质量流程的发行依赖，上游同步时与主控文件一起保护；更新需重新核对来源和许可。
