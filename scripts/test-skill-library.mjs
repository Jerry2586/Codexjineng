import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { addSkill, registerSource, listLibrary, scanLibrary, updateLibrary, rollbackSkill, recoverLibrary, fileHash, isLibraryUpdateCommand } from '../skills/auto-dev/scripts/skill-library.mjs';
import { catalog } from '../skills/auto-dev/scripts/skill-catalog.mjs';
import { repository } from '../skills/auto-dev/scripts/skill-library-git.mjs';
const cli = path.resolve('skills/auto-dev/scripts/skill-library.mjs');
function fixture(t) {
  const temporary = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(temporary, 'smartbuild-library-'));
  t.after(() => { assert.equal(path.dirname(root), temporary); assert.match(path.basename(root), /^smartbuild-library-/); fs.rmSync(root, { recursive: true, force: true }); });
  const repo = path.join(root, 'upstream'), skillsRoot = path.join(root, 'installed'), options = { library: path.join(root, 'library') };
  fs.mkdirSync(repo); fs.mkdirSync(skillsRoot);
  const git = (...args) => {
    const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true });
    assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
  };
  git('init', '-b', 'main'); git('config', 'user.name', 'Library Test'); git('config', 'user.email', 'library-test@example.invalid'); git('config', 'commit.gpgsign', 'false'); git('config', 'core.autocrlf', 'false');
  const write = (file, value) => { const target = path.join(repo, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, value); };
  const skill = (name, content = 'version one') => { write('skills/' + name + '/SKILL.md', '---\nname: ' + name + '\ndescription: A fixture for real Git integration tests.\n---\n\n' + content + '\n'); write('skills/' + name + '/data.txt', content); };
  const commit = message => { git('add', '.'); git('commit', '-m', message); return git('rev-parse', 'HEAD'); };
  skill('alpha'); skill('beta'); write('LICENSE', 'Fixture authors retain their attribution.'); commit('initial');
  const add = (id = 'alpha', extra = {}) => addSkill(options, { repository: repo, directory: 'skills/' + id, skillsRoot, author: 'Fixture authors', ...extra });
  const installed = id => path.join(skillsRoot, id);
  const update = ids => updateLibrary(options, '技能库更新', ids);
  return { root, repo, skillsRoot, options, git, write, skill, commit, add, installed, update };
}

