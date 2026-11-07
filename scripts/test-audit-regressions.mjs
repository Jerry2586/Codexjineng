import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {initialState, transition, summary, readState} from '../skills/auto-dev/scripts/task-runtime.mjs';
import { renderPanel } from '../skills/auto-dev/scripts/panel.mjs';
const executor={id:'implementer',kind:'main',source:'unknown'};
const reviewer={id:'reviewer',kind:'subagent',source:'tool',observation:'fixture independent return'};
function fixture(t,options={}) {
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'smartbuild-regression-')));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'.smartbuild/evidence'),{recursive:true});fs.writeFileSync(path.join(root,'app.txt'),'v1');
 let state=initialState(root,'regression','session'),seq=0;
 const act=(action,fields={})=>state=transition(state,{action,id:state.lock??'R001',expectedRevision:state.revision,...fields},root);
 const proof=()=>{const file='.smartbuild/evidence/'+(++seq)+'.txt';fs.writeFileSync(path.join(root,file),'fixture observation '+seq);return file;};
 const add=(fields={})=>act('add',{id:undefined,title:'task',scope:'app',watch:['app.txt'],acceptance:['app works'],...fields});
 const start=(id)=>{act('authorize',{id,message:'开始制作',source:'fixture user',operations:state.tasks.find(t=>t.id===id).deliveries});act('plan',{id,steps:[{title:'implement',input:'app',output:'app',verify:'test'}]});act('start',{id});};
 const quality=()=>{for(const [kind,skill] of [['project_audit','ponytail-audit'],['text_review','humanizer']])act('evidence',{kind,skill,source:'isolated test fixture',result:'passed',summary:'fixture quality check',artifact:proof()});};
 const checks=()=>{act('skill-select',{context:{goal:'regression',needs:['testing']},selection:{primary:null,support:[],reason:'standard regression'},audit:{read:false,compatible:true,reason:'fixture',executor}});act('skill-outcome',{result:'passed',category:'quality',progressed:true,symptom:'checked',reason:'passed',verification:'fixture test',artifact:proof(),executor});act('acceptance-result',{criterion:0,result:'passed',changes:['app.txt'],verification:'fixture test',artifact:proof()});act('evidence',{kind:'business',result:'passed',summary:'fixture',artifact:proof()});quality();};
 const review=(fields={})=>act('evidence',{kind:'review',skill:'ponytail-review',source:'isolated test fixture',result:'passed',summary:'fixture review',artifact:proof(),reviewer,independent:true,findings:{blocking:0,advisory:0},...fields});
 const finish=()=>{checks();review();act('verify');act('deliver');act('evidence',{kind:'local',result:'passed',summary:'fixture delivery',artifact:proof()});act('complete');};
 const {deferStart=false,...taskOptions}=options;add(taskOptions);if(!deferStart)start('R001');
 return {root,act,proof,add,start,quality,checks,review,finish,get state(){return state;}};
}
test('F01 review identity findings and metrics survive state readback',t=>{
 const f=fixture(t);const metrics={before:{complexity:9},after:{complexity:4}};f.review({metrics});
 fs.writeFileSync(path.join(f.root,'auto-dev-state.json'),JSON.stringify(f.state));const record=readState(f.root).tasks[0].evidence.at(-1);
 assert.equal(record.reviewer.id,'reviewer');assert.equal(record.independent,true);assert.deepEqual(record.findings,{blocking:0,advisory:0});assert.deepEqual(record.metrics,metrics);
});
test('F01 passing review cannot contain blocking findings or negative counts',t=>{
 const f=fixture(t);assert.throws(()=>f.review({findings:{blocking:1,advisory:0}}),/blocking/i);assert.throws(()=>f.review({findings:{blocking:-1,advisory:0}}),/findings|nonnegative/i);
});
test('F01 self review does not satisfy the independent review gate',t=>{
 const f=fixture(t);f.checks();f.review({reviewer:executor,independent:false});f.act('verify');assert.throws(()=>f.act('deliver'),/independent review/i);
});
test('F01 exemption must carry a source and reason and cannot erase defects',t=>{
 const f=fixture(t);assert.throws(()=>f.add({reviewRequired:false}),/waiver|exemption/i);
 f.add({reviewRequired:false,reviewWaiver:{source:'fixture user decision',reason:'no independent service; explicitly accepted'}});
 const task=f.state.tasks[1];assert.equal(task.reviewWaiver.planVersion,1);assert.equal(task.history.at(-1).reviewWaiver.source,'fixture user decision');
});
test('F01 failed review materializes blocking issues and needs distinct retest',t=>{
 const f=fixture(t);f.checks();const artifact=f.proof();f.review({result:'failed',artifact,findings:{blocking:1,advisory:0,items:[{title:'invalid input accepted',severity:'high',criterion:0}]}});
 const issue=f.state.tasks[0].issues[0];assert.equal(issue.status,'open');assert.equal(issue.reviewer.id,'reviewer');
 f.review();f.act('verify');assert.throws(()=>f.act('deliver'),/blocking issue/i);
 assert.throws(()=>f.act('issue-resolve',{issueId:issue.id,fix:'guard input',changes:['app.txt'],verification:'retest',artifact}),/distinct/i);
 f.act('issue-resolve',{issueId:issue.id,fix:'guard input',changes:['app.txt'],verification:'regression passed',artifact:f.proof()});f.act('deliver');
});
test('F03 pending operation cannot be deferred and stays reconcilable while blocked',t=>{
 const f=fixture(t,{deliveries:['local','deploy']});f.checks();f.review();f.act('verify');f.act('deliver');f.act('operation-start',{operation:'deploy',target:'fixture only',key:'deploy-once'});f.act('block',{reason:'unknown outcome'});
 assert.throws(()=>f.act('defer',{reason:'wait for network'}),/pending|reconcile/i);assert.equal(f.state.lock,'R001');
 f.act('operation-finish',{key:'deploy-once',result:'not-applied',reason:'read-only target check',artifact:f.proof()});f.act('defer',{reason:'network unavailable'});assert.equal(f.state.tasks[0].operations[0].status,'not-applied');
});

