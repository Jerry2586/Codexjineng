import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { initialState, transition } from '../skills/auto-dev/scripts/task-runtime.mjs';
import { readSkillMetadata, catalog } from '../skills/auto-dev/scripts/skill-catalog.mjs';
import { recommend, diagnose, loadProfiles } from '../skills/auto-dev/scripts/skill-router.mjs';

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'smartbuild-router-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.smartbuild/evidence'), { recursive: true });
  fs.writeFileSync(path.join(root, 'app.txt'), 'app');
  const skill = (name, description = 'backend api') => {
    const file = path.join(root, name, 'SKILL.md'); fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `---\nname: ${name}\ndescription: ${description}\n---\nFixture instructions`);
    return readSkillMetadata(file);
  };
  const a = skill('a'), b = skill('b'), c = skill('c'), d = skill('d');
  let state = initialState(root, 'Fixture', 'test-session');
  const act = (action, fields = {}) => { state = transition(state, { action, id: 'R001', expectedRevision: state.revision, ...fields }, root); return state; };
  act('add', { id: undefined, title: 'API update', scope: 'API contract', acceptance: ['API works'], watch: ['app.txt'] });
  act('authorize', { message: '开始制作', source: 'fixture', operations: ['local'] });
  act('plan', { steps: [{ title: 'Implement', input: 'API', output: 'API', verify: 'contract test' }] });
  act('start');
  const context = { goal: 'Repair API', needs: ['backend', 'api'], stack: ['node'], phase: 'implementation', tools: [], operations: ['local'] };
  const selection = primary => ({ primary, support: [], reason: 'API capability fits current task', missing: [] });
  const executor={id:'fixture',kind:'main',model:null,source:'unknown'};
  const audit={read:true,compatible:true,reason:'fixture reads and matches method',executor};
  const select = (primary = a) => act('skill-select', { context, selection: selection(primary), profiles, audit });
  let counter = 0;
  const outcome = (fields = {}) => {
    const artifact = `.smartbuild/evidence/attempt-${++counter}.txt`;
    fs.writeFileSync(path.join(root, artifact), `Fixture observation ${counter}`);
    return act('skill-outcome', { executor, result: 'failed', category: 'method', progressed: false, symptom: 'contract mismatch', reason: 'observed mismatch', verification: 'API contract test', artifact, ...fields });
  };
  const handoff = { constraints: ['Preserve compatibility'], completed: ['API handler implemented'], attempts: ['Contract still fails'], nextVerification: 'Run API contract test' };
  const change = primary => act('skill-switch', { selection: selection(primary), handoff, audit, profiles: profiles.map(p => p.path === primary?.path ? { ...p, sha256: primary.sha256, version: primary.version } : p) });
  const profiles = [a,b,c,d].map(s => ({ path: s.path, sha256: s.sha256, version: s.version, needs: ['backend', 'api'], stacks: ['node'], tools: [], operations: ['local'] }));
  return { root, a,b,c,d, context, profiles, act, select, outcome, change, selection, handoff, get state() { return state; } };
}

