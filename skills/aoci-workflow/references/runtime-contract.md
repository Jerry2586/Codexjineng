# 运行时合同与证据

参考基线：AOCI-CODE `v0.2.0-rc1`，于 2026-11-06 核对。兼容声明仅覆盖本文引用的流程；旧版本、新版本均须先核对实际工具定义和 Guide。

权威资料：
- https://github.com/aoci-spec/aoci-code/blob/v0.2.0-rc1/README.zh-CN.md
- https://github.com/aoci-spec/aoci-code/blob/v0.2.0-rc1/docs/overview-delivery.md
- https://github.com/aoci-spec/aoci-code/blob/v0.2.0-rc1/docs/cognition-refresh.md
- https://github.com/aoci-spec/aoci-code/blob/v0.2.0-rc1/spec/public/aoci-system-cognition-runtime-v1.txt

## 身份与可用性

主控记录二进制绝对路径、CLI 版本、MCP 服务自报版本、运行时仓库根目录、认知身份和检查时间。磁盘程序与正在运行的 MCP 可能不同；以真正响应当前请求的服务为准。CLI 诊断不得转换成完整认知交付。

0.2.0-rc1 文档提供 `--repo <项目> index agent guide --agent codex --json` 用于读取运行时指南，`verify`/`check` 用于核验。先确认安装版本支持，再调用。禁止包装器代替 AOCI 的 Plan、Apply、CAS、Baseline 或 Recovery。

## 三类证据及严格确认

| 主控证据 | 含义 | 不足以证明 |
|---|---|---|
| cognition_delivery | 当前会话接收完整内容，宿主确认交付 | 严格认知确认、业务正确 |
| cognition_alignment | 当前索引与受管内容对齐，无待恢复事务 | 当前模型已读全、测试通过 |
| business | 当前修改与受影响行为的真实检查结果 | 索引已维护 |

严格认知确认单独保留在原始响应中；只有实际结果允许，才可填写 `fullSystemReliable=true`。系统级决策要求此项；局部任务仍需源码和测试。

任务脚本接受的 receipt 摘要包含 `source: "mcp"`、`projectRoot`、`serviceVersion`、`identity`。交付再填 `complete`、`delivered`；对齐再填 `aligned`、`recoveryPending`。这些是本项目的归一化字段，必须由主代理从实际版本的响应解释，不能把字段名传回 AOCI。保留脱敏原始输出，脚本只验证文件绑定、项目和状态前置，不证明摘要语义真实。

## 恢复与有限继续

压缩后旧会话收据仅用于定位，不能证明新会话已读。遵循实际运行时给出的刷新、游标、确认和终态。已完成传输但严格确认未通过，应报告“已交付，完整认知确认未通过”，不要误报成索引不存在。

只有运行时明确返回 `full_system_claim_disabled_source_bound_task_continuation_allowed`，且治理对齐、无 Recovery/第三方冲突时，才登记 `cognition_limit`；另附当前源码检查证据和明确的局部范围。它允许当前任务在限制下继续，不允许未界定的系统级迁移或架构决策。相同刷新代次不自动重试完整加载。

| 情况 | 主控动作 |
|---|---|
| 项目身份不符 | 阻塞认知步骤，纠正连接后重查 |
| 仅安装 CLI / 缺 MCP | 保留未验证，按需要接入宿主 |
| 首次空索引 | 按授权建立真实条目，不记录“已理解” |
| 内容截断、缺片、身份改变 | 本次交付不可用，依 Guide 恢复 |
| 测试失败 | 修复业务，保留原任务锁 |
| 维护失败 | 保留仍有效的业务证据，处理维护 |
| stopped / 事务中断 | 根据正式写入证据恢复，禁止盲目重跑 |
| 第三方冲突、无法证明恢复 | 阻塞受影响步骤，保留断点 |

宿主保存收据身份与待处理恢复事项，不在任务账本复制整份正式索引。索引内容始终归 AOCI 管理。
