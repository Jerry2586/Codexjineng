import fs from 'node:fs';
import path from 'node:path';

const requiredFiles = [
  'README.md',
  'LICENSE',
  'VERSION',
  'CHANGELOG.md',
  'SMARTBUILD.md',
  'UPSTREAM.md',
  'skills/auto-dev/SKILL.md',
  'skills/auto-dev/agents/openai.yaml',
  'skills/auto-dev/references/five-stage-operating-model.md',
  'skills/auto-dev/references/implementation-and-testing.md',
  'skills/auto-dev/references/planning-and-boundaries.md',
  'skills/auto-dev/references/personal-workbench.md',
  'skills/auto-dev/references/decision-and-stage-gates.md',
  'skills/auto-dev/references/project-ledger.md',
  'skills/auto-dev/references/command-center-panel.md',
  'skills/auto-dev/references/release-and-operations.md',
  'scripts/test-auto-dev-functional.mjs',
  'scripts/test-auto-dev-behavior.mjs',
  'scripts/test-task-runtime.mjs',
  'scripts/test-skill-library.mjs',
  'scripts/test-skill-router.mjs',
  'scripts/test-workflow-audit.mjs',
  'scripts/restore-smartbuild.ps1',
  'scripts/smartbuild-files.ps1',
  'skills/auto-dev/scripts/workflow-audit.mjs',
  'skills/auto-dev/references/company-development.md',
  'skills/auto-dev/scripts/skill-router.mjs',
  'skills/auto-dev/references/skill-routing.md',
  'skills/auto-dev/scripts/skill-library.mjs',
  'skills/auto-dev/scripts/skill-library-git.mjs',
  'skills/auto-dev/references/skill-library.md',
  'skills/auto-dev/scripts/task-runtime.mjs',
  'skills/auto-dev/scripts/skill-catalog.mjs',
  'skills/auto-dev/references/task-runtime.md',
  'skills/aoci-workflow/SKILL.md',
  'skills/aoci-workflow/agents/openai.yaml',
  'skills/aoci-workflow/scripts/probe-aoci.mjs',
  'skills/aoci-workflow/references/runtime-contract.md',
];

const failures = [];
for (const file of requiredFiles) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) failures.push(`缺少文件: ${file}`);
}

const version = fs.existsSync('VERSION') ? fs.readFileSync('VERSION', 'utf8').trim() : '';
if (!/^\d+\.\d+\.\d+$/.test(version)) failures.push(`VERSION 不是有效版本号: ${version || '空'}`);

const skill = fs.existsSync('skills/auto-dev/SKILL.md')
  ? fs.readFileSync('skills/auto-dev/SKILL.md', 'utf8')
  : '';
const commandCenter = fs.existsSync('skills/auto-dev/references/command-center-panel.md')
  ? fs.readFileSync('skills/auto-dev/references/command-center-panel.md', 'utf8')
  : '';

const requiredSkillText = [
  '# 智构开发系统',
  `版本：\`${version}\``,
  '## 自动识别事项与统一任务队列（先判定）',
  '## 开发请求第一回复协议（不得省略）',
  '首次启动完整版与后续精简面板都映射同一份可信账本',
  '禁止只用一段文字复述需求后询问“需要我开始吗”',
  '缺少其中任意一项都视为没有执行本技能',
  '本技能的开发框架是强制外壳',
  '先把输入转成简短、可核对的大白话文字需求',
  '图片和附件只提供需求证据',
  '## 精简需求记忆体',
  '只有整个开发轮次关闭并开始下一轮时才归档退出活动表',
  '活动表里没有的旧聊天要求',
  '## 最高优先级：开发回合入口闸门',
  '在进行任何工具调用、子智能体派发、代码修改、测试或外部写入之前',
  '未明确先讨论，未授权等待指令，已授权则先完成以上展示再执行',
  '用户当前消息去除首尾空白后全文恰好是 `开始制作`',
  '当前任务锁：R001',
  '## 五阶段开发骨架',
  '这五部的名称、顺序和阶段管理逻辑属于写死的运行骨架',
  '## 智构开发指挥中心',
  '| 状态 | 编号 | 事项 | 下一步 |',
  '①构想定稿',
  'references/command-center-panel.md',
  '唯一下一步',
  '不写死示例项目、编号、阶段或进度',
  '阶段一是自由创作和真实功能试制',
  '泥腿子版本盘点、拆分、迁移和补齐为正规军第一版',
  '### 真实性红线',
  '先测试、通过后部署、部署后验收',
  '一个工具调用通道和一个代码修改执行者',
  '用户不负责挑技能',
  '## 统一控制口令',
  '### 项目阶段推进',
  '`转到第N阶段`',
  '`进入大下一步`',
  '1. 构想定稿',
  '2. 架构定界',
  '3. 企业化改造',
  '4. 接口清理与重构',
  '5. 测试部署验收',
  '## 先区分问答和开发任务',
  '## 开发任务强制分段',
  '复杂逻辑的线路图澄清',
  '当前任务锁',
  '暂停口令',
  '## 全功能测试与发布闸门',
  '公开仓库安装测试和CI必须全部通过',
];

