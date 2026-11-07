import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { initialState, transition, summary } from './task-runtime.mjs';
import { renderPanel } from './panel.mjs';
function fixture(t) {
 const parent=path.resolve(os.tmpdir(),'auto-dev-quality-tests'); fs.mkdirSync(parent,{recursive:true});
 const root=fs.mkdtempSync(path.join(parent,'case-'));
 t.after(()=>{assert.equal(path.dirname(path.resolve(root)),parent);assert.ok(path.basename(root).startsWith('case-'));fs.rmSync(root,{recursive:true,force:true});});
 fs.writeFileSync(path.join(root,'app.js'),'export const ok=true;'); fs.mkdirSync(path.join(root,'.smartbuild/evidence'),{recursive:true});
 fs.writeFileSync(path.join(root,'.smartbuild/evidence/check.txt'),'isolated fixture evidence; not a real audit');
 let state=initialState(root,'quality fixture','tests');
 const apply=r=>(state=transition(state,{...r,expectedRevision:state.revision},root));
 apply({action:'add',title:'fixture',scope:'app',acceptance:['works'],watch:['app.js'],aociRequired:false});
 const proof=kind=>apply({action:'evidence',id:'R001',kind,result:'passed',summary:'isolated quality test',artifact:'.smartbuild/evidence/check.txt',skill:kind==='project_audit'?'ponytail-audit':'humanizer',source:'test fixture'});
 return {root,apply,proof,get state(){return state;}};
}
test('new tasks enable the three checks without inventing passed results',t=>{
 const f=fixture(t); const q=summary(f.state,f.root).checks[0].quality;
 assert.equal(f.state.tasks[0].qualityVersion,1); assert.equal(q.required,true);
 for(const kind of ['project_audit','review','text_review'])assert.equal(q[kind],false);
});
test('opening the panel adopts quality checks for active legacy tasks and preserves pause',t=>{
 const f=fixture(t); delete f.state.tasks[0].qualityVersion; f.apply({action:'pause',nextAction:'wait'});
 f.apply({action:'display',enabled:true,message:'开发助手'});
 assert.equal(f.state.tasks[0].qualityVersion,1);assert.equal(f.state.paused,true);
 assert.equal(f.state.tasks[0].authorization,null);
});
test('missing and stale quality evidence blocks delivery even after business tests pass',t=>{
 const f=fixture(t);f.apply({action:'plan',id:'R001',steps:[{title:'check',input:'app',output:'works',verify:'test',skills:[]}]});
 f.apply({action:'authorize',id:'R001',message:'开始制作',source:'test',operations:['local']}); f.apply({action:'start',id:'R001'});
 f.apply({action:'evidence',id:'R001',kind:'business',result:'passed',summary:'fixture',artifact:'.smartbuild/evidence/check.txt'}); f.apply({action:'verify',id:'R001'});
 assert.throws(()=>f.apply({action:'deliver',id:'R001'}),/project_audit/); f.proof('project_audit');
 assert.throws(()=>f.apply({action:'deliver',id:'R001'}),/text_review/); f.proof('text_review');
 assert.equal(summary(f.state,f.root).checks[0].quality.text_review,true);
 f.apply({action:'evidence',id:'R001',kind:'text_review',result:'failed',summary:'later failure',artifact:'.smartbuild/evidence/check.txt',skill:'humanizer',source:'test'});
 assert.throws(()=>f.apply({action:'deliver',id:'R001'}),/text_review/);f.proof('text_review');
 fs.writeFileSync(path.join(f.root,'app.js'),'export const ok=false;');
 const q=summary(f.state,f.root).checks[0].quality;assert.equal(q.project_audit,false);assert.equal(q.text_review,false);
});
test('quality evidence must name the correct skill and its real source',t=>{
 const f=fixture(t);
 assert.throws(()=>f.apply({action:'evidence',id:'R001',kind:'project_audit',result:'passed',summary:'wrong skill',artifact:'.smartbuild/evidence/check.txt',skill:'humanizer',source:'test'}));
});
test('the rendered startup distinguishes enabled policy from completed reviews',t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.root,'auto-dev-state.json'),JSON.stringify(f.state));
 const panel=renderPanel(f.root,{mode:'full'});assert.match(panel,/质量规则：已启用/);assert.match(panel,/项目审计：待执行或复核/);assert.match(panel,/代码审核：待执行或复核/);assert.match(panel,/文字检查：待执行或复核/);
});

