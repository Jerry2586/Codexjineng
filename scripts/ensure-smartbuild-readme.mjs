import fs from 'node:fs';

const path = 'README.md';
const version = fs.readFileSync('VERSION', 'utf8').trim();
const start = '<!-- smartbuild:start -->';
const end = '<!-- smartbuild:end -->';
const block = `${start}\n## 核心智能体\n\n- **[智构开发系统 v${version}](./SMARTBUILD.md)**：技能入口位于 [\`skills/auto-dev\`](./skills/auto-dev/SKILL.md)。\n${end}`;
const installStart = '<!-- smartbuild-install:start -->';
const installEnd = '<!-- smartbuild-install:end -->';
const installBlock = `${installStart}\n## 安装\n\n安装你的完整技能包，并选择需要的技能：\n\n\`\`\`bash\nnpx skills@latest add Jerry2586/Codexjineng\n\`\`\`\n\n只安装“智构开发系统”：\n\n\`\`\`bash\nnpx skills@latest add Jerry2586/Codexjineng --skill auto-dev -g -y\n\`\`\`\n\n安装后写入 Codex 全局强制启动入口：\n\n\`\`\`powershell\npowershell -NoProfile -ExecutionPolicy Bypass -File "$HOME\\.agents\\skills\\auto-dev\\scripts\\install-global-bootstrap.ps1"\n\`\`\`\n${installEnd}`;

let readme = fs.readFileSync(path, 'utf8');
readme = readme.replace(/version-\d+\.\d+\.\d+-blue/g, `version-${version}-blue`);
readme = readme.replace(/当前版本：\[`v\d+\.\d+\.\d+`\]/g, `当前版本：[\`v${version}\`]`);
const pattern = new RegExp(`${start}[\\s\\S]*?${end}`, 'm');
const installPattern = new RegExp(`${installStart}[\\s\\S]*?${installEnd}`, 'm');

if (pattern.test(readme)) {
  readme = readme.replace(pattern, block);
} else if (readme.includes('## Reference')) {
  readme = readme.replace('## Reference', `## Reference\n\n${block}`);
} else {
  readme = `${readme.trimEnd()}\n\n## 智构开发系统\n\n${block}\n`;
}

if (installPattern.test(readme)) {
  readme = readme.replace(installPattern, installBlock);
} else {
  readme = `${readme.trimEnd()}\n\n${installBlock}\n`;
}

fs.writeFileSync(path, readme);