test('F02 sequential tasks may change one file; round closes only after final integrated regression',t=>{
 const f=fixture(t);f.add({title:'follow-up'});f.finish();const original=f.state.tasks[0].completion;
 fs.writeFileSync(path.join(f.root,'app.txt'),'v2');f.start('R002');f.finish();
 const historical=summary(f.state,f.root).checks[0];assert.equal(historical.completion.valid,true);assert.equal(historical.completion.current,false);assert.deepEqual(f.state.tasks[0].completion,original);
 assert.throws(()=>f.act('close-round',{id:undefined,source:'user acceptance',artifact:f.proof()}),/round.*verification|final.*regression/i);
 f.act('round-verification',{id:undefined,result:'passed',verification:'integrated app tests',source:'fixture test run',artifact:f.proof(),coverage:[{id:'R001',criterion:0,result:'passed'},{id:'R002',criterion:0,result:'passed'}]});
 f.act('close-round',{id:undefined,source:'user acceptance',artifact:f.proof()});assert.equal(f.state.round.status,'closed');
});
test('F02 failed or stale final regression and incomplete coverage cannot close a round',t=>{
 const f=fixture(t);f.finish();const fields={id:undefined,verification:'integrated tests',source:'fixture',artifact:f.proof(),coverage:[{id:'R001',criterion:0,result:'passed'}]};
 assert.throws(()=>f.act('round-verification',{...fields,result:'passed',coverage:[]}),/coverage/i);
 f.act('round-verification',{...fields,result:'failed'});assert.throws(()=>f.act('close-round',{id:undefined,source:'acceptance',artifact:f.proof()}),/verification|regression/i);
 f.act('round-verification',{...fields,result:'passed'});fs.writeFileSync(path.join(f.root,'app.txt'),'v3');assert.throws(()=>f.act('close-round',{id:undefined,source:'acceptance',artifact:f.proof()}),/stale|regression/i);
});
test('F02 current-contract completion without snapshot stays unverified until reopened',t=>{
 const f=fixture(t);f.finish();delete f.state.tasks[0].completion;
 assert.equal(summary(f.state,f.root).checks[0].completion.valid,false);
 assert.throws(()=>f.act('round-verification',{id:undefined,result:'passed',verification:'tests',source:'fixture',artifact:f.proof(),coverage:[{id:'R001',criterion:0,result:'passed'}]}),/completion|historical|reopen/i);
 f.act('reopen',{id:'R001',reason:'reverify historical task',source:'current user request'});assert.equal(f.state.tasks[0].status,'queued');assert.equal(f.state.tasks[0].history.at(-1).reopened.previousStatus,'completed');
 f.start('R001');f.finish();assert.equal(summary(f.state,f.root).checks[0].completion.valid,true);
});

