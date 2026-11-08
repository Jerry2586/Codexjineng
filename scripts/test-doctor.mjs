import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {doctor,handoff} from '../skills/auto-dev/scripts/doctor.mjs';
import {initialize,transact} from '../skills/auto-dev/scripts/task-runtime.mjs';
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'smartbuild-doctor-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.writeFileSync(path.join(root,'app.txt'),'one');return root;}
const add={action:'add',title:'Repair',scope:'app.txt only',watch:['app.txt'],acceptance:['works']};
test('doctor reads an empty project without creating a ledger or claiming live AOCI',t=>{const root=fixture(t),before=fs.readdirSync(root);const r=doctor(root);assert.equal(r.ledger.status,'absent');assert.equal(r.aoci.mcp,'unverified');assert.equal(r.aoci.cli,'unverified');assert.deepEqual(fs.readdirSync(root),before);assert.match(handoff(r),/未验证|unverified/);});
test('doctor reports legacy completion, pending operations and invalid evidence without writing',t=>{const root=fixture(t);initialize(root,'test','session');transact(root,{...add,expectedRevision:0});const file=path.join(root,'auto-dev-state.json'),state=JSON.parse(fs.readFileSync(file));state.tasks[0].status='completed';state.lock=null;state.tasks[0].operations=[{key:'deploy-1',operation:'deploy',status:'pending'}];state.tasks[0].evidence=[{kind:'business',result:'passed',planVersion:1,artifact:{path:'.smartbuild/evidence/missing.txt',sha256:'0'.repeat(64)}}];fs.writeFileSync(file,JSON.stringify(state));const before=fs.readFileSync(file,'utf8'),r=doctor(root);assert.equal(r.ledger.tasks[0].completion.status,'historical-unverified');assert.equal(r.ledger.tasks[0].evidence.business,false);assert.equal(r.ledger.pending.length,1);assert.match(r.nextAction,/pending|核实/);assert.equal(fs.readFileSync(file,'utf8'),before);});
test('doctor detects watched source drift and malformed ledger independently',t=>{const root=fixture(t);initialize(root,'test','session');transact(root,{...add,expectedRevision:0});const file=path.join(root,'auto-dev-state.json'),state=JSON.parse(fs.readFileSync(file));state.tasks[0].checkpoint={fingerprint:'old'};fs.writeFileSync(file,JSON.stringify(state));assert.equal(doctor(root).ledger.tasks[0].drift,true);fs.writeFileSync(file,'{broken');const before=fs.readFileSync(file,'utf8'),r=doctor(root);assert.equal(r.ledger.status,'invalid');assert.equal(fs.readFileSync(file,'utf8'),before);});
test('doctor distinguishes core changes, user customization and missing packages',t=>{const root=fixture(t),source=path.join(root,'source'),installed=path.join(root,'installed');for(const name of ['auto-dev','custom','missing']){fs.mkdirSync(path.join(source,name),{recursive:true});fs.writeFileSync(path.join(source,name,'SKILL.md'),'---\nname: '+name+'\ndescription: fixture\n---\nOriginal');}fs.mkdirSync(path.join(installed,'auto-dev'),{recursive:true});fs.mkdirSync(path.join(installed,'custom'),{recursive:true});fs.writeFileSync(path.join(installed,'auto-dev','SKILL.md'),'changed');fs.writeFileSync(path.join(installed,'custom','SKILL.md'),'用户定制');const r=doctor(root,{source,installed}),byName=Object.fromEntries(r.installation.packages.map(p=>[p.name,p]));assert.equal(byName['auto-dev'].status,'core-diff');assert.equal(byName.custom.status,'customized');assert.equal(byName.missing.status,'missing');assert.equal(fs.readFileSync(path.join(installed,'custom','SKILL.md'),'utf8'),'用户定制');});

test('doctor checks only an explicitly supplied absolute diagnostic binary and surfaces incompatible versions',t=>{const root=fixture(t),script=fileURLToPath(new URL('../skills/auto-dev/scripts/doctor.mjs',import.meta.url));const result=spawnSync(process.execPath,[script,root,'--aoci-binary',process.execPath,'--json'],{encoding:'utf8'});assert.equal(result.status,2,result.stderr);const report=JSON.parse(result.stdout);assert.equal(report.aoci.binary,process.execPath);assert.equal(report.aoci.cli,'available');assert.equal(report.aoci.versionOutput,process.version);assert.equal(report.aoci.contractMatch,false);assert.equal(report.aoci.mcp,'unverified');assert.equal(fs.existsSync(path.join(root,'auto-dev-state.json')),false);assert.match(handoff(report),/CLI available/);});
test('doctor rejects relative or missing explicit AOCI paths',t=>{const root=fixture(t);assert.throws(()=>doctor(root,{aociBinary:'aoci'}),/absolute binary path/);const script=fileURLToPath(new URL('../skills/auto-dev/scripts/doctor.mjs',import.meta.url));const result=spawnSync(process.execPath,[script,root,'--aoci-binary'],{encoding:'utf8'});assert.equal(result.status,1);assert.match(result.stderr,/requires a path/);});

