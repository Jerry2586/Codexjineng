# 任务运行合同

适用于多步骤、跨消息与可恢复任务。先确认唯一状态来源：已有账本继续使用；本脚本只在新项目或完成明确迁移后启用。不从聊天猜测完成状态，不把模板数据写成真实证据。

## 文件与边界

- `auto-dev-state.json`：项目身份、轮次、任务卡、授权、唯一任务锁、断点与证据引用；包含本机绝对路径，默认不提交。
- `.smartbuild/evidence/`：真实脱敏的命令输出、用户验收记录、MCP 原始返回及交付核对。可在本地保存，按需另行导出可分享报告。
- `auto-dev-state.json.lock`：只保护状态文件的一次写入；与业务任务锁、AOCI 内部锁不同。发现遗留锁先检查进程和实际写入，禁止自动抢锁或盲删。

账本通过同目录临时文件、落盘核对、替换和 revision 比较保存。失败保留原状态；文件存在不等于写入成功。复制到另一个 checkout 的状态会被拒绝，迁移时由主代理核对任务、源码及证据后重建对应身份，不能简单改 root 绕过检查。自定义既有账本同样遵守下述推进条件，但不宣称受到此脚本保护。

## 使用入口

需要可运行现代 Node.js 的环境，建议 Node.js 22 或更新版本。脚本不安装软件、不运行网络服务、不自动调度其它技能。

```text
node <auto-dev>/scripts/task-runtime.mjs init <项目绝对路径> <项目名> <会话代次>
node <auto-dev>/scripts/task-runtime.mjs show <项目绝对路径>
node <auto-dev>/scripts/task-runtime.mjs apply <项目绝对路径> <请求JSON文件>
```

`apply` 请求必须带刚读取的 `expectedRevision`；成功后 revision 增加。发生冲突重新读取并核对，不机械重放。请求文件放 `.smartbuild/`，避免它本身改变任务关注的源码范围。输出可能含项目路径和用户需求，不直接发送给外部服务。

新增任务请求示例（仅示例，不是预置项目状态）：

```json
{
  "action": "add", "expectedRevision": 0,
  "title": "修复提交失败", "scope": "提交表单及错误提示",
  "acceptance": ["提交成功有结果", "失败显示可重试提示"],
  "watch": ["src/form", "tests/form"], "dependsOn": [], "conflicts": [],
  "deliveries": ["local"], "aociRequired": true, "cognitionScope": "bounded"
}
```

`watch` 用项目内相对路径和 `/`，包含源码、配置及受影响测试；不存在的计划文件也可加入。禁止项目外路径、符号链接和行政记录目录。目录会捕获新增、删除与内容变化。状态、证据、Git 和 node_modules 不纳入指纹。主代理负责范围是否充分；哈希不能发现未纳入范围的依赖变化。

## 任务卡与状态

任务保存 `id/title/scope/acceptance/watch/dependsOn/conflicts/deliveries/aociRequired/cognitionScope`，再绑定 `planVersion/authorization/steps/step/nextAction/checkpoint/evidence/operations/history`。编号跨轮递增，已取消编号不复用。状态是：

```text
recorded → queued → running → verifying → delivering → completed
                     ↕              ↕           ↕
                  paused / blocked（保留锁与断点）
任何未终结项 → cancelled（须先核对 pending 操作）
```