test('F05 persisted panel keeps lock, recent completion and newest queued task',t=>{
 const f=fixture(t);f.finish();for(let n=2;n<=7;n++)f.add({title:'task '+n});f.start('R002');
 fs.writeFileSync(path.join(f.root,'auto-dev-state.json'),JSON.stringify(f.state));
 const compact=renderPanel(f.root);for(const id of ['R002','R001','R007'])assert.match(compact,new RegExp('\\| '+id+' \\|'));
 assert.match(compact,/其余 4 项/);const full=renderPanel(f.root,{mode:'full'});for(let n=1;n<=7;n++)assert.ok(full.includes('R00'+n));assert.match(full,/完成时与当前版本均已核验/);
 fs.writeFileSync(path.join(f.root,'app.txt'),'v2');assert.match(renderPanel(f.root,{mode:'full'}),/历史已完成，当前版本待复验/);
 f.act('pause',{id:'R002',nextAction:'resume tests'});fs.writeFileSync(path.join(f.root,'auto-dev-state.json'),JSON.stringify(f.state));assert.match(renderPanel(f.root),/已暂停/);
});
test('F05 panel reads current evidence instead of nonexistent stored checks',t=>{
 const f=fixture(t);f.checks();f.review();fs.writeFileSync(path.join(f.root,'auto-dev-state.json'),JSON.stringify(f.state));assert.match(renderPanel(f.root,{mode:'full'}),/证据齐全/);
 fs.writeFileSync(path.join(f.root,'app.txt'),'changed');assert.doesNotMatch(renderPanel(f.root,{mode:'full'}),/证据齐全/);
 f.act('block',{reason:'service unavailable'});f.act('defer',{reason:'external dependency'});fs.writeFileSync(path.join(f.root,'auto-dev-state.json'),JSON.stringify(f.state));assert.match(renderPanel(f.root),/已搁置/);
});

// Independent acceptance audit regressions; fixtures are synthetic, not delivery evidence.
test('A01 review loses independence if the reviewer later executes the task', t => {
 const f=fixture(t); f.review();
 f.act('skill-select',{context:{goal:'regression',needs:['testing']},selection:{primary:null,support:[],reason:'standard regression'},audit:{read:false,compatible:true,reason:'fixture',executor:reviewer}});
 f.act('skill-outcome',{result:'passed',category:'quality',progressed:true,symptom:'checked',reason:'passed',verification:'fixture',artifact:f.proof(),executor:reviewer});
 f.act('acceptance-result',{criterion:0,result:'passed',changes:['app.txt'],verification:'fixture',artifact:f.proof()});
 f.act('evidence',{kind:'business',result:'passed',summary:'fixture',artifact:f.proof()}); f.quality(); f.act('verify');
 assert.throws(()=>f.act('deliver'),/independent review/i);
});
test('A02 reopened tasks cannot reuse previous acceptance or delivery evidence', t => {
 const f=fixture(t);f.finish();const before=structuredClone(f.state.tasks[0]);
 f.act('reopen',{reason:'fresh acceptance required',source:'fixture user'});
 if(!f.state.tasks[0].authorization)f.act('authorize',{message:'开始制作',source:'fixture user',operations:['local']});
 if(!f.state.tasks[0].steps.length)f.act('plan',{steps:before.steps});
 f.act('start');
 f.act('skill-select',{context:{goal:'regression',needs:['testing']},selection:{primary:null,support:[],reason:'standard regression'},audit:{read:false,compatible:true,reason:'fixture',executor}});
 f.act('skill-outcome',{result:'passed',category:'quality',progressed:true,symptom:'checked',reason:'passed',verification:'fixture',artifact:f.proof(),executor});
 f.act('verify');assert.throws(()=>f.act('deliver'),/project_audit/i);
 assert.equal(f.state.tasks[0].history.at(-1).reopened.basis.evidence.length,before.evidence.length);
 f.act('acceptance-result',{criterion:0,result:'passed',changes:['app.txt'],verification:'fresh test',artifact:f.proof()});
 f.act('evidence',{kind:'business',result:'passed',summary:'fresh test',artifact:f.proof()});
 f.quality();f.review();f.act('deliver');assert.throws(()=>f.act('complete'),/local.*evidence/i);
 f.act('evidence',{kind:'local',result:'passed',summary:'fresh delivery',artifact:f.proof()});f.act('complete');
 assert.equal(summary(f.state,f.root).checks[0].completion.valid,true);
});
test('A03 zero blocking count cannot hide critical finding details', t => {
 const f=fixture(t);const before=structuredClone(f.state);
 assert.throws(()=>f.review({findings:{blocking:0,advisory:1,items:[{title:'critical defect',severity:'critical',blocking:true,criterion:0}]}}),/findings|blocking|detail/i);
 assert.deepEqual(f.state,before);
});
test('A04 genuinely legacy completion remains unverified until fresh acceptance',t=>{
 const f=fixture(t);f.finish();const legacy=f.state.tasks[0];
 for(const key of ['workflowVersion','completion','routing','acceptanceResults','issues'])delete legacy[key];
 legacy.evidence=[];
 assert.equal(summary(f.state,f.root).checks[0].workflow.status,'legacy-unreviewed');
 assert.equal(summary(f.state,f.root).checks[0].completion.valid,false);
 f.act('reopen',{reason:'verify legacy record',source:'fixture user'});
 if(!f.state.tasks[0].authorization)f.act('authorize',{message:'开始制作',source:'fixture user',operations:['local']});
 if(!f.state.tasks[0].steps.length)f.act('plan',{steps:[{title:'reverify',input:'legacy',output:'evidence',verify:'tests'}]});
 f.act('start');f.act('verify');assert.throws(()=>f.act('deliver'),/project_audit/i);
 f.finish();assert.equal(summary(f.state,f.root).checks[0].completion.valid,true);
});

