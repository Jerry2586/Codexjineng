import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Read-only environment evidence. This intentionally cannot claim MCP connectivity or index validity.
export function probe(project, binary) {
  const root = fs.realpathSync(project);
  const facts = { projectRoot: root, binary: binary ?? null, cli: binary ? 'unavailable' : 'unverified',
    reviewedContract: '0.2.0-rc1', contractMatch: false,
    assets: ['aoci.txt', 'aoci.meta.txt', 'aoci.code.txt', 'aoci.database.txt'].filter(file => fs.existsSync(path.join(root, file))),
    mcp: 'unverified', cognitionDelivery: 'unverified', cognitionAlignment: 'unverified' };
  if (!binary) return { ...facts, nextAction: 'Provide a trusted absolute AOCI binary path to check CLI availability; MCP remains unverified' };
  if (!path.isAbsolute(binary) || !fs.statSync(binary).isFile()) throw new Error('Use an existing trusted absolute binary path');
  const version = spawnSync(binary, ['--version'], { cwd: root, shell: false, windowsHide: true, timeout: 10000, encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (version.error || version.status !== 0) return { ...facts, error: version.error?.message ?? version.stderr.trim(), nextAction: 'Resolve CLI diagnostic failure' };
  facts.cli = 'available'; facts.versionOutput = version.stdout.trim();
  facts.contractMatch = /^aoci version 0\.2\.0-rc1(?:\s|$)/.test(facts.versionOutput);
  facts.nextAction = facts.contractMatch ? 'Inspect callable MCP identity, Rules and runtime Guide' : 'Inspect the installed version documentation and runtime capabilities before choosing a workflow';
  return facts;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(probe(process.argv[2], process.argv[3]), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