test('declared capabilities cover every development domain without a universal winner', t => {
  const f = fixture(t);
  for (const domain of ['product','architecture','frontend','backend','database','api','testing','performance','security','environment','deployment','writing']) {
    const result = recommend({ skills: [f.a], profiles: [{ ...f.profiles[0], needs: [domain] }], context: { ...f.context, needs: [domain] }, root: f.root });
    assert.equal(result.primary.path, f.a.path); assert.equal(result.missing.length, 0);
    assert.ok(result.primary.reasons.length); assert.equal(result.primary.sha256, f.a.sha256);
  }
});
test('compatibility and missing tools exclude candidates; unknown metadata stays provisional', t => {
  const f = fixture(t);
  let result = recommend({ skills: [f.a], profiles: [{ ...f.profiles[0], tools: ['database'] }], context: f.context, root: f.root });
  assert.equal(result.primary, null); assert.match(result.excluded[0].reason, /tool/);
  result = recommend({ skills: [f.a], profiles: [{ ...f.profiles[0], stacks: ['swift'] }], context: f.context, root: f.root });
  assert.equal(result.primary, null);
  result = recommend({ skills: [f.a], context: f.context, root: f.root });
  assert.equal(result.primary, null); assert.equal(result.candidates[0].confidence, 'metadata-only'); assert.deepEqual(result.missing, ['api','backend']);
});
test('changed or missing skills never enter recommendation or selection', t => {
  const f = fixture(t); fs.appendFileSync(f.a.path, '\nChanged');
  assert.equal(recommend({ skills: [f.a], context: f.context, root: f.root }).primary, null);
  assert.throws(() => f.select(), /changed|digest/);
  fs.unlinkSync(f.b.path); assert.throws(() => f.select(f.b), /ENOENT|missing/i);
});
test('selection respects existing authorization, lock and pause guards', t => {
  const f = fixture(t); f.act('pause', { nextAction: 'resume API' });
  assert.throws(() => f.select(), /paused/); assert.equal(f.state.tasks[0].routing, undefined);
});
test('two observed repeated method failures permit contextual switch but prevent A-B-A', t => {
  const f = fixture(t); f.select(); f.outcome();
  assert.equal(diagnose(f.state.tasks[0], f.root).action, 'adjust-method');
  assert.throws(() => f.change(f.b), /diagnosis/);
  f.outcome(); assert.equal(diagnose(f.state.tasks[0], f.root).action, 'switch'); f.change(f.b);
  const route = f.state.tasks[0].routing.routes.at(-1);
  assert.equal(route.handoff.scope, 'API contract'); assert.deepEqual(route.handoff.acceptance, ['API works']);
  assert.equal(route.handoff.failures.length, 2); assert.equal(route.handoff.nextVerification, 'Run API contract test');
  f.outcome(); f.outcome(); assert.throws(() => f.change(f.a), /cycle/);
  f.change(f.c); f.outcome(); f.outcome(); assert.throws(() => f.change(f.d), /limit/);
});
test('environment, permission, requirements and unknown failures do not invite blind switching', t => {
  for (const [category, action] of [['environment','repair-environment'],['permission','resolve-permission'],['requirements','clarify-requirements'],['unknown','investigate']]) {
    const f = fixture(t); f.select(); f.outcome({ category }); f.outcome({ category });
    assert.equal(diagnose(f.state.tasks[0], f.root).action, action); assert.throws(() => f.change(f.b), /diagnosis/);
  }
});
test('invalidated evidence, duplicate results and scope changes cannot drive switching', t => {
  const f = fixture(t); f.select(); f.outcome(); f.outcome();
  const last = f.state.tasks[0].routing.routes[0].outcomes.at(-1);
  assert.throws(() => f.outcome({ artifact: last.artifact.path }), /duplicate/i);
  fs.writeFileSync(path.join(f.root, last.artifact.path), 'tampered');
  assert.equal(diagnose(f.state.tasks[0], f.root).action, 'reverify');
  assert.throws(() => f.change(f.b), /diagnosis/);
  f.act('amend', { scope: 'Different API', acceptance: ['new criterion'], watch: ['app.txt'], reason: 'scope changed' });
  assert.equal(diagnose(f.state.tasks[0], f.root).action, 'select');
});
test('success is evidence-bound project experience and does not complete a task', t => {
  const f = fixture(t); f.select(f.b); f.outcome({ result: 'passed', category: 'quality', progressed: true });
  assert.equal(f.state.tasks[0].status, 'running');
  const options = { skills: [f.a,f.b], profiles: f.profiles, context: f.context, state: f.state, root: f.root };
  assert.equal(recommend(options).primary.path, f.b.path);
  const changed = structuredClone(f.state); changed.project.root = path.dirname(f.root);
  assert.throws(() => recommend({ ...options, state: changed }), /identity/);
  const proof = f.state.tasks[0].routing.routes[0].outcomes[0]; fs.unlinkSync(path.join(f.root, proof.artifact.path));
  assert.equal(recommend(options).primary.path, f.a.path);
});
test('a stale profile stays visible but cannot become an execution choice', t => {
  // Drift stays visible, while content review and regenerated declarations are required.
  const f = fixture(t); fs.appendFileSync(f.a.path, '\nNew version');
  const current = readSkillMetadata(f.a.path);
  const result = recommend({ skills: [current], profiles: f.profiles, context: f.context, root: f.root });
  assert.equal(result.candidates[0].confidence, 'profile-stale');
  assert.ok(result.warnings.some(s => /Stale profile/.test(s)));
  assert.equal(result.primary, null);
  assert.throws(() => f.act('skill-select', {context:f.context, selection:f.selection(current), profiles:f.profiles, audit:{}}), /current capability/);
});
test('missing capability permits explicit standard workflow fallback', t => {
  const f = fixture(t);
  const result = recommend({ skills: [], context: f.context, root: f.root });
  assert.equal(result.primary, null); assert.deepEqual(result.missing, ['api','backend']);
  f.select(null); f.outcome({ result: 'passed', category: 'quality', progressed: true });
  assert.equal(diagnose(f.state.tasks[0], f.root).action, 'verify-acceptance');
});

