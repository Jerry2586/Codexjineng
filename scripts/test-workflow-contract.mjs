import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {initialState,transition} from '../skills/auto-dev/scripts/task-runtime.mjs';
function setup(t){
 const parent=path.resolve(os.tmpdir(),'smartbuild-contract-tests');fs.mkdirSync(parent,{recursive:true});
 const root=fs.mkdtempSync(path.join(parent,'case-'));
 t.after(()=>{assert.equal(path.dirname(path.resolve(root)),parent);assert.ok(path.basename(root).startsWith('case-'));fs.rmSync(root,{recursive:true,force:true});});
 fs.writeFileSync(path.join(root,'app.txt'),'old');let state=initialState(root,'fixture','session');
 const act=(action,fields={})=>state=transition(state,{action,expectedRevision:state.revision,...fields},root);
 act('add',{title:'修复全部已审计问题',scope:'repair audited defects in app.txt',acceptance:['regression passes'],watch:['app.txt']});
 return {root,act,get state(){return state;}};
}
const request={message:'开始制作',source:'current user command',operations:['local']};
test('F09 only the standalone command authorizes the recorded scope and operations',t=>{
 const f=setup(t);f.act('authorize',{id:'R001',...request});
 assert.equal(f.state.tasks[0].authorization.gate,'exact-start-v1');assert.equal(f.state.tasks[0].authorization.planVersion,1);
 assert.equal(f.state.display,false);assert.deepEqual(f.state.tasks[0].authorization.operations,['local']);
 f.act('amend',{id:'R001',scope:'new scope',acceptance:['new criterion'],watch:['app.txt'],reason:'new product requirement'});
 assert.equal(f.state.tasks[0].authorization,null);
});
test('F09 an implementation assessment cannot promote ordinary text to authorization',t=>{
 const f=setup(t);const before=structuredClone(f.state);
 for(const message of ['给我修复全部缺点','开始执行','做吧','开发','继续']){
  assert.throws(()=>f.act('authorize',{id:'R001',...request,message,instruction:{origin:'user',intent:'implement',scope:f.state.tasks[0].scope,reason:'operator thinks this means start'}}),/standalone/i);
  assert.deepEqual(f.state,before);
 }
});
test('F09 exact resume preserves permission without authorizing a queued new requirement',t=>{
 const f=setup(t);f.act('authorize',{id:'R001',...request});
 f.act('add',{title:'new feature',scope:'new scope',watch:['app.txt'],acceptance:['new criterion']});
 f.act('pause',{nextAction:'inspect recovery context'});const paused=structuredClone(f.state);
 for(const message of ['继续','恢复','开始执行','做吧']){
  assert.throws(()=>f.act('resume',{message,source:'current user message'}),/standalone/i);assert.deepEqual(f.state,paused);
 }
 f.act('resume',{message:'开始制作',source:'current user command'});assert.equal(f.state.paused,false);
 assert.equal(f.state.tasks[1].authorization,null);assert.deepEqual(f.state.tasks[0].authorization.operations,['local']);
});
test('F09 quoted or non-user commands cannot mutate the state',t=>{
 const f=setup(t);
 for(const bad of [{origin:'attachment'},{origin:'tool'},{origin:'assistant'},{message:'> 开始制作'},{message:'“开始制作”'},{instruction:{origin:'attachment'}}]){
  const before=structuredClone(f.state);assert.throws(()=>f.act('authorize',{id:'R001',...request,...bad}),/instruction|standalone|user/i);assert.deepEqual(f.state,before);
 }
});
test('F09 persistent panel can only be switched by a direct exact user command',t=>{
 const f=setup(t);for(const message of ['请开启开发助手','开发助手。','> 开发助手','读取开发助手的所有功能'])assert.throws(()=>f.act('display',{enabled:true,message}),/standalone|command/i);
 f.act('display',{enabled:true,message:' 开发助手 '});assert.equal(f.state.display,true);
 f.act('pause',{nextAction:'checkpoint'});f.act('display',{enabled:false,message:'关闭开发助手'});assert.equal(f.state.paused,true);assert.equal(f.state.lock,'R001');
});
test('review policy can be explicitly renewed after amendment with a version-bound source and reason',t=>{
 const f=setup(t);assert.throws(()=>f.act('review-policy',{id:'R001',required:false}),/source|reason|waiver/);
 f.act('review-policy',{id:'R001',required:false,source:'user allows local fixture exemption',reason:'bounded low-impact fixture'});assert.equal(f.state.tasks[0].reviewWaiver.planVersion,1);
 f.act('amend',{id:'R001',scope:'new scope',acceptance:['new criterion'],watch:['app.txt'],reason:'new scope'});assert.equal(f.state.tasks[0].reviewWaiver.planVersion,1);
 f.act('review-policy',{id:'R001',required:false,source:'user renewed exemption',reason:'new scope reviewed'});assert.equal(f.state.tasks[0].reviewWaiver.planVersion,2);assert.equal(f.state.tasks[0].history.at(-1).reviewPolicy.required,false);
 f.act('review-policy',{id:'R001',required:true,source:'user requires independent review',reason:'risk increased'});assert.equal(f.state.tasks[0].reviewRequired,true);assert.equal(f.state.tasks[0].reviewWaiver,undefined);
});