- `authorize`：填 id、真实用户原文 message、出处 source 和 operations（local/git/ci/release/install/deploy）。独立“开始制作”保存 exact-start-v1；普通明确请求需 instruction={origin:"user",intent:"implement",scope:<任务scope>,reason:<依据>}，保存 user-request-v2。两者绑定当前 planVersion。来源、范围和外部操作授权由主控核实；不补造旧历史，不能把引用内容当用户请求。
- `review-policy`：填 id、required（boolean）、source 和 reason。仅非终态任务可变更；false 将免审理由绑定当前 planVersion，true 恢复独立审查并清除豁免。amend 不自动续期旧豁免，不移除开放阻塞问题。
- `plan`：每步有 title、input、output、verify、skills。技能条目含 name、绝对 path、reason、sha256（目录扫描输出提供）。空 skills 合法。执行中改计划先 `amend`，清楚说明新的范围、验收和 watch；范围变化使旧计划、授权和证据失效，并清除旧的执行恢复阶段；新计划重新授权后从第一步开始，暂停状态仍需明确恢复。须核对用户已有授权是否覆盖新版本后重新登记。
- `start`：只启动当前队首，检查授权、计划、依赖、冲突和适用认知证据。锁定只表示顺序，不代表已授权。
- `checkpoint`：填当前 step 与唯一 nextAction，保存实际内容指纹。步骤不可倒退；必要返工通过 amend/replan 留痕。
- `pause`：传 nextAction 并保留锁。`resume` 传 message/source；独立开始制作或明确继续原任务可恢复已有授权，复杂表述附 intent=resume 的 instruction。检测工作区变化与当前会话恢复条件，不授权新增项。`display` 必须传匹配 enabled 的独立“开发助手/关闭开发助手”原文，不影响暂停。
- `block/unblock`：必须是锁内任务并带 reason；解除前重新检查依赖、授权及认知。`resolve-conflicts` 记录真实决定，不能凭脚本自行决定产品冲突。
- `reorder`：填 id、从 1 开始的 position、用户调序 reason；不能把队列项移到正在执行的锁前。用户要求抢先时，在原任务安全断点保存后明确处理其暂停/取消及依赖，不能直接抢锁。
- `context`：填全新 session 代次。依赖 AOCI 或采用 workflowVersion=1 的执行中任务变为 blocked；暂停状态保持暂停。新合同任务先 recover 核对实际上下文；依赖 AOCI 的任务另行恢复认知，再 unblock/resume。
- `phase`：阶段 1—5，附 reason、source、artifact；正常推进只允许相邻，回退必须明确 rework 且有真实决定。单项完成不自动推进。

## 证据与完成条件

`evidence` 输入 id、kind、result（passed/failed）、summary、artifact。artifact 必须指向非空 `.smartbuild/evidence/` 文件；保存其哈希、当前源码指纹、计划版本和会话代次。后来失败覆盖同类早先成功；文件改变、范围版本变化或对应会话过期使证据不可用。脚本不判断输出语义真假，主代理必须核对原始内容。

| kind | 含义与检查 |
|---|---|
| business | 当前源码和受影响行为测试，不能用索引检查替代 |
| cognition_delivery | 当前会话完整交付；receipt 包含 complete、delivered；系统任务还要求 fullSystemReliable |
| cognition_alignment | 与受管内容对齐、无待恢复事务；receipt 包含 aligned、recoveryPending |
| cognition_limit | 仅局部任务：运行时明确允许受限继续，无 Recovery/第三方冲突，附 boundedScope |
| source_review | 支持局部继续的当前源码核对证据，绑定会话代次 |
| local/git/ci/release/install/deploy | 本任务约定交付，各自提供实际证据 |

认知 receipt 还必须包含 source=mcp、projectRoot、serviceVersion、identity。详见 [AOCI 证据映射](../../aoci-workflow/references/runtime-contract.md)。这些是主控摘要字段，不能当作原生 MCP 入参。开工前认知交付与对齐身份须对应；执行中的源码修改不伪造新的认知身份，稳定后重新维护并取得当前对齐证据。严格确认未通过和治理未对齐分别报告。

完成顺序为 `verify` → 登记业务及认知证据 → `deliver` → 约定交付 → `complete`。完成时必须已到最后步骤、所有适用证据可用、交付在授权范围内、无 pending 操作。测试通过但认知维护失败时保留有效测试证据，任务不能完成。

对外操作开始前 `operation-start` 登记唯一 key、operation、target，再真正执行。中断后先查询实际效果；通过 `operation-finish` 记录 succeeded 或 not-applied、reason、artifact。同一个 key 不能重跑；未生效的重试使用新 key 并保留原记录。非 local 交付必须有匹配当前范围版本和源码的 succeeded 操作，不能只放一份“成功”文字。