test('recommendation is bounded and excludes conflicting support', t => {
  const f = fixture(t);
  const result = recommend({ skills: [f.a,f.b,f.c,f.d], context: { ...f.context, needs: ['backend','api','testing','security'] },
    profiles: [
      { ...f.profiles[0], needs: ['backend'], conflicts: ['b'] },
      { ...f.profiles[1], needs: ['api'] }, { ...f.profiles[2], needs: ['testing'] }, { ...f.profiles[3], needs: ['security'] }
    ] });
  assert.equal(result.candidates[0].name, 'a'); assert.equal(result.support.length, 2);
  assert.deepEqual(result.missing, ['api']); assert.ok(!result.support.some(s => s.name === 'b'));
});
test('different failure symptoms and observed progress do not trigger automatic switching', t => {
  const f = fixture(t); f.select(); f.outcome(); f.outcome({ symptom: 'new symptom' });
  assert.equal(diagnose(f.state.tasks[0], f.root).action, 'adjust-method');
  f.outcome({ symptom: 'new symptom', progressed: true });
  assert.equal(diagnose(f.state.tasks[0], f.root).action, 'adjust-method');
});
test('new source changes require new verification before using a previous switch diagnosis', t => {
  const f = fixture(t); f.select(); f.outcome(); f.outcome();
  fs.writeFileSync(path.join(f.root, 'app.txt'), 'modified after test');
  assert.throws(() => f.change(f.b), /reverify/);
});
test('selection reset cannot evade the switch limit', t => {
  const f = fixture(t); f.select();
  assert.throws(() => f.select(f.b), /skill-switch/);
});
test('updated skill can be reselected with a handoff and does not inherit old ranking', t => {
  const f = fixture(t); f.select(f.b); f.outcome({ result: 'passed', category: 'quality' });
  fs.appendFileSync(f.b.path, '\nupdated'); const updated = readSkillMetadata(f.b.path);
  assert.equal(diagnose(f.state.tasks[0], f.root).action, 'refresh-selection');
  assert.throws(() => f.outcome(), /changed/);
  f.change(updated); assert.equal(f.state.tasks[0].routing.routes.length, 2);
  const result = recommend({ skills: [f.a,updated], context: f.context, state: f.state, root: f.root });
  assert.equal(result.candidates[0].name, 'a');
});
test('routing cannot manufacture operation permission or bypass missing handoff', t => {
  const f = fixture(t);
  assert.throws(() => f.act('skill-select', { context: { ...f.context, operations: ['deploy'] }, selection: f.selection(f.a) }), /authorization/);
  f.select(); f.outcome(); f.outcome();
  assert.throws(() => f.act('skill-switch', { selection: f.selection(f.b) }), /handoff/);
});
test('failed evidence writes leave the ledger unchanged', t => {
  const f = fixture(t); f.select(); const before = structuredClone(f.state);
  assert.throws(() => f.outcome({ artifact: '../outside.txt' }), /Evidence/);
  assert.deepEqual(f.state, before);
});
test('metadata duplicate names preserve path identity', t => {
  const f = fixture(t);
  fs.writeFileSync(f.b.path, fs.readFileSync(f.a.path)); const duplicate = readSkillMetadata(f.b.path);
  const result = recommend({ skills: [f.a, duplicate], context: f.context });
  assert.equal(result.candidates.length, 2); assert.notEqual(result.candidates[0].path, result.candidates[1].path);
});
test('non-method failures do not penalize the specialist in project experience', t => {
  const f = fixture(t); f.select(f.a); f.outcome({ category: 'environment' });
  const result = recommend({ skills: [f.a,f.b], context: f.context, state: f.state, root: f.root });
  assert.equal(result.candidates[0].name, 'a'); assert.ok(result.candidates[0].reasons.every(s => !s.includes('results: -')));
});
test('different project context does not inherit successful ranking', t => {
  const f = fixture(t); f.select(f.b); f.outcome({ result: 'passed', category: 'quality' });
  const result = recommend({ skills: [f.a,f.b], context: { ...f.context, stack: ['python'] }, state: f.state, root: f.root });
  assert.equal(result.candidates[0].name, 'a');
});

