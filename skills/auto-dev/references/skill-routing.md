# 全项目技能选择、诊断与接续

本合同覆盖产品规划、架构、前后端、数据库、接口、测试、性能、安全、环境、部署与文档。UI 只是其中一种任务。用户描述问题，主代理负责识别能力、选择方法、修改代码、核实结果；用户不用挑技能。

## 执行入口与最小组合

获准制作后，每个步骤开始、用户反馈结果不满意、重复错误、环境改变或上下文恢复时，主代理重新评估。先读唯一任务账本和已有成果，确定 goal、needs、stack、phase、可用 tools 与已授权 operations。需求没有实质变化时沿用本任务授权；扩大范围通过原有 amend 流程处理。暂停、权限和 AOCI 前置仍适用。交付阶段也可诊断和切换；存在 pending 安装或部署操作时，先核实副作用并登记结果，再改变选用方案。

通过 skill-catalog.mjs 读取目录元数据，再调用 skill-router.mjs recommend。选择至多一个主技能和两个必要的辅助技能；记录绝对路径、内容 sha256、来源（已知时）、选择理由、匹配能力和缺口。同名技能按路径消歧。所有领域走同一机制，自定义能力通过 profiles 扩展，不能把当前已安装技能说成覆盖所有专业能力。

元数据推荐只表示相关性，不证明技术适配。主代理必须读取选中的完整 SKILL.md，核对技术栈、阶段、所需工具、操作权限和冲突；用当前版本的 selection audit 记录亲读与兼容核对结果。没有核实的项标 metadata-only，仅列入待核对候选，不进入执行技能组合。当前声明可推荐，但真正执行前仍须完整阅读并记录适配核对，整个过程不要求用户挑技能。profile 失效时警告并降级，重新阅读后更新。脚本核实文件版本，不能证明模型真的理解了技能。

没有适合技能时记录缺口，使用明确的常规工程方法；确实缺少前置条件时报告阻塞。不自动下载、安装或执行目录中所有技能，不捏造缺失的专家。技能提供方法，实际代码写入仍由主代理完成。

## 调用与数据

推荐请求是普通 JSON 文件，不是第二份任务账本：

```json
{
  "root": "项目绝对路径",
  "roots": ["已安装技能根目录"],
  "context": {
    "goal": "修复接口契约不一致",
    "needs": ["backend", "api", "testing"],
    "stack": ["node"],
    "phase": "implementation",
    "tools": [],
    "operations": ["local"],
    "readOnly": false
  }
}
```

```text
node <auto-dev>/scripts/skill-router.mjs recommend <请求.json>
node <auto-dev>/scripts/task-runtime.mjs apply <项目> <事件.json>
node <auto-dev>/scripts/task-runtime.mjs show <项目>
```

可选 libraryFile 指向既有技能来源登记文件。profiles 每项含 path、sha256、needs；可选 stacks、phases、tools、operations、conflicts。path 和 sha256 来自当前目录；不写示例哈希冒充真实版本。stacks 表示允许的技术栈之一，phases 表示允许阶段，tools 和 operations 表示必须具备的集合，conflicts 使用技能名称或绝对路径。不指定的兼容约束仍由完整技能阅读确认。省略 profiles 时从每个技能根自动加载当前档案；显式 profiles:[] 则禁用默认档案。domains/excludeDomains 限定领域，explicitOnly 需要 context.invokedSkills 明确点名，access 与 readOnly 限定读写适配，inputs/outputs/notFor 说明输入输出和禁用场景。自动生成只标 profile-declared；只有 review 的 sha256/version、source/reviewer/artifact 对应当前内容才可显示 profile-reviewed。该标签仍不替代实际 selection audit。

内置能力覆盖声明通过 `sourceSha256` 绑定具体 SKILL.md 内容。同名技能已被定制或更新而摘要不匹配时，只从实际元数据生成 `needs-review` 候选，不继承内置声明，也不自动进入执行组合；须亲读当前内容并重建经核对的档案。默认档案中的无效条目逐条隔离并给出 warning，不影响其它有效条目；显式传入的档案仍严格校验。

推荐输出 primary、support、missing、候选理由、excluded 和 warnings。primary 与 support 仅来自当前版本的能力声明或带来源评审的 profile；缺少 profile 时返回候选与能力缺口，由主代理完成阅读后继续选择。仅元数据匹配不加载或执行技能指令；宿主读取所选正文后实施。推荐为确定性的启发式筛选：当前且适用的能力档案优先，同等覆盖时参考技能名称中的专业领域和当前阶段；主控与 AOCI 集成技能须有明确能力档案，避免把流程描述当成专业能力。它不承诺找到所有已安装技能中的最佳答案；可根据阅读后的 profile 补足描述中的信息。

