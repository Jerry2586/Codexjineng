// Shared executable contract. Natural-language intent is an operator-supplied observation, not inferred from keywords.
export const CONTRACT_VERSION = 2;
export const STAGES = Object.freeze(['构想定稿','架构定界','企业化改造','接口清理与重构','测试部署验收']);
export const STATUS = Object.freeze({recorded:'○ 已记录',queued:'□ 排队',running:'🔄 执行中',paused:'⏸ 已暂停',blocked:'🔴 阻塞',verifying:'🔄 验证中',delivering:'🔄 交付中',completed:'✅ 已完成',cancelled:'× 已取消',deferred:'⏸ 已搁置'});
export const TERMINAL_STATES = Object.freeze(['completed','cancelled']);
export const OPERATIONS = Object.freeze(['local','git','ci','release','install','deploy']);
export const CONTROLS = Object.freeze(['开发助手','关闭开发助手','记录需求','开始制作','暂停一下','查看队列表','调整顺序 Rxxx 到第 N','取消需求 Rxxx','启动线路图','转到第N阶段']);
export const PANEL = Object.freeze({firstLine:'【开发助手｜框架内执行】',title:'## 智构开发指挥中心',fullHeader:'| 状态 | 编号 | 所属步骤 | 当前步骤 | 内容摘要 | 验证结果 |',shortHeader:'| 状态 | 编号 | 事项 | 下一步 |'});
export const CONTROL_FULL = CONTROLS.map(value=>'`'+value+'`').join(' · ');
export const CONTROL_SHORT = '`控制：开始制作 · 暂停一下 · 查看队列表 · 关闭开发助手`';
const requireValue=(ok,message)=>{if(!ok)throw new Error(message);};
const nonempty=value=>typeof value==='string'&&value.trim().length>0;
export const isStartCommand=message=>typeof message==='string'&&message.trim()==='开始制作';
export function controlCommand(message,origin='user'){
 if(origin!=='user'||typeof message!=='string')return null;
 const value=message.trim();return CONTROLS.includes(value)?value:null;
}
export function panelMode({enabled=false,firstShown=false,message,origin='user'}={}){
 const command=controlCommand(message,origin);
 if(command==='开发助手')return 'full';if(command==='关闭开发助手')return 'none';
 return enabled?(firstShown?'compact':'full'):'none';
}
function directInstruction(request){
 requireValue(nonempty(request.message),'User instruction message required');
 requireValue((request.origin===undefined||request.origin==='user')&&(request.instruction?.origin===undefined||request.instruction.origin==='user'),'Instruction must originate from the user; conflicting sources are invalid');
 requireValue(!/^(?:>|`|[“「『"])/.test(request.message.trim()),'Quoted instruction cannot authorize work');
}
export function implementationInstruction(request,scope){
 directInstruction(request);
 if(isStartCommand(request.message))return {gate:'exact-start-v1',message:request.message};
 const input=request.instruction;
 requireValue(input?.origin==='user'&&input.intent==='implement'&&nonempty(input.reason),'Explicit user instruction assessment required; standalone 开始制作 is also accepted');
 requireValue(input.scope===scope,'Instruction scope does not match current task scope');
 return {gate:'user-request-v2',message:request.message,instruction:{origin:'user',intent:'implement',scope,reason:input.reason}};
}
export function validAuthorization(authorization,scope){
 try {if(!authorization||!nonempty(authorization.source))return false;return implementationInstruction(authorization,scope).gate===authorization.gate;}catch{return false;}
}
export function resumeInstruction(request,scope){
 directInstruction(request);
 if(isStartCommand(request.message)||['继续','恢复','继续执行','继续做','恢复原任务'].includes(request.message.trim()))return;
 requireValue(request.instruction?.origin==='user'&&request.instruction.intent==='resume'&&request.instruction.scope===scope&&nonempty(request.instruction.reason),'Resume requires an explicit user instruction for existing scope; standalone 开始制作 is also accepted');
}
