import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pwsh = process.env.SMARTBUILD_PWSH || 'pwsh.exe';

test('interrupted manifest update preserves a readable recovery manifest', { skip: process.platform !== 'win32', timeout: 60000 }, async t => {
  const temp = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(temp, 'smartbuild-manifest-test-'));
  t.after(() => {
    assert.equal(path.dirname(root), temp);
    assert.match(path.basename(root), /^smartbuild-manifest-test-/);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const library = path.join(root, 'skills');
  const destination = path.join(library, 'auto-dev');
  const backup = path.join(root, 'backups', 'original');
  fs.mkdirSync(destination, { recursive: true });
  fs.mkdirSync(path.join(backup, 'auto-dev'), { recursive: true });
  const hash = value => crypto.createHash('sha256').update(value).digest('hex').toUpperCase();
  fs.writeFileSync(path.join(destination, 'SKILL.md'), 'NEW');
  fs.writeFileSync(path.join(backup, 'auto-dev', 'SKILL.md'), 'ORIGINAL');
  const manifest = { schemaVersion: 2, destination: library, skills: ['auto-dev'], phase: 'prepared', files: [{ path: 'auto-dev/SKILL.md', existed: true, sha256: hash('ORIGINAL'), installedSha256: hash('NEW') }] };
  const manifestPath = path.join(backup, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const originalBytes = fs.statSync(manifestPath).size;
  const script = path.join(root, 'write.ps1');
  fs.writeFileSync(script, "param([string]$Manifest,[string]$Helper)\n$ErrorActionPreference='Stop'\n. $Helper\n$value=Get-Content -LiteralPath $Manifest -Raw | ConvertFrom-Json\n$value.phase='applied'\n$value | Add-Member -NotePropertyName padding -NotePropertyValue ('x' * (32 * 1024 * 1024))\nWrite-JsonNoBom $Manifest $value\n");
  let child, interrupted = false, stderr = '';
  const watcher = fs.watch(backup, (_event, name) => {
    if (!name || !child || interrupted) return;
    try {
      const size = fs.statSync(path.join(backup, name)).size;
      if (size > 0 && (name !== 'manifest.json' || size !== originalBytes)) interrupted = child.kill('SIGKILL');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  });
  child = spawn(pwsh, ['-NoProfile', '-File', script, '-Manifest', manifestPath, '-Helper', path.join(repo, 'scripts', 'smartbuild-files.ps1')], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 30000);
  try {
    await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  } finally { clearTimeout(timeout); watcher.close(); }
  assert.equal(interrupted, true, 'Writer was not interrupted: ' + stderr);
  const restoredManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.ok(['prepared', 'applied'].includes(restoredManifest.phase));
  assert.deepEqual(restoredManifest.files, manifest.files);
  const restored = spawnSync(pwsh, ['-NoProfile', '-File', path.join(repo, 'scripts', 'restore-smartbuild.ps1'), '-BackupPath', backup, '-Destination', destination], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(restored.status, 0, restored.stderr);
  assert.equal(fs.readFileSync(path.join(destination, 'SKILL.md'), 'utf8'), 'ORIGINAL');
});