事件统一包含 action、id 和 expectedRevision，并写入 auto-dev-state.json 中对应 tasks[].routing；历史轮次沿用 archives。没有独立技能任务队列或跨项目全局排名。

| 事件 | 必填数据 | 效果 |
|---|---|---|
| skill-select | context、selection（primary、support、reason），可选 profiles | 当前步骤首次选择；primary 可为 null，表明常规方法降级 |
| skill-outcome | result、category、progressed、symptom、reason、verification、artifact，可选 feedback | 记录实际尝试、测试或反馈结果 |
| skill-switch | 新 selection、handoff，可选新 profiles | 保留上下文后切换；不修改需求、任务锁和授权 |

selection 的技能项至少有 name、path、sha256、version，取自当前目录或推荐结果；非空技能组合必须有当前版本的 profiles（可使用根目录默认档案）。每个步骤仅首次使用 skill-select，后续不能用它清空尝试史。skill-outcome 的 result 是 passed/failed/partial；category 是 method/quality/environment/permission/requirements/unknown；progressed 是布尔值。symptom 使用同一问题的稳定描述，verification 写实际执行的核验，artifact 是 .smartbuild/evidence/ 下非空脱敏文件。证据重复、丢失、篡改、路径越界或技能变更不能当成新尝试。

## 先诊断，再切换

主代理根据实际错误、测试、截图或用户反馈分类，不能仅因为测试红了就断言技能不好。脚本不自动理解日志；分类理由必须能在证据中核对。

| 观察 | 下一步 |
|---|---|
| 环境缺失、网络故障、限流 | 修复环境或保留缺口；不惩罚技能 |
| 权限不足 | 解决实际权限边界；不绕过授权 |
| 需求不清或互相矛盾 | 核对唯一决定性问题与影响范围 |
| 原因未知 | 继续调查，不能盲换技能 |
| 方法或质量问题，一次失败或仍有进展 | 调整可解释的原因，再验证 |
| 同一症状连续两次失败、均无进展且有独立证据 | 可切换更合适的方法 |
| 所选技能缺失或版本改变 | 携带交接重新选择并读取当前版本 |
| 证据或受测源码已变化 | 先重新验证 |
| 技能结果通过 | 继续需求验收与约定交付 |

每个计划步骤最多三组选用记录，即两次切换；禁止 A→B→A 的循环。达到限制后重新分析需求、架构和可用条件，向用户报告真正的缺口；不能伪造新步骤或修改计划以绕过限制。

handoff 包含 constraints（约束）、completed（有效成果）、attempts（已尝试方法）、nextVerification（下一项验证）。运行时自动补入原目标、任务范围、验收条件、旧选用记录、失败证据和源码指纹。主代理必须确认这些内容真实完整，保留已有可用功能，再执行下一方法。

压缩或重启后先 show，恢复当前 routing 记录和交接，重读选中技能并核对 sha256 与依赖 version；不得从零重做或丢弃失败原因。show 的 checks[].routing 提供当前诊断，源码漂移会使旧结果变成 reverify。

## 项目经验与质量监管

经验只从同一项目身份、相同能力/技术栈/阶段/工具/操作条件、相同技能路径与内容版本的结果中取得；证据文件必须仍匹配。最后一次结果覆盖该选用记录的旧结论。环境、权限、需求或未知故障不降低技能评分。历史反馈只对排序作小幅调整，不等于当前源码已经通过验证；版本变化后不能继承旧版成功。跨项目复用只能把历史记录作为待核对线索，不能混用账本或成绩。

主代理负责开发、自查、修复与最终验收。每个实际制作批次安排独立只读审查；复杂任务按互不重叠的范围拆分。审查者不写代码、不代替主代理掌握基础设计。调用失败或限流记录“独立审查待复核”，不能写成通过。用户明确禁止派发或执行环境不支持时如实记录限制。

表达、文案与文档按已安装 humanizer 的适用规则检查，保持原意和技术事实，不用自然表达替代测试证据。最终对照需求逐项验收，说明实际运行范围与未完成项。skill-outcome passed 不会自动通过 business、AOCI 或 local/install/deploy 等交付检查；这些仍由原任务运行合同控制。

## 审核与执行身份

新任务的 skill-select/skill-switch 带 audit，skill-outcome 带 executor；具体字段与包内专家索引见 [公司化研发合同](company-development.md)。profile 同时绑定 sha256 与 version。目录发现的专家只是候选，读取与适配由主代理完成。新合同任务没有每步有效成功记录时不能推进或交付；常规方法降级同样需要真实结果。

常规测试、审查或重构没有专业技能时，standardWorkflow 提供 [通用质量流程](general-quality.md)，状态为 available-not-executed。路由声明覆盖不代表真实执行、测试通过或具备所有领域能力。
