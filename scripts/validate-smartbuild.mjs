import fs from 'node:fs';
import path from 'node:path';
import {catalog} from '../skills/auto-dev/scripts/skill-catalog.mjs';

const requiredFiles = [
  'skills/auto-dev/scripts/workflow-contract.mjs',
  'skills/auto-dev/scripts/capability-contract.mjs',
  'skills/auto-dev/scripts/doctor.mjs',
  'skills/auto-dev/references/execution-policy.md',
  'skills/auto-dev/references/execution-guide.md',
  'skills/auto-dev/references/general-quality.md',
  'skills/auto-dev/references/health-and-handoff.md',
  'scripts/test-workflow-contract.mjs',
  'scripts/test-audit-regressions.mjs',
  'scripts/test-doctor.mjs',
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

const requiredSkillText = ['# 智构开发系统', '版本：'+String.fromCharCode(96)+version+String.fromCharCode(96), '## 最高优先级：开发回合入口闸门', 'references/execution-policy.md', 'references/execution-guide.md', 'references/task-runtime.md', 'references/command-center-panel.md', 'references/general-quality.md', 'references/health-and-handoff.md'];
for (const text of requiredSkillText) if (!skill.includes(text)) failures.push('SKILL.md 缺少入口或引用: '+text);
if (skill.split('\n').length > 100) failures.push('主入口过长，执行细则应按需展开');
const ruleFiles=['skills/auto-dev/SKILL.md',...fs.readdirSync('skills/auto-dev/references').filter(name=>name.endsWith('.md')).map(name=>'skills/auto-dev/references/'+name)];
const rules=ruleFiles.map(file=>fs.readFileSync(file,'utf8')).join('\n');
for (const term of ['固定五部顺序','新增项默认排到队尾','只有整个开发轮次关闭并开始下一轮时才归档','真实用户原文','planVersion','证据摘要快照','最终整轮回归','独立审查','不授权新增任务','CLI 安装成功','先测试、通过后部署、部署后验收','正规军第一版','真实性红线','用户不负责挑技能']) if(!rules.includes(term)) failures.push('合同缺少关键保护: '+term);
for (const file of [...ruleFiles,'README.md','SMARTBUILD.md','skills/auto-dev/agents/openai.yaml']) {
 const content=fs.readFileSync(file,'utf8');
 if(/唯一开工与暂停恢复口令|开工与恢复只接受|同义说法只用于识别非开工动作/.test(content)) failures.push('残留矛盾授权规则: '+file);
 if(content.includes('\uFFFD')) failures.push('发现损坏字符: '+file);
 for(const match of content.matchAll(/\]\(([^)]+\.md)(?:#[^)]*)?\)/g)){
  const target=match[1];if(/^(?:https?:|[A-Za-z]:)/.test(target)||target.includes('<'))continue;
  if(!fs.existsSync(path.resolve(path.dirname(file),target))) failures.push('失效文档引用: '+file+' → '+target);
 }
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
// Capability profiles bind a skill's declared capabilities to its exact content.
// A skill edit without regenerating profiles silently changes what the router may pick.
const profilesFile = 'skills/auto-dev/references/profiles.json';
if (!fs.existsSync(profilesFile)) {
  failures.push('缺少技能能力档案: ' + profilesFile + '（运行 node skills/auto-dev/scripts/build-profiles.mjs skills）');
} else {
  try {
    const stored = JSON.parse(fs.readFileSync(profilesFile, 'utf8'));
    if(stored.schemaVersion!==2||!Array.isArray(stored.skills)) throw new Error('Expected profiles schemaVersion 2');
    const entries=catalog(['skills']);
    const seen=new Set();
    for (const profile of stored.skills) {
      const relative=profile.file??profile.dir+'/SKILL.md',file=path.resolve('skills',relative),boundary=path.relative(path.resolve('skills'),file);
      if(boundary.startsWith('..')||path.isAbsolute(boundary)||relative.includes('\\')){failures.push('能力档案路径越界: '+relative);continue;}
      if(seen.has(file))failures.push('重复能力档案: '+relative);seen.add(file);
      const entry=entries.find(item=>path.resolve(item.path)===file);
      if(!entry){failures.push('能力档案指向的技能/角色不存在: '+relative);continue;}
      if(entry.sha256!==profile.sha256||entry.version!==profile.version)failures.push('能力档案已过期: '+profile.name+'（重新运行 build-profiles.mjs）');
    }
  } catch(error){failures.push('能力档案无效: '+error.message);}
}

if (!workflow.includes('node scripts/test-auto-dev-functional.mjs')) failures.push('CI 没有运行功能规则测试');
if (!workflow.includes('node scripts/test-auto-dev-behavior.mjs --self-test')) failures.push('CI 没有运行离线行为契约');

if (!workflow.includes('node --test scripts/test-task-runtime.mjs')) failures.push('CI 没有运行任务状态机测试');
if (!workflow.includes('scripts/test-panel.mjs')) failures.push('CI 没有运行面板黄金测试');

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