for (const initialized of [true, false]) test('doctor flags a write lock without deleting it; initialized='+initialized, t=>{
 const root=fixture(t);
 if(initialized)initialize(root,'test','session');
 const lock=path.join(root,'auto-dev-state.json.lock'),bytes=JSON.stringify({pid:2147483647,at:'2026-01-01T00:00:00Z'});
 fs.writeFileSync(lock,bytes);
 const before=fs.readdirSync(root).sort(),ledger=initialized?fs.readFileSync(path.join(root,'auto-dev-state.json'),'utf8'):null;
 const script=fileURLToPath(new URL('../skills/auto-dev/scripts/doctor.mjs',import.meta.url));
 const result=spawnSync(process.execPath,[script,root,'--json'],{encoding:'utf8'});
 assert.equal(result.status,2,result.stderr||result.stdout);
 const report=JSON.parse(result.stdout);
 assert.equal(report.status,'needs-attention');assert.equal(report.ledger.writeLockPresent,true);assert.match(report.nextAction,/写锁/);
 assert.equal(fs.readFileSync(lock,'utf8'),bytes);assert.deepEqual(fs.readdirSync(root).sort(),before);
 if(initialized)assert.equal(fs.readFileSync(path.join(root,'auto-dev-state.json'),'utf8'),ledger);
});

for(const destination of ['source','installed']) for(const mode of ['empty','missing-one']) test('R004 doctor detects '+mode+' capability profiles in '+destination,t=>{
 const root=fixture(t),source=path.join(root,'source'),installed=path.join(root,'installed');
 fs.cpSync(fileURLToPath(new URL('../skills',import.meta.url)),source,{recursive:true});
 if(destination==='installed')fs.cpSync(source,installed,{recursive:true});
 const file=path.join(destination==='source'?source:installed,'auto-dev/references/profiles.json');
 const stored=JSON.parse(fs.readFileSync(file,'utf8')),removed=mode==='empty'?stored.skills:stored.skills.slice(0,1);
 assert.ok(removed.length);stored.skills=mode==='empty'?[]:stored.skills.slice(1);fs.writeFileSync(file,JSON.stringify(stored));
 const before=fs.readFileSync(file,'utf8'),r=doctor(root,{source,...(destination==='installed'?{installed}:{})});
 const profiles=destination==='source'?r.source.profiles:r.installation.profiles;
 assert.equal(profiles.status,'needs-attention');assert.equal(r.status,'needs-attention');
 for(const item of removed)assert.ok(profiles.items.some(p=>p.name===item.name&&p.status==='missing'),item.name);
 assert.equal(fs.readFileSync(file,'utf8'),before,'diagnostics must remain read-only');
});

test('R004 unrelated malformed installed metadata does not affect distribution profile coverage', t => {
 const root=fixture(t),source=path.join(root,'source'),installed=path.join(root,'installed');
 fs.cpSync(fileURLToPath(new URL('../skills',import.meta.url)),source,{recursive:true}); fs.cpSync(source,installed,{recursive:true});
 const extra=path.join(installed,'unrelated'); fs.mkdirSync(extra); fs.writeFileSync(path.join(extra,'SKILL.md'),'---\nname: unrelated\n---\nMissing description');
 const file=path.join(installed,'auto-dev/references/profiles.json'),stored=JSON.parse(fs.readFileSync(file,'utf8'));
 stored.skills.push({...stored.skills[0],name:'unrelated',dir:'unrelated',file:'unrelated/SKILL.md'}); fs.writeFileSync(file,JSON.stringify(stored));
 const before=fs.readFileSync(file,'utf8'),report=doctor(root,{source,installed});
 assert.equal(report.installation.profiles.status,'current'); assert.deepEqual(report.installation.profiles.warnings,[]);
 assert.ok(!report.installation.profiles.items.some(item=>item.name==='unrelated'));
 assert.equal(fs.readFileSync(file,'utf8'),before);
});
