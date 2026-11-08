import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {canonicalRoot,readState,summary,fingerprint,roundReport} from './task-runtime.mjs';
import {catalog,readSkillMetadata} from './skill-catalog.mjs';
import {loadProfiles} from './skill-router.mjs';
import {buildProfiles} from './build-profiles.mjs';
import {validAuthorization,CONTRACT_VERSION} from './workflow-contract.mjs';
import {probe} from '../../aoci-workflow/scripts/probe-aoci.mjs';
const defaultSource=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const key=value=>process.platform==='win32'?path.resolve(value).toLowerCase():path.resolve(value);
function files(root){
 const result=new Map();
 const visit=folder=>{for(const item of fs.readdirSync(folder,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
  if(['.git','node_modules','__pycache__'].includes(item.name))continue;
  const absolute=path.join(folder,item.name),relative=path.relative(root,absolute).split(path.sep).join('/');
  if(item.isSymbolicLink())throw new Error('Linked package file requires review: '+relative);
  if(item.isDirectory())visit(absolute);else if(item.isFile()){if(result.size>=10000)throw new Error('Package scope too large');result.set(relative,digest(fs.readFileSync(absolute)));}
 }};
 if(fs.lstatSync(root).isSymbolicLink())throw new Error('Linked package root requires review');
 visit(root);return result;
}
function profileReport(root,entries,{restrictToEntries=false}={}){
 const warnings=[],profiles=loadProfiles(root,{warn:value=>warnings.push(value)});
 const included=new Set(entries.map(entry=>key(entry.path)));
 const items=profiles.filter(profile=>!restrictToEntries||included.has(key(profile.path))).map(profile=>{const entry=entries.find(e=>key(e.path)===key(profile.path));return {path:profile.path,name:entry?.name??path.basename(path.dirname(profile.path)),status:!entry?'unmatched':entry.sha256===profile.sha256&&entry.version===profile.version?'current':'stale'};});
 try{
  const present=new Set(items.map(item=>key(item.path)));
  for(const expected of buildProfiles(root,{entries})){
   const file=path.resolve(root,expected.file);
   if(included.has(key(file))&&!present.has(key(file)))items.push({path:file,name:expected.name,status:'missing'});
  }
 }catch(error){warnings.push({kind:'profile-coverage-unverified',reason:error.message});}
 return {status:warnings.length||items.some(i=>i.status!=='current')?'needs-attention':'current',items,warnings,meaning:'Capability declarations; semantic review and execution are separate.'};
}
function installationReport(source,installed,entries){
 if(!installed)return {status:'not-requested',packages:[]};
 const packages=[];
 for(const entry of entries.filter(e=>e.kind!=='role')){
  const relative=path.relative(source,path.dirname(entry.path)),target=path.join(installed,relative);
  try{
   if(!fs.existsSync(target)){packages.push({name:entry.name,status:'missing',path:target});continue;}
   const from=files(path.dirname(entry.path)),to=files(target),missing=[],changed=[],extra=[];
   for(const [file,hash] of from){if(!to.has(file))missing.push(file);else if(to.get(file)!==hash)changed.push(file);}
   for(const file of to.keys())if(!from.has(file))extra.push(file);
   const generatedOnly=entry.name==='auto-dev'&&!missing.length&&changed.every(file=>file==='references/profiles.json');
   const core=['auto-dev','aoci-workflow'].includes(entry.name);
   const status=!missing.length&&!changed.length?'same':generatedOnly?'generated-profile-diff':core?'core-diff':'customized';
   packages.push({name:entry.name,path:target,status,missing,changed,extra});
  }catch(error){packages.push({name:entry.name,path:target,status:'error',reason:error.message});}
 }
 const problems=packages.filter(p=>['missing','core-diff','error'].includes(p.status));
 return {status:problems.length?'needs-attention':'aligned',root:installed,packages};
}
function ledgerReport(root){
 const writeLockPresent=fs.existsSync(path.join(root,'auto-dev-state.json.lock'));
 if(!fs.existsSync(path.join(root,'auto-dev-state.json'))){
  const legacy=['auto-dev-ledger.md','.codex/auto-dev-ledger.md'].filter(file=>fs.existsSync(path.join(root,file)));
  return {status:legacy.length?'legacy':'absent',writeLockPresent,legacy,tasks:[],pending:[]};
 }
 let state;
 try{state=readState(root);}catch(error){return {status:'invalid',writeLockPresent,reason:error.message,tasks:[],pending:[]};}
 const tasks=state.tasks.map(task=>{
  const item={id:task.id,title:task.title,status:task.status,scope:task.scope,planVersion:task.planVersion,nextAction:task.nextAction,authorization:{valid:validAuthorization(task.authorization,task.scope)&&task.authorization.planVersion===task.planVersion,operations:task.authorization?.operations??[]}};
  try{
   item.fingerprint=fingerprint(root,task.watch);item.drift=!!task.checkpoint&&task.checkpoint.fingerprint!==item.fingerprint;
   const check=summary({...state,tasks:[task]},root).checks[0];
   item.completion=check.completion;item.workflow={ready:check.workflow.ready,reason:check.workflow.reason,status:check.workflow.status};item.evidence=check.evidence;
  }catch(error){item.error=error.message;}
  return item;
 });
 const pending=state.tasks.flatMap(task=>(task.operations??[]).filter(op=>op.status==='pending').map(op=>({id:task.id,key:op.key,operation:op.operation})));
 const round=roundReport(state,root);
 return {status:'readable',project:state.project,schemaVersion:state.schemaVersion,revision:state.revision,round:{id:state.round.id,status:state.round.status,valid:round.valid,reason:round.reason},session:state.session,paused:state.paused,lock:state.lock,writeLockPresent,tasks,pending};
}
export function doctor(project,{source=defaultSource,installed,aociBinary}={}){
 const root=canonicalRoot(project),sourceRoot=path.resolve(source),installedRoot=installed?path.resolve(installed):null,errors=[];
 const entries=catalog([sourceRoot],null,{onError:error=>errors.push(error)});
 const sourceProfiles=profileReport(sourceRoot,entries),installation=installationReport(sourceRoot,installedRoot,entries);
 // Only inspect the packages belonging to this source distribution in the installed library.
 if(installedRoot&&fs.existsSync(installedRoot)){
  const installedEntries=[];
  for(const entry of entries.filter(e=>e.kind!=='role')){const folder=path.join(installedRoot,path.relative(sourceRoot,path.dirname(entry.path)));if(!fs.existsSync(folder))continue;
   try {installedEntries.push(readSkillMetadata(path.join(folder,'SKILL.md')));}catch(error){errors.push({path:folder,reason:error.message});}
  }
  installation.profiles=profileReport(installedRoot,installedEntries,{restrictToEntries:true});
 }
 const ledger=ledgerReport(root),aoci=probe(root,aociBinary);
 const aociIssue=!!aociBinary&&(aoci.cli!=='available'||!aoci.contractMatch);
 let nextAction='按当前用户请求选择范围；诊断没有修改账本。';
 if(ledger.status==='invalid')nextAction='先核实并修复现有账本格式或项目身份，保留原文件。';
 else if(ledger.pending.length)nextAction='先核实 pending 操作的真实结果，再以原幂等键登记 operation-finish。';
 else if(ledger.writeLockPresent)nextAction='先核实账本写锁的进程与状态，不自动删除锁。';
 else if(installation.status==='needs-attention')nextAction='检查安装差异，使用带备份安装器同步核心与缺失技能，保留用户定制。';
 else if(ledger.tasks.some(t=>t.error||t.drift||t.status==='completed'&&!t.completion?.valid))nextAction='核对源码变化和历史完成证据；需复验的完成项显式 reopen，保留历史。';
 else if(ledger.paused)nextAction='任务保持暂停，等待用户独立发送“开始制作”恢复原授权范围。';
 else if(ledger.lock)nextAction=ledger.tasks.find(t=>t.id===ledger.lock)?.nextAction??'核对当前任务范围与证据。';
 else if(aociIssue)nextAction=aoci.nextAction;
 const findings=(ledger.writeLockPresent?1:0)+(aociIssue?1:0)+errors.length+(sourceProfiles.status!=='current'?1:0)+(installation.profiles?.status==='needs-attention'?1:0)+installation.packages.filter(p=>['missing','core-diff','error'].includes(p.status)).length+ledger.pending.length+ledger.tasks.filter(t=>t.error||t.drift||t.status==='completed'&&!t.completion?.valid).length+(ledger.status==='invalid'?1:0);
 return {contractVersion:CONTRACT_VERSION,projectRoot:root,status:findings?'needs-attention':'checked',source:{root:sourceRoot,packageCount:entries.filter(e=>e.kind!=='role').length,fingerprint:digest(JSON.stringify(entries.map(e=>[path.relative(sourceRoot,e.path).split(path.sep).join('/'),e.sha256,e.version]))),profiles:sourceProfiles,errors},installation,ledger,aoci,nextAction};
}
export function handoff(report){
 const l=report.ledger;
 return ['项目：'+report.projectRoot,'源码：'+report.source.fingerprint,'账本：'+l.status+'；修订 '+(l.revision??'无')+'；锁 '+(l.lock??'无')+'；暂停 '+(l.paused?'是':'否'),...l.tasks.map(t=>t.id+' '+t.status+'｜'+t.scope+'｜授权 '+(t.authorization.valid?t.authorization.operations.join(','):'待核对')+'｜证据 '+(t.error??t.workflow?.reason??'见诊断')), '待核实操作：'+(l.pending.map(op=>op.id+'/'+op.operation+'/'+op.key).join('，')||'无'),'AOCI：CLI '+report.aoci.cli+'；版本 '+(report.aoci.versionOutput??'未检查')+'；合同匹配 '+(report.aoci.contractMatch?'是':'未确认')+'；MCP/当前会话认知未验证。','下一步：'+report.nextAction,'历史聊天只供追溯，不能作为新增授权或当前验证通过。'].join('\n')+'\n';
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{
  const args=process.argv.slice(2),project=args.shift(),options={};let asHandoff=false;
  if(!project)throw new Error('Usage: doctor.mjs <project> [--source <skills-root>] [--installed <skills-root>] [--aoci-binary <trusted-absolute-path>] [--handoff|--json]');
  while(args.length){const flag=args.shift();if(flag==='--handoff')asHandoff=true;else if(flag==='--json'){}else if(['--source','--installed','--aoci-binary'].includes(flag)){const value=args.shift();if(!value||value.startsWith('--'))throw new Error(flag+' requires a path');options[flag==='--aoci-binary'?'aociBinary':flag.slice(2)]=value;}else throw new Error('Unknown argument: '+flag);}
  const report=doctor(project,options);console.log(asHandoff?handoff(report):JSON.stringify(report,null,2));process.exitCode=report.status==='needs-attention'?2:0;
 }catch(error){console.error(error.message);process.exitCode=1;}
}
