import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { inferDomains } from './capability-contract.mjs';
import { catalog } from './skill-catalog.mjs';

// Capability profiles must track skill content exactly. Regenerate after any skill edit;
// validate-smartbuild.mjs fails when the stored digest no longer matches the file on disk.
const NEED_PATTERNS = {
  product: /product|产品|需求|brainstorm|planning/iu,
  architecture: /architect|架构|系统设计/iu,
  frontend: /frontend|front.?end|react|vue|网页|前端|界面|\bui\b/iu,
  backend: /backend|back.?end|server|后端|服务端/iu,
  database: /database|sql|数据库|数据模型|migration/iu,
  api: /\bapi\b|接口|contract|契约/iu,
  testing: /\btest|测试|verification|验证/iu,
  performance: /performance|profil|性能/iu,
  security: /security|安全(?!区域)|权限|auth/iu,
  environment: /environment|环境|配置|setup/iu,
  deployment: /deploy|release|部署|发布/iu,
  writing: /writ|文档|文案|表达|humaniz/iu,
};

const COORDINATORS = new Set(['auto-dev', 'aoci-workflow']);

function readOverrides(file) {
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Hand-written capability overrides ship inside the auto-dev skill, so they must be
// resolved against the skills root being scanned. A repo-relative default silently
// loses every override once the package is installed somewhere else.
function overridesPath(skillsRoot) {
  return path.join(skillsRoot, 'auto-dev', 'references', 'profile-overrides.json');
}

function patterns(text) {
  return Object.entries(NEED_PATTERNS).filter(([, regex]) => regex.test(text)).map(([name]) => name);
}

export function buildProfiles(skillsRoot, { overridesFile = null, entries = catalog([skillsRoot]) } = {}) {
  const overrides = readOverrides(overridesFile ?? overridesPath(skillsRoot));
  const profiles = [];
  for (const entry of entries) {
    if (COORDINATORS.has(entry.name)) continue;
    const dir = path.relative(skillsRoot, entry.path).split(path.sep).map(part => part).slice(0, -1).join('/');
    const declared = overrides[entry.name];
    const bindingMatches = declared?.sourceSha256 === entry.sha256;
    const override = bindingMatches ? declared : {};
    const needsReview = Boolean(declared && !bindingMatches);
    const needs = override.needs ?? patterns(`${entry.name} ${entry.description}`);
    if (!needs.length && !needsReview) continue;
    profiles.push({
      dir: dir.replace(/\\/g, '/'),
      file: path.relative(skillsRoot, entry.path).split(path.sep).join('/'),
      name: entry.name,
      sha256: entry.sha256,
      version: entry.version,
      needs,
      domains: override.domains ?? inferDomains(entry.name + ' ' + entry.description, [], needs),
      excludeDomains: override.excludeDomains ?? [],
      explicitOnly: override.explicitOnly ?? /only runs when explicitly invoked|仅.*显式|仅.*点名/i.test(entry.description),
      access: override.access ?? 'unspecified',
      inputs: override.inputs ?? ['task scope and current source'],
      outputs: override.outputs ?? ['candidate instructions; review before execution'],
      notFor: override.notFor ?? [],
      declaration: { source: bindingMatches ? 'profile-overrides.json' : 'skill-metadata', status: needsReview ? 'needs-review' : 'declared' },
      review: override.review ?? null,
      ...(override.stacks ? { stacks: override.stacks } : {}),
      ...(override.phases ? { phases: override.phases } : {}),
      ...(override.tools ? { tools: override.tools } : {}),
      ...(override.operations ? { operations: override.operations } : {}),
    });
  }
  profiles.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  return profiles;
}

export function coverage(profiles) {
  const covered = new Set(profiles.flatMap(profile => profile.needs));
  return {
    covered: Object.keys(NEED_PATTERNS).filter(need => covered.has(need)),
    gaps: Object.keys(NEED_PATTERNS).filter(need => !covered.has(need)),
  };
}

export function output(profiles) {
  const report = coverage(profiles);
  return `${JSON.stringify({ schemaVersion: 2, generatedBy: 'build-profiles.mjs', assurance: 'declarations-only; not execution or review coverage', skills: profiles, coverage: report }, null, 2)}\n`;
}

export function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// Self-healing check: rebuild only when the stored document no longer matches what the
// skills on disk would produce. This is the one command the installer and periodic
// maintenance run, so an independent skill update cannot leave stale profiles behind.
export function refresh(skillsRoot, outFile) {
  const profiles = buildProfiles(skillsRoot);
  const next = output(profiles);
  const previous = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
  if (previous === next) return { changed: false, profiles };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const temporary = outFile + '.' + crypto.randomUUID() + '.tmp';
  const fd = fs.openSync(temporary, 'wx');
  try { fs.writeFileSync(fd, next); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { fs.renameSync(temporary, outFile); } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  return { changed: true, profiles };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const args = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
  const [skillsRoot = 'skills', outFile] = args;
  const check = process.argv.includes('--check');
  const target = outFile ?? path.join(skillsRoot, 'auto-dev/references/profiles.json');
  const profiles = buildProfiles(skillsRoot);
  const report = coverage(profiles);
  if (check) {
    const result = refresh(skillsRoot, target);
    console.log(`profiles: ${profiles.length} ${result.changed ? 'regenerated' : 'already current'} at ${target}`);
  } else {
    refresh(skillsRoot, target);
    console.log(`profiles: ${profiles.length} written to ${target}`);
  }
  console.log(`declared needs: ${report.covered.join(', ') || '(none)'}`);
  console.log(`undeclared needs: ${report.gaps.join(', ') || '(none)'}`);
}