test('CLI reports malformed or unavailable skill roots and still recommends usable skills', t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.root,'broken'));
  fs.writeFileSync(path.join(f.root,'broken/SKILL.md'), '---\nname: broken\n---\nMissing description');
  const input = path.join(f.root,'request.json');
  fs.writeFileSync(input, JSON.stringify({ root: f.root, roots: [path.join(f.root,'missing-root'),f.root], context: f.context }));
  const output = spawnSync(process.execPath, ['skills/auto-dev/scripts/skill-router.mjs','recommend',input], { encoding:'utf8' });
  assert.equal(output.status, 0, output.stderr);
  const result = JSON.parse(output.stdout);
  assert.equal(result.candidates[0].name,'a'); assert.ok(result.warnings.some(w => w.includes('missing-root'))); assert.ok(result.warnings.some(w => w.includes('Missing description'))); assert.ok(result.warnings.some(w => w.includes('profiles-missing')));
});

test('evidence prefix cannot hide traversal outside the evidence directory', t => {
  const f = fixture(t); f.select();
  assert.throws(() => f.outcome({ artifact: '.smartbuild/evidence/../../app.txt' }), /Evidence|evidence/);
});

test('delivery-stage failures can be diagnosed without bypassing pending side effects', t => {
  const f = fixture(t);
  const artifact = '.smartbuild/evidence/business.txt';
  fs.writeFileSync(path.join(f.root,artifact), 'fixture business validation');
  f.select(); f.outcome({result:'passed',category:'quality',progressed:true});
  f.act('acceptance-result',{criterion:0,result:'passed',changes:['app.txt'],verification:'fixture check',artifact});
  f.act('verify'); f.act('evidence', {kind:'business',result:'passed',summary:'fixture validation',artifact});
  f.act('evidence', {kind:'review',skill:'ponytail-review',source:'isolated test fixture',result:'passed',summary:'fixture review',artifact,reviewer:{id:'fixture-reviewer',kind:'subagent',source:'tool',observation:'fixture return'},independent:true,findings:{blocking:0,advisory:0}});
  for (const [kind, skill] of [['project_audit','ponytail-audit'],['text_review','humanizer']]) f.act('evidence', {kind,skill,source:'isolated test fixture',result:'passed',summary:'fixture quality check',artifact});
  f.act('deliver');
  f.act('operation-start', {key:'fixture-operation',operation:'local',target:'fixture destination'});
  f.outcome(); f.outcome();
  assert.throws(() => f.change(f.b), /pending/);
  f.act('operation-finish', {key:'fixture-operation',result:'not-applied',reason:'fixture reconciled',artifact});
  f.change(f.b); assert.equal(f.state.tasks[0].status,'delivering');
});

test('orchestrator and integration workflows are not general domain specialists', t => {
  const f = fixture(t);
  fs.writeFileSync(f.a.path, '---\nname: auto-dev\ndescription: product planning testing API deployment\n---\nFixture');
  fs.writeFileSync(f.b.path, '---\nname: aoci-workflow\ndescription: environment setup cognition integration\n---\nFixture');
  const result = recommend({skills:[readSkillMetadata(f.a.path),readSkillMetadata(f.b.path)],context:{...f.context,needs:['testing','environment']}});
  assert.equal(result.primary,null); assert.deepEqual(result.missing,['environment','testing']);
});
test('safe area wording does not claim security expertise', t => {
  const f = fixture(t);
  fs.writeFileSync(f.a.path,'---\nname: mobile-native\ndescription: 处理安全区域与移动网页视口\n---\nFixture');
  const result=recommend({skills:[readSkillMetadata(f.a.path)],context:{...f.context,needs:['security']}});
  assert.equal(result.primary,null);
});
test('domain and phase in skill name outrank incidental mentions in other workflows', t => {
  const f = fixture(t);
  fs.writeFileSync(f.a.path,'---\nname: finishing-a-development-branch\ndescription: Integrate work when all tests pass\n---\nFixture');
  fs.writeFileSync(f.b.path,'---\nname: verification-before-completion\ndescription: Use before claiming work is passing\n---\nFixture');
  fs.writeFileSync(f.c.path,'---\nname: test-driven-development\ndescription: Use before writing implementation code\n---\nFixture');
  const result=recommend({skills:[f.a,f.b,f.c].map(s=>readSkillMetadata(s.path)),context:{...f.context,phase:'verification',needs:['testing']}});
  assert.equal(result.candidates[0].name,'verification-before-completion');
});

