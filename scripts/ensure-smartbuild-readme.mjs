import fs from 'node:fs';

const path = 'README.md';
const start = '<!-- smartbuild:start -->';
const end = '<!-- smartbuild:end -->';
const block = `${start}\n- **[智构开发系统 v1.0.0](./SMARTBUILD.md)** — 五阶段、双模式、分段式企业级 AI 开发系统。技能入口：[skills/auto-dev](./skills/auto-dev/SKILL.md)。\n${end}`;

let readme = fs.readFileSync(path, 'utf8');
const pattern = new RegExp(`${start}[\\s\\S]*?${end}`, 'm');

if (pattern.test(readme)) {
  readme = readme.replace(pattern, block);
} else if (readme.includes('## Reference')) {
  readme = readme.replace('## Reference', `## Reference\n\n${block}`);
} else {
  readme = `${readme.trimEnd()}\n\n## 智构开发系统\n\n${block}\n`;
}

fs.writeFileSync(path, readme);
