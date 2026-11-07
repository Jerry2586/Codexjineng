# 公司化研发与审核合同

这份合同补充固定五阶段。主代理按任务需要承担职责、选择方法、改码并作最终验收；子代理仅负责探索、检索和独立核验。角色数量不代表需要同时运行多个代理。小修改只记录必要内容，跨模块和正式交付按受影响范围增加检查。

| 职责 | 输入与决定 | 可核对结果 |
|---|---|---|
| 产品与需求 | 用户用途、成功与异常流程 | 范围、逐项验收标准 |
| 项目统筹 | 授权、依赖、冲突和新增要求 | Rxxx、唯一任务锁、步骤和断点 |
| 架构与技术选型 | 当前项目、数据和接口约束 | 模块边界、选型依据、变更影响 |
| 设计与开发 | 已确认需求与项目约定 | 真实功能、可用交互、异常处理 |
| AI 与技能治理 | 技术栈、问题、阶段和工具 | 候选、亲读、适配、实际执行和验证记录 |
| 质量与安全审核 | 改动与风险 | 复现、分级问题、修复和复测 |
| 发布与运维 | 约定交付和实际权限 | 构建、安装、恢复与适用运行检查 |
| 文档与知识维护 | 有效成果和未解决问题 | 使用说明、版本依据和交接下一步 |

## 身份与能力记录

目录只发现候选。普通技能记录入口 sha256 和整个技能包的 version；包内角色还记录 packagePath、索引路径信息与 provenance 文件位置。version 绑定包内实际文件内容，包括参考、脚本、索引和角色；新增、删除或改变依赖均使旧 profile 失效。范围按技能包保守计算，因此未使用文件改变也可能需要重新审核。`.git`、node_modules、Python 缓存和智构备份不参与版本摘要；不得把运行方法依赖放在这些排除目录。若方法需要包外参考，须把对应参考加入项目 watch 或作为另一份受审核技能记录。

`references/catalog.json` 的 roles 数组包含 name、description、path，可附 department、sourcePath。扫描将角色列为候选，不执行其正文。拒绝包外、重复及链接角色路径。PROVENANCE 的作者、版本和摘要只是包内来源记录，不能证明远程内容当前仍一致。角色模板里的履历、权限、工具和记忆均不构成真实运行身份。

新任务的 skill-select/skill-switch 必须带 audit：

```json
{
  "read": true,
  "compatible": true,
  "reason": "已读技能及使用到的参考；方法符合当前技术栈和任务范围",
  "executor": { "id": "实际执行者标识", "kind": "main", "model": null, "source": "unknown" }
}
```

kind 为 main、subagent、human 或 tool；model 无法核对时必须为 null。source 为 runtime 或 tool 时，还需 observation，写明实际身份返回的出处。运行脚本校验字段和文件，不能验证填写者是否真的读懂技能，也不能凭字段认证模型身份。主代理必须保留诚实记录。常规方法降级可用 primary=null、read=false，同时填写适配理由和执行者。

profile 需要 path、sha256、version 和能力/栈/阶段/工具/操作约束。选用后 stage=reviewed；实际 skill-outcome 同样带 executor，失败或部分完成记 executed，通过记 validated。每次调用失败都记录实际结果；读取文件不会自动变成执行成功。选用阶段 audit 记录亲读和适配，目录中的候选阶段与执行阶段分别保留。

## 新任务的完成检查

新任务由 add 自动写入 workflowVersion=1，不提供关闭检查的请求开关。checkpoint 推进只能向下一步移动；当前步骤必须有审核后的选择或明确的常规方法，以及当前源码下通过的实际结果。失败、无结果、文件丢失、摘要不符或技能版本变化都会阻止推进。

进入交付及开始外部操作时，除了业务、认知和原交付检查，还必须满足以下条件。仅能在实际安装、发布或部署后检查的验收项，可先登记 result=pending-delivery、operation、验证方法和当前证据；operation 必须是本任务已授权的非 local 交付。该记录允许进入对应交付准备，但 show 仍报告未通过，complete 必须等待真实操作后补齐 passed。普通遗漏、失败、过期记录不能以此自动放行。

完成任务必须满足：

- 全部计划步骤都有有效的最后一次成功结果；中间步骤保留当时源码指纹，最后步骤的结果必须匹配当前源码。
- 每个验收条件都有对应的最新通过记录，绑定当前计划、源码和证据文件。
- 所有阻塞问题都有修复说明和当前复测证据。