test('A05 reopen can replace a prior generation log without invalidating new completion',t=>{
 const f=fixture(t);f.finish();const old=structuredClone(f.state.tasks[0].evidence.find(e=>e.kind==='business'));
 f.act('reopen',{reason:'rerun acceptance',source:'fixture user'});f.start('R001');f.checks();
 fs.writeFileSync(path.join(f.root,old.artifact.path),'new generation actual test result');
 f.act('evidence',{kind:'business',result:'passed',summary:'new generation test',artifact:old.artifact.path});
 f.review();f.act('verify');f.act('deliver');f.act('evidence',{kind:'local',result:'passed',summary:'new delivery',artifact:f.proof()});f.act('complete');
 assert.equal(summary(f.state,f.root).checks[0].completion.valid,true);
 assert.deepEqual(f.state.tasks[0].history.at(-1).reopened.basis.evidence.find(e=>e.kind==='business'),old);
 f.act('round-verification',{id:undefined,result:'passed',verification:'final integrated tests',source:'fixture',artifact:f.proof(),coverage:[{id:'R001',criterion:0,result:'passed'}]});
 f.act('close-round',{id:undefined,source:'fixture acceptance',artifact:f.proof()});assert.equal(f.state.round.status,'closed');
 fs.writeFileSync(path.join(f.root,old.artifact.path),'tampered current proof');
 assert.equal(summary(f.state,f.root).checks[0].completion.valid,false);
});
test('A06 superseded same-generation logs do not poison the adopted proof snapshot',t=>{
 const f=fixture(t);f.checks();const old=f.state.tasks[0].evidence.find(e=>e.kind==='business');
 fs.writeFileSync(path.join(f.root,old.artifact.path),'rerun passed');
 f.act('evidence',{kind:'business',result:'passed',summary:'latest test result',artifact:old.artifact.path});
 const criterion=f.state.tasks[0].acceptanceResults.at(-1);
 fs.writeFileSync(path.join(f.root,criterion.artifact.path),'latest criterion result');
 f.act('acceptance-result',{criterion:0,result:'passed',changes:['app.txt'],verification:'retest',artifact:criterion.artifact.path});
 f.review();f.act('verify');f.act('deliver');f.act('evidence',{kind:'local',result:'passed',summary:'local delivery',artifact:f.proof()});f.act('complete');
 assert.equal(summary(f.state,f.root).checks[0].completion.valid,true);
});

