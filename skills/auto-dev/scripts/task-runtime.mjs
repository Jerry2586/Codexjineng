import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { routeTransition, diagnose } from './skill-router.mjs';
import { assertStepReady, assertWorkflowReady, auditTransition, workflowReport, recoveryReady } from './workflow-audit.mjs';
const auditHelpers = {artifact, fingerprint, localPath};

// This records operator-supplied evidence; it cannot certify model comprehension or test truth.
const FILE = 'auto-dev-state.json';
const TERMINAL = new Set(['completed', 'cancelled']);
const STATES = new Set(['recorded', 'queued', 'running', 'paused', 'blocked', 'verifying', 'delivering', ...TERMINAL]);
const OPS = new Set(['local', 'git', 'ci', 'release', 'install', 'deploy']);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const insist = (condition, message) => { if (!condition) throw new Error(message); };
const text = (value, label) => { insist(typeof value === 'string' && value.trim(), `${label} must be nonempty`); return value; };
const strings = (value, label, empty = false) => {
  insist(Array.isArray(value) && (empty || value.length > 0), `${label} must be an array`);
  value.forEach(item => text(item, label));
  insist(new Set(value).size === value.length, `${label} contains duplicates`);
  return value;
};
const same = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
export const canonicalRoot = root => fs.realpathSync.native(root);
function localPath(root, relative, mustExist = true) {
  text(relative, 'relative path');
  insist(!path.isAbsolute(relative) && !relative.includes('\\'), 'Use repository-relative paths with /');
  const target = path.resolve(root, relative);
  const rel = path.relative(root, target);
  insist(!rel.startsWith('..') && !path.isAbsolute(rel), 'Path escapes project');
  let probe = root;
  for (const part of rel.split(path.sep).filter(Boolean)) {
    probe = path.join(probe, part);
    if (!fs.existsSync(probe)) { insist(!mustExist, `Missing path: ${relative}`); break; }
    insist(!fs.lstatSync(probe).isSymbolicLink(), `Symlink not accepted: ${relative}`);
  }
  return target;
}
const excluded = new Set(['.git', '.smartbuild', 'node_modules', FILE, 'auto-dev-ledger.md']);
const administrative = part => excluded.has(part) || part.startsWith(`${FILE}.`);
export function fingerprint(root, watch) {
  strings(watch, 'watch');
  const files = new Map();
  function visit(absolute) {
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    if (relative.split('/').some(administrative)) return;
    insist(files.size < 50000, 'Scope too large; choose bounded watch paths');
    if (!fs.existsSync(absolute)) { files.set(relative, 'missing'); return; }
    const stat = fs.lstatSync(absolute);
    insist(!stat.isSymbolicLink(), `Symlink in watched scope: ${relative}`);
    if (stat.isDirectory()) {
      files.set(`${relative}/`, 'directory');
      for (const name of fs.readdirSync(absolute).sort()) visit(path.join(absolute, name));
    } else {
      insist(stat.isFile(), `Unsupported input: ${relative}`);
      files.set(relative, sha(fs.readFileSync(absolute)));
    }
  }
  for (const relative of watch) {
    insist(!relative.split('/').some(administrative), 'Administrative paths cannot be watched');
    visit(localPath(root, relative, false));
  }
  return sha(JSON.stringify([...files].sort(([a], [b]) => a.localeCompare(b, 'en'))));
}
function artifact(root, relative) {
  insist(typeof relative === 'string' && relative.startsWith('.smartbuild/evidence/'), 'Evidence must be in .smartbuild/evidence/');
  insist(path.posix.normalize(relative).startsWith('.smartbuild/evidence/'), 'Evidence escapes evidence directory');
  const target = localPath(root, relative);
  insist(fs.statSync(target).isFile() && fs.statSync(target).size > 0, 'Evidence file must be nonempty');
  return { path: relative, sha256: sha(fs.readFileSync(target)) };
}
const allTasks = state => [...state.archives.flatMap(round => round.tasks), ...state.tasks];
function taskFor(state, id) {
  const task = state.tasks.find(item => item.id === id);
  insist(task, `Unknown current-round task: ${id}`);
  return task;
}
export function validateState(state, root) {
  insist(state.schemaVersion === 1, 'Unsupported state schema');
  insist(same(state.project.root, canonicalRoot(root)), 'Project identity mismatch; do not reuse another checkout state');
  insist(Number.isSafeInteger(state.revision) && state.revision >= 0, 'Invalid revision');
  insist(Array.isArray(state.tasks) && Array.isArray(state.archives), 'Invalid task collection');
  const tasks = allTasks(state);
  insist(new Set(tasks.map(t => t.id)).size === tasks.length, 'Duplicate task IDs');
  for (const task of tasks) {
    insist(/^R\d{3,}$/.test(task.id) && STATES.has(task.status), 'Invalid task');
    for (const dep of task.dependsOn) insist(tasks.some(item => item.id === dep), `Unknown dependency: ${dep}`);
    const seen = new Set();
    const walk = id => {
      insist(!seen.has(id), 'Dependency cycle'); seen.add(id);
      for (const dep of tasks.find(item => item.id === id).dependsOn) walk(dep);
      seen.delete(id);
    };
    walk(task.id);
  }
  if (state.lock) insist(state.tasks.some(t => t.id === state.lock && !TERMINAL.has(t.status)), 'Invalid task lock');
  insist(state.tasks.filter(t => ['running', 'verifying', 'delivering', 'paused'].includes(t.status)).every(t => t.id === state.lock), 'Only the locked task can execute');
  return state;
}
export function initialState(root, name, session) {
  return { schemaVersion: 1, revision: 0, project: { id: crypto.randomUUID(), name: text(name, 'name'), root: canonicalRoot(root) },
    phase: null, display: false, session: text(session, 'session'), paused: false, lock: null,
    round: { id: 1, status: 'open' }, nextId: 1, tasks: [], archives: [], updatedAt: now() };
}
export function usableEvidence(state, task, kind, root, current = true) {
  const candidates = task.evidence.filter(e => e.kind === kind && e.planVersion === task.planVersion);
  const proof = candidates.at(-1); // A later failure supersedes an earlier success.
  if (!proof || proof.result !== 'passed') return false;
  try {
    if (artifact(root, proof.artifact.path).sha256 !== proof.artifact.sha256) return false;
    if (current && fingerprint(root, task.watch) !== proof.fingerprint) return false;
    if (['cognition_delivery', 'cognition_limit', 'source_review'].includes(kind) && proof.session !== state.session) return false;
    return true;
  } catch { return false; }
}
export function isStartCommand(message) {
  return typeof message === 'string' && message.trim() === '开始制作';
}
function requireStartCommand(message) {
  insist(isStartCommand(message), 'Implementation requires the standalone user message: 开始制作');
}
function authorized(task, operation = 'local') {
  insist(task.authorization?.gate === 'exact-start-v1' && isStartCommand(task.authorization.message), 'Task lacks exact-start authorization');
  insist(task.authorization?.planVersion === task.planVersion && task.authorization.operations.includes(operation), `Task lacks current ${operation} authorization`);
}
function cognitionReady(state, task, root, current = true) {
  const delivery = task.evidence.filter(e => e.kind === 'cognition_delivery' && e.planVersion === task.planVersion).at(-1);
  const alignment = task.evidence.filter(e => e.kind === 'cognition_alignment' && e.planVersion === task.planVersion).at(-1);
  if (usableEvidence(state, task, 'cognition_delivery', root, current)
      && (!current || delivery.receipt.identity === alignment?.receipt.identity)
      && (task.cognitionScope !== 'system' || delivery.receipt.fullSystemReliable === true)) return true;
  const limit = task.evidence.filter(e => e.kind === 'cognition_limit' && e.planVersion === task.planVersion).at(-1);
  return task.cognitionScope === 'bounded' && usableEvidence(state, task, 'cognition_limit', root, current)
    && usableEvidence(state, task, 'source_review', root, current)
    && (!current || limit.receipt.identity === alignment?.receipt.identity);
}
function ready(state, task, root) {
  insist(!state.paused, 'Project is paused');
  authorized(task);
  insist(task.dependsOn.every(id => allTasks(state).find(t => t.id === id)?.status === 'completed'), 'Dependencies incomplete or cancelled');
  insist(task.conflicts.length === 0, 'Unresolved conflicts');
  insist(task.steps.length > 0, 'Execution steps required');
  if (task.aociRequired) {
    insist(cognitionReady(state, task, root), 'Current-session cognition delivery or bounded continuation required');
    insist(usableEvidence(state, task, 'cognition_alignment', root), 'Current cognition alignment required');
  }
}
function verified(state, task, root, beforeDelivery = false) {
  insist(usableEvidence(state, task, 'business', root), 'Business evidence missing, failed, or stale');
  if (task.aociRequired) {
    insist(cognitionReady(state, task, root, false), 'Restore cognition for current session before verification');
    insist(usableEvidence(state, task, 'cognition_alignment', root), 'Cognition alignment missing, failed, or stale');
  }
  if (task.workflowVersion === 1 || task.status !== 'completed') assertWorkflowReady(task, root, auditHelpers, {beforeDelivery});
}
export function transition(original, request, root) {
  validateState(original, root);
  insist(request.expectedRevision === original.revision, 'Revision conflict; reload before retrying');
  const state = structuredClone(original);
  const action = text(request.action, 'action');
  const task = request.id ? taskFor(state, request.id) : null;
  const owned = () => { insist(task && state.lock === task.id, 'Action requires current task lock'); };
  const active = () => {
    owned(); insist(!state.paused && task.status !== 'blocked', 'Task paused or blocked'); authorized(task);
    insist(recoveryReady(state, task, root, auditHelpers), 'Current recovery review required');
    if (task.aociRequired) insist(cognitionReady(state, task, root, false), 'Restore cognition for current session');
  };
  const reason = () => text(request.reason, 'reason');
  switch (action) {
    case 'add': {
      insist(state.round.status === 'open', 'Close/archive previous round before adding');
      const dependsOn = strings(request.dependsOn ?? [], 'dependsOn', true);
      const watch = strings(request.watch, 'watch'); fingerprint(root, watch);
      const deliveries = strings(request.deliveries ?? ['local'], 'deliveries');
      insist(deliveries.every(op => OPS.has(op)), 'Unknown delivery kind');
      const item = { id: `R${String(state.nextId++).padStart(3, '0')}`, round: state.round.id,
        title: text(request.title, 'title'), scope: text(request.scope, 'scope'), acceptance: strings(request.acceptance, 'acceptance'),
        watch, dependsOn, conflicts: strings(request.conflicts ?? [], 'conflicts', true), deliveries,
        aociRequired: request.aociRequired === true, cognitionScope: request.cognitionScope ?? 'bounded', status: 'recorded', workflowVersion: 1, planVersion: 1, authorization: null,
        steps: [], step: 0, nextAction: 'Clarify scope and authorization', evidence: [], operations: [], history: [] };
      insist(['bounded', 'system'].includes(item.cognitionScope), 'Invalid cognition scope');
      state.tasks.push(item);
      state.lock ??= item.id; // Reserves queue order; it does not grant permission to execute.
      break;
    }
    case 'authorize': {
      insist(task && !TERMINAL.has(task.status), 'Cannot authorize closed task');
      const operations = strings(request.operations, 'operations');
      insist(operations.every(op => OPS.has(op)), 'Unknown operation');
      requireStartCommand(request.message);
      task.authorization = { gate: 'exact-start-v1', message: request.message, source: text(request.source, 'authorization source'), operations, planVersion: task.planVersion, at: now() };
      if (task.status === 'recorded') task.status = 'queued';
      break;
    }
    case 'amend': {
      insist(task && !TERMINAL.has(task.status), 'Cannot amend closed task');
      task.history.push({ at: now(), scope: task.scope, planVersion: task.planVersion, reason: reason() });
      task.scope = text(request.scope, 'scope'); task.acceptance = strings(request.acceptance, 'acceptance');
      task.watch = strings(request.watch, 'watch'); fingerprint(root, task.watch);
      if (request.aociRequired !== undefined) { insist(typeof request.aociRequired === 'boolean', 'aociRequired must be boolean'); task.aociRequired = request.aociRequired; }
      if (request.cognitionScope !== undefined) { insist(['bounded', 'system'].includes(request.cognitionScope), 'Invalid cognition scope'); task.cognitionScope = request.cognitionScope; }
      task.planVersion++; task.authorization = null; task.steps = []; task.step = 0;
      task.status = state.lock === task.id ? 'blocked' : 'recorded'; task.nextAction = 'Review revised scope and authorization';
      break;
    }
    case 'plan':
      insist(task && ['recorded', 'queued', 'blocked'].includes(task.status), 'Plan only before execution or after an amendment');
      insist(task.steps.length === 0, 'Amend the task before replacing a plan');
      insist(Array.isArray(request.steps) && request.steps.length, 'Steps required');
      for (const step of request.steps) {
        for (const key of ['title', 'input', 'output', 'verify']) text(step[key], `step.${key}`);
        insist(Array.isArray(step.skills ?? []), 'skills must be an array');
        for (const selection of step.skills ?? []) {
          for (const key of ['name', 'path', 'reason', 'sha256']) text(selection[key], 'skill.' + key);
          insist(path.isAbsolute(selection.path) && /^[a-f0-9]{64}$/.test(selection.sha256), 'Skill selection requires absolute path and content digest');
        }
      }
      task.steps = structuredClone(request.steps); task.step = 0; break;
    case 'start': {
      insist(task && ['queued', 'recorded'].includes(task.status), 'Task is not queued');
      const head = state.tasks.find(t => !TERMINAL.has(t.status));
      insist(head?.id === task.id && (!state.lock || state.lock === task.id), 'Cannot skip queue head or steal lock');
      ready(state, task, root); state.lock = task.id; task.status = 'running'; task.step = 1;
      task.checkpoint = { fingerprint: fingerprint(root, task.watch), at: now(), session: state.session };
      task.nextAction = task.steps[0].title; break;
    }
    case 'handoff': {
      owned(); requireStartCommand(request.message);
      insist(!state.paused && task.status === 'blocked', 'Handoff requires a blocked task, not a paused or running task');
      insist(!task.operations.some(op => op.status === 'pending'), 'Resolve pending operations before handoff');
      const target = taskFor(state, request.target);
      insist(target.id !== task.id && ['queued', 'recorded'].includes(target.status), 'Handoff target must be queued');
      ready(state, target, root);
      const record = { at: now(), handoff: { from: task.id, to: target.id, message: request.message, source: text(request.source, 'handoff source'), reason: reason() } };
      task.history.push(record); target.history.push(record);
      state.tasks = [target, ...state.tasks.filter(t => t.id !== target.id)];
      state.lock = target.id; target.status = 'running'; target.step = 1;
      target.checkpoint = { fingerprint: fingerprint(root, target.watch), at: now(), session: state.session };
      target.nextAction = target.steps[0].title;
      break;
    }
    case 'recover':
      owned(); authorized(task); insist(!TERMINAL.has(task.status), 'Cannot recover terminal task');
      auditTransition(state, task, request, root, auditHelpers); break;
    case 'adopt-workflow':
    case 'acceptance-result':
    case 'issue-open':
    case 'issue-resolve':
    case 'issue-reopen':
      active(); insist(['running','verifying','delivering'].includes(task.status), 'Task not executing');
      auditTransition(state, task, request, root, auditHelpers); break;
    case 'skill-select':
    case 'skill-outcome':
    case 'skill-switch':
      active(); routeTransition(state, task, request, root, { artifact, fingerprint }); break;
    case 'checkpoint':
      active(); insist(['running', 'verifying', 'delivering'].includes(task.status), 'Task not executing');
      insist(Number.isInteger(request.step) && request.step >= task.step && request.step <= task.steps.length, 'Invalid step');
      if (request.step > task.step) {
        insist(request.step === task.step + 1, 'Step advancement must be adjacent; cannot skip');
        assertStepReady(task, task.step, root, auditHelpers);
      }
      task.step = request.step; task.nextAction = text(request.nextAction, 'nextAction');
      task.checkpoint = { fingerprint: fingerprint(root, task.watch), at: now(), session: state.session }; break;
    case 'pause':
      state.paused = true;
      if (state.lock) {
        const locked = taskFor(state, state.lock);
        if (locked.status !== 'paused') {
          locked.pauseStatus = locked.status;
          if (locked.status !== 'blocked') locked.resumeStatus = locked.status;
        }
        locked.status = 'paused'; locked.nextAction = text(request.nextAction, 'nextAction');
        locked.checkpoint = { fingerprint: fingerprint(root, locked.watch), at: now(), session: state.session };
      }
      break;
    case 'resume': {
      insist(state.paused, 'Project is not paused'); requireStartCommand(request.message);
      const resumeSource = text(request.source, 'resume instruction');
      if (state.lock) authorized(taskFor(state, state.lock));
      state.paused = false;
      if (state.lock) {
        const locked = taskFor(state, state.lock);
        locked.history.push({ at: now(), resume: { message: request.message, source: resumeSource } });
        if (fingerprint(root, locked.watch) !== locked.checkpoint?.fingerprint) {
          locked.status = 'blocked'; locked.nextAction = 'Review external workspace changes';
        } else {
          // Starting or continuing implementation must re-check the current session after compaction.
          locked.status = locked.pauseStatus === 'blocked' ? 'blocked' : locked.resumeStatus ?? 'queued';
          if (!recoveryReady(state, locked, root, auditHelpers)) {
            locked.status = 'blocked'; locked.nextAction = 'Current recovery review required';
          } else locked.recoveryRequired = null;
          if (locked.aociRequired && !cognitionReady(state, locked, root, false)) {
            locked.status = 'blocked'; locked.nextAction = 'Restore cognition for current session';
          }
        }
      }
      break;
    }
    case 'block': owned(); if (task.status !== 'blocked') task.resumeStatus = task.status; task.status = 'blocked'; task.nextAction = reason(); break;
    case 'unblock':
      owned(); insist(task.status === 'blocked', 'Task is not blocked'); ready(state, task, root);
      insist(recoveryReady(state, task, root, auditHelpers), 'Current recovery review required');
      task.recoveryRequired = null;
      task.history.push({ at: now(), review: reason() });
      task.status = ['running', 'verifying', 'delivering'].includes(task.resumeStatus) ? task.resumeStatus : 'queued';
      task.checkpoint = { fingerprint: fingerprint(root, task.watch), at: now(), session: state.session }; break;
    case 'context': {
      const session = text(request.session, 'new session/compaction epoch');
      insist(session !== state.session, 'Context event requires a new epoch'); state.session = session;
      if (state.lock) {
        const locked = taskFor(state, state.lock);
        if (locked.workflowVersion === 1) locked.recoveryRequired = session;
        if ((locked.aociRequired || locked.workflowVersion === 1) && ['running', 'verifying', 'delivering'].includes(locked.status)) {
          locked.resumeStatus = locked.status; locked.status = 'blocked'; locked.nextAction = locked.aociRequired ? 'Restore cognition for current session' : 'Review recovery context and evidence';
        }
      }
      break;
    }
    case 'phase': {
      insist(Number.isInteger(request.phase) && request.phase >= 1 && request.phase <= 5, 'Invalid project phase');
      if (state.phase !== null) insist(request.phase === state.phase + 1 || (request.phase < state.phase && request.rework === true), 'Phase advance must be adjacent; rework must be explicit');
      state.phaseBasis = { artifact: artifact(root, request.artifact), reason: reason(), source: text(request.source, 'phase decision source'), at: now() };
      state.phase = request.phase; break;
    }
    case 'display': insist(typeof request.enabled === 'boolean', 'enabled must be boolean'); state.display = request.enabled; break;
    case 'resolve-conflicts':
      insist(task && !TERMINAL.has(task.status), 'Task must be active'); task.history.push({ at: now(), conflictResolution: reason() }); task.conflicts = []; break;
    case 'evidence': {
      insist(task && task.status !== 'cancelled' && state.round.status === 'open', 'Evidence requires an open-round task');
      const kind = request.kind;
      insist(['business', 'source_review', 'cognition_delivery', 'cognition_alignment', 'cognition_limit', ...OPS].includes(kind), 'Unknown evidence kind');
      insist(['passed', 'failed'].includes(request.result), 'Evidence result must be passed or failed');
      if (kind.startsWith('cognition_') && request.result === 'passed') {
        const receipt = request.receipt;
        insist(receipt && same(canonicalRoot(receipt.projectRoot), canonicalRoot(root)), 'AOCI runtime project mismatch');
        text(receipt.identity, 'cognition identity'); text(receipt.serviceVersion, 'MCP service version');
        insist(receipt.source === 'mcp', 'CLI/file presence does not prove MCP delivery or alignment');
        if (kind === 'cognition_delivery') insist(receipt.complete === true && receipt.delivered === true, 'Partial/check-only delivery is insufficient');
        if (kind === 'cognition_alignment') insist(receipt.aligned === true && receipt.recoveryPending === false, 'Alignment/recovery not confirmed');
        if (kind === 'cognition_limit') {
          insist(task.cognitionScope === 'bounded', 'Limited continuation cannot authorize system decisions');
          insist(receipt.continuation === 'full_system_claim_disabled_source_bound_task_continuation_allowed', 'Runtime continuation permission required');
          insist(receipt.aligned === true && receipt.recoveryPending === false && receipt.thirdPartyConflict === false, 'Limited continuation requires alignment without conflict or recovery');
          text(receipt.boundedScope, 'bounded source scope');
        }
      }
      task.evidence.push({ kind, result: request.result, summary: text(request.summary, 'evidence summary'),
        artifact: artifact(root, request.artifact), fingerprint: fingerprint(root, task.watch), planVersion: task.planVersion,
        session: state.session, at: now(), ...(request.receipt ? { receipt: structuredClone(request.receipt) } : {}) });
      break;
    }
    case 'verify': active(); insist(['running', 'verifying'].includes(task.status), 'Task not in verification'); task.status = 'verifying'; break;
    case 'deliver':
      active(); insist(task.status === 'verifying', 'Verify before delivery'); verified(state, task, root, true);
      task.status = 'delivering'; break;
    case 'operation-start':
      active(); insist(task.status === 'delivering', 'External operations only during delivery'); verified(state, task, root, true);
      authorized(task, request.operation); insist(task.deliveries.includes(request.operation), 'Operation is outside agreed delivery');
      insist(!task.operations.some(op => op.status === 'pending'), 'Reconcile pending external operation before starting another');
      text(request.key, 'idempotency key');
      insist(!task.operations.some(op => op.key === request.key), 'Operation already recorded; reconcile its effect before retrying');
      task.operations.push({ key: request.key, operation: request.operation, target: text(request.target, 'operation target'), status: 'pending', planVersion: task.planVersion, fingerprint: fingerprint(root, task.watch), at: now() }); break;
    case 'operation-finish': {
      owned(); const operation = task.operations.find(op => op.key === request.key);
      insist(operation?.status === 'pending', 'Operation is not pending');
      insist(['succeeded', 'not-applied'].includes(request.result), 'Reconcile to succeeded or not-applied');
      operation.artifact = artifact(root, request.artifact); operation.status = request.result; operation.summary = reason(); break;
    }
    case 'complete':
      active(); insist(task.status === 'delivering', 'Delivery step required'); verified(state, task, root);
      insist(task.step === task.steps.length, 'Remaining execution steps');
      for (const kind of task.deliveries) {
        authorized(task, kind); insist(usableEvidence(state, task, kind, root), `Missing or stale ${kind} delivery evidence`);
        if (kind !== 'local') insist(task.operations.some(op => op.operation === kind && op.status === 'succeeded' && op.planVersion === task.planVersion && op.fingerprint === fingerprint(root, task.watch)), `No reconciled ${kind} operation for current content`);
      }
      insist(!task.operations.some(op => op.status === 'pending'), 'Reconcile pending external operation');
      task.status = 'completed'; task.completedAt = now(); task.nextAction = 'Retain until round archive';
      state.lock = state.tasks.find(t => !TERMINAL.has(t.status))?.status === 'blocked' ? state.tasks.find(t => !TERMINAL.has(t.status)).id : null;
      break;
    case 'cancel':
      insist(task && !TERMINAL.has(task.status), 'Task must be active');
      insist(!task.operations.some(op => op.status === 'pending'), 'Reconcile pending operation before cancelling');
      task.history.push({ at: now(), cancelled: reason() }); task.status = 'cancelled'; if (state.lock === task.id) state.lock = null; break;
    case 'reorder': {
      insist(task && !TERMINAL.has(task.status) && !['running', 'paused', 'verifying', 'delivering', 'blocked'].includes(task.status), 'Cannot move executing/blocked task');
      reason(); const locked = state.tasks.find(t => t.id === state.lock);
      const rest = state.tasks.filter(t => t.id !== task.id);
      insist(Number.isInteger(request.position) && request.position >= 1 && request.position <= rest.length + 1, 'Invalid position');
      rest.splice(request.position - 1, 0, task);
      if (locked && ['running', 'paused', 'verifying', 'delivering', 'blocked'].includes(locked.status)) insist(rest.find(t => !TERMINAL.has(t.status)).id === locked.id, 'Cannot move ahead of running task');
      state.tasks = rest;
      if (!locked || ['recorded', 'queued'].includes(locked.status)) state.lock = rest.find(t => !TERMINAL.has(t.status))?.id ?? null;
      break;
    }
    case 'close-round':
      insist(!state.lock && state.tasks.length && state.tasks.every(t => TERMINAL.has(t.status)), 'Round has unfinished tasks');
      for (const item of state.tasks.filter(t => t.status === 'completed')) {
        verified(state, item, root);
        for (const kind of item.deliveries) insist(usableEvidence(state, item, kind, root), `Round requires current ${item.id} ${kind} evidence`);
      }
      state.round.status = 'closed'; state.round.acceptance = { source: text(request.source, 'round acceptance source'), artifact: artifact(root, request.artifact), at: now() }; break;
    case 'new-round':
      insist(state.round.status === 'closed' && !state.paused, 'Close and accept round before archiving');
      state.archives.push({ ...state.round, tasks: state.tasks }); state.tasks = [];
      state.round = { id: state.round.id + 1, status: 'open' }; break;
    default: throw new Error(`Unknown action: ${action}`);
  }
  state.revision++; state.updatedAt = now();
  return validateState(state, root);
}
function atomicSave(root, state) {
  const target = localPath(root, FILE, false);
  const temp = `${target}.${crypto.randomUUID()}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temp, 'wx'); fs.writeFileSync(fd, JSON.stringify(state, null, 2) + '\n'); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    validateState(JSON.parse(fs.readFileSync(temp, 'utf8')), root);
    fs.renameSync(temp, target);
    insist(fs.readFileSync(target, 'utf8') === JSON.stringify(state, null, 2) + '\n', 'State readback mismatch');
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
export function readState(project) {
  const root = canonicalRoot(project);
  return validateState(JSON.parse(fs.readFileSync(localPath(root, FILE), 'utf8')), root);
}
export function transact(project, request) {
  const root = canonicalRoot(project);
  const lockPath = localPath(root, `${FILE}.lock`, false);
  const fd = fs.openSync(lockPath, 'wx'); // Never steal a stale lock automatically.
  try {
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: now() }));
    const state = transition(readState(root), request, root); atomicSave(root, state); return state;
  } finally { fs.closeSync(fd); fs.unlinkSync(lockPath); }
}
export function initialize(project, name, session) {
  const root = canonicalRoot(project);
  insist(!fs.existsSync(path.join(root, FILE)), 'State already exists');
  insist(!['auto-dev-ledger.md', '.codex/auto-dev-ledger.md'].some(p => fs.existsSync(path.join(root, p))), 'Legacy ledger exists; explicitly reconcile/migrate before creating another authority');
  const fd = fs.openSync(localPath(root, `${FILE}.lock`, false), 'wx');
  try { insist(!fs.existsSync(path.join(root, FILE)), 'State already exists'); const state = initialState(root, name, session); atomicSave(root, state); return state; }
  finally { fs.closeSync(fd); fs.unlinkSync(path.join(root, `${FILE}.lock`)); }
}
export function summary(state, root) {
  return { ...state, checks: state.tasks.map(t => ({ id: t.id, workflow: workflowReport(t, root, auditHelpers), routing: t.routing ? diagnose(t, root, fingerprint(root, t.watch)) : null, evidence: Object.fromEntries(['business', 'source_review', 'cognition_delivery', 'cognition_alignment', 'cognition_limit', ...t.deliveries].map(kind => [kind, usableEvidence(state, t, kind, root)])) })) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [command, project, argument, session] = process.argv.slice(2);
    insist(project, 'Usage: task-runtime.mjs init <project> <name> <session> | show <project> | apply <project> <request.json>');
    const root = canonicalRoot(project);
    const state = command === 'init' ? initialize(root, argument, session)
      : command === 'show' ? summary(readState(root), root)
      : command === 'apply' ? transact(root, JSON.parse(fs.readFileSync(argument, 'utf8')))
      : (() => { throw new Error('Unknown command'); })();
    console.log(JSON.stringify(state, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
