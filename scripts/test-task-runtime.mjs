import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { initialState, initialize, readState, transact, transition, fingerprint, summary } from '../skills/auto-dev/scripts/task-runtime.mjs';
import { catalog } from '../skills/auto-dev/scripts/skill-catalog.mjs';
import { probe } from '../skills/aoci-workflow/scripts/probe-aoci.mjs';

function fixture(t, options = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'smartbuild-state-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.smartbuild/evidence'), { recursive: true });
  fs.writeFileSync(path.join(root, 'app.txt'), 'initial\n');
  fs.writeFileSync(path.join(root, '.smartbuild/evidence/result.txt'), 'fixture evidence; never a live MCP result');
  let state = initialState(root, 'Fixture', 'session-1');
  const act = (action, fields = {}) => { state = transition(state, { action, expectedRevision: state.revision, ...fields }, root); return state; };
  const add = (fields = {}) => act('add', { title: 'Update app', scope: 'app.txt only', acceptance: ['observable result'], watch: ['app.txt'], ...fields });
  const plan = id => act('plan', { id, steps: [{ title: 'Implement and verify', input: 'app.txt', output: 'updated file', verify: 'read content', skills: [] }] });
  const authorize = (id = 'R001', operations = ['local']) => act('authorize', { id, operations, source: 'Explicit fixture authorization', message: '开始制作' });
  const audit = (id='R001') => {
    const task=state.tasks.find(t=>t.id===id); if(!['running','verifying','delivering'].includes(task.status))return;
    const executor={id:'fixture',kind:'main',model:null,source:'unknown'};
    if(!task.routing) act('skill-select',{id,context:{goal:'fixture test',needs:['testing']},selection:{primary:null,support:[],reason:'fixture standard method'},audit:{read:false,compatible:true,reason:'fixture',executor}});
    if(!state.tasks.find(t=>t.id===id).routing.routes.at(-1).outcomes.length) act('skill-outcome',{id,result:'passed',category:'quality',progressed:true,symptom:'fixture',reason:'fixture result',verification:'fixture assertions',artifact:'.smartbuild/evidence/result.txt',executor});
    for(let criterion=0;criterion<task.acceptance.length;criterion++)act('acceptance-result',{id,criterion,result:'passed',changes:['app.txt'],verification:'fixture verification',artifact:'.smartbuild/evidence/result.txt'});
    for(const [kind,skill] of [['project_audit','ponytail-audit'],['text_review','humanizer']]) act('evidence',{id,kind,skill,source:'isolated test fixture',result:'passed',summary:'fixture quality check',artifact:'.smartbuild/evidence/result.txt'});
  };
  const proof = (kind, fields = {}) => { if(kind==='business') audit(); return act('evidence', { id: 'R001', kind, result: 'passed', summary: 'fixture', artifact: '.smartbuild/evidence/result.txt', ...fields }); };
  const receipt = { source: 'mcp', projectRoot: root, serviceVersion: 'test-only', identity: 'index-1', complete: true, delivered: true, aligned: true, recoveryPending: false };
  const cognition = (extra = {}) => { proof('cognition_delivery', { receipt: { ...receipt, ...extra } }); proof('cognition_alignment', { receipt }); };
  const prepare = () => { add(options); authorize('R001', options.deliveries ?? ['local']); plan('R001'); };
  const start = () => act('start', { id: 'R001' });
  const review = (id='R001') => act('evidence', { id, kind: 'review', skill: 'ponytail-review', source: 'isolated test fixture', result: 'passed', summary: 'independent review complete',
    artifact: '.smartbuild/evidence/result.txt',
    reviewer: { id: 'fixture-reviewer', kind: 'subagent', source: 'tool', observation: 'fixture subagent return' },
    independent: true, findings: { blocking: 0, advisory: 0 } });
  const finish = () => { act('verify', { id: 'R001' }); proof('business'); review(); act('deliver', { id: 'R001' }); proof('local'); act('complete', { id: 'R001' }); };
  return { root, act, add, plan, authorize, proof, review, audit, receipt, cognition, prepare, start, finish, get state() { return state; } };
}

