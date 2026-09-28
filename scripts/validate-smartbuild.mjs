import fs from 'node:fs';

const requiredFiles = [
  'README.md', 'LICENSE', 'VERSION', 'CHANGELOG.md', 'SMARTBUILD.md', 'UPSTREAM.md',
  'skills/auto-dev/SKILL.md', 'skills/auto-dev/agents/openai.yaml',
  'skills/auto-dev/references/five-stage-operating-model.md',
  'skills/auto-dev/references/implementation-and-testing.md',
  'skills/auto-dev/references/planning-and-boundaries.md',
  'skills/auto-dev/references/personal-workbench.md',
  'skills/auto-dev/references/decision-and-stage-gates.md',
  'skills/auto-dev/references/project-ledger.md',
  'skills/auto-dev/references/command-center-panel.md',
  'skills/auto-dev/references/global-bootstrap.md',
  'skills/auto-dev/references/release-and-operations.md',
  'skills/auto-dev/scripts/install-global-bootstrap.ps1',
  'scripts/install-smartbuild.ps1', 'scripts/test-auto-dev-functional.mjs',
  'scripts/test-auto-dev-behavior.mjs', 'scripts/validate-smartbuild.mjs',
];
const failures = [];
const read = (file) => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
for (const file of requiredFiles) if (!fs.existsSync(file) || !fs.statSync(file).isFile()) failures.push(`缺少文件: ${file}`);

const version = read('VERSION').trim();
if (!/^\d+\.\d+\.\d+$/.test(version)) failures.push(`VERSION 不是有效版本号: ${version || '空'}`);
const skill = read('skills/auto-dev/SKILL.md');
const panel = read('skills/auto-dev/references/command-center-panel.md');
const bootstrap = read('skills/auto-dev/references/global-bootstrap.md');
const installer = read('skills/auto-dev/scripts/install-global-bootstrap.ps1');
const localInstaller = read('scripts/install-smartbuild.ps1');
const metadata = read('skills/auto-dev/agents/openai.yaml');
const behavior = read('scripts/test-auto-dev-behavior.mjs');
const readme = read('README.md');
const smartbuild = read('SMARTBUILD.md');
const changelog = read('CHANGELOG.md');
const workflow = read('.github/workflows/validate-smartbuild.yml');
const requireText = (label, source, values) => values.forEach((value) => { if (!source.includes(value)) failures.push(`${label} 缺少关键规则: ${value}`); });

requireText('SKILL.md', skill, [
  '# 智构开发系统', `版本：\`${version}\``,
  '用户当前消息去除首尾空白后全文恰好是 `开发助手` 时',
  '首行永远固定为 `【开发助手｜框架内执行】`',
  '首次启动回复必须显示完整版',
  '从第二条用户消息起全部使用',
  '| 状态 | 编号 | 事项 | 下一步 |',
  '登记完成后自动恢复当前任务断点',
  '### 消息回合与开发轮次不得混淆',
  '一个开发轮次可以跨很多消息回合',
  '新开发轮次开始时',
  '## 五阶段开发骨架', '## 开发任务强制分段', '### 真实性红线',
  '先测试、通过后部署、部署后验收', '## 全功能测试与发布闸门',
]);
requireText('面板合同', panel, [
  '# 智能体开发指挥中心面板合同',
  '## 首次启动完整版（强制且只显示一次）',
  '| 运行信息 | 当前内容 |',
  '| 状态 | 编号 | 所属步骤 | 当前步骤 | 内容摘要 | 验证结果 |',
  '### 当前焦点', '### 控制口令',
  '## 后续精简面板（第二条回复起强制）',
  '| 状态 | 编号 | 事项 | 下一步 |',
  '控制：暂停一下 · 查看队列表 · 关闭开发助手',
  '## 显示层与运行层边界（写死）',
  '显示层相当于网站前端', '运行层相当于网站后端',
  '## 消息回合与开发轮次（写死）',
  '下一条用户消息、上下文压缩或智能体交接都不能把它删除',
  '## 需求排队与滚动接替（写死）',
  '自动回到原任务断点继续',
  '新开发轮次开始时，上轮完成项整体归档并退出活动表',
]);
requireText('全局入口', bootstrap, [
  'SMARTBUILD-GLOBAL-BOOTSTRAP:START', 'SMARTBUILD-GLOBAL-BOOTSTRAP:END',
  '全文恰好是 `开发助手`', '第一行必须逐字为 `【开发助手｜框架内执行】`',
  '首次启动完整版', '从第二条用户消息起', '精简面板', '不得静默退回普通回答',
  '面板模板是写死的显示层，等同网站前端', '运行层，等同网站后端',
  '一条消息和一次回复只是消息回合', '当前轮次完成项不得在下一条消息时删除',
]);
requireText('全局安装器', installer, ['[switch]$Remove', 'SMARTBUILD-GLOBAL-BOOTSTRAP:START', 'Move-Item']);
requireText('本地安装器', localInstaller, ["@('agents', 'references', 'scripts')", 'install-global-bootstrap.ps1', '& $bootstrapInstaller']);
requireText('默认提示', metadata, ['allow_implicit_invocation: true', '首次启动完整版', '从第二条用户消息起持续显示精简面板', '自动恢复原任务断点', '严格区分消息回合和开发轮次']);
requireText('行为测试', behavior, ['const hasFullPanel', 'const hasCompactPanel', '独立开发助手首次显示完整版', '开启后普通问答保持精简面板', '新需求排队且不抢当前任务', '同一开发轮次完成项不会因下一条消息消失']);

