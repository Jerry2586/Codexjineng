import fs from 'node:fs';
import path from 'node:path';

const requiredFiles = [
  'VERSION',
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
if (version !== '1.0.0') failures.push(`VERSION 应为 1.0.0，实际为 ${version || '空'}`);

const skill = fs.existsSync('skills/auto-dev/SKILL.md')
  ? fs.readFileSync('skills/auto-dev/SKILL.md', 'utf8')
  : '';

const requiredSkillText = [
  '# 智构开发系统',
  '版本：`1.0.0`',
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
