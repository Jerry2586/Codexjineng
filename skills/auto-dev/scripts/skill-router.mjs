import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { catalog, readSkillEntry } from './skill-catalog.mjs';
import { actorRecord, selectionAudit } from './workflow-audit.mjs';

const check = (ok, message) => { if (!ok) throw new Error(message); };
const text = (s, key) => { check(typeof s === 'string' && s.trim(), `${key} must be nonempty`); return s.trim(); };
const list = (values = [], key = 'list') => {
  check(Array.isArray(values), `${key} must be an array`);
  return [...new Set(values.map(v => text(v, key).toLowerCase()))].sort();
};
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const identity = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const now = () => new Date().toISOString();
const methods = new Set(['method', 'quality']);
const categories = new Set([...methods, 'environment', 'permission', 'requirements', 'unknown']);
const terms = {
  product: /product|产品|需求|brainstorm|planning/iu,
  architecture: /architect|架构|系统设计/iu,
  frontend: /frontend|front.end|react|vue|网页|前端|界面|\bui\b/iu,
  backend: /backend|back.end|server|后端|服务端/iu,
  database: /database|sql|数据库|数据模型|migration/iu,
  api: /\bapi\b|接口|contract|契约/iu,
  testing: /\btest|测试|verification|验证/iu,
  performance: /performance|profil|性能/iu,
  security: /security|安全(?!区域)|权限|auth/iu,
  environment: /environment|环境|配置|setup/iu,
  deployment: /deploy|release|部署|发布/iu,
  writing: /writ|文档|文案|表达|humaniz/iu,
};
export function normalizeContext(input) {
  check(input && typeof input === 'object', 'context required');
  const value = { goal: text(input.goal, 'goal'), needs: list(input.needs, 'needs'), stack: list(input.stack),
    phase: text(input.phase ?? 'any', 'phase').toLowerCase(), tools: list(input.tools), operations: list(input.operations ?? ['local']) };
  check(value.needs.length > 0, 'needs required');
  check(value.operations.every(op => ['local','git','ci','release','install','deploy'].includes(op)), 'Unknown operation');
  return value;
}
export function contextKey(input) {
  const { goal, ...context } = normalizeContext(input);
  return digest(JSON.stringify(context));
}
export function skillCurrent(skill) {
  check(skill && path.isAbsolute(skill.path), 'Skill requires absolute path');
  const actual = readSkillEntry(skill);
  check(actual.sha256 === skill.sha256 && actual.name === skill.name && actual.version === skill.version, 'Skill changed: refresh content digest and read instructions');
  return { ...actual, ...(skill.library ? { library: skill.library } : {}) };
}
export function artifactMatches(root, proof) {
  try {
    check(proof?.path?.startsWith('.smartbuild/evidence/') && !proof.path.includes('\\'), 'Invalid evidence path');
    check(path.posix.normalize(proof.path).startsWith('.smartbuild/evidence/'), 'Evidence escapes evidence directory');
    const absolute = path.resolve(root, proof.path), relative = path.relative(root, absolute);
    check(!relative.startsWith('..') && !path.isAbsolute(relative), 'Evidence escapes project');
    let probe = root;
    for (const part of relative.split(path.sep)) { probe = path.join(probe, part); check(!fs.lstatSync(probe).isSymbolicLink(), 'Linked evidence'); }
    return fs.statSync(absolute).isFile() && fs.statSync(absolute).size > 0 && digest(fs.readFileSync(absolute)) === proof.sha256;
  } catch { return false; }
}
const currentRoutes = task => (task.routing?.routes ?? []).filter(r => r.planVersion === task.planVersion && r.step === task.step);
function experience(state, root, context, skill) {
  if (!state) return 0;
  let value = 0;
  for (const task of [...state.tasks, ...(state.archives ?? []).flatMap(r => r.tasks)]) {
    for (const route of task.routing?.routes ?? []) {
      if (route.projectId !== state.project.id || route.planVersion !== task.planVersion || route.contextKey !== contextKey(context)) continue;
      if (route.selection.primary?.version !== skill.version || route.selection.primary?.sha256 !== skill.sha256 || identity(route.selection.primary.path) !== identity(skill.path)) continue;
      const outcome = route.outcomes.at(-1);
      if (!outcome || !artifactMatches(root, outcome.artifact)) continue;
      if (outcome.result === 'passed') value += 1;
      else if (outcome.result === 'failed' && methods.has(outcome.category)) value -= 1;
    }
  }
  return Math.max(-2, Math.min(2, value));
}
export function recommend({ skills, context: input, profiles = [], state = null, root }) {
  const context = normalizeContext(input);
  check(Array.isArray(skills) && Array.isArray(profiles), 'skills and profiles must be arrays');
  if (state) check(root && identity(fs.realpathSync.native(root)) === identity(state.project.root), 'Project identity mismatch');
  const excluded = [], warnings = [], candidates = [], seen = new Set();
  for (const entry of skills) {
    let skill;
    try { skill = skillCurrent(entry); } catch (error) { excluded.push({ name: entry.name, path: entry.path, reason: error.message }); continue; }
    if (seen.has(identity(skill.path))) continue;
    seen.add(identity(skill.path));
    const matches = profiles.filter(p => typeof p.path === 'string' && identity(p.path) === identity(skill.path));
    check(matches.length <= 1, 'Duplicate capability profiles for a skill');
    let profile = matches[0];
    if (profile && (profile.sha256 !== skill.sha256 || profile.version !== skill.version)) { warnings.push(`Stale profile ignored: ${skill.name}`); profile = null; }
    let needs, conflicts = [], reason = '';
    // Bundled orchestrators coordinate specialists; incidental domain mentions do not make them specialists.
    if (!profile && ['auto-dev','aoci-workflow'].includes(skill.name)) {
      excluded.push({name: skill.name, path: skill.path, reason: 'Coordinator or integration workflow requires an explicit task capability profile'}); continue;
    }
    if (profile) {
      needs = list(profile.needs, 'profile.needs');
      const stacks = list(profile.stacks), phases = list(profile.phases), tools = list(profile.tools), ops = list(profile.operations);
      conflicts = list(profile.conflicts);
      if (stacks.length && !stacks.some(s => context.stack.includes(s))) reason = 'Incompatible or unknown stack';
      else if (phases.length && !phases.includes(context.phase)) reason = 'Incompatible or unknown phase';
      else if (tools.some(tool => !context.tools.includes(tool))) reason = 'Missing required tool';
      else if (ops.some(op => !context.operations.includes(op))) reason = 'Operation outside available authorization';
    } else {
      const metadata = `${skill.name} ${skill.description}`;
      needs = Object.entries(terms).filter(([,regex]) => regex.test(metadata)).map(([name]) => name);
    }
    const matched = context.needs.filter(n => needs.includes(n));
    if (!reason && !matched.length) reason = 'No matching capability; read metadata or provide a version-bound profile';
    if (reason) { excluded.push({ name: skill.name, path: skill.path, reason }); continue; }
    const historyScore = experience(state, root, context, skill);
    const namedCapability = matched.some(n => terms[n]?.test(skill.name));
    const namedPhase = context.phase !== 'any' && skill.name.toLowerCase().includes(context.phase);
    candidates.push({ ...skill, matched, conflicts, confidence: profile ? 'profile-reviewed' : 'metadata-only',
      score: matched.length * 10 + (profile ? 6 : 0) + (namedCapability ? 2 : 0) + (namedPhase ? 1 : 0) + historyScore,
      reasons: [`Matches: ${matched.join(', ')}`, ...(namedCapability ? ['Skill name identifies the requested domain'] : []), ...(namedPhase ? ['Skill name matches current phase'] : []), profile ? 'Version-bound capability profile' : 'Metadata suggests relevance; read full skill and verify compatibility',
        ...(historyScore ? [`Same-project observed results: ${historyScore > 0 ? '+' : ''}${historyScore}`] : [])] });
  }
  candidates.sort((a,b) => b.score - a.score || a.name.localeCompare(b.name, 'en') || a.path.localeCompare(b.path, 'en'));
  const selected = [], covered = new Set();
  const conflictsWith = (a,b) => a.conflicts.includes(b.name.toLowerCase()) || a.conflicts.includes(identity(b.path).toLowerCase());
  for (const skill of candidates) {
    if (skill.confidence !== 'profile-reviewed') continue;
    if (selected.length === 3) break;
    if (selected.some(s => conflictsWith(s,skill) || conflictsWith(skill,s))) continue;
    if (!skill.matched.some(n => !covered.has(n))) continue;
    selected.push(skill); skill.matched.forEach(n => covered.add(n));
  }
  return { context, contextKey: contextKey(context), primary: selected[0] ?? null, support: selected.slice(1),
    missing: context.needs.filter(n => !covered.has(n)), candidates: candidates.slice(0,5), excluded, warnings,
    fallback: selected.length ? null : candidates.length ? 'Review candidate instructions and provide current capability profiles; otherwise use an explicit standard workflow.' : 'Use a documented standard workflow for the missing capabilities; do not fabricate a specialist.' };
}
export function diagnose(task, root, fingerprint = null) {
  const route = currentRoutes(task).at(-1);
  if (!route) return { action: 'select', reason: 'No selection for current step and plan' };
  try { for (const skill of [route.selection.primary, ...route.selection.support].filter(Boolean)) skillCurrent(skill); }
  catch { return { action: 'refresh-selection', reason: 'Selected skill missing or changed; preserve handoff before reselection' }; }
  const last = route.outcomes.at(-1);
  if (!last) return { action: 'execute', reason: 'No observed outcome yet' };
  if (!artifactMatches(root, last.artifact) || (fingerprint && last.fingerprint !== fingerprint)) return { action: 'reverify', reason: 'Latest observation is stale or missing' };
  if (last.result === 'passed') return { action: 'verify-acceptance', reason: 'Skill result passed; task acceptance and delivery still required' };
  const external = { environment: 'repair-environment', permission: 'resolve-permission', requirements: 'clarify-requirements', unknown: 'investigate' };
  if (external[last.category]) return { action: external[last.category], reason: last.reason };
  const recent = route.outcomes.slice(-2);
  const repeated = recent.length === 2 && recent.every(o => o.result === 'failed' && !o.progressed && methods.has(o.category)
    && o.symptom === last.symptom && artifactMatches(root, o.artifact));
  return { action: repeated ? 'switch' : 'adjust-method', reason: repeated ? 'Two evidenced attempts failed with the same symptom and no progress' : 'Change one evidenced cause and verify again' };
}
function validateSelection(request, context) {
  const input = request.selection;
  check(input && Array.isArray(input.support) && input.support.length <= 2, 'Selection supports at most two supporting skills');
  check(input.primary || input.support.length === 0, 'Support requires a primary skill');
  const skills = [input.primary, ...input.support].filter(Boolean);
  check(new Set(skills.map(s => identity(s.path))).size === skills.length, 'Duplicate selected skill');
  skills.forEach(skillCurrent);
  const result = recommend({ skills, context, profiles: request.profiles ?? [] });
  check(result.candidates.length === skills.length, 'Selection capability or compatibility mismatch');
  check(result.candidates.every(s => s.confidence === 'profile-reviewed'), 'Selected skills require a reviewed current capability profile');
  check(result.primary || skills.length === 0, 'No eligible primary');
  // An explicit order is allowed, but incompatible pairs must not be combined.
  for (const a of result.candidates) for (const b of result.candidates) if (a !== b) {
    check(!a.conflicts.includes(b.name.toLowerCase()) && !a.conflicts.includes(identity(b.path).toLowerCase()), 'Conflicting selected skills');
  }
  return { primary: input.primary ? result.candidates.find(s => identity(s.path) === identity(input.primary.path)) : null,
    support: input.support.map(s => result.candidates.find(c => identity(c.path) === identity(s.path))),
    reason: text(input.reason, 'selection.reason'), missing: context.needs.filter(n => !result.candidates.some(s => s.matched.includes(n))) };
}
function handoffRecord(input, route, task) {
  check(input, 'Context handoff required');
  const strings = key => { check(Array.isArray(input[key]), `handoff.${key} must be an array`); return input[key].map(s => text(s, `handoff.${key}`)); };
  return { scope: task.scope, acceptance: [...task.acceptance], goal: route.context.goal, constraints: strings('constraints'), completed: strings('completed'),
    attempts: strings('attempts'), failures: route.outcomes.filter(o => o.result !== 'passed'), previousSelection: route.selection,
    previousFingerprint: route.outcomes.at(-1)?.fingerprint ?? route.fingerprint, nextVerification: text(input.nextVerification, 'handoff.nextVerification') };
}
// Called only inside task-runtime's guarded, atomic transition. No parallel ledger or skill execution.
export function routeTransition(state, task, request, root, helpers) {
  check(['running','verifying','delivering'].includes(task.status), 'Skill routing requires executing task');
  task.routing ??= { routes: [] };
  const routes = currentRoutes(task), current = routes.at(-1);
  const fingerprint = helpers.fingerprint(root, task.watch);
  if (request.action === 'skill-select' || request.action === 'skill-switch') {
    check(!task.operations.some(op => op.status === 'pending'), 'Reconcile pending operations before changing skill selection');
    let context, handoff = null;
    if (request.action === 'skill-select') { check(!current, 'Use skill-switch for current step; cannot reset switching history'); context = normalizeContext(request.context); }
    else {
      check(current, 'Select a skill first');
      const diagnosis = diagnose(task, root, fingerprint);
      check(['switch','refresh-selection'].includes(diagnosis.action), `Switch requires eligible diagnosis: ${diagnosis.action}`);
      check(routes.length < 3, 'Switch limit reached; reassess approach or clarify scope');
      context = current.context; handoff = handoffRecord(request.handoff, current, task);
    }
    check(context.operations.every(op => task.authorization.operations.includes(op)), 'Routing context exceeds authorization');
    const selection = validateSelection(request, context);
    const audit = task.workflowVersion === 1 ? selectionAudit(request.audit, !!selection.primary) : null;
    const team = s => JSON.stringify([s.primary ? identity(s.primary.path) : 'standard-workflow', ...s.support.map(x => identity(x.path)).sort()]);
    const previous = routes.map(r => team(r.selection));
    const next = team(selection);
    // A content update to the current skill is allowed only when the stored version became stale.
    const refreshing = current && diagnose(task, root, fingerprint).action === 'refresh-selection'
      && next === previous.at(-1) && [selection.primary, ...selection.support].filter(Boolean).some(s =>
        ![current.selection.primary, ...current.selection.support].filter(Boolean).some(old => identity(old.path) === identity(s.path) && old.version === s.version && old.sha256 === s.sha256));
    check(!previous.includes(next) || refreshing, 'Skill switch cycle rejected');
    task.routing.routes.push({ id: `S${task.routing.routes.length + 1}`, projectId: state.project.id, planVersion: task.planVersion, step: task.step,
      context, contextKey: contextKey(context), selection, audit, stage: audit ? 'reviewed' : 'legacy-unreviewed', profiles: structuredClone(request.profiles ?? []), handoff, fingerprint, session: state.session, at: now(), outcomes: [] });
    task.nextAction = handoff?.nextVerification ?? `Apply selected method: ${context.goal}`;
  } else if (request.action === 'skill-outcome') {
    check(current, 'Select a skill first');
    for (const skill of [current.selection.primary,...current.selection.support].filter(Boolean)) skillCurrent(skill);
    check(['passed','failed','partial'].includes(request.result), 'Invalid skill outcome');
    check(categories.has(request.category), 'Invalid diagnosis category');
    check(typeof request.progressed === 'boolean', 'progressed must be boolean');
    const proof = helpers.artifact(root, request.artifact);
    check(!current.outcomes.some(o => o.artifact.path === proof.path || o.artifact.sha256 === proof.sha256), 'Duplicate evidence does not count as another attempt');
    const executor = task.workflowVersion === 1 ? actorRecord(request.executor) : null;
    current.stage = request.result === 'passed' ? 'validated' : 'executed';
    current.outcomes.push({ executor, result: request.result, category: request.category, progressed: request.progressed,
      symptom: text(request.symptom, 'symptom'), reason: text(request.reason, 'reason'), verification: text(request.verification, 'verification'),
      feedback: request.feedback ? text(request.feedback, 'feedback') : null, artifact: proof, fingerprint, session: state.session, at: now() });
    task.nextAction = diagnose(task, root, fingerprint).action;
  } else throw new Error('Unknown routing action');
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [command, inputFile] = process.argv.slice(2);
    check(command === 'recommend' && inputFile, 'Usage: node skill-router.mjs recommend request.json');
    const input = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
    const root = input.root ? fs.realpathSync(input.root) : null;
    const state = root && fs.existsSync(path.join(root, 'auto-dev-state.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'auto-dev-state.json'), 'utf8')) : null;
    check(Array.isArray(input.roots) && input.roots.length, 'roots must contain skill directories');
    const discoveryWarnings = [];
    const skills = catalog(input.roots, input.libraryFile, { onError: failure => discoveryWarnings.push(`${failure.path}: ${failure.reason}`) });
    const result = recommend({ skills, profiles: input.profiles, context: input.context, root, state });
    result.warnings.push(...discoveryWarnings);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