test('scope authorization is explicit; reserving the first task is not execution', t => {
  const f = fixture(t); f.add(); f.plan('R001');
  assert.equal(f.state.lock, 'R001'); assert.throws(f.start, /authorization/);
  f.authorize(); f.start(); assert.equal(f.state.tasks[0].status, 'running');
});
test('new requests queue behind the lock and cannot steal execution', t => {
  const f = fixture(t); f.prepare(); f.start(); f.add({ title: 'Second' }); f.authorize('R002'); f.plan('R002');
  assert.throws(() => f.act('start', { id: 'R002' }), /skip queue|steal lock/);
  assert.throws(() => f.act('reorder', { id: 'R002', position: 1, reason: 'attempt' }), /ahead/);
  assert.equal(f.state.lock, 'R001');
});
test('amending scope invalidates plan, authorization and old evidence', t => {
  const f = fixture(t); f.prepare(); f.start(); f.proof('business');
  f.act('amend', { id: 'R001', scope: 'new boundary', acceptance: ['new result'], watch: ['app.txt'], reason: 'user correction' });
  assert.equal(f.state.tasks[0].planVersion, 2); assert.equal(f.state.tasks[0].authorization, null);
  assert.equal(summary(f.state, f.root).checks[0].evidence.business, false);
  assert.throws(() => f.act('unblock', { id: 'R001', reason: 'retry' }), /authorization/);
});
test('a running plan cannot be silently replaced', t => {
  const f = fixture(t); f.prepare(); f.start(); assert.throws(() => f.plan('R001'), /Plan only/);
});
test('pause persists focus; display toggle does not resume; resume detects external edits', t => {
  const f = fixture(t); f.prepare(); f.start(); f.act('pause', { nextAction: 'Continue app' });
  f.act('display', { enabled: false, message: '关闭开发助手' }); assert.equal(f.state.paused, true); assert.equal(f.state.lock, 'R001');
  assert.throws(() => f.act('checkpoint', { id: 'R001', step: 1, nextAction: 'continue' }), /paused/);
  fs.writeFileSync(path.join(f.root, 'app.txt'), 'external edit'); f.act('resume', { message: '开始制作', source: 'continue original' });
  assert.equal(f.state.tasks[0].status, 'blocked'); assert.match(f.state.tasks[0].nextAction, /external/);
});
test('pause without drift resumes the existing step', t => {
  const f = fixture(t); f.prepare(); f.start(); f.act('pause', { nextAction: 'Continue app' }); f.act('resume', { message: '开始制作', source: 'continue' });
  assert.equal(f.state.tasks[0].status, 'running'); assert.equal(f.state.tasks[0].step, 1);
});
test('dependencies must complete; cancellation cannot satisfy a dependency', t => {
  const f = fixture(t); f.prepare(); f.add({ dependsOn: ['R001'] }); f.authorize('R002'); f.plan('R002');
  f.act('cancel', { id: 'R001', reason: 'user cancellation' });
  assert.throws(() => f.act('start', { id: 'R002' }), /Dependencies/);
  assert.equal(f.state.tasks[0].status, 'cancelled');
});
test('unknown dependency is rejected atomically', t => {
  const f = fixture(t); const before = structuredClone(f.state);
  assert.throws(() => f.add({ dependsOn: ['R999'] }), /Unknown dependency/); assert.deepEqual(f.state, before);
});
test('completed tasks survive messages until explicit round acceptance and archive', t => {
  const f = fixture(t); f.prepare(); f.start(); f.finish();
  f.act('display', { enabled: true, message: '开发助手' }); f.act('context', { session: 'later-message' });
  assert.equal(f.state.tasks[0].status, 'completed'); assert.equal(f.state.lock, null);
  assert.throws(() => f.act('new-round'), /Close/);
  f.act('round-verification',{result:'passed',source:'fixture test',verification:'final regression',artifact:'.smartbuild/evidence/result.txt',coverage:[{id:'R001',criterion:0,result:'passed'}]});
  f.act('close-round', { source: 'accepted local artifact', artifact: '.smartbuild/evidence/result.txt' });
  f.act('new-round'); assert.equal(f.state.tasks.length, 0); assert.equal(f.state.archives[0].tasks[0].id, 'R001');
  f.add(); assert.equal(f.state.tasks[0].id, 'R002');
});
test('failed business evidence supersedes earlier success', t => {
  const f = fixture(t); f.prepare(); f.start(); f.act('verify', { id: 'R001' });
  f.proof('business'); f.proof('business', { result: 'failed' });
  assert.throws(() => f.act('deliver', { id: 'R001' }), /Business evidence/);
});
test('source changes and evidence tampering invalidate passed results', t => {
  const f = fixture(t); f.prepare(); f.start(); f.proof('business');
  fs.writeFileSync(path.join(f.root, 'app.txt'), 'changed'); assert.equal(summary(f.state, f.root).checks[0].evidence.business, false);
  f.proof('business'); fs.appendFileSync(path.join(f.root, '.smartbuild/evidence/result.txt'), 'altered');
  assert.equal(summary(f.state, f.root).checks[0].evidence.business, false);
});
test('a shared scope changed by a later task requires regression evidence before round close', t => {
  const f = fixture(t); f.prepare(); f.start(); f.finish(); fs.appendFileSync(path.join(f.root, 'app.txt'), 'later task');
  assert.throws(() => f.act('close-round', { source: 'accept', artifact: '.smartbuild/evidence/result.txt' }), /round verification|regression/);
});
test('wrong repository, CLI-only and partial cognition receipts are rejected', t => {
  const f = fixture(t, { aociRequired: true }); f.prepare();
  assert.throws(f.start, /cognition/);
  for (const change of [{ projectRoot: os.tmpdir() }, { source: 'cli' }, { complete: false }, { delivered: false }]) {
    assert.throws(() => f.proof('cognition_delivery', { receipt: { ...f.receipt, ...change } }), /mismatch|MCP|Partial/);
  }
});
test('delivery and alignment must refer to the same cognition identity', t => {
  const f = fixture(t, { aociRequired: true }); f.prepare(); f.cognition({ identity: 'other-index' });
  assert.throws(f.start, /cognition/);
});
test('system decisions require full-system reliability while bounded tasks may proceed', t => {
  const f = fixture(t, { aociRequired: true, cognitionScope: 'system' }); f.prepare(); f.cognition();
  assert.throws(f.start, /cognition/); f.cognition({ fullSystemReliable: true }); f.start();
});
test('compaction blocks executing AOCI task and requires fresh current-session cognition', t => {
  const f = fixture(t, { aociRequired: true }); f.prepare(); f.cognition(); f.start();
  f.act('context', { session: 'compaction-1' }); assert.equal(f.state.tasks[0].status, 'blocked');
  assert.throws(() => f.act('verify', { id: 'R001' }), /blocked/);
  assert.throws(() => f.act('unblock', { id: 'R001', reason: 'resume' }), /cognition/);
  f.cognition(); f.act('recover',{id:'R001',reviewed:true,artifact:'.smartbuild/evidence/result.txt',reason:'fixture recovery',nextAction:'continue'}); f.act('unblock', { id: 'R001', reason: 'fresh delivery' }); assert.equal(f.state.tasks[0].status, 'running');
});
test('compaction while paused cannot be bypassed by resume', t => {
  const f = fixture(t, { aociRequired: true }); f.prepare(); f.cognition(); f.start();
  f.act('pause', { nextAction: 'Continue' }); f.act('context', { session: 'compaction-2' }); f.act('resume', { message: '开始制作', source: 'continue' });
  assert.equal(f.state.tasks[0].status, 'blocked');
});
test('bounded continuation requires runtime permission, source evidence, alignment and no recovery', t => {
  const f = fixture(t, { aociRequired: true }); f.prepare();
  const receipt = { ...f.receipt, continuation: 'full_system_claim_disabled_source_bound_task_continuation_allowed', boundedScope: 'app.txt only', thirdPartyConflict: false };
  assert.throws(() => f.proof('cognition_limit', { receipt: { ...receipt, recoveryPending: true } }), /recovery/);
  f.proof('cognition_limit', { receipt }); f.proof('cognition_alignment', { receipt }); assert.throws(f.start, /cognition/);
  f.proof('source_review'); f.start(); assert.equal(f.state.tasks[0].status, 'running');
});
test('business success survives maintenance failure, but completion remains blocked', t => {
  const f = fixture(t, { aociRequired: true }); f.prepare(); f.cognition(); f.start();
  fs.appendFileSync(path.join(f.root, 'app.txt'), 'implementation'); f.act('verify', { id: 'R001' }); f.proof('business');
  f.proof('cognition_alignment', { result: 'failed' });
  assert.equal(summary(f.state, f.root).checks[0].evidence.business, true);
  f.review();
  assert.throws(() => f.act('deliver', { id: 'R001' }), /alignment/);
  f.proof('cognition_alignment', { receipt: f.receipt }); f.act('deliver', { id: 'R001' });
});
test('pending external operations cannot be repeated or completed before reconciliation', t => {
  const f = fixture(t, { deliveries: ['local', 'git'] }); f.prepare(); f.start(); f.act('verify', { id: 'R001' }); f.proof('business'); f.review(); f.act('deliver', { id: 'R001' });
  f.act('operation-start', { id: 'R001', operation: 'git', key: 'push-1', target: 'fixture remote/ref' });
  assert.throws(() => f.act('operation-start', { id: 'R001', operation: 'git', key: 'push-1', target: 'fixture' }), /pending external operation/);
  assert.throws(() => f.act('operation-start', { id: 'R001', operation: 'git', key: 'push-2', target: 'fixture' }), /pending external operation/);
  f.proof('local'); f.proof('git'); assert.throws(() => f.act('complete', { id: 'R001' }), /reconciled/);
  f.act('operation-finish', { id: 'R001', key: 'push-1', result: 'succeeded', reason: 'verified remote', artifact: '.smartbuild/evidence/result.txt' });
  assert.throws(() => f.act('operation-start', { id: 'R001', operation: 'git', key: 'push-1', target: 'fixture' }), /already recorded/);
  f.act('complete', { id: 'R001' });
});
test('unrequested delivery cannot run with local-only authorization', t => {
  const f = fixture(t); f.prepare(); f.start(); f.act('verify', { id: 'R001' }); f.proof('business'); f.review(); f.act('deliver', { id: 'R001' });
  assert.throws(() => f.act('operation-start', { id: 'R001', operation: 'deploy', key: 'x', target: 'prod' }), /authorization/);
});
test('phase changes require evidence and adjacent progress, never task completion', t => {
  const f = fixture(t); f.prepare(); f.start(); f.finish(); assert.equal(f.state.phase, null);
  const basis = { source: 'verified project assessment', reason: 'phase evidence', artifact: '.smartbuild/evidence/result.txt' };
  f.act('phase', { phase: 2, ...basis }); assert.throws(() => f.act('phase', { phase: 4, ...basis }), /adjacent/);
  f.act('phase', { phase: 3, ...basis }); assert.throws(() => f.act('phase', { phase: 1, ...basis }), /adjacent/);
});
test('path traversal and administrative watch scopes are refused', t => {
  const f = fixture(t);
  assert.throws(() => fingerprint(f.root, ['../outside']), /escapes/);
  assert.throws(() => fingerprint(f.root, ['.smartbuild']), /Administrative/);
  f.prepare(); assert.throws(() => f.proof('business', { artifact: '.smartbuild/evidence/../../../outside' }), /escapes/);
});
test('directory fingerprints detect additions and deletions, ignoring runtime bookkeeping', t => {
  const f = fixture(t); const base = fingerprint(f.root, ['.']);
  fs.writeFileSync(path.join(f.root, 'auto-dev-state.json.lock'), 'lock'); assert.equal(fingerprint(f.root, ['.']), base);
  fs.writeFileSync(path.join(f.root, 'new.txt'), 'new'); assert.notEqual(fingerprint(f.root, ['.']), base);
  fs.unlinkSync(path.join(f.root, 'new.txt')); assert.equal(fingerprint(f.root, ['.']), base);
});
test('disk transactions reject stale revisions, never steal locks, and preserve old state on error', t => {
  const f = fixture(t); initialize(f.root, 'Fixture', 'session-1');
  transact(f.root, { action: 'display', enabled: true, message: '开发助手', expectedRevision: 0 });
  const prior = fs.readFileSync(path.join(f.root, 'auto-dev-state.json'), 'utf8');
  assert.throws(() => transact(f.root, { action: 'display', enabled: false, message: '关闭开发助手', expectedRevision: 0 }), /Revision/);
  assert.equal(fs.readFileSync(path.join(f.root, 'auto-dev-state.json'), 'utf8'), prior);
  fs.writeFileSync(path.join(f.root, 'auto-dev-state.json.lock'), 'other writer');
  assert.throws(() => transact(f.root, { action: 'display', enabled: false, message: '关闭开发助手', expectedRevision: 1 }), /EEXIST/);
  assert.equal(fs.readFileSync(path.join(f.root, 'auto-dev-state.json.lock'), 'utf8'), 'other writer');
});
test('legacy ledger and copied checkout identity cannot be silently replaced', t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.root, 'auto-dev-ledger.md'), 'existing');
  assert.throws(() => initialize(f.root, 'Fixture', 'session-1'), /Legacy/);
  const altered = { ...f.state, project: { ...f.state.project, root: os.tmpdir() } };
  assert.throws(() => transition(altered, { action: 'display', enabled: true, message: '开发助手', expectedRevision: 0 }, f.root), /identity/);
});
test('CLI init/show/apply persist actual state without a service', t => {
  const f = fixture(t); const script = path.resolve('skills/auto-dev/scripts/task-runtime.mjs');
  const invoke = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', windowsHide: true });
  assert.equal(invoke('init', f.root, 'Fixture', 'session-1').status, 0);
  fs.writeFileSync(path.join(f.root, 'request.json'), JSON.stringify({ action: 'display', enabled: true, message: '开发助手', expectedRevision: 0 }));
  assert.equal(invoke('apply', f.root, path.join(f.root, 'request.json')).status, 0);
  const shown = invoke('show', f.root); assert.equal(shown.status, 0); assert.equal(JSON.parse(shown.stdout).display, true);
  assert.equal(readState(f.root).revision, 1);
});
test('skill catalog discovers roots, exposes duplicate names, and never runs skill scripts', t => {
  const f = fixture(t);
  for (const name of ['one', 'two']) {
    fs.mkdirSync(path.join(f.root, name, 'demo'), { recursive: true });
    fs.writeFileSync(path.join(f.root, name, 'demo/SKILL.md'), '---\nname: demo\ndescription: |\n  Metadata only\n  no execution\n---\nDO NOT EXECUTE THIS BODY');
  }
  const result = catalog([path.join(f.root, 'one'), path.join(f.root, 'two')]);
  assert.equal(result.length, 2); assert.ok(result.every(x => x.ambiguous && x.description.includes('Metadata only')));
});
test('AOCI probe never infers MCP delivery from CLI or index file presence', t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.root, 'aoci.txt'), 'not a live index');
  const facts = probe(f.root); assert.deepEqual(facts.assets, ['aoci.txt']); assert.equal(facts.mcp, 'unverified');
  const node = probe(f.root, process.execPath); assert.equal(node.cli, 'available'); assert.equal(node.contractMatch, false); assert.equal(node.cognitionDelivery, 'unverified');
});