test('metadata candidates require a reviewed current profile before becoming an execution choice', t => {
  const f=fixture(t);
  const result=recommend({skills:[f.a],context:f.context});
  assert.equal(result.primary,null); assert.deepEqual(result.missing,['api','backend']);
  assert.equal(result.candidates[0].confidence,'metadata-only');
  assert.throws(()=>f.act('skill-select',{context:f.context,selection:f.selection(f.a)}),/declaration|profile/);
  f.select(); assert.equal(f.state.tasks[0].routing.routes[0].selection.primary.confidence,'profile-declared');
});

test('project experience recognizes the same Windows project through a substituted drive', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t); f.select(f.b); f.outcome({ result: 'passed', category: 'quality', progressed: true });
  const drive = ['Q:', 'R:', 'S:', 'T:', 'U:', 'V:', 'W:', 'X:', 'Y:', 'Z:'].find(letter => !fs.existsSync(letter + path.sep));
  assert.ok(drive, 'A free drive letter is required to verify Windows path aliases');
  const mapped = spawnSync('subst', [drive, f.root], { encoding: 'utf8' });
  assert.equal(mapped.status, 0, mapped.stderr || mapped.error?.message);
  try {
    const options = { skills: [f.a, f.b], profiles: f.profiles, context: f.context, state: f.state, root: drive + path.sep };
    assert.equal(recommend(options).primary.path, f.b.path);
    const other = structuredClone(f.state); other.project.root = path.dirname(f.state.project.root);
    assert.throws(() => recommend({ ...options, state: other }), /identity/);
  } finally {
    const unmapped = spawnSync('subst', [drive, '/D'], { encoding: 'utf8' });
    assert.equal(unmapped.status, 0, unmapped.stderr || unmapped.error?.message);
  }
});

test('bundled capability profiles let the router select a skill without per-call profiles', () => {
  const skillsRoot = path.resolve('skills');
  const skills = catalog([skillsRoot]);
  const profiles = loadProfiles(skillsRoot);
  assert.ok(profiles.length > 0, 'bundled profiles must ship with the package');
  const result = recommend({ skills, profiles, root: skillsRoot, context: { goal: 'improve a hover animation', needs: ['frontend'], stack: [], phase: 'implementation' } });
  assert.ok(result.primary, 'a frontend need must resolve to a primary skill');
  assert.equal(result.primary.confidence, 'profile-declared');
});

test('an installed tree with only the core skills still routes without throwing', t => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'smartbuild-installed-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'skills');
  fs.mkdirSync(root);
  for (const name of ['auto-dev', 'aoci-workflow']) fs.cpSync(path.join('skills', name), path.join(root, name), { recursive: true });
  const skills = catalog([root]);
  const skipped = [];
  const profiles = loadProfiles(root, { warn: entry => skipped.push(entry) });
  assert.ok(skipped.every(entry => entry.kind === 'skill-not-installed'), 'missing directories are reported, not thrown');
  assert.equal(profiles.length, 0, 'profiles for absent skills are dropped');
  const result = recommend({ skills, profiles, root, context: { goal: 'add login', needs: ['security'], stack: [], phase: 'implementation' } });
  assert.equal(result.primary, null);
  assert.deepEqual(result.missing, ['security']);
});

test('changed skill remains a provisional candidate until its declaration is refreshed', t => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'smartbuild-stale-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'skills');
  const folder = path.join(root, 'security-tool');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'SKILL.md'), '---\nname: security-tool\ndescription: security review\n---\nOriginal body');
  const before = readSkillMetadata(path.join(folder, 'SKILL.md'));
  const profiles = [{ path: before.path, sha256: before.sha256, version: before.version, needs: ['security'] }];
  fs.writeFileSync(path.join(folder, 'SKILL.md'), '---\nname: security-tool\ndescription: security review\n---\nUpdated body from the library');
  const skills = catalog([root]);
  const result = recommend({ skills, profiles, root, context: { goal: 'review auth', needs: ['security'], stack: [], phase: 'implementation' } });
  assert.equal(result.primary, null, 'stale declarations cannot silently authorize selection');
  assert.equal(result.candidates[0].name, 'security-tool');
  assert.equal(result.candidates[0].confidence, 'profile-stale');
  assert.ok(result.warnings.some(warning => /Stale profile/.test(warning)), 'the staleness is reported');
});

