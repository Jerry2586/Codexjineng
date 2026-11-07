import { readSkillEntry } from './skill-catalog.mjs';
const check=(ok,message)=>{if(!ok)throw new Error(message);};
const text=(s,key)=>{check(typeof s==='string'&&s.trim(),key+' required');return s.trim();};
const now=()=>new Date().toISOString();
export function actorRecord(input) {
  check(input && ['main','subagent','human','tool'].includes(input.kind),'Executor identity required');
  const actor={id:text(input.id,'actor.id'),kind:input.kind,model:input.model??null,source:input.source??'unknown'};
  check(['runtime','tool','unknown'].includes(actor.source),'Invalid identity source');
  check(actor.model===null || typeof actor.model==='string' && actor.model.trim(),'Invalid model identity');
  check(actor.model===null || actor.source!=='unknown','Unknown identity source cannot assert a model');
  if(actor.source!=='unknown') actor.observation=text(input.observation,'identity tool/runtime observation');
  return actor;
}
export function selectionAudit(input,hasSkill) {
  check(input && input.compatible===true && typeof input.read==='boolean','Selection audit and compatibility required');
  check(!hasSkill || input.read===true,'Selected skill instructions must be read');
  return {read:input.read,compatible:true,reason:text(input.reason,'audit.reason'),executor:actorRecord(input.executor),at:now()};
}
function artifactValid(root,proof,helpers) { try{return !!proof&&helpers.artifact(root,proof.path).sha256===proof.sha256;}catch{return false;} }
function currentRecord(task,record,root,helpers,current=true) {
  return !!record && record.planVersion===task.planVersion && artifactValid(root,record.artifact,helpers)
    && (!current || record.fingerprint===helpers.fingerprint(root,task.watch));
}
function routeCheck(task,step,root,helpers,current=true) {
  const route=task.routing?.routes.filter(r=>r.step===step&&r.planVersion===task.planVersion).at(-1);
  if(!route)return {step,valid:false,reason:'Routing selection missing for step '+step};
  if(!route.audit)return {step,valid:false,reason:'Routing identity audit missing for step '+step};
  try{for(const skill of [route.selection.primary,...route.selection.support].filter(Boolean)){
    const actual=readSkillEntry(skill);check(actual.sha256===skill.sha256&&actual.version===skill.version&&actual.name===skill.name,'version');
  }}catch{return {step,valid:false,reason:'Routing skill dependencies changed for step '+step};}
  const outcome=route.outcomes.at(-1);
  if(!outcome || outcome.result!=='passed' || !outcome.executor)return {step,valid:false,reason:'Routing successful outcome required for step '+step};
  if(!artifactValid(root,outcome.artifact,helpers) || (current && outcome.fingerprint!==helpers.fingerprint(root,task.watch)))return {step,valid:false,reason:'Routing outcome stale for step '+step};
  return {step,valid:true,reason:null};
}
export function assertStepReady(task,step,root,helpers) {
  check(task.workflowVersion===1,'Legacy task requires adopt-workflow review before advancing');
  const result=routeCheck(task,step,root,helpers);check(result.valid,result.reason);
}
export function workflowReport(task,root,helpers,{beforeDelivery=false}={}) {
  if(task.workflowVersion!==1)return {status:'legacy-unreviewed',ready:false,reason:'Historical workflow evidence has not been reviewed',routes:[],acceptance:[],issues:[]};
  const routes=task.steps.map((_,i)=>routeCheck(task,i+1,root,helpers,i+1===task.steps.length));
  const acceptance=task.acceptance.map((criterion,index)=>{const record=task.acceptanceResults?.filter(r=>r.planVersion===task.planVersion&&r.criterion===index).at(-1);return {criterion:index,text:criterion,pendingDelivery:record?.result==='pending-delivery'?record.operation:null,valid:(record?.result==='passed'||beforeDelivery&&record?.result==='pending-delivery'&&task.deliveries.includes(record.operation)&&task.authorization?.operations.includes(record.operation))&&currentRecord(task,record,root,helpers)};});
  // Findings survive amendments: changing a plan cannot erase a known defect.
  const issues=(task.issues??[]).map(issue=>({id:issue.id,title:issue.title,blocking:issue.blocking,valid:issue.status==='resolved'&&artifactValid(root,issue.artifact,helpers)&&currentRecord(task,issue.resolution,root,helpers)}));
  const reason=routes.find(r=>!r.valid)?.reason ?? (acceptance.some(a=>!a.valid)?'Acceptance evidence missing, failed, or stale':null)
    ?? (issues.some(i=>i.blocking&&!i.valid)?'Blocking issue requires repair and current retest':null);
  return {status:reason?'pending':'ready',ready:!reason,reason,routes,acceptance,issues};
}
export function assertWorkflowReady(task,root,helpers,options) {
  const report=workflowReport(task,root,helpers,options);check(report.ready,report.reason);
}
export function auditTransition(state,task,request,root,helpers) {
  const base=()=>({planVersion:task.planVersion,fingerprint:helpers.fingerprint(root,task.watch),session:state.session,at:now()});
  const changes=()=>{check(Array.isArray(request.changes)&&request.changes.length,'changes required');return request.changes.map(file=>{helpers.localPath(root,file);check(task.watch.some(w=>file===w||file.startsWith(w+'/')),'Change outside task watch');return file;});};
  if(request.action==='adopt-workflow') {
    check(task.workflowVersion!==1,'Workflow already adopted');check(request.reviewed===true,'Legacy review required');
    task.workflowVersion=1;task.history.push({workflowAdoption:{...base(),artifact:helpers.artifact(root,request.artifact),reason:text(request.reason,'reason')}});
  } else if(request.action==='acceptance-result') {
    check(Number.isInteger(request.criterion)&&request.criterion>=0&&request.criterion<task.acceptance.length,'Unknown acceptance criterion');
    check(['passed','failed','pending-delivery'].includes(request.result),'Invalid acceptance result');
    if(request.result==='pending-delivery')check(request.operation!=='local'&&task.deliveries.includes(request.operation)&&task.authorization.operations.includes(request.operation),'Pending delivery requires an authorized external delivery');
    (task.acceptanceResults??=[]).push({...base(),criterion:request.criterion,result:request.result,...(request.result==='pending-delivery'?{operation:request.operation}:{}),changes:changes(),verification:text(request.verification,'verification'),artifact:helpers.artifact(root,request.artifact)});
  } else if(request.action==='issue-open') {
    const reviewer=actorRecord(request.reviewer);
    check(!request.independent || reviewer.kind==='subagent'&&reviewer.source==='tool','Independent review requires subagent identity from tool return');
    check(['critical','high','medium','low'].includes(request.severity),'Invalid issue severity');
    if(request.criterion!==undefined)check(Number.isInteger(request.criterion)&&request.criterion>=0&&request.criterion<task.acceptance.length,'Unknown issue criterion');
    const issues=task.issues??=[];
    issues.push({...base(),id:'I'+(issues.length+1),title:text(request.title,'issue.title'),severity:request.severity,criterion:request.criterion??null,
      blocking:request.blocking!==false || ['critical','high'].includes(request.severity),status:'open',reviewer,independent:request.independent===true,artifact:helpers.artifact(root,request.artifact)});
  } else if(request.action==='issue-resolve') {
    const issue=task.issues?.find(i=>i.id===request.issueId);check(issue,'Unknown issue');
    text(request.fix,'fix'); changes(); text(request.verification,'verification');
    const retest=helpers.artifact(root,request.artifact);
    check(retest.path!==issue.artifact.path && retest.sha256!==issue.artifact.sha256,'Retest needs new evidence distinct from finding');
    issue.resolution={...base(),fix:text(request.fix,'fix'),changes:changes(),verification:text(request.verification,'verification'),artifact:helpers.artifact(root,request.artifact)};issue.status='resolved';
  } else if(request.action==='issue-reopen') {
    const issue=task.issues?.find(i=>i.id===request.issueId);check(issue,'Unknown issue');
    issue.status='open';(issue.history??=[]).push({...base(),reason:text(request.reason,'reason'),artifact:helpers.artifact(root,request.artifact)});
  } else if(request.action==='recover') {
    check(request.reviewed===true,'Recovery requires actual source and evidence review');
    task.recovery={...base(),scope:task.scope,authorization:structuredClone(task.authorization),checkpoint:structuredClone(task.checkpoint??null),
      artifact:helpers.artifact(root,request.artifact),reason:text(request.reason,'reason'),report:workflowReport(task,root,helpers)};
    task.nextAction=text(request.nextAction,'nextAction');
  } else throw new Error('Unknown workflow audit action');
}
export function recoveryReady(state,task,root,helpers) {
  if(task.workflowVersion!==1 || task.recoveryRequired!==state.session)return true;
  return task.recovery?.session===state.session&&currentRecord(task,task.recovery,root,helpers);
}