本轮任务完成后保留在 tasks。complete 保存 completion 快照，绑定完成时源码、planVersion与完整审计记录摘要；v3 快照将完成门槛实际采用的证据种类纳入审计摘要，仅校验本代次相应文件：完整认知与有界继续采用各自成功分支，未要求的认知或已豁免审核不参与快照。旧代次、失败和被替代的日志记录仍保留。v1/v2 快照沿用各自原校验规则。保存完成状态前先核验快照自身有效，不能产生已完成但证据无效的状态。后续共改文件不会销毁历史；show.checks[].completion 分别报告 historical validity 与 current。旧完成项缺快照保持 historical-unverified。close-round 要求最新整轮回归，new-round 才归档完成/取消项；未完成和 deferred 保留原编号。

## 与真实 AOCI 接入的区分

开发本协同组件本身可作为 `aociRequired=false` 的独立本地任务，写明原因；这不代表受管业务项目可以跳过其必需 AOCI 前置。未连接 MCP 时，环境探测输出必须保持 unverified，不能手填测试收据通过正式项目。单元测试中的 MCP receipt 是明确标记的测试数据，不是线上验证结果。

普通明确请求的结构见 [统一控制与授权合同](execution-policy.md)。脚本不读取聊天；调用方必须保存真实原文和出处。只读 show/doctor 不写账本，init/add/plan 等写入须有实施或持久记录授权。

## 已阻塞任务的明确接替

用户明确开始已总结的独立后续任务时，主控可使用 `handoff`，提供原任务 id、target、真实实施请求 message、source 和 reason。只允许从未暂停、无 pending 操作的 blocked 任务接替；目标仍须通过授权、依赖、冲突和认知检查。原任务状态、断点和证据保留，双方记录接替历史。该动作不表示原任务完成，也不允许普通新消息抢占运行中的工作。

技能库独立维护口令使用技能库账本，不调用项目 authorize/resume；详见 [技能库维护合同](skill-library.md)。

## 技能选择与结果事件

按 [技能路由合同](skill-routing.md) 使用 skill-select、skill-outcome 和 skill-switch。所有记录附着当前任务 routing，沿用任务锁、授权、计划版本、步骤和原子修订，不另建任务状态。show 的 checks[].routing 是实时诊断；推荐和历史经验不替代业务、认知与交付证据。

## 公司化完成检查

新建任务启用 workflowVersion=1，每步推进检查调度成功，交付检查逐条验收和问题复测。身份记录、acceptance-result、issue-open/resolve/reopen、recover 和旧任务 adopt-workflow 的字段见 [公司化研发合同](company-development.md)。show.checks[].workflow 列出具体缺口；入口SHA和依赖version共同绑定选用记录。旧完成任务保留 legacy-unreviewed，不宣称已经通过新增检查。

## 完成、重开与整轮回归

- `reopen`：id、reason、source；把原 completion、证据基础和授权完整保存到 history，递增 planVersion，并清理当前授权、步骤、路由与完成快照。按原范围重新计划、登记已有有效用户授权并重做验收、审核和交付；旧代次记录保留但不满足新代次门槛，不扩大用户授权。
- `round-verification`：result、verification、source、artifact、coverage。coverage 每项为 {id,criterion,result}，完整覆盖当前所有 completed 任务的验收条件；artifact 为真实整合回归日志。任务必须全部完成、取消或已明确搁置，且无锁、无pending操作。
- `close-round`：source、artifact；检查最终回归仍绑定当前整合版本，不能以旧单项测试代替。
- `defer`：锁内blocked任务、reason；明确外部阻塞后让出锁，保留编号及证据。任何pending操作先用 operation-finish 核实结果，即使原任务blocked仍可完成该核对。

## 审核记录

`evidence` 动作设置 `kind="review"`，输入 result、summary、artifact、reviewer、independent、findings={blocking,advisory,items} 和可选metrics。计数必须非负整数；passed不得包含阻塞发现。独立审核的reviewer须有真实身份与可核对来源，不能与执行者相同；failed的阻塞items会进入问题表。自审记录不满足独立审核。

`reviewRequired:false` 仅在有reviewWaiver={source,reason}时接受；豁免绑定当前计划版本，amend后须重新登记决定。豁免不能清除开放阻塞问题；没有实际独立审查不能写通过。