const invalidStartMessages = [undefined, null, 123, '', '执行', '开始执行', '继续执行', '做吧', '按这个做', '可以', '确认', '继续', '恢复', '开始制作。', '请开始制作', '开始制作 R001', '开始 制作', '“开始制作”', '\x60开始制作\x60', '\x60\x60\x60\n开始制作\n\x60\x60\x60', '> 开始制作', '开始制作\n新需求', '开始制作\u200b'];
for (const message of invalidStartMessages) {
  test('only the standalone command can authorize or resume: '+JSON.stringify(message), t => {
    const f=fixture(t); f.add(); f.plan('R001'); const before=structuredClone(f.state);
    assert.throws(()=>f.act('authorize',{id:'R001',operations:['local'],source:'source says 开始制作',message}), /instruction|standalone|message|Quoted/i);
    assert.deepEqual(f.state,before); assert.throws(f.start,/authorization/);
    f.authorize(); f.start(); f.act('pause',{nextAction:'original checkpoint'}); const paused=structuredClone(f.state);
    assert.throws(()=>f.act('resume',{source:'continue original',message}),/instruction|standalone|message|Quoted/i); assert.deepEqual(f.state,paused);
    assert.equal(f.state.lock,'R001');
  });
}
test('standalone command trims only outer whitespace and preserves resume evidence', t=>{
 const f=fixture(t); f.add(); f.plan('R001');
 f.act('authorize',{id:'R001',operations:['local'],source:'user message 1',message:' \n开始制作\t'}); f.start();
 f.act('pause',{nextAction:'checkpoint'}); f.act('resume',{source:'user message 2',message:'\r\n开始制作  '});
 assert.equal(f.state.tasks[0].status,'running');
 assert.equal(f.state.tasks[0].history.at(-1).resume.source,'user message 2');
 assert.deepEqual(f.state.tasks[0].authorization.operations,['local']);
});
test('legacy free-form authorization cannot bypass start, resume or continuation',t=>{
 const f=fixture(t);f.prepare(); const auth=f.state.tasks[0].authorization; delete auth.gate; delete auth.message;
 assert.throws(f.start,/valid user authorization/);
 f.authorize();f.start();f.act('pause',{nextAction:'checkpoint'}); delete f.state.tasks[0].authorization.gate;
 assert.throws(()=>f.act('resume',{message:'开始制作',source:'user'}),/valid user authorization/);
 assert.equal(f.state.paused,true);
});

