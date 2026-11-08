import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { readSkillMetadata, isBackupPath } from './skill-catalog.mjs';
import { refresh } from './build-profiles.mjs';
import { repository, relativeDirectory, fetchRepository, trackingRef, resolveCommit, snapshot } from './skill-library-git.mjs';

const ensure = (condition, message) => { if (!condition) throw new Error(message); };
const now = () => new Date().toISOString();
const digest = input => crypto.createHash('sha256').update(input).digest('hex');
const PROTECTED = new Set(['auto-dev', 'aoci-workflow']);
const equal = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const exists = p => { try { fs.lstatSync(p); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
export const isLibraryUpdateCommand = message => typeof message === 'string' && message.trim() === '技能库更新';
function noLinks(target) {
  let probe = path.resolve(target);
  for (;;) {
    if (exists(probe)) ensure(!fs.lstatSync(probe).isSymbolicLink(), 'Symlink/junction path is not supported: ' + probe);
    const parent = path.dirname(probe); if (parent === probe) break; probe = parent;
  }
  return path.resolve(target);
}
function within(root, target) {
  const relative = path.relative(root, target);
  ensure(relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative), 'Path escapes its managed directory');
  return noLinks(target);
}
function removeOwned(root, target) {
  within(root, target);
  // Verify the complete tree before recursive removal, including dangling links.
  if (exists(target)) {
    // Cleanup must also work for an oversized partial snapshot. Keep path/type safety
    // independent of the size limits used to admit a skill into the library.
    const verifyTree = folder => {
      const stat=fs.lstatSync(folder);
      ensure(!stat.isSymbolicLink(), 'Skill contains a symlink/junction');
      ensure(stat.isDirectory()||stat.isFile(), 'Skill contains unsupported files');
      if(stat.isDirectory())for(const name of fs.readdirSync(folder))verifyTree(path.join(folder,name));
    };
    verifyTree(target); fs.rmSync(target, { recursive: true, force: true });
  }
}
export function fileHash(directory) {
  noLinks(directory);
  ensure(exists(directory) && fs.statSync(directory).isDirectory(), 'Skill directory is missing');
  const files = []; let bytes = 0;
  const visit = (folder, prefix = '') => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const target = path.join(folder, entry.name), relative = prefix + entry.name;
      const stat = fs.lstatSync(target);
      ensure(!stat.isSymbolicLink(), 'Skill contains a symlink/junction');
      if (stat.isDirectory()) visit(target, relative + '/');
      else {
        ensure(stat.isFile(), 'Skill contains unsupported files');
        bytes += stat.size; ensure(bytes <= 32 * 1024 * 1024 && files.length < 5000, 'Skill exceeds supported size');
        files.push([relative, digest(fs.readFileSync(target)), process.platform === 'win32' ? 0 : stat.mode & 0o111]);
      }
    }
  };
  visit(directory); return digest(JSON.stringify(files));
}
function metadata(directory) {
  const match = readSkillMetadata(path.join(directory, 'SKILL.md'));
  ensure(match, 'Skill metadata could not be read');
  ensure(/^[a-z0-9][a-z0-9-]{0,63}$/.test(match.name), 'Skill name must use lowercase letters, numbers and hyphens');
  return { name: match.name, description: match.description };
}
function saveJSON(file, value) {
  noLinks(file);
  const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  const fd = fs.openSync(temporary, 'wx');
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  try { fs.renameSync(temporary, file); } finally { if (exists(temporary)) fs.unlinkSync(temporary); }
}
function copy(from, to) {
  fileHash(from); noLinks(to); ensure(!exists(to), 'Copy target already exists');
  // Use Unicode-safe filesystem operations for each path; verify the resulting tree.
  const visit = (source, target) => {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      const src = path.join(source, entry.name), dst = path.join(target, entry.name);
      if (entry.isDirectory()) visit(src, dst);
      else { fs.copyFileSync(src, dst, fs.constants.COPYFILE_EXCL); fs.chmodSync(dst, fs.statSync(src).mode); }
    }
  };
  visit(from, to); ensure(fileHash(from) === fileHash(to), 'Copied files failed verification');
}
function refreshProfiles(ctx, skillsRoot) {
  const corePath = path.join(skillsRoot, 'auto-dev');
  if (!exists(path.join(corePath, 'SKILL.md'))) return;
  const target = noLinks(path.join(corePath, 'references/profiles.json'));
  const core = ctx.state.skills.find(item => equal(item.path, corePath));
  const wasClean = core && fileHash(corePath) === core.installedHash;
  const result = refresh(skillsRoot, target);
  if (result.changed && wasClean) { core.installedHash = fileHash(corePath); save(ctx); }
}
function validId(id) { ensure(typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id) && !/^(con|prn|aux|nul|com\d|lpt\d)$/.test(id), 'Invalid library skill ID'); return id; }
function openLibrary(options = {}, create = false) {
  const root = noLinks(options.library ?? path.join(os.homedir(), '.agents', 'skill-library'));
  if (create) fs.mkdirSync(root, { recursive: true });
  const registry = path.join(root, 'registry.json');
  noLinks(registry);
  const state = exists(registry) ? JSON.parse(fs.readFileSync(registry, 'utf8')) : { schemaVersion: 1, revision: 0, skills: [], runs: [] };
  ensure(state.schemaVersion === 1 && Array.isArray(state.skills) && Array.isArray(state.runs), 'Unsupported library registry');
  ensure(new Set(state.skills.map(item => item.id)).size === state.skills.length, 'Duplicate library IDs');
  for (const item of state.skills) { validId(item.id); ensure(path.isAbsolute(item.path), 'Library target must be absolute'); }
  return { root, registry, state };
}
function save(ctx) { ctx.state.revision++; saveJSON(ctx.registry, ctx.state); }
function locked(options, callback, recovery = false) {
  let ctx = openLibrary(options, true);
  const lock = path.join(ctx.root, 'library.lock');
  let fd;
  try { fd = fs.openSync(lock, 'wx'); } catch (e) { if (e.code === 'EEXIST') throw new Error('Library is locked; inspect the owner before removing a stale lock'); throw e; }
  fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: now() }));
  try {
    ctx = openLibrary(options); // Reload after acquiring the lock to avoid a stale read/write race.
    ensure(recovery || !exists(path.join(ctx.root, 'pending.json')), 'Interrupted operation found; run recover before modifying the library');
    return callback(ctx);
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
function staging(ctx) {
  const root = noLinks(path.join(ctx.root, 'staging'));
  fs.mkdirSync(root, { recursive: true });
  return fs.mkdtempSync(path.join(root, 'skill-'));
}
function targetPath(ctx, request, id) {
  const root = noLinks(request.skillsRoot ?? path.join(os.homedir(), '.agents', 'skills'));
  ensure(!equal(root, ctx.root) && !root.startsWith(ctx.root + path.sep) && !ctx.root.startsWith(path.join(root, id) + path.sep), 'Library storage and skill target must be separate');
  const target = within(root, path.join(root, validId(id)));
  ensure(!ctx.state.skills.some(item => item.id !== id && equal(item.path, target)), 'Target already belongs to another skill');
  return target;
}
function currentStatus(item) {
  try {
    const actual = fileHash(item.path);
    return { ...item, localModified: actual !== item.installedHash, status: item.source ? item.baselineVerified ? 'tracked' : 'baseline-unverified' : 'source-pending' };
  } catch (error) { return { ...item, localModified: true, status: 'unavailable', error: error.message }; }
}
export function listLibrary(options) {
  const ctx = openLibrary(options);
  return { library: ctx.root, revision: ctx.state.revision, pending: exists(path.join(ctx.root, 'pending.json')), skills: ctx.state.skills.map(currentStatus), lastRun: ctx.state.runs.at(-1) ?? null };
}
export function scanLibrary(options, roots) {
  return locked(options, ctx => {
    const results = [];
    for (const root of roots) {
      if (isBackupPath(root)) continue;
      noLinks(root);
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || isBackupPath(path.join(root,entry.name)) || !exists(path.join(root, entry.name, 'SKILL.md'))) continue;
        const target = noLinks(path.resolve(root, entry.name));
        const previous = ctx.state.skills.find(item => equal(item.path, target));
        if (previous) { results.push({ id: previous.id, status: 'already-registered' }); continue; }
        try {
          const info = metadata(target);
          let id = validId(entry.name);
          if (ctx.state.skills.some(item => item.id === id)) id = validId(id.slice(0, 54) + '-' + digest(target).slice(0, 8));
          ctx.state.skills.push({ id, ...info, path: target, source: null, baselineVerified: false, installedCommit: null, installedHash: fileHash(target), addedAt: now(), checkedAt: null, updatedAt: null, protected: PROTECTED.has(info.name), backups: [], history: [] });
          results.push({ id, status: 'source-pending' });
        } catch (error) { results.push({ path: target, status: 'failed', error: error.message }); }
      }
    }
    save(ctx); return results;
  });
}
function validateReplacement(old, next) {
  ensure(!old?.protected && !PROTECTED.has(next.name), 'Core skills are maintained by the SmartBuild installer, not bulk updates');
  if (old) ensure(old.name === next.name, 'Upstream skill name changed; review before replacing it');
}
function commitFiles(ctx, old, next, prepared, action) {
  const target = noLinks(next.path), parent = noLinks(path.dirname(target));
  fs.mkdirSync(parent, { recursive: true });
  if (old) ensure(fileHash(target) === old.installedHash, 'Local changes detected; current files were preserved');
  else ensure(!exists(target), 'Install target already exists');
  const id = crypto.randomUUID(), backupRoot = within(ctx.root, path.join(ctx.root, 'backups', id));
  fs.mkdirSync(backupRoot, { recursive: true });
  if (old) copy(target, path.join(backupRoot, 'files'));
  const backup = { schemaVersion: 1, id, skillId: next.id, createdAt: now(), action, previous: old, previousHash: old ? fileHash(target) : null };
  saveJSON(path.join(backupRoot, 'manifest.json'), backup);
  const stage = within(parent, path.join(parent, '.skill-library-stage-' + id));
  const parked = within(parent, path.join(parent, '.skill-library-old-' + id));
  copy(prepared, stage);
  next = { ...next, installedHash: fileHash(stage), lastOperation: id, backups: [...(old?.backups ?? []), id], history: [...(old?.history ?? []), { at: now(), action, from: old?.installedCommit ?? null, to: next.installedCommit, backup: id }] };
  const journal = { schemaVersion: 1, id, skillId: next.id, target, stage, parked, oldHash: old?.installedHash ?? null, newHash: next.installedHash, previous: old };
  const pending = path.join(ctx.root, 'pending.json');
  saveJSON(pending, journal);
  try {
    if (old) { ensure(fileHash(target) === old.installedHash, 'Local changes appeared during update'); fs.renameSync(target, parked); }
    fs.renameSync(stage, target);
    if (old) ctx.state.skills[ctx.state.skills.findIndex(item => item.id === old.id)] = next; else ctx.state.skills.push(next);
    save(ctx);
    refreshProfiles(ctx, parent);
    if (exists(parked)) removeOwned(parent, parked);
    fs.unlinkSync(pending);
    return next;
  } catch (error) {
    // The journal remains durable; recover uses content hashes and the saved registry to decide.
    throw new Error('Update interrupted; current/backup files retained. Run recover. ' + error.message);
  }
}
export function addSkill(options, request) {
  return locked(options, ctx => {
    const url = repository(request.repository), directory = relativeDirectory(request.directory);
    const folder = fetchRepository(noLinks(path.join(ctx.root, 'repositories')), url);
    const ref = trackingRef(folder, url, request.ref), commit = resolveCommit(folder, ref);
    const temporary = staging(ctx), prepared = path.join(temporary, 'skill');
    try {
      const details = snapshot(folder, commit, directory, prepared, noLinks(path.join(ctx.root, 'attributions')));
      const info = metadata(prepared), id = validId(request.id ?? info.name);
      const old = ctx.state.skills.find(item => item.id === id);
      ensure(!old?.source || (!old.baselineVerified && old.source.repository === url && old.source.directory === directory && old.source.ref === ref), 'Skill already has a source; use update or review its registration');
      ensure(!PROTECTED.has(id), 'Core skills are maintained by the SmartBuild installer');
      validateReplacement(old, info);
      const target = old?.path ?? targetPath(ctx, request, id);
      if (old && request.skillsRoot) ensure(equal(targetPath(ctx, request, id), target), 'Existing skill location does not match requested target');
      const upstreamHash = fileHash(prepared);
      const present = exists(target);
      const actual = present ? fileHash(target) : null;
      const next = { id, ...info, path: target, source: { repository: url, directory, ref, author: request.author ?? old?.source?.author ?? null, ...(old?.source?.evidence ? { evidence: old.source.evidence } : {}) }, baselineVerified: !present || actual === upstreamHash, installedCommit: !present || actual === upstreamHash ? commit : null, upstreamCommit: commit, installedHash: actual ?? upstreamHash, addedAt: old?.addedAt ?? now(), checkedAt: now(), updatedAt: present ? old?.updatedAt ?? null : now(), protected: false, attribution: details.attribution, backups: old?.backups ?? [], history: old?.history ?? [] };
      if (present) {
        ensure(metadata(target).name === info.name, 'Existing target is a different skill');
        if (old) ctx.state.skills[ctx.state.skills.indexOf(old)] = next; else ctx.state.skills.push(next);
        save(ctx);
        return { id, status: next.baselineVerified ? 'registered' : 'baseline-unverified', commit: next.installedCommit, message: next.baselineVerified ? 'Existing files match the tracked revision' : 'Source saved; existing files differ from upstream and will not be overwritten' };
      }
      const installed = commitFiles(ctx, null, next, prepared, 'install');
      return { id, status: 'installed', commit, backup: installed.lastOperation };
    } finally { removeOwned(path.join(ctx.root, 'staging'), temporary); }
  });
}
// Record documented origins without claiming an installed commit or replacing any files.
export function registerSource(options, request) {
  return locked(options, ctx => {
    const item = ctx.state.skills.find(entry => entry.id === request.id);
    ensure(item && !item.protected, 'Register an existing non-core skill first');
    ensure(!item.source, 'Source already recorded; review it before changing provenance');
    ensure(typeof request.evidence === 'string' && request.evidence.trim(), 'Source evidence is required; do not guess origins');
    const url = repository(request.repository), directory = relativeDirectory(request.directory);
    const ref = request.ref;
    ensure(typeof ref === 'string', 'An explicitly verified ref is required');
    ensure(/^refs\/(heads|tags)\/[^\s]+$/.test(ref) && !ref.includes('..') && !/[~^:?*\[\]\\]/.test(ref), 'Use an explicit branch or tag reference');
    item.source = { repository: url, directory, ref, author: request.author ?? null, evidence: request.evidence };
    item.baselineVerified = false; item.installedCommit = null;
    item.history.push({ at: now(), action: 'register-source', evidence: request.evidence });
    save(ctx); return { id: item.id, status: 'baseline-unverified' };
  });
}
export function updateLibrary(options, message, ids = null) {
  ensure(isLibraryUpdateCommand(message), 'Only the standalone 技能库更新 command authorizes bulk updates');
  return locked(options, ctx => {
    if (ids) { ensure(Array.isArray(ids), 'ids must be an array'); for (const id of ids) ensure(ctx.state.skills.some(item => item.id === id), 'Unknown skill ID: ' + id); }
    const report = { id: crypto.randomUUID(), startedAt: now(), fetchedRepositories: 0, results: [], discovered: [] };
    const caches = new Map();
    for (const candidate of [...ctx.state.skills]) {
      if (ids && !ids.includes(candidate.id)) continue;
      let item = ctx.state.skills.find(entry => entry.id === candidate.id);
      const result = { id: item.id, from: item.installedCommit, to: item.installedCommit };
      try {
        if (item.protected) { report.results.push({ ...result, status: 'protected' }); continue; }
        if (!item.source) { report.results.push({ ...result, status: 'source-pending' }); continue; }
        if (!item.baselineVerified) { report.results.push({ ...result, status: 'baseline-unverified' }); continue; }
        ensure(fileHash(item.path) === item.installedHash, 'Local changes detected; current files were preserved');
        const url = repository(item.source.repository);
        if (!caches.has(url)) {
          report.fetchedRepositories++;
          try { caches.set(url, { folder: fetchRepository(noLinks(path.join(ctx.root, 'repositories')), url) }); }
          catch (error) { caches.set(url, { error }); }
        }
        const cache = caches.get(url); if (cache.error) throw cache.error;
        const commit = resolveCommit(cache.folder, item.source.ref);
        result.to = commit;
        const temporary = staging(ctx), prepared = path.join(temporary, 'skill');
        try {
          const details = snapshot(cache.folder, commit, relativeDirectory(item.source.directory), prepared, noLinks(path.join(ctx.root, 'attributions')));
          const info = metadata(prepared); validateReplacement(item, info);
          for (const directory of details.discovered) if (!ctx.state.skills.some(other => other.source?.repository === url && other.source.directory === directory) && !report.discovered.some(entry => entry.repository === url && entry.directory === directory && entry.ref === item.source.ref)) report.discovered.push({ repository: url, ref: item.source.ref, directory });
          item.checkedAt = now();
          if (commit === item.installedCommit && fileHash(prepared) === item.installedHash) {
            refreshProfiles(ctx, path.dirname(item.path));
            save(ctx); report.results.push({ ...result, status: 'current' }); continue;
          }
          const next = { ...item, ...info, attribution: details.attribution, installedCommit: commit, upstreamCommit: commit, checkedAt: now(), updatedAt: now() };
          const installed = commitFiles(ctx, item, next, prepared, 'update');
          report.results.push({ ...result, status: 'updated', backup: installed.lastOperation });
        } finally { removeOwned(path.join(ctx.root, 'staging'), temporary); }
      } catch (error) {
        report.results.push({ ...result, status: 'failed', error: error.message });
        const stored = ctx.state.skills.find(entry => entry.id === item.id);
        if (stored) stored.checkedAt = now();
        if (exists(path.join(ctx.root, 'pending.json'))) { report.interrupted = true; break; }
      }
    }
    report.finishedAt = now();
    if (report.interrupted) {
      // Reload the durable state; an unsuccessful save must not accidentally commit in-memory changes.
      ctx.state = openLibrary(options).state;
    }
    ctx.state.runs.push(report); save(ctx);
    return report;
  });
}
export function rollbackSkill(options, id, backupId) {
  return locked(options, ctx => {
    validId(id); ensure(/^[a-f0-9-]{36}$/.test(backupId), 'Invalid backup ID');
    const item = ctx.state.skills.find(entry => entry.id === id); ensure(item, 'Unknown skill');
    ensure(item.backups.includes(backupId), 'Backup does not belong to this skill');
    const folder = within(ctx.root, path.join(ctx.root, 'backups', backupId));
    noLinks(path.join(folder, 'manifest.json'));
    const backup = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8'));
    ensure(backup.id === backupId && backup.skillId === id && backup.previous && equal(backup.previous.path, item.path), 'Backup cannot restore this skill');
    const prepared = within(folder, path.join(folder, 'files'));
    ensure(fileHash(prepared) === backup.previousHash && backup.previousHash === backup.previous.installedHash, 'Backup contents changed; rollback refused');
    const next = commitFiles(ctx, item, { ...backup.previous, checkedAt: item.checkedAt, updatedAt: now() }, prepared, 'rollback');
    return { id, status: 'rolled-back', from: item.installedCommit, to: next.installedCommit, backup: next.lastOperation };
  });
}
export function recoverLibrary(options) {
  return locked(options, ctx => {
    const file = path.join(ctx.root, 'pending.json');
    if (!exists(file)) return { status: 'nothing-to-recover' };
    noLinks(file);
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    ensure(j.schemaVersion === 1 && /^[a-f0-9-]{36}$/.test(j.id), 'Invalid recovery journal');
    const parent = noLinks(path.dirname(j.target));
    ensure(equal(j.stage, path.join(parent, '.skill-library-stage-' + j.id)) && equal(j.parked, path.join(parent, '.skill-library-old-' + j.id)), 'Invalid recovery paths');
    noLinks(j.target); noLinks(j.stage); noLinks(j.parked);
    // Reject conflicting recovery inputs before removing or replacing installed files.
    const recoveryFiles = [[j.stage, j.newHash], [j.parked, j.oldHash]];
    for (const [target, expected] of recoveryFiles) if (exists(target)) ensure(fileHash(target) === expected, 'Recovery files changed; manual recovery required');
    const item = ctx.state.skills.find(entry => entry.id === j.skillId);
    const committed = item?.lastOperation === j.id;
    if (committed) {
      ensure(equal(item.path, j.target) && fileHash(j.target) === j.newHash, 'Installed files changed; manual recovery required');
    } else {
      if (j.previous) ensure(item && equal(item.path, j.target) && item.installedHash === j.oldHash, 'Registry changed; manual recovery required');
      else ensure(!item, 'Registry changed; manual recovery required');
      if (exists(j.target)) {
        const actual = fileHash(j.target);
        ensure(actual === j.oldHash || actual === j.newHash, 'Local files changed; manual recovery required');
        if (actual === j.newHash && actual !== j.oldHash) {
          if (j.previous) ensure(exists(j.parked) && fileHash(j.parked) === j.oldHash, 'Original parked files are missing or changed; use the verified backup manually');
          removeOwned(parent, j.target);
        }
      }
      if (j.previous && !exists(j.target)) {
        ensure(exists(j.parked) && fileHash(j.parked) === j.oldHash, 'Original parked files are missing or changed; use the verified backup manually');
        fs.renameSync(j.parked, j.target);
      }
    }
    for (const [target, expected] of recoveryFiles) if (exists(target)) { ensure(fileHash(target) === expected, 'Recovery files changed; manual recovery required'); removeOwned(parent, target); }
    refreshProfiles(ctx, parent);
    fs.unlinkSync(file);
    return { status: committed ? 'completed' : 'restored', id: j.skillId };
  }, true);
}
function cli() {
  const args = process.argv.slice(2), command = args.shift();
  const options = {};
  const index = args.indexOf('--library');
  if (index >= 0) { ensure(args[index + 1], '--library requires a path'); options.library = args[index + 1]; args.splice(index, 2); }
  let result;
  switch (command) {
    case 'list': result = listLibrary(options); break;
    case 'scan': ensure(args.length, 'scan requires one or more skill roots'); result = scanLibrary(options, args); break;
    case 'add': ensure(args[0], 'add requires a JSON request file'); result = addSkill(options, JSON.parse(fs.readFileSync(args[0], 'utf8'))); break;
    case 'register': ensure(args[0], 'register requires a JSON request file'); result = registerSource(options, JSON.parse(fs.readFileSync(args[0], 'utf8'))); break;
    case 'update': ensure(args[0] === '--message' && args[1], 'update requires --message with the original standalone user command'); result = updateLibrary(options, args[1], args.length > 2 ? args.slice(2) : null); break;
    case 'rollback': result = rollbackSkill(options, args[0], args[1]); break;
    case 'recover': result = recoverLibrary(options); break;
    default: throw new Error('Usage: skill-library.mjs list|scan <roots...>|add <request.json>|register <request.json>|update --message 技能库更新 [ids...]|rollback <id> <backup-id>|recover [--library <directory>]');
  }
  console.log(JSON.stringify(result, null, 2));
  if (result.interrupted || result.results?.some(item => item.status === 'failed') || (Array.isArray(result) && result.some(item => item.status === 'failed'))) process.exitCode = 2;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { cli(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