for (const text of requiredSkillText) {
  if (!skill.includes(text)) failures.push(`SKILL.md 缺少关键规则: ${text}`);
}

const requiredCommandCenterText = [
  '# 智能体开发指挥中心面板合同',
  '## 智构开发指挥中心',
  '| 运行信息 | 当前内容 |',
  '### 全局五部进度',
  '### 本回合理解',
  '| 状态 | 编号 | 所属步骤 | 当前步骤 | 内容摘要 | 验证结果 |',
  '### 当前焦点',
  '### 控制口令',
  '`开发助手`',
  '`关闭开发助手`',
  '当前开发轮次内已经完成的 Rxxx 必须继续保存在本轮账本和完整队列表中',
  '| 状态 | 编号 | 事项 | 下一步 |',
  '后续精简面板',
  '无证据时不得写百分比',
  'APPGOGCMS、R004、R005、R006',
];
for (const text of requiredCommandCenterText) {
  if (!commandCenter.includes(text)) failures.push(`指挥中心合同缺少关键规则: ${text}`);
}

const readme = fs.existsSync('README.md') ? fs.readFileSync('README.md', 'utf8') : '';
if (!readme.includes('<!-- smartbuild:start -->') || !readme.includes('<!-- smartbuild:end -->')) {
  failures.push('README 缺少智构保护标记');
}
if (!readme.includes('<!-- smartbuild-install:start -->') || !readme.includes('<!-- smartbuild-install:end -->')) {
  failures.push('README 缺少安装入口保护标记');
}
if (!readme.includes('npx skills@latest add Jerry2586/Codexjineng')) {
  failures.push('README 没有使用用户自己的安装包');
}
if (readme.includes('npx skills@latest add emilkowalski/skills')) {
  failures.push('README 仍把原作者仓库作为默认安装包');
}
if (!readme.includes(`# 智构开发系统 SmartBuild`)) failures.push('README 没有以智构开发系统作为产品首页');
if (!readme.includes(`version-${version}-blue`)) failures.push('README 版本徽章与 VERSION 不一致');
if (!readme.includes(`智构开发系统 v${version}`)) failures.push('README 核心智能体版本与 VERSION 不一致');
if (!readme.includes(`当前版本：[\`v${version}\`]`)) failures.push('README 当前版本与 VERSION 不一致');
if (!readme.includes('emilkowalski/skills')) failures.push('README 缺少原作者仓库来源说明');
if (!readme.includes('MIT License')) failures.push('README 缺少 MIT License 说明');
if (!readme.includes('吸收上游不代表删除原作者署名')) failures.push('README 缺少原作者署名保护说明');

const license = fs.existsSync('LICENSE') ? fs.readFileSync('LICENSE', 'utf8') : '';
if (!license.includes('MIT License')) failures.push('LICENSE 不是预期的 MIT License');
if (!license.includes('Copyright (c) 2026 Emil Kowalski')) failures.push('LICENSE 缺少原作者版权声明');

const changelog = fs.existsSync('CHANGELOG.md') ? fs.readFileSync('CHANGELOG.md', 'utf8') : '';
const changelogVersion = changelog.match(/^##\s+(\d+\.\d+\.\d+)\b/m)?.[1] ?? '';
if (changelogVersion !== version) failures.push(`CHANGELOG.md 最新版本与 VERSION 不一致: ${changelogVersion || '空'}`);

const smartbuild = fs.existsSync('SMARTBUILD.md') ? fs.readFileSync('SMARTBUILD.md', 'utf8') : '';
if (!smartbuild.includes(`# 智构开发系统 v${version}`)) failures.push('SMARTBUILD.md 版本与 VERSION 不一致');
if (!smartbuild.includes('npx skills@latest add Jerry2586/Codexjineng')) failures.push('SMARTBUILD.md 缺少用户安装包命令');

const openaiYaml = fs.existsSync('skills/auto-dev/agents/openai.yaml')
  ? fs.readFileSync('skills/auto-dev/agents/openai.yaml', 'utf8')
  : '';
if (!openaiYaml.includes('allow_implicit_invocation: true')) failures.push('auto-dev 没有启用自动发现');
if (!openaiYaml.includes('首次启动完整版')
  || !openaiYaml.includes('持续显示精简面板')) {
  failures.push('auto-dev 默认提示没有强调开发入口闸门');
}

const workflow = fs.existsSync('.github/workflows/validate-smartbuild.yml')
  ? fs.readFileSync('.github/workflows/validate-smartbuild.yml', 'utf8')
  : '';
if (!workflow.includes('node scripts/test-auto-dev-functional.mjs')) failures.push('CI 没有运行功能规则测试');
if (!workflow.includes('node scripts/test-auto-dev-behavior.mjs --self-test')) failures.push('CI 没有运行离线行为契约');

if (!workflow.includes('node --test scripts/test-task-runtime.mjs')) failures.push('CI 没有运行任务状态机测试');

for (const file of requiredFiles) {
  if (!fs.existsSync(file)) continue;
  const data = fs.readFileSync(file, 'utf8');
  if (/\r(?!\n)/.test(data)) failures.push(`文件包含异常换行: ${file}`);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`智构开发系统 v${version} 校验通过，共检查 ${requiredFiles.length} 个核心文件。`);