技能依赖变化会使已完成步骤的审核过期。需要重做先前步骤时，按已有 amend、plan 和授权合同留痕，重新验证受影响范围，不能改步骤来重置失败次数。

新事件均通过 task-runtime.mjs apply 写入原账本，并携带 id、expectedRevision：

| action | 主要字段 | 结果 |
|---|---|---|
| acceptance-result | criterion（从0开始）、result、changes、verification、artifact | 每条验收关联项目内改动、测试和证据；最后一次失败覆盖旧成功 |
| issue-open | title、severity、artifact、reviewer，可附 criterion、independent、blocking | 记录问题；critical/high 始终阻塞，其他等级默认阻塞 |
| issue-resolve | issueId、fix、changes、verification、artifact | 记录主代理修复与复测，复测证据须不同于发现证据 |
| issue-reopen | issueId、reason、artifact | 重新打开问题并保留原因 |
| recover | reviewed=true、reason、artifact、nextAction | 保存恢复时核对的范围、授权、断点、源码与审核缺口 |
| adopt-workflow | reviewed=true、reason、artifact | 显式将未结束旧任务纳入新合同，保留原证据和未知项 |

changes 必须是项目 watch 内实际存在的相对路径。artifact 必须指向 `.smartbuild/evidence/` 中非空、可核对的文件。issue-resolve 不等于代码已自动修复；由主代理实际改码、执行复测后登记。后续源码修改或证据变化使验收和问题关闭失效，需要针对当前版本复核。已知问题跨计划修订保留，不能用 amend 清除问题。

独立审查必须来自实际只读子代理或人工审查者，reviewer.kind=subagent/human、source=tool/runtime 且含 observation 等可核对返回。主代理自查只记 main。子代理失败、429或未返回时记录“独立审查未完成”，不得伪造成通过；若这项审查属于本次约定验收，则保留阻塞。

## 旧账本与恢复

旧任务没有 workflowVersion 时，show 报告 legacy-unreviewed，不补造历史调度或验收。已完成的历史任务保留原状态；没有完成快照时标 historical-unverified，关轮前显式 reopen 并复核；不得把它们宣称为已通过新合同。未结束旧任务必须显式 adopt-workflow；若已跨过缺记录的步骤，需实际重新规划和审核，不能填造旧记录。

context 事件使正在执行的新合同任务保存断点并阻塞。先 show，核对实际文件、技能、授权、当前结果、未解决问题和 pending 操作，再 recover 并按原合同 unblock；暂停任务仍保持暂停，恢复还要核对既有范围授权；暂停或更新断点不能消除本次会话的恢复核对要求。恢复记录不把过期结果变成有效结果，也不代替 AOCI。show.checks[].workflow 返回每步、每条验收和每个问题的缺口，主控据此恢复下一步。

其他项目的经验只作待审核线索；本项目成绩必须使用本项目身份、相同上下文与当前技能版本。需求、权限或环境故障不当成方法质量下降。重试和切换次数遵守技能路由合同。

## 安装备份与恢复

本地安装器默认把备份放在技能库的同级 smartbuild-backups，例如 `~/.agents/smartbuild-backups`。自定义 BackupDirectory 也必须在技能发现根目录之外。安装器将原来技能根目录中、名称符合其UUID格式的旧智构备份移出，检查迁移前后文件摘要并写恢复清单；目标冲突或未知内容保留现场并报错。目录扫描也主动排除智构备份路径。

需要回退时执行：

```powershell
pwsh -NoProfile -File scripts/restore-smartbuild.ps1 -BackupPath <备份绝对目录> -Destination <技能库>/auto-dev
```

安装器与恢复器先检查全部目标路径；文件位置被目录占用或父目录被文件占用时，在写入之前报错。恢复器再核对原目标、路径与每个文件摘要，保存恢复前的文件并恢复备份。BackupPath 是操作者显式选择的可信备份，可位于自定义目录；清单摘要用于检测变化，并非签名或来源认证。v2 manifest 还记录本次新增文件，恢复时撤回这些新增文件；保留无关用户扩展。恢复前逐项校验安装后摘要，发现用户后续修改则拒绝覆盖。默认保留非核心定制，显式 ReplaceCustomizedSkills 才替换；profiles 按实际安装树生成并纳入同一恢复事务。当前快照、旧快照和恢复清单都应保留到验收结束。
