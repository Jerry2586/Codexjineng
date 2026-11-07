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
export function independentReviewer(actor) {
  return !!actor && ['subagent','human'].includes(actor.kind) && ['tool','runtime'].includes(actor.source)
    && typeof actor.observation==='string' && !!actor.observation.trim();
}
export function reviewWaiver(input,planVersion) {
  check(input && typeof input==='object','Review exemption requires a waiver with source and reason');
  return {source:text(input.source,'review waiver source'),reason:text(input.reason,'review waiver reason'),planVersion,at:now()};
}
function taskExecutors(task) {
  return (task.routing?.routes??[]).flatMap(r=>[r.audit?.executor,...r.outcomes.map(o=>o.executor)]).filter(Boolean);
}
export function recordReview(state,task,request,root,helpers) {
  const reviewer=actorRecord(request.reviewer), independent=request.independent===true;
  check(!independent || independentReviewer(reviewer),'Independent review requires a recorded subagent/human observation');
  const executors=taskExecutors(task);
  check(!independent || !executors.some(a=>a.id===reviewer.id),'Independent reviewer cannot be the task executor');
  const findings=request.findings;
  check(findings && ['blocking','advisory'].every(k=>Number.isSafeInteger(findings[k])&&findings[k]>=0),'Review requires nonnegative findings counts');
  // items describes blocking findings; even a zero count must agree with supplied details.
  check(findings.items===undefined || Array.isArray(findings.items)&&findings.items.length===findings.blocking,'Blocking findings count must match issue details');
  check(request.result!=='passed' || findings.blocking===0,'Passing review cannot contain blocking findings');
  if(request.metrics!==undefined) {
    check(request.metrics && ['before','after'].every(k=>request.metrics[k] && typeof request.metrics[k]==='object' && !Array.isArray(request.metrics[k])),'Review metrics require before/after objects');
  }
  const issueIds=[];
  if(findings.blocking>0) {
    check(Array.isArray(findings.items)&&findings.items.length===findings.blocking,'Blocking findings require one issue detail per finding');
    for(const item of findings.items) {
      auditTransition(state,task,{...item,action:'issue-open',blocking:true,reviewer,independent,artifact:request.artifact},root,helpers);
      issueIds.push(task.issues.at(-1).id);
    }
  }
  return {reviewer,independent,findings:structuredClone(findings),...(issueIds.length?{issueIds}:{}),...(request.metrics!==undefined?{metrics:structuredClone(request.metrics)}:{})};
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
  // A clean review must still leave a record: absence and "found nothing" are different states.
  const reviewRecord=(task.evidence??[]).filter(e=>e.kind==='review'&&e.planVersion===task.planVersion).at(-1);
  const waiver=task.reviewWaiver;
  const waived=task.reviewRequired===false && waiver?.planVersion===task.planVersion && !!waiver.source?.trim() && !!waiver.reason?.trim();
  const review={required:!waived,waiver:waived?waiver:null,record:reviewRecord??null,valid:!!reviewRecord&&reviewRecord.result==='passed'&&reviewRecord.independent===true&&independentReviewer(reviewRecord.reviewer)&&!taskExecutors(task).some(actor=>actor.id===reviewRecord.reviewer.id)&&reviewRecord.findings?.blocking===0&&artifactValid(root,reviewRecord.artifact,helpers)&&reviewRecord.fingerprint===helpers.fingerprint(root,task.watch)};
  const reason=routes.find(r=>!r.valid)?.reason ?? (acceptance.some(a=>!a.valid)?'Acceptance evidence missing, failed, or stale':null)
    ?? (issues.some(i=>i.blocking&&!i.valid)?'Blocking issue requires repair and current retest':null)
    ?? (review.required&&!review.valid?'Independent review evidence missing, failed, or stale':null);
  return {status:reason?'pending':'ready',ready:!reason,reason,routes,acceptance,issues,review};
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
    check(!request.independent || independentReviewer(reviewer),'Independent review requires subagent identity from tool return');
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
