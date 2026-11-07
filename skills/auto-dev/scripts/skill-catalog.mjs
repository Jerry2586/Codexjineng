import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

function entryMetadata(file) {
  const actual = fs.realpathSync(file);
  const content = fs.readFileSync(actual, 'utf8').replace(/^\uFEFF/, '');
  const header = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  if (!header) throw new Error(`Missing frontmatter: ${file}`);
  const field = key => {
    const match = header.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
    if (!match) throw new Error(`Missing ${key}: ${file}`);
    let value = match[1].trim();
    if (/^[>|][-+]?\s*$/.test(value)) {
      const following = header.slice(match.index + match[0].length).split(/\r?\n/).slice(1);
      const lines = [];
      for (const line of following) { if (line && !/^\s/.test(line)) break; lines.push(line.trim()); }
      value = lines.join(' ').trim();
    } else if (value.startsWith('"')) value = JSON.parse(value);
    else if (value.startsWith("'")) value = value.slice(1, -1).replace(/''/g, "'");
    if (!value) throw new Error(`Empty ${key}: ${file}`);
    return value;
  };
  return { name: field('name'), description: field('description'), path: actual, sha256: crypto.createHash('sha256').update(fs.readFileSync(actual)).digest('hex') };
}
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
export const isBackupPath = file => path.resolve(file).split(/[\\/]/).some(part => /^smartbuild-backup-/i.test(part) || part === 'smartbuild-backups');
function packageVersion(root) {
  const files = [];
  function visit(folder) {
    for (const entry of fs.readdirSync(folder, {withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))) {
      if (['.git','node_modules','__pycache__'].includes(entry.name) || /^smartbuild-backup-/i.test(entry.name)) continue;
      const file=path.join(folder,entry.name);
      if (entry.isSymbolicLink()) throw new Error('Linked dependency requires a reviewed local copy: '+file);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) {
        if (files.length >= 10000) throw new Error('Skill dependency scope too large');
        files.push([path.relative(root,file).split(path.sep).join('/'), hash(fs.readFileSync(file))]);
      }
    }
  }
  visit(root);
  return hash(JSON.stringify(files));
}
export function readSkillMetadata(file) {
  const entry=entryMetadata(file);
  return {...entry,kind:'skill',version:packageVersion(path.dirname(entry.path))};
}
function rolePath(root, relative) {
  if (typeof relative!=='string' || !relative || relative.includes('\\') || path.isAbsolute(relative)) throw new Error('Role requires relative path');
  const file=path.resolve(root,relative), rel=path.relative(root,file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Role path escapes package');
  let cursor=root;
  for (const part of rel.split(path.sep)) {cursor=path.join(cursor,part);if(fs.lstatSync(cursor).isSymbolicLink())throw new Error('Linked role path outside reviewed package');}
  if (!fs.statSync(file).isFile()) throw new Error('Role must be a file');
  return file;
}
function rolesFor(wrapper) {
  const root=path.dirname(wrapper.path), index=path.join(root,'references/catalog.json');
  if (!fs.existsSync(index)) return [];
  const data=JSON.parse(fs.readFileSync(index,'utf8'));
  if (!Array.isArray(data.roles)) return [];
  const seen=new Set();
  return data.roles.map(role=>{
    if (typeof role.name!=='string' || !role.name.trim() || typeof role.description!=='string' || !role.description.trim()) throw new Error('Invalid role metadata');
    const file=rolePath(root,role.path), key=process.platform==='win32'?file.toLowerCase():file;
    if(seen.has(key))throw new Error('Duplicate role path');seen.add(key);
    const sha256=hash(fs.readFileSync(file));
    return {name:role.name,description:role.description,path:file,sha256,kind:'role',packagePath:wrapper.path,
      department:role.department??null,sourcePath:role.sourcePath??null,version:hash(JSON.stringify([wrapper.version,role.path,sha256])),
      provenance:fs.existsSync(path.join(root,'PROVENANCE.json'))?path.join(root,'PROVENANCE.json'):null};
  });
}
export function readSkillEntry(entry) {
  if (entry.kind!=='role') return readSkillMetadata(entry.path);
  const wrapper=readSkillMetadata(entry.packagePath);
  const match=rolesFor(wrapper).find(role=>process.platform==='win32'?role.path.toLowerCase()===path.resolve(entry.path).toLowerCase():role.path===path.resolve(entry.path));
  if (!match) throw new Error('Role no longer present in package index');
  return match;
}
// Metadata only. Listing a capability never loads a skill body or executes its scripts.
export function catalog(roots, libraryFile = null, { onError = null } = {}) {
  const result = [], visited = new Set();
  for (const root of roots) {
    if (isBackupPath(root)) continue;
    let resolved, entries;
    try { resolved = fs.realpathSync(root); entries = fs.readdirSync(resolved, { withFileTypes: true }); }
    catch (error) { if (!onError) throw error; onError({ path: root, reason: error.message }); continue; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || isBackupPath(path.join(resolved, entry.name))) continue;
      const file = path.join(resolved, entry.name, 'SKILL.md');
      if (!fs.existsSync(file)) continue;
      try {
        const actual = fs.realpathSync(file);
        if (visited.has(actual)) continue;
        visited.add(actual);
        const wrapper = { ...readSkillMetadata(actual), root: resolved };
        result.push(wrapper, ...rolesFor(wrapper).map(role => ({...role, root:resolved})));
      } catch (error) { if (!onError) throw error; onError({ path: file, reason: error.message }); }
    }
  }
  if (libraryFile && fs.existsSync(libraryFile)) {
    const registry = JSON.parse(fs.readFileSync(libraryFile, 'utf8'));
    if (registry.schemaVersion !== 1 || !Array.isArray(registry.skills)) throw new Error('Unsupported library registry');
    for (const skill of result) {
      const entry = registry.skills.find(item => process.platform === 'win32' ? item.path.toLowerCase() === path.dirname(skill.path).toLowerCase() : item.path === path.dirname(skill.path));
      if (entry) skill.library = { id: entry.id, source: entry.source, commit: entry.installedCommit, baselineVerified: entry.baselineVerified, protected: entry.protected };
    }
  }
  const names = new Map();
  for (const skill of result) names.set(skill.name, (names.get(skill.name) ?? 0) + 1);
  return result.map(skill => ({ ...skill, ambiguous: names.get(skill.name) > 1 }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const roots = process.argv.slice(2);
    const index = roots.indexOf('--library');
    const libraryFile = index >= 0 ? roots.splice(index, 2)[1] : null;
    if (index >= 0 && !libraryFile) throw new Error('--library requires registry.json');
    console.log(JSON.stringify(catalog(roots.length ? roots : [path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')], libraryFile), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