test('F06 CLI defaults to profiles from each root and explicit empty profiles remain empty', t => {
 const f=fixture(t), roots=[path.join(f.root,'one'),path.join(f.root,'two')];
 for(const [i,dir] of roots.entries()) {
  const folder=path.join(dir,'same');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'SKILL.md'),'---\nname: same\ndescription: backend api\n---\n'+i);
  const skill=readSkillMetadata(path.join(folder,'SKILL.md'));fs.mkdirSync(path.join(dir,'auto-dev/references'),{recursive:true});
  fs.writeFileSync(path.join(dir,'auto-dev/references/profiles.json'),JSON.stringify({skills:[{dir:'same',name:skill.name,sha256:skill.sha256,version:skill.version,needs:['backend','api']}]}));
 }
 const request=path.join(f.root,'request.json');const call=(extra={})=>{fs.writeFileSync(request,JSON.stringify({roots,context:f.context,...extra}));const r=spawnSync(process.execPath,[path.resolve('skills/auto-dev/scripts/skill-router.mjs'),'recommend',request],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
 const result=call();assert.ok(result.primary);assert.equal(result.candidates.length,2);assert.notEqual(result.candidates[0].path,result.candidates[1].path);assert.equal(call({profiles:[]}).primary,null);
});
test('F07 backend regression never recommends a motion specialist',()=>{
 const skillsRoot=path.resolve('skills');const result=recommend({skills:catalog([skillsRoot]),profiles:loadProfiles(skillsRoot),context:{goal:'为 Python 后端数据库补回归测试',needs:['testing'],stack:['python'],phase:'testing'}});
 assert.equal(result.primary,null);assert.deepEqual(result.missing,['testing']);assert.ok(result.standardWorkflow);
});
test('F07 explicit-only skill requires an explicit invocation and never implies content review',()=>{
 const skillsRoot=path.resolve('skills');const skills=catalog([skillsRoot]).filter(s=>s.name==='pick-ui-library');const context={goal:'梳理现有前端分层，不选库',needs:['architecture','frontend'],phase:'planning'};
 const options={skills,profiles:loadProfiles(skillsRoot),context};assert.equal(recommend(options).primary,null);
 const invoked=recommend({...options,context:{...context,invokedSkills:['pick-ui-library']}});assert.equal(invoked.primary.name,'pick-ui-library');assert.equal(invoked.primary.confidence,'profile-declared');
});

import { buildProfiles, output } from '../skills/auto-dev/scripts/build-profiles.mjs';
test('A07 changed bundled skill cannot inherit name-based capability declarations',t=>{
 const f=fixture(t),refs=path.join(f.root,'auto-dev/references');fs.mkdirSync(refs,{recursive:true});
 fs.copyFileSync(path.resolve('skills/auto-dev/references/profile-overrides.json'),path.join(refs,'profile-overrides.json'));
 fs.mkdirSync(path.join(f.root,'animate'));fs.writeFileSync(path.join(f.root,'animate/SKILL.md'),'---\nname: animate\ndescription: Use for backend database administration only.\n---\nCustomized instructions');
 const built=buildProfiles(f.root);fs.writeFileSync(path.join(refs,'profiles.json'),output(built));
 const row=built.find(p=>p.name==='animate');assert.ok(!row.needs.includes('frontend'));assert.ok(!row.domains.includes('web-animation'));assert.equal(row.declaration.status,'needs-review');
 const result=recommend({skills:catalog([f.root]).filter(s=>s.name==='animate'),profiles:loadProfiles(f.root),context:{goal:'backend database administration',needs:['backend','database'],phase:'implementation'},root:f.root});
 assert.equal(result.primary,null);assert.ok(result.warnings.some(w=>/animate/.test(w)));
});
test('A08 malformed profile rows warn and preserve valid routing entries',t=>{
 const f=fixture(t),refs=path.join(f.root,'auto-dev/references');fs.mkdirSync(refs,{recursive:true});
 const valid={file:'a/SKILL.md',name:'a',sha256:f.a.sha256,version:f.a.version,needs:['backend','api']};
 fs.writeFileSync(path.join(refs,'profiles.json'),JSON.stringify({skills:[null,{file:42},{...valid,needs:'backend'},{...valid,access:{}},valid]}));
 const warnings=[],profiles=loadProfiles(f.root,{warn:w=>warnings.push(w)});
 assert.equal(warnings.length,4);assert.equal(profiles.length,1);
 assert.equal(recommend({skills:[f.a],profiles,context:f.context,root:f.root}).primary.name,'a');
});