test('legacy ledgers remain readable without fabricating a completed audit',t=>{
 const f=fixture(t);delete f.state.tasks[0].workflowVersion;delete f.state.tasks[0].qualityVersion;
 const q=summary(f.state,f.root).checks[0].quality;assert.equal(q.required,false);assert.equal(q.review,false);
 f.state.tasks[0].status='completed';f.state.lock=null;f.apply({action:'display',enabled:true,message:'开发助手'});
 assert.equal(f.state.tasks[0].qualityVersion,undefined);assert.equal(summary(f.state,f.root).checks[0].completion.status,'historical-unverified');
});
test('code review evidence requires ponytail-review and an attributable source',t=>{
 const f=fixture(t);const review={action:'evidence',id:'R001',kind:'review',result:'passed',summary:'isolated fixture review',artifact:'.smartbuild/evidence/check.txt',reviewer:{id:'fixture-reviewer',kind:'subagent',source:'tool',observation:'synthetic unit test identity'},independent:true,findings:{blocking:0,advisory:0,items:[]}};
 assert.throws(()=>f.apply(review),/ponytail-review/);
 assert.throws(()=>f.apply({...review,skill:'ponytail-review'}),/source/);
 f.apply({...review,skill:'ponytail-review',source:'unit test fixture'});
 assert.equal(f.state.tasks[0].evidence.at(-1).skill,'ponytail-review');
});
test('quality checks permit a verified delivery and bind its completion snapshot',t=>{
 const f=fixture(t),actor={id:'fixture-main',kind:'main',source:'tool',observation:'synthetic unit test identity'};
 f.apply({action:'plan',id:'R001',steps:[{title:'check',input:'app',output:'works',verify:'test',skills:[]}]});
 f.apply({action:'authorize',id:'R001',message:'开始制作',source:'test',operations:['local']});f.apply({action:'start',id:'R001'});
 f.apply({action:'skill-select',id:'R001',context:{goal:'isolated fixture verification',needs:['testing']},selection:{primary:null,support:[],reason:'isolated standard workflow fixture'},audit:{read:false,compatible:true,reason:'test fixture only',executor:actor}});
 f.apply({action:'skill-outcome',id:'R001',result:'passed',category:'quality',progressed:true,symptom:'fixture',reason:'fixture',verification:'unit test fixture',artifact:'.smartbuild/evidence/check.txt',executor:actor});
 f.apply({action:'acceptance-result',id:'R001',criterion:0,result:'passed',changes:['app.js'],verification:'unit test fixture',artifact:'.smartbuild/evidence/check.txt'});
 f.proof('project_audit');f.proof('text_review');f.proof('business');f.apply({action:'verify',id:'R001'});
 assert.throws(()=>f.apply({action:'deliver',id:'R001'}),/Independent review/);
 f.apply({action:'evidence',id:'R001',kind:'review',skill:'ponytail-review',source:'unit test fixture',result:'passed',summary:'isolated fixture review',artifact:'.smartbuild/evidence/check.txt',reviewer:{id:'fixture-reviewer',kind:'subagent',source:'tool',observation:'synthetic unit test identity'},independent:true,findings:{blocking:0,advisory:0,items:[]}});
 f.apply({action:'deliver',id:'R001'});f.proof('local');f.apply({action:'complete',id:'R001'});
 const saved=summary(f.state,f.root).checks[0].completion;assert.equal(saved.valid,true);assert.equal(saved.current,true);
 assert.ok(f.state.tasks[0].completion.evidenceKinds.includes('project_audit'));assert.ok(f.state.tasks[0].completion.evidenceKinds.includes('text_review'));
 fs.writeFileSync(path.join(f.root,'.smartbuild/evidence/check.txt'),'changed fixture proof');
 assert.equal(summary(f.state,f.root).checks[0].completion.valid,false);
});