test('standalone update command has a narrow scope and never accepts surrounding prose', () => {
  for (const value of ['技能库更新', ' \n技能库更新\t']) assert.equal(isLibraryUpdateCommand(value), true);
  for (const value of ['开始制作', '就是这样', '请技能库更新', '技能库更新。', '“技能库更新”', '`技能库更新`', '```\n技能库更新\n```', '> 技能库更新', null]) assert.equal(isLibraryUpdateCommand(value), false);
});
test('invalid update authorization does not create a library', t => {
  const f = fixture(t); assert.throws(() => updateLibrary(f.options, '开始制作'), /standalone/); assert.equal(fs.existsSync(f.options.library), false);
});
test('install records source, exact commit, branch, attribution and content', t => {
  const f = fixture(t); const result = f.add();
  assert.equal(result.status, 'installed');
  const [item] = listLibrary(f.options).skills;
  assert.equal(item.installedCommit, f.git('rev-parse', 'HEAD')); assert.equal(item.source.ref, 'refs/heads/main');
  assert.equal(item.source.repository, f.repo); assert.equal(item.source.author, 'Fixture authors');
  assert.equal(item.localModified, false); assert.equal(item.baselineVerified, true);
  assert.match(fs.readFileSync(item.attribution[0], 'utf8'), /Fixture authors/);
  assert.equal(fs.readFileSync(path.join(f.installed('alpha'), 'data.txt'), 'utf8'), 'version one');
});
test('batch update fetches a shared repository once and does not install newly discovered skills', t => {
  const f = fixture(t); f.add(); f.add('beta');
  f.skill('alpha', 'version two'); f.skill('beta', 'version two'); f.skill('gamma');
  const commit = f.commit('update both and add gamma'); const report = f.update();
  assert.equal(report.fetchedRepositories, 1); assert.deepEqual(report.results.map(item => item.status), ['updated', 'updated']);
  assert.ok(report.discovered.some(item => item.directory === 'skills/gamma')); assert.equal(fs.existsSync(f.installed('gamma')), false);
  for (const id of ['alpha', 'beta']) { assert.equal(fs.readFileSync(path.join(f.installed(id), 'data.txt'), 'utf8'), 'version two'); assert.equal(listLibrary(f.options).skills.find(s => s.id === id).installedCommit, commit); }
  assert.deepEqual(f.update().results.map(item => item.status), ['current', 'current']);
  assert.equal(listLibrary(f.options).skills.length, 2);
});
test('local edits prevent overwrite even when upstream commit is unchanged', t => {
  const f = fixture(t); f.add(); fs.writeFileSync(path.join(f.installed('alpha'), 'data.txt'), 'my edits');
  const r = f.update(); assert.equal(r.results[0].status, 'failed'); assert.match(r.results[0].error, /Local changes/); assert.equal(r.fetchedRepositories, 0);
  assert.equal(fs.readFileSync(path.join(f.installed('alpha'), 'data.txt'), 'utf8'), 'my edits');
});
test('local deletions block replacement, while unrelated skills continue updating', t => {
  const f = fixture(t); f.add(); f.add('beta'); fs.unlinkSync(path.join(f.installed('alpha'), 'data.txt'));
  f.skill('alpha', 'two'); f.skill('beta', 'two'); f.commit('two');
  const r = f.update(); assert.deepEqual(r.results.map(i => i.status), ['failed', 'updated']); assert.equal(fs.existsSync(path.join(f.installed('alpha'), 'data.txt')), false);
});
test('upstream file removal removes the installed file and rollback restores it', t => {
  const f = fixture(t); f.add(); const before = listLibrary(f.options).skills[0].installedCommit;
  fs.unlinkSync(path.join(f.repo, 'skills/alpha/data.txt')); f.commit('remove data');
  const r = f.update(); assert.equal(r.results[0].status, 'updated'); assert.equal(fs.existsSync(path.join(f.installed('alpha'), 'data.txt')), false);
  const restored = rollbackSkill(f.options, 'alpha', r.results[0].backup); assert.equal(restored.to, before);
  assert.equal(fs.readFileSync(path.join(f.installed('alpha'), 'data.txt'), 'utf8'), 'version one');
  const forward = rollbackSkill(f.options, 'alpha', restored.backup); assert.equal(forward.to, r.results[0].to); assert.equal(fs.existsSync(path.join(f.installed('alpha'), 'data.txt')), false);
});
test('rollback preserves local changes and refuses tampered backups', t => {
  const f = fixture(t); f.add(); f.skill('alpha', 'two'); f.commit('two'); const r = f.update(); const backup = r.results[0].backup;
  fs.writeFileSync(path.join(f.installed('alpha'), 'data.txt'), 'mine');
  assert.throws(() => rollbackSkill(f.options, 'alpha', backup), /Local changes/);
  fs.writeFileSync(path.join(f.installed('alpha'), 'data.txt'), 'two');
  fs.writeFileSync(path.join(f.options.library, 'backups', backup, 'files/data.txt'), 'tampered');
  assert.throws(() => rollbackSkill(f.options, 'alpha', backup), /Backup contents changed/);
  assert.equal(fs.readFileSync(path.join(f.installed('alpha'), 'data.txt'), 'utf8'), 'two');
});
test('tag tracking remains pinned when a branch advances', t => {
  const f = fixture(t); f.git('tag', 'v1'); f.add('alpha', { ref: 'refs/tags/v1' });
  f.skill('alpha', 'two'); f.commit('two'); assert.equal(f.update().results[0].status, 'current');
});
test('missing upstream skill is reported without replacing the working installation', t => {
  const f = fixture(t); f.add(); f.git('rm', '-r', 'skills/alpha'); f.commit('remove alpha');
  const r = f.update(); assert.equal(r.results[0].status, 'failed'); assert.match(r.results[0].error, /no SKILL/);
  assert.equal(fs.readFileSync(path.join(f.installed('alpha'), 'data.txt'), 'utf8'), 'version one');
});
test('invalid frontmatter and renamed skills are refused', t => {
  const f = fixture(t); f.add();
  for (const text of ['bad metadata', '---\nname: other\ndescription: other skill\n---\n']) {
    f.write('skills/alpha/SKILL.md', text); f.commit('invalid');
    assert.equal(f.update().results[0].status, 'failed'); assert.match(fs.readFileSync(path.join(f.installed('alpha'), 'SKILL.md'), 'utf8'), /name: alpha/);
  }
});
test('upstream symlinks are rejected before copying any files', t => {
  const f = fixture(t); f.add(); const oid = f.git('hash-object', '-w', 'LICENSE');
  f.git('update-index', '--add', '--cacheinfo', '120000,' + oid + ',skills/alpha/link'); f.git('commit', '-m', 'symlink fixture');
  const r = f.update(); assert.equal(r.results[0].status, 'failed'); assert.match(r.results[0].error, /Symlinks/); assert.equal(fs.existsSync(path.join(f.installed('alpha'), 'link')), false);
});
test('scan registers unknown origins once and preserves existing edits', t => {
  const f = fixture(t); fs.cpSync(path.join(f.repo, 'skills/alpha'), f.installed('alpha'), { recursive: true });
  scanLibrary(f.options, [f.skillsRoot]); fs.writeFileSync(path.join(f.installed('alpha'), 'data.txt'), 'mine'); scanLibrary(f.options, [f.skillsRoot]);
  const state = listLibrary(f.options); assert.equal(state.skills.length, 1); assert.equal(state.skills[0].status, 'source-pending'); assert.equal(state.skills[0].localModified, true);
  assert.equal(f.update().results[0].status, 'source-pending');
});
test('registering existing files verifies matching baselines and preserves mismatches', t => {
  const f = fixture(t); fs.cpSync(path.join(f.repo, 'skills/alpha'), f.installed('alpha'), { recursive: true });
  assert.equal(f.add().status, 'registered');
  fs.cpSync(path.join(f.repo, 'skills/beta'), f.installed('beta'), { recursive: true }); fs.writeFileSync(path.join(f.installed('beta'), 'data.txt'), 'mine');
  assert.equal(f.add('beta').status, 'baseline-unverified'); assert.equal(f.update().results.find(r => r.id === 'beta').status, 'baseline-unverified');
  assert.equal(fs.readFileSync(path.join(f.installed('beta'), 'data.txt'), 'utf8'), 'mine');
});
test('failed repository does not stop another repository from updating', t => {
  const f = fixture(t), other = fixture(t); f.add();
  addSkill(f.options, { repository: other.repo, directory: 'skills/beta', skillsRoot: f.skillsRoot });
  fs.renameSync(f.repo, f.repo + '-unavailable'); other.skill('beta', 'two'); other.commit('two');
  const r = f.update(); assert.deepEqual(r.results.map(i => i.status), ['failed', 'updated']);
});
test('unsafe source URLs and escaping directories cannot mutate the library', t => {
  const f = fixture(t);
  for (const value of ['https://name:secret@example.com/repo', 'https://secret@example.com/repo', 'https://example.com/repo?token=secret', 'ext::touch unsafe', 'file:///tmp/repo']) assert.throws(() => repository(value));
  assert.throws(() => f.add('alpha', { directory: '../outside' }), /relative/);
  assert.equal(fs.existsSync(f.installed('alpha')), false);
});
test('core skills cannot be overwritten by bulk installation', t => {
  const f = fixture(t); f.skill('auto-dev'); f.commit('core-name fixture');
  assert.throws(() => f.add('auto-dev'), /Core skills/); assert.equal(fs.existsSync(f.installed('auto-dev')), false);
});
test('existing lock and interrupted journal prevent mutation', t => {
  const f = fixture(t); f.add(); const file = path.join(f.options.library, 'registry.json'), before = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(path.join(f.options.library, 'library.lock'), 'owner fixture'); assert.throws(f.update, /locked/); fs.unlinkSync(path.join(f.options.library, 'library.lock'));
  fs.writeFileSync(path.join(f.options.library, 'pending.json'), '{}'); assert.throws(f.update, /Interrupted/); assert.equal(fs.readFileSync(file, 'utf8'), before);
});
test('recovery restores an interrupted swap without pretending it was committed', t => {
  const f = fixture(t); f.add(); const old = listLibrary(f.options).skills[0], id = '12345678-1234-1234-1234-123456789abc';
  const target = old.path, stage = path.join(f.skillsRoot, '.skill-library-stage-' + id), parked = path.join(f.skillsRoot, '.skill-library-old-' + id);
  fs.cpSync(target, stage, { recursive: true }); fs.writeFileSync(path.join(stage, 'data.txt'), 'uncommitted new files'); const newHash = fileHash(stage);
  fs.renameSync(target, parked); fs.renameSync(stage, target);
  fs.writeFileSync(path.join(f.options.library, 'pending.json'), JSON.stringify({ schemaVersion: 1, id, skillId: 'alpha', target, stage, parked, oldHash: old.installedHash, newHash, previous: old }));
  assert.equal(recoverLibrary(f.options).status, 'restored'); assert.equal(fileHash(target), old.installedHash); assert.equal(fs.existsSync(parked), false);
  assert.equal(listLibrary(f.options).skills[0].installedCommit, old.installedCommit);
});
test('recovery refuses to discard edits made after interruption', t => {
  const f = fixture(t); f.add(); const old = listLibrary(f.options).skills[0], id = '12345678-1234-1234-1234-123456789abc';
  fs.writeFileSync(path.join(old.path, 'data.txt'), 'later local edits');
  fs.writeFileSync(path.join(f.options.library, 'pending.json'), JSON.stringify({ schemaVersion: 1, id, skillId: 'alpha', target: old.path, stage: path.join(f.skillsRoot, '.skill-library-stage-' + id), parked: path.join(f.skillsRoot, '.skill-library-old-' + id), oldHash: old.installedHash, newHash: 'different', previous: old }));
  assert.throws(() => recoverLibrary(f.options), /Local files changed/); assert.equal(fs.readFileSync(path.join(old.path, 'data.txt'), 'utf8'), 'later local edits');
});
test('CLI reports structured update failures with a nonzero exit status', t => {
  const f = fixture(t); f.add(); fs.writeFileSync(path.join(f.installed('alpha'), 'data.txt'), 'mine');
  const r = spawnSync(process.execPath, [cli, 'update', '--message', '技能库更新', '--library', f.options.library], { encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 2); assert.equal(JSON.parse(r.stdout).results[0].status, 'failed');
});

test('documented source registration keeps its evidence and requires a verified baseline', t => {
  const f = fixture(t); fs.cpSync(path.join(f.repo, 'skills/alpha'), f.installed('alpha'), { recursive: true }); scanLibrary(f.options, [f.skillsRoot]);
  registerSource(f.options, { id: 'alpha', repository: f.repo, directory: 'skills/alpha', ref: 'refs/heads/main', evidence: 'Explicit fixture provenance', author: 'Fixture authors' });
  assert.equal(f.update().results[0].status, 'baseline-unverified'); assert.equal(f.add().status, 'registered');
  const entries = catalog([f.skillsRoot], path.join(f.options.library, 'registry.json'));
  assert.equal(entries[0].library.source.repository, f.repo); assert.equal(entries[0].library.baselineVerified, true);
});
test('malformed neighboring skill does not prevent a valid skill from being registered', t => {
  const f = fixture(t); fs.mkdirSync(f.installed('broken')); fs.writeFileSync(path.join(f.installed('broken'), 'SKILL.md'), 'not frontmatter');
  assert.equal(f.add().status, 'installed');
  const results = scanLibrary(f.options, [f.skillsRoot]); assert.equal(results.find(item => item.id === 'alpha').status, 'already-registered'); assert.ok(results.some(item => item.status === 'failed'));
});
test('name overrides cannot install into a protected core directory', t => {
  const f = fixture(t); assert.throws(() => f.add('alpha', { id: 'auto-dev' }), /Core skills/); assert.equal(fs.existsSync(f.installed('auto-dev')), false);
});
test('registry write interruption restores old content and keeps the old commit', t => {
  const f = fixture(t); f.add(); const old = listLibrary(f.options).skills[0];
  f.skill('alpha', 'two'); f.commit('two');
  const original = fs.renameSync;
  let failed = false;
  fs.renameSync = function (from, to) {
    if (!failed && to === path.join(f.options.library, 'registry.json')) { failed = true; throw new Error('Injected registry rename failure'); }
    return original(from, to);
  };
  let result;
  try { result = f.update(); } finally { fs.renameSync = original; }
  assert.equal(result.interrupted, true); assert.equal(result.results[0].status, 'failed');
  assert.equal(listLibrary(f.options).skills[0].installedCommit, old.installedCommit);
  assert.equal(recoverLibrary(f.options).status, 'restored'); assert.equal(fileHash(old.path), old.installedHash);
});
test('cleanup failure after commit is recovered by finishing the committed transaction', t => {
  const f = fixture(t); f.add(); f.skill('alpha', 'two'); const commit = f.commit('two');
  const original = fs.rmSync; let failed = false;
  fs.rmSync = function (target, options) {
    if (!failed && path.basename(target).startsWith('.skill-library-old-')) { failed = true; throw new Error('Injected cleanup failure'); }
    return original(target, options);
  };
  let result;
  try { result = f.update(); } finally { fs.rmSync = original; }
  assert.equal(result.interrupted, true); assert.equal(listLibrary(f.options).skills[0].installedCommit, commit);
  assert.equal(recoverLibrary(f.options).status, 'completed'); assert.equal(fs.readFileSync(path.join(f.installed('alpha'), 'data.txt'), 'utf8'), 'two');
});

function copyFixture(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name), dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyFixture(src, dst); else fs.copyFileSync(src, dst);
  }
}
// F08: execute real entry points and real Git updates, including non-ASCII paths.
test('profile CLI runs from a Chinese path and honors its separate output argument', t => {
  const f = fixture(t), skills = path.join(f.root, '中文 技能');
  fs.mkdirSync(skills);
  copyFixture(path.resolve('skills/auto-dev'), path.join(skills, 'auto-dev'));
  copyFixture(f.repo + '/skills/alpha', path.join(skills, 'alpha'));
  const out = path.join(f.root, '独立 档案.json');
  const r = spawnSync(process.execPath, [path.join(skills, 'auto-dev/scripts/build-profiles.mjs'), skills, out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); assert.ok(fs.existsSync(out), 'CLI must write its requested output');
  assert.ok(JSON.parse(fs.readFileSync(out, 'utf8')).skills.some(p => p.name === 'alpha'));
});
test('add, update and rollback refresh profiles without marking an unchanged core as locally edited', t => {
  const f = fixture(t);
  fs.cpSync(path.resolve('skills/auto-dev'), path.join(f.skillsRoot, 'auto-dev'), { recursive: true });
  scanLibrary(f.options, [f.skillsRoot]);
  f.add();
  const profile = () => JSON.parse(fs.readFileSync(path.join(f.skillsRoot, 'auto-dev/references/profiles.json'), 'utf8')).skills.find(p => p.name === 'alpha');
  const first = profile(); assert.ok(first, 'add must generate a matching profile');
  f.skill('alpha', 'version two'); f.commit('change skill');
  const report = f.update(['alpha']); assert.equal(report.results[0].status, 'updated');
  assert.notEqual(profile().sha256, first.sha256);
  rollbackSkill(f.options, 'alpha', report.results[0].backup);
  assert.equal(profile().sha256, first.sha256);
  assert.equal(listLibrary(f.options).skills.find(p => p.name === 'auto-dev').localModified, false);
});

test('A06 repeated Git blobs are bounded by expanded bytes before writing and leave no staging residue', t => {
 const f=fixture(t);const bytes=Buffer.alloc(17*1024*1024,97);
 f.write('skills/alpha/one.bin',bytes);f.write('skills/alpha/two.bin',bytes);f.commit('duplicated large blob');
 assert.throws(()=>f.add(),/32 MiB|size/i);
 assert.equal(fs.existsSync(f.installed('alpha')),false);
 const staging=path.join(f.options.library,'staging');assert.deepEqual(fs.readdirSync(staging),[]);
});


test('R003 recovery preflights parked originals before removing the installed version', t => {
 for(const conflict of ['changed','missing']) {
  const f=fixture(t);f.add();const old=listLibrary(f.options).skills[0];
  const id=crypto.randomUUID(),target=old.path;
  const stage=path.join(f.skillsRoot,'.skill-library-stage-'+id),parked=path.join(f.skillsRoot,'.skill-library-old-'+id);
  if(conflict==='changed') {
   fs.cpSync(target,stage,{recursive:true});fs.renameSync(target,parked);fs.renameSync(stage,target);
   fs.writeFileSync(path.join(parked,'data.txt'),'later original edits');
  }
  fs.writeFileSync(path.join(target,'data.txt'),'new installed version');
  const newHash=fileHash(target),journal=path.join(f.options.library,'pending.json');
  fs.writeFileSync(journal,JSON.stringify({schemaVersion:1,id,skillId:'alpha',target,stage,parked,oldHash:old.installedHash,newHash,previous:old}));
  assert.throws(()=>recoverLibrary(f.options),/missing|changed/);
  assert.equal(fs.existsSync(target),true,'rejected recovery must retain installed files');
  assert.equal(fileHash(target),newHash);
  if(conflict==='changed')assert.equal(fs.readFileSync(path.join(parked,'data.txt'),'utf8'),'later original edits');
  assert.equal(fs.existsSync(journal),true);
 }
});