test('rejected gate leaves the persisted ledger and task lock unchanged',t=>{
 const f=fixture(t); f.prepare(); f.start(); f.act('pause',{nextAction:'checkpoint'});
 const file=path.join(f.root,'auto-dev-state.json');fs.writeFileSync(file,JSON.stringify(f.state));const before=fs.readFileSync(file,'utf8');
 assert.throws(()=>transact(f.root,{action:'resume',expectedRevision:f.state.revision,source:'user',message:'> 继续执行'}),/Quoted/);
 assert.equal(fs.readFileSync(file,'utf8'),before);assert.equal(fs.existsSync(file+'.lock'),false);
 assert.equal(readState(f.root).lock,'R001'); assert.equal(readState(f.root).paused,true);
});

test('explicit handoff keeps a blocked task and its checkpoint while starting independent work', t => {
  const f = fixture(t); f.prepare(); f.start();
  f.act('block', { id: 'R001', reason: 'External service unavailable' });
  const checkpoint = structuredClone(f.state.tasks[0].checkpoint);
  f.add({ title: 'Independent library' }); f.authorize('R002'); f.plan('R002');
  const request = { id: 'R001', target: 'R002', message: '开始制作', source: 'User requests independent work', reason: 'Separate local scope' };
  assert.throws(() => f.act('handoff', { ...request, message: '就是这样' }), /开始制作/);
  f.act('handoff', request);
  assert.equal(f.state.lock, 'R002');
  assert.equal(f.state.tasks[0].status, 'running');
  const previous = f.state.tasks.find(task => task.id === 'R001');
  assert.equal(previous.status, 'blocked'); assert.deepEqual(previous.checkpoint, checkpoint);
  assert.equal(previous.history.at(-1).handoff.to, 'R002');
  f.act('verify', { id: 'R002' }); f.audit('R002');
  for (const kind of ['business', 'local']) f.act('evidence', { id: 'R002', kind, result: 'passed', summary: 'fixture', artifact: '.smartbuild/evidence/result.txt' });
  f.review('R002'); f.act('deliver', { id: 'R002' }); f.act('complete', { id: 'R002' });
  assert.equal(f.state.lock, 'R001'); assert.equal(f.state.tasks.find(t => t.id === 'R001').status, 'blocked');
});
test('handoff cannot bypass running work, pause, authorization, dependencies or pending operations', t => {
  for (const condition of ['running', 'paused', 'unauthorized', 'dependency', 'pending']) {
    const f = fixture(t); f.prepare(); f.start();
    if (condition === 'pending') { f.act('verify', { id: 'R001' }); f.proof('business'); f.review(); f.act('deliver', { id: 'R001' }); f.act('operation-start', { id: 'R001', key: 'pending-1', operation: 'local', target: 'fixture' }); }
    if (condition !== 'running') f.act('block', { id: 'R001', reason: 'Fixture block' });
    if (condition === 'paused') f.act('pause', { nextAction: 'wait' });
    f.add({ title: 'Second', dependsOn: condition === 'dependency' ? ['R001'] : [] });
    if (condition !== 'unauthorized') f.authorize('R002');
    f.plan('R002');
    assert.throws(() => f.act('handoff', { id: 'R001', target: 'R002', message: '开始制作', source: 'fixture', reason: 'fixture' }));
    assert.equal(f.state.lock, 'R001');
  }
});

