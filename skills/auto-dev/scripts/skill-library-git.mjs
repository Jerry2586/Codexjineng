import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const fail = message => { throw new Error(message); };
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const MAX_BYTES = 32 * 1024 * 1024;
export function repository(value) {
  if (typeof value !== 'string' || !value.trim() || /[\r\n\0]/.test(value)) fail('Repository must be a Git URL or absolute local path');
  if (path.isAbsolute(value)) return fs.realpathSync(value);
  if (/^git@[a-zA-Z0-9.-]+:[\w./-]+$/.test(value)) return value.replace(/\/$/, '');
  let url;
  try { url = new URL(value); } catch { fail('Use a full HTTPS/SSH Git URL'); }
  if (!['https:', 'ssh:'].includes(url.protocol) || url.password || url.search || url.hash || (url.protocol === 'https:' && url.username)) fail('Repository URLs must not contain credentials, query parameters or unsupported protocols');
  return url.href.replace(/\/$/, '').replace(/\.git$/, '') + '.git';
}
export function relativeDirectory(value = '.') {
  if (value === '.') return value;
  if (typeof value !== 'string' || !value || value.includes('\\') || value.split('/').some(part => !part || part === '.' || part === '..' || /[<>:"|?*\x00-\x1f]/.test(part))) fail('Skill directory must be a repository-relative path with /');
  return value;
}
export function runGit(cwd, args, input) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
  for (const key of Object.keys(env)) if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG|SSH|EXEC_PATH)/.test(key)) delete env[key];
  const result = spawnSync('git', ['-c', 'core.hooksPath=' + path.join(cwd, 'disabled-hooks'), '-c', 'core.fsmonitor=false', '-c', 'protocol.ext.allow=never', '-C', cwd, ...args], { input, env, windowsHide: true, timeout: 60000, maxBuffer: MAX_BYTES * 2 });
  if (result.error || result.status !== 0) {
    // Do not echo repository-specific stderr: credential helpers can include private details.
    fail(`Git ${args[0]} failed${result.error?.code ? ' (' + result.error.code + ')' : ''}; check source, ref, network and Git authentication`);
  }
  return result.stdout;
}
export function fetchRepository(base, url) {
  const folder = path.join(base, hash(url));
  fs.mkdirSync(folder, { recursive: true });
  if (!fs.existsSync(path.join(folder, 'HEAD'))) runGit(folder, ['init', '--bare']);
  runGit(folder, ['fetch', '--force', '--prune', '--prune-tags', '--no-recurse-submodules', '--depth=1', '--', url,
    '+refs/heads/*:refs/remotes/library/*', '+refs/tags/*:refs/tags/*']);
  return folder;
}
export function trackingRef(folder, url, ref) {
  if (!ref || ref === 'HEAD') {
    const response = runGit(folder, ['ls-remote', '--symref', '--', url, 'HEAD']).toString('utf8');
    ref = response.match(/^ref: (refs\/heads\/[^\s]+)\s+HEAD$/m)?.[1];
    if (!ref) fail('Default branch unavailable; provide an explicit refs/heads/... or refs/tags/...');
  }
  if (!ref.startsWith('refs/')) ref = 'refs/heads/' + ref;
  if (!/^refs\/(heads|tags)\//.test(ref)) fail('Track a branch or a tag explicitly');
  runGit(folder, ['check-ref-format', ref]);
  return ref;
}
export function resolveCommit(folder, ref) {
  const local = ref.startsWith('refs/heads/') ? ref.replace('refs/heads/', 'refs/remotes/library/') : ref;
  if (!/^refs\/(remotes\/library|tags)\//.test(local)) fail('Invalid tracked reference');
  return runGit(folder, ['rev-parse', '--verify', local + '^{commit}']).toString('utf8').trim();
}
function tree(folder, commit) {
  return runGit(folder, ['ls-tree', '-rz', '--full-tree', commit]).toString('utf8').split('\0').filter(Boolean).map(line => {
    const match = line.match(/^(\d+) (\w+) ([a-f0-9]+)\t([\s\S]+)$/);
    if (!match) fail('Malformed Git tree');
    return { mode: match[1], type: match[2], oid: match[3], file: match[4] };
  });
}
function safeFile(file) {
  if (file.split('/').some(part => !part || part === '.' || part === '..' || /[<>:"\\|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part) || ['.git', '.skill-library'].includes(part.toLowerCase()))) fail('Unsupported filename in skill: ' + file);
}
function blobs(folder, entries) {
  if (entries.length > 5000) fail('Skill contains too many files');
  const ids = [...new Set(entries.map(entry => entry.oid))];
  if (!ids.length) return new Map();
  const data = runGit(folder, ['cat-file', '--batch'], ids.join('\n') + '\n');
  const values = new Map();
  let offset = 0, size = 0;
  for (const oid of ids) {
    const end = data.indexOf(10, offset);
    const header = data.subarray(offset, end).toString('ascii').split(' ');
    const length = Number(header[2]);
    if (end < 0 || header[0] !== oid || header[1] !== 'blob' || !Number.isSafeInteger(length) || length < 0 || end + 1 + length >= data.length) fail('Invalid Git object');
    size += length; if (size > MAX_BYTES) fail('Skill exceeds the 32 MiB limit');
    values.set(oid, data.subarray(end + 1, end + 1 + length));
    offset = end + 1 + length + 1;
  }
  return values;
}
export function snapshot(folder, commit, directory, destination, attributionRoot) {
  const rows = tree(folder, commit);
  const prefix = directory === '.' ? '' : directory + '/';
  const files = rows.filter(row => row.file.startsWith(prefix)).map(row => ({ ...row, local: row.file.slice(prefix.length) }));
  if (!files.some(row => row.local === 'SKILL.md')) fail('Upstream skill directory has no SKILL.md');
  const names = new Set();
  for (const entry of files) {
    safeFile(entry.local);
    if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode)) fail('Symlinks and submodules are not supported in installed skills');
    if (names.has(entry.local.toLowerCase())) fail('Case-colliding files in skill');
    names.add(entry.local.toLowerCase());
  }
  const ancestors = [''];
  if (directory !== '.') { let current = ''; for (const part of directory.split('/')) { current += part + '/'; ancestors.push(current); } }
  const notices = rows.filter(row => ancestors.includes(path.posix.dirname(row.file) === '.' ? '' : path.posix.dirname(row.file) + '/') && /^(licen[cs]e|copying|notice|authors|copyright)([.-].*)?$/i.test(path.posix.basename(row.file)));
  for (const entry of notices) { safeFile(entry.file); if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode)) fail('Unsupported attribution file'); }
  const values = blobs(folder, [...files, ...notices]);
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of files) {
    const target = path.join(destination, ...entry.local.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, values.get(entry.oid));
    if (process.platform !== 'win32' && entry.mode === '100755') fs.chmodSync(target, 0o755);
  }
  const attribution = path.join(attributionRoot, hash(folder), commit);
  for (const entry of notices) {
    const target = path.join(attribution, ...entry.file.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, values.get(entry.oid));
  }
  return { attribution: notices.map(entry => path.join(attribution, ...entry.file.split('/'))), discovered: rows.filter(row => /(^|\/)SKILL\.md$/.test(row.file)).map(row => path.posix.dirname(row.file)) };
}
