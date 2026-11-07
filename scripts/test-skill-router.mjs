import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { initialState, transition } from '../skills/auto-dev/scripts/task-runtime.mjs';
import { readSkillMetadata } from '../skills/auto-dev/scripts/skill-catalog.mjs';
import { recommend, diagnose } from '../skills/auto-dev/scripts/skill-router.mjs';

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
test('a stale profile cannot claim compatibility for a new skill version', t => {
  const f = fixture(t); fs.appendFileSync(f.a.path, '\nNew version');
  const current = readSkillMetadata(f.a.path);
  const result = recommend({ skills: [current], profiles: f.profiles, context: f.context, root: f.root });
  assert.equal(result.primary, null); assert.equal(result.candidates[0].confidence, 'metadata-only'); assert.ok(result.warnings.some(s => /profile/.test(s)));
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
  assert.equal(result.candidates[0].name,'a'); assert.equal(result.warnings.length,2);
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
  f.act('verify'); f.act('evidence', {kind:'business',result:'passed',summary:'fixture validation',artifact}); f.act('deliver');
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
  assert.throws(()=>f.act('skill-select',{context:f.context,selection:f.selection(f.a)}),/reviewed|profile/);
  f.select(); assert.equal(f.state.tasks[0].routing.routes[0].selection.primary.confidence,'profile-reviewed');
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