test('a blocked queue head can be deferred so the round and queue keep moving', t => {
  const f = fixture(t); f.prepare(); f.start();
  f.act('block', { id: 'R001', reason: 'awaiting external MCP service' });
  f.add({ title: 'Second local task', scope: 'app.txt only', acceptance: ['observable result'], watch: ['app.txt'] });
  assert.throws(() => f.act('start', { id: 'R002' }), /skip queue|steal lock/);
  assert.throws(() => f.act('defer', { id: 'R002', reason: 'wrong head' }), /blocked/);
  f.act('defer', { id: 'R001', reason: 'awaiting external MCP service' });
  assert.equal(f.state.tasks[0].status, 'deferred');
  assert.equal(f.state.lock, 'R002');
  assert.deepEqual(f.state.round.carryOver, ['R001']);
  f.authorize('R002'); f.plan('R002'); f.act('start', { id: 'R002' }); f.act('verify', { id: 'R002' }); f.audit('R002');
  for (const kind of ['business', 'local']) f.act('evidence', { id: 'R002', kind, result: 'passed', summary: 'fixture', artifact: '.smartbuild/evidence/result.txt' });
  f.review('R002'); f.act('deliver', { id: 'R002' }); f.act('complete', { id: 'R002' });
  f.act('round-verification',{result:'passed',source:'fixture test',verification:'final regression',artifact:'.smartbuild/evidence/result.txt',coverage:[{id:'R002',criterion:0,result:'passed'}]});
  f.act('close-round', { source: 'fixture round acceptance', artifact: '.smartbuild/evidence/result.txt' });
  f.act('new-round');
  const carried = f.state.tasks.find(task => task.id === 'R001');
  assert.ok(carried, 'a deferred task must return in the next round with its original id');
  assert.equal(carried.round, 2);
  assert.equal(carried.status, 'blocked');
  assert.equal(f.state.archives.length, 1);
  assert.equal(f.state.archives[0].tasks.some(task => task.id === 'R001'), false);
});