if (!readme.includes('<!-- smartbuild:start -->') || !readme.includes('<!-- smartbuild:end -->')) failures.push('README 缺少智构保护标记');
if (!readme.includes('<!-- smartbuild-install:start -->') || !readme.includes('<!-- smartbuild-install:end -->')) failures.push('README 缺少安装入口保护标记');
if (!readme.includes('npx skills@latest add Jerry2586/Codexjineng')) failures.push('README 没有用户自己的安装命令');
if (!readme.includes('install-global-bootstrap.ps1')) failures.push('README 缺少全局入口安装命令');
if (!readme.includes(`version-${version}-blue`)) failures.push('README 版本徽章与 VERSION 不一致');
if (!readme.includes(`智构开发系统 v${version}`)) failures.push('README 核心智能体版本与 VERSION 不一致');
if (!readme.includes(`当前版本：[\`v${version}\`]`)) failures.push('README 当前版本与 VERSION 不一致');
if (!smartbuild.includes(`# 智构开发系统 v${version}`)) failures.push('SMARTBUILD.md 版本与 VERSION 不一致');
if (!smartbuild.includes('首次启动完整版') || !smartbuild.includes('精简面板')) failures.push('SMARTBUILD.md 未说明两段式面板');
const changelogVersion = changelog.match(/^##\s+(\d+\.\d+\.\d+)\b/m)?.[1] ?? '';
if (changelogVersion !== version) failures.push(`CHANGELOG.md 最新版本与 VERSION 不一致: ${changelogVersion || '空'}`);
if (readme.includes('npx skills@latest add emilkowalski/skills')) failures.push('README 仍把上游作为默认安装包');
if (!readme.includes('emilkowalski/skills') || !readme.includes('MIT License')) failures.push('README 缺少上游来源或许可证说明');
const license = read('LICENSE');
if (!license.includes('MIT License') || !license.includes('Copyright (c) 2026 Emil Kowalski')) failures.push('LICENSE 缺少 MIT 或上游版权声明');
if (!workflow.includes('node scripts/validate-smartbuild.mjs') || !workflow.includes('node scripts/test-auto-dev-functional.mjs') || !workflow.includes('node scripts/test-auto-dev-behavior.mjs --self-test')) failures.push('CI 未覆盖全部本地校验');

for (const file of requiredFiles) {
  const data = read(file);
  if (/\r(?!\n)/.test(data)) failures.push(`文件包含异常换行: ${file}`);
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`智构开发系统 v${version} 校验通过，共检查 ${requiredFiles.length} 个核心文件。`);
