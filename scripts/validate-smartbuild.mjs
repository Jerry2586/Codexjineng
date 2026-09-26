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
  'skills/auto-dev/references/project-ledger.md',
  'skills/auto-dev/references/release-and-operations.md',
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

const requiredSkillText = [
  '# 智构开发系统',
  `版本：\`${version}\``,
  '## 五阶段开发骨架',
  '1. 构想开发确定',
  '2. 架构拆分、边界确定、防止越界',
  '3. 企业正规化改造',
  '4. 删除多余API和废弃接口、优化屎山',
  '5. 接口测试、功能测试、部署使用',
  '## 先区分问答和开发任务',
  '## 开发任务强制分段',
  '复杂逻辑的线路图澄清',
  '当前任务锁',
  '暂停口令',
];

for (const text of requiredSkillText) {
  if (!skill.includes(text)) failures.push(`SKILL.md 缺少关键规则: ${text}`);
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
