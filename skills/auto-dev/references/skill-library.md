# 技能库：来源、批量更新与回退

当用户加入外部技能、查询技能来源、独立发送 `技能库更新` 或要求回退技能时读取。技能文件仍保留在可发现的安装目录；来源账本、仓库缓存、原作者许可和备份放在独立目录，避免把备份识别成可调用技能。

## 口令与任务边界

普通开发和暂停恢复遵守 [统一控制与授权合同](execution-policy.md)。技能库批量维护的便捷入口是：**用户当前消息仅去除首尾空白后全文恰好为 `技能库更新`**，直接授权检查并更新已登记的技能。引用、代码块、长句、标点或截图中的词不触发；调用脚本时传真实原文，不把其他说法改写成口令。该例外不启动或恢复项目开发，不替未授权的新增技能开工，也不改变项目任务锁。

已开启的工作台继续显示短面板。更新属于独立技能库维护，结果写入技能库账本；项目的暂停、阻塞与步骤保留。普通开发待口令的规则不能拦住这个已确认例外。添加新技能、改变来源和回退仍按用户明确范围执行，不自动购买、上传、发布或执行上游脚本。

## 存储与记录

默认技能目录是 `~/.agents/skills`；默认库目录是 `~/.agents/skill-library`。自定义库用 `--library <绝对目录>`。插件或系统托管技能使用各自更新器，不搬进本库、不覆盖。扫描只选择用户维护的技能根目录。

`registry.json` 是唯一来源账本，逐项保存：稳定 id、名称、用途、安装路径、仓库地址、仓库子目录、作者、跟踪分支或标签、安装提交、上游提交、文件摘要、加入/检查/更新时间、是否已验证基线、备份和更新历史。列表实时检查本地修改。仓库 URL 不保存密码或 Token；认证沿用 Git 已配置的凭据。

- 没有可靠 Git 证据：保留文件，标 `source-pending`，不得猜来源。
- 已知来源但未证实安装版本：标 `baseline-unverified`，不把当前文件冒充某个提交。后续用 `add` 对同一来源重新核对，内容完全一致才能启用自动更新。
- 本库核心 `auto-dev` 和 `aoci-workflow` 由智构安装器维护，不被外部批量更新覆盖。
- 署名和技能目录内的许可原样保留；仓库根及祖先目录的 LICENSE、NOTICE、AUTHORS 等随版本留存在 `attributions/`，账本保存其位置。没有许可信息时不编造。

## 使用

需要现有 Node.js 和 Git。以下命令中的路径按实际安装位置填写。

```text
node <auto-dev>/scripts/skill-library.mjs list
node <auto-dev>/scripts/skill-library.mjs scan <用户维护的技能根目录>
node <auto-dev>/scripts/skill-library.mjs add <请求.json>
node <auto-dev>/scripts/skill-library.mjs register <来源请求.json>
node <auto-dev>/scripts/skill-library.mjs update --message "技能库更新"
node <auto-dev>/scripts/skill-library.mjs rollback <技能id> <备份id>
node <auto-dev>/scripts/skill-library.mjs recover
```

`add` 请求包含 `repository`（完整 HTTPS/SSH URL 或绝对本地 Git 路径）、`directory`（仓库内路径，根技能用 `.`）；可选 `id`、`ref`、`author`、`skillsRoot`。省略 ref 时实际查询默认分支并固定为 `refs/heads/...`；标签必须明确写 `refs/tags/...`，标签不会自动追到下一个版本。已有同名目标会核对来源与内容，不直接覆盖。存在名称冲突时指定不同 id。

`register` 用于已有技能来源记录：先 scan，再传 `id/repository/directory/ref/author/evidence`。证据写来源说明或文件位置；本操作不联网、不声称版本已核实、不会开启自动替换。未知默认分支时先核对，不填猜测值。

目录选择器可关联来源：

```text
node <auto-dev>/scripts/skill-catalog.mjs <技能根> --library <技能库>/registry.json
```

## 更新流程与异常

1. 获取库写锁并读回账本。锁存在时检查持有进程，不自动抢锁。发现 `pending.json` 时先恢复。
2. 逐项检查来源、基线和本地内容。同一仓库本次只 fetch 一次，再按各技能自己的分支或标签解析提交。
3. 在暂存目录读取真实 Git blob，校验 SKILL.md 的名称与用途、目录和文件边界。拒绝符号链接、子模块、跨平台不安全路径、超出 32 MiB 或 5000 文件的技能。不执行技能脚本。
4. 保存旧文件和带摘要的清单，写中断日志；同盘替换目标并持久保存新提交和摘要，完成后清理临时文件。上游已删除的文件不会残留。
5. 独立失败继续处理其他技能。若替换过程发生中断，停止本批写入并保留可恢复日志；不能继续覆盖不确定状态。
6. 输出 `updated/current/failed/source-pending/baseline-unverified/protected`，带旧新提交、备份 id 与失败原因。发现上游新增技能只列出，不自动安装。失败退出码为 2，调用或授权错误为 1。

`rollback` 只接受属于该技能的备份，核对备份摘要和当前文件未被修改，再恢复并备份刚替换的版本，因此也能撤销回退。`recover` 依据实际文件摘要与已落盘账本，完成已提交事务或恢复未提交事务；外部改动不明时保留现场并要求核对，不把文件删除当作自动修复。

测试使用临时真实 Git 仓库覆盖更新、标签、改动冲突、删除、损坏来源、备份和恢复；它不等于实际远端服务连通性或所有第三方技能语义正确的证明。