test('A07 bounded continuation snapshots only the cognition path actually accepted',t=>{
 const f=fixture(t,{aociRequired:true,cognitionScope:'bounded',deferStart:true}),failed=f.proof();
 const receipt={source:'mcp',projectRoot:f.root,serviceVersion:'fixture',identity:'index',aligned:true,recoveryPending:false,thirdPartyConflict:false,boundedScope:'app',continuation:'full_system_claim_disabled_source_bound_task_continuation_allowed'};
 f.act('evidence',{kind:'cognition_delivery',result:'failed',summary:'full delivery failed',artifact:failed});
 for(const kind of ['cognition_limit','source_review','cognition_alignment'])f.act('evidence',{kind,result:'passed',summary:'bounded path verified',artifact:f.proof(),receipt});
 f.start('R001');fs.writeFileSync(path.join(f.root,failed),'updated unused failure log');f.finish();
 assert.equal(summary(f.state,f.root).checks[0].completion.valid,true);
 assert.equal(f.state.tasks[0].evidence.find(e=>e.kind==='cognition_delivery').result,'failed');
 f.act('round-verification',{id:undefined,result:'passed',verification:'integrated regression',source:'fixture',artifact:f.proof(),coverage:[{id:'R001',criterion:0,result:'passed'}]});
 f.act('close-round',{id:undefined,source:'fixture acceptance',artifact:f.proof()});assert.equal(f.state.round.status,'closed');
 const adopted=f.state.tasks[0].evidence.find(e=>e.kind==='cognition_limit');fs.writeFileSync(path.join(f.root,adopted.artifact.path),'tampered adopted proof');
 assert.equal(summary(f.state,f.root).checks[0].completion.valid,false);
});
test('A08 non-AOCI tasks do not bind unused cognition evidence into completion',t=>{
 const f=fixture(t),unused=f.proof();f.act('evidence',{kind:'source_review',result:'failed',summary:'unused diagnostic',artifact:unused});
 fs.writeFileSync(path.join(f.root,unused),'diagnostic revised');f.finish();assert.equal(summary(f.state,f.root).checks[0].completion.valid,true);
});
test('A09 full cognition completion ignores an unused failed bounded alternative',t=>{
 const f=fixture(t,{aociRequired:true,deferStart:true}),unused=f.proof(),receipt={source:'mcp',projectRoot:f.root,serviceVersion:'fixture',identity:'index',complete:true,delivered:true,aligned:true,recoveryPending:false};
 for(const kind of ['cognition_limit','source_review'])f.act('evidence',{kind,result:'failed',summary:'unused alternative',artifact:unused});
 for(const kind of ['cognition_delivery','cognition_alignment'])f.act('evidence',{kind,result:'passed',summary:'full cognition verified',artifact:f.proof(),receipt});
 f.start('R001');fs.writeFileSync(path.join(f.root,unused),'updated alternative');f.finish();assert.equal(summary(f.state,f.root).checks[0].completion.valid,true);
});


test('R003 cancelling the locked task reserves the next active task', t => {
 const f=fixture(t);f.add({title:'next task'});
 f.act('cancel',{reason:'fixture user cancellation'});
 assert.equal(f.state.tasks[0].status,'cancelled');
 assert.equal(f.state.lock,'R002');
 assert.equal(f.state.tasks[1].status,'recorded');
 assert.equal(f.state.tasks[1].authorization,null);
});
test('R003 whole-project and normalized watch paths accept in-scope changes', t => {
 for(const watch of [['.'],['./'],['./app.txt']]) {
  const f=fixture(t,{watch});
  f.act('acceptance-result',{criterion:0,result:'passed',changes:['app.txt'],verification:'fixture assertions',artifact:f.proof()});
  assert.equal(f.state.tasks[0].acceptanceResults.at(-1).result,'passed');
 }
});
test('R003 deletion repairs can be recorded and still enforce the watched scope', t => {
 const f=fixture(t);const finding=f.proof();
 f.act('issue-open',{title:'obsolete file',severity:'medium',blocking:true,reviewer,independent:true,artifact:finding});
 fs.unlinkSync(path.join(f.root,'app.txt'));
 f.act('acceptance-result',{criterion:0,result:'passed',changes:['app.txt'],verification:'file absent',artifact:f.proof()});
 f.act('issue-resolve',{issueId:'I1',fix:'remove obsolete file',changes:['app.txt'],verification:'file absent',artifact:f.proof()});
 assert.equal(f.state.tasks[0].issues[0].status,'resolved');
 assert.throws(()=>f.act('acceptance-result',{criterion:0,result:'passed',changes:['other.txt'],verification:'outside scope',artifact:f.proof()}),/outside task watch/);
 assert.throws(()=>f.act('acceptance-result',{criterion:0,result:'passed',changes:['../outside.txt'],verification:'outside project',artifact:f.proof()}),/escapes project/);
});
