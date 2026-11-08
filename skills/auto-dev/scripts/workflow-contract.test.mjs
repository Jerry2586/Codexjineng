import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isStartCommand, implementationInstruction, resumeInstruction, validAuthorization, panelMode } from './workflow-contract.mjs';
import { initialState, transition } from './task-runtime.mjs';

const scope = 'form submission';
const source = 'test user message';
const request = message => ({ message, source, instruction: { origin: 'user', intent: 'implement', scope, reason: 'The user described a complete change.' } });
const nonCommands = ['开始执行', '做吧', '开始执行做吧', '请开始执行', '执行', '开发', '开始吧', '按这个改', '修复全部问题', '帮我完成这个功能', '继续', '恢复', '开始制作。', '请开始制作', '开始制作，顺便加一个功能', '我说开始制作才开工'];
const quotedCommands = ['“开始制作”', '"开始制作"', "'开始制作'", '\x60开始制作\x60', '\x60\x60\x60\n开始制作\n\x60\x60\x60', '> 开始制作'];

test('only a standalone start command grants implementation authorization', () => {
  for (const message of ['开始制作', '  开始制作  ', '\n开始制作\r\n']) {
    assert.equal(isStartCommand(message), true);
    assert.equal(implementationInstruction(request(message), scope).gate, 'exact-start-v1');
    assert.doesNotThrow(() => resumeInstruction(request(message), scope));
  }
});

test('ordinary requests remain discussion even with an implementation assessment', () => {
  for (const message of nonCommands) {
    assert.equal(isStartCommand(message), false);
    assert.throws(() => implementationInstruction(request(message), scope), { name: 'Error' }, message);
  }
});

test('quoted commands and commands from other sources cannot grant authorization', () => {
  for (const message of quotedCommands) {
    assert.equal(isStartCommand(message), false);
    assert.throws(() => implementationInstruction(request(message), scope), { name: 'Error' }, message);
    assert.throws(() => resumeInstruction(request(message), scope), { name: 'Error' }, message);
  }
  for (const origin of ['tool', 'attachment', 'assistant']) {
    assert.throws(() => implementationInstruction({ ...request('开始制作'), origin }, scope));
    assert.throws(() => resumeInstruction({ ...request('开始制作'), origin }, scope));
  }
});

test('legacy natural-language authorizations cannot start or continue work', () => {
  const legacy = { ...request('按这个改'), gate: 'user-request-v2' };
  assert.equal(validAuthorization(legacy, scope), false);
  assert.equal(validAuthorization({ ...request('开始制作'), gate: 'user-request-v2' }, scope), false);
  assert.equal(validAuthorization({ message: '开始制作', source, gate: 'exact-start-v1' }, scope), true);
});

test('resume aliases and operator interpretations cannot release a pause', () => {
  for (const message of ['继续', '恢复', '继续执行', '继续做', '恢复原任务', '请接着上次做']) {
    assert.throws(() => resumeInstruction({ ...request(message), instruction: { origin: 'user', intent: 'resume', scope, reason: 'The user wants to continue.' } }, scope), { name: 'Error' }, message);
  }
});

test('panel controls cannot be used as implementation instructions', () => {
  assert.equal(panelMode({ message: '开发助手' }), 'full');
  assert.equal(panelMode({ enabled: true, firstShown: true, message: '关闭开发助手' }), 'none');
  for (const message of ['开发助手', '关闭开发助手', '记录需求', '查看队列表', '启动线路图', '转到第N阶段']) {
    assert.throws(() => implementationInstruction(request(message), scope), { name: 'Error' }, message);
  }
});

function fixture(t) {
  const parent = path.resolve(os.tmpdir(), 'auto-dev-start-gate-tests');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'case-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), parent);
    assert.ok(path.basename(root).startsWith('case-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(root, 'form.js'), 'export const valid = true;\n');
  let state = initialState(root, 'test fixture', 'start-gate-test');
  const apply = input => { state = transition(state, { ...input, expectedRevision: state.revision }, root); return state; };
  apply({ action: 'add', title: 'fix submission', scope, acceptance: ['successful submission'], watch: ['form.js'], aociRequired: false });
  apply({ action: 'plan', id: 'R001', steps: [{ title: 'fix', input: 'form', output: 'working form', verify: 'submission result', skills: [] }] });
  return { root, apply, get state() { return state; } };
}

test('runtime rejects an ordinary authorize request without mutating its state', t => {
  const f = fixture(t);
  const original = structuredClone(f.state);
  assert.throws(() => f.apply({ ...request('按这个改'), action: 'authorize', id: 'R001', operations: ['local'] }));
  assert.deepEqual(f.state, original);
  assert.equal(f.state.tasks[0].authorization, null);
});

test('runtime accepts the command, preserves a pause on discussion, and resumes on the command', t => {
  const f = fixture(t);
  f.apply({ action: 'authorize', id: 'R001', message: '开始制作', source, operations: ['local'] });
  f.apply({ action: 'start', id: 'R001' });
  f.apply({ action: 'pause', nextAction: 'resume the form fix' });
  const paused = structuredClone(f.state);
  assert.throws(() => f.apply({ action: 'resume', message: '继续', source }));
  assert.deepEqual(f.state, paused);
  f.apply({ action: 'resume', message: '开始制作', source });
  assert.equal(f.state.paused, false);
  assert.equal(f.state.tasks[0].status, 'running');
});

test('a persisted legacy request gate cannot start a queued runtime task', t => {
  const f = fixture(t);
  const state = structuredClone(f.state);
  state.tasks[0].status = 'queued';
  state.tasks[0].authorization = { ...request('按这个改'), gate: 'user-request-v2', operations: ['local'], planVersion: 1 };
  assert.throws(() => transition(state, { action: 'start', id: 'R001', expectedRevision: state.revision }, f.root));
});

test('scope amendments invalidate the command authorization until authorized again', t => {
  const f = fixture(t);
  f.apply({ action: 'authorize', id: 'R001', message: '开始制作', source, operations: ['local'] });
  f.apply({ action: 'amend', id: 'R001', scope: 'form and confirmation', acceptance: ['submission and confirmation'], watch: ['form.js'], reason: 'new product requirement' });
  assert.equal(f.state.tasks[0].authorization, null);
  assert.equal(f.state.tasks[0].planVersion, 2);
  assert.throws(() => f.apply({ ...request('开发'), action: 'authorize', id: 'R001', operations: ['local'] }));
  f.apply({ action: 'authorize', id: 'R001', message: '开始制作', source, operations: ['local'] });
  assert.equal(f.state.tasks[0].authorization.planVersion, 2);
});