test('deferred tasks never count as completed and cannot be started directly', t => {
  const f = fixture(t); f.prepare(); f.start(); f.act('block', { id: 'R001', reason: 'external dependency' });
  f.act('defer', { id: 'R001', reason: 'external dependency' });
  assert.throws(() => f.act('start', { id: 'R001' }), /not queued/);
  assert.throws(() => f.act('complete', { id: 'R001' }), /lock/);
});

test('amended blocked task restarts from its new plan instead of stale resume phase', t => {
  for (const {phase, paused} of ['running', 'verifying', 'delivering'].flatMap(phase => [false, true].map(paused => ({phase, paused})))) {
    const f = fixture(t); f.prepare(); f.start();
    if (phase !== 'running') f.act('verify', { id: 'R001' });
    if (phase === 'delivering') { f.proof('business'); f.review(); f.act('deliver', { id: 'R001' }); }
    f.act('block', { id: 'R001', reason: 'source change requires replan' });
    if (paused) f.act('pause', { nextAction: 'replan after pause' });
    f.act('amend', { id: 'R001', scope: 'revised app task', acceptance: ['reverified result'], watch: ['app.txt'], reason: 'explicit revised scope' });
    f.authorize(); f.plan('R001');
    if (paused) {
      assert.equal(f.state.paused, true);
      f.act('resume', { message: '开始制作', source: 'explicit fixture resume' });
    } else f.act('unblock', { id: 'R001', reason: 'new scope authorized and planned' });
    assert.equal(f.state.tasks[0].status, 'queued', phase);
    assert.equal(f.state.tasks[0].step, 0);
    f.start();
    assert.equal(f.state.tasks[0].status, 'running');
    assert.equal(f.state.tasks[0].step, 1);
  }
});
