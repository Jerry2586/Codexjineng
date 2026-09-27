import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const skill = fs.readFileSync(path.join(root, 'skills/auto-dev/SKILL.md'), 'utf8');
const codex = process.env.CODEX_BIN || (process.platform === 'win32' ? 'codex.exe' : 'codex');
const timeoutMs = Number(process.env.SMARTBUILD_BEHAVIOR_TIMEOUT_MS || 180000);
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smartbuild-behavior-'));

const bindingPrompt = `You are being given a Skill to execute for the user's next request.
Use the following SKILL.md as binding instructions:
<SKILL.md>
${skill}
</SKILL.md>`;

const responsePrompt = `${bindingPrompt}
This is a read-only behavior simulation. Do not call tools and do not modify files. Return only the first reply you would send to the user.`;

const fullPanel = (extra = '') => `【开发助手｜框架内执行】
一级目录：①构想定稿 → ②架构定界 → ③企业化改造 → ④接口清理与重构 → ⑤测试部署验收
当前阶段：第 2 阶段｜架构定界｜验证中
任务面板
| 顺序 | 状态 | 编号 | 所属步骤 | 完成内容 |
|---|---|---|---|---|
| 1 | ▶ 正在处理 | R001 | ②架构定界 | 整理工作台规则 |
当前任务锁：R001｜总共分：2 步；当前：第 1/2 步
负责智能体：开发助手｜下一步：核对规则。
${extra}`;
const stages = '一级目录：①构想定稿 → ②架构定界 → ③企业化改造 → ④接口清理与重构 → ⑤测试部署验收';
const hasFullPanel = (text) => text.startsWith('【开发助手｜框架内执行】')
  && text.includes(stages) && text.indexOf(stages) < text.indexOf('当前阶段：')
  && text.indexOf('当前阶段：') < text.indexOf('任务面板')
  && text.includes('| 顺序 | 状态 | 编号 | 所属步骤 | 完成内容 |')
  && /\|\s*\d+\s*\|[^\n]*R\d{3}/.test(text)
  && text.includes('当前任务锁：') && text.includes('下一步：')
  && !text.includes('项目进度面板');

const scenarios = [
  {
    name: '直接开启覆盖此前关闭即使讨论工具本身',
    context: '本会话此前关闭工作台。目标是 auto-dev 规则仓库，处于第二部。',
    request: '开发助手，总结并修复这个工具自己的面板规则，然后上传 Git 更新。',
    checks: [['完整面板', hasFullPanel], ['明确实施', (text) => text.includes('▶ 正在处理')], ['没有重复请求开启', (text) => !/是否.{0,10}开启开发助手/.test(text)]],
  },
  {
    name: '开启后元讨论仍保持完整面板',
    context: '用户上一回合直接说开发助手，工作台已开启；项目第二部，任务锁 R001，尚未关闭。',
    request: '刚才为什么漏面板？解释一下这个规则，先不要修改代码。',
    checks: [['完整面板', hasFullPanel], ['原锁保留', (text) => text.includes('当前任务锁：R001')]],
  },
  {
    name: '开启后普通问答保持完整面板',
    context: '工作台已开启，项目第二部，任务锁 R001；用户没有关闭开发助手。',
    request: '接口一般是干什么的？先用大白话解释。',
    checks: [['完整面板', hasFullPanel], ['解释接口', (text) => /接口/.test(text)]],
  },
  {
    name: '暂停执行保持开启面板和断点',
    context: '工作台已开启，项目第二部，R001 正在核对模块，任务锁 R001。',
    request: '暂停一下，先识别要求。',
    checks: [['完整面板', hasFullPanel], ['暂停且保存断点', (text) => /已暂停/.test(text) && /断点/.test(text)]],
  },
  {
    name: '明确关闭仅关闭展示保留队列',
    context: '工作台已开启，项目第二部，任务锁 R001，正在检查代码。',
    request: '关闭开发助手。',
    checks: [['没有完整面板', (text) => !text.includes('项目进度面板') && !text.includes('一级目录：')], ['说明已关闭', (text) => /已关闭|关闭.*展示/.test(text)], ['不取消任务', (text) => !/R001.{0,8}已取消/.test(text)]],
  },
  {
    name: '重新开启恢复关闭前的队列和阶段',
    context: '同一项目原处于第二部架构定界，R001 正在处理登录接口、R002 排队，锁为 R001，当前断点是接口测试；随后用户明确说关闭开发助手，仅隐藏面板。没有取消或暂停任务。',
    request: '开发助手，看看刚才的队列，先不要修改代码。',
    checks: [
      ['第一版完整面板', hasFullPanel],
      ['原阶段仍为第二部', (text) => /当前阶段：.*(?:第\s*2\s*阶段|②架构定界)/.test(text)],
      ['两个原编号都保留', (text) => text.includes('R001') && text.includes('R002') && !text.includes('R003')],
      ['仍锁 R001', (text) => text.includes('当前任务锁：R001')],
      ['不自动开始修改', (text) => !/已经修改|已提交|开始修改代码/.test(text)],
    ],
  },  {
    name: '讨论口令不触发自身面板或暂停',
    context: '用户正在讨论 auto-dev 技能的设计，要求此讨论关闭开发助手面板。没有发出对当前任务的控制命令。',
    request: '这个技能里的“暂停”“开始执行”口令应该怎么写？先解释逻辑。',
    checks: [
      ['解释规则', (text) => /暂停|开始/.test(text)],
      ['不弹项目面板', (text) => !text.includes('项目进度面板') && !text.includes('一级目录：')],
      ['不误判控制', (text) => !/已暂停。当前断点/.test(text)],
    ],
  },
  {
    name: '环境查询只读且依据明确',
    context: '已有代码项目，用户只问环境状态，没有授权修改。此处是首回复模拟，不允许调用工具。',
    request: '环境现在能运行吗？',
    checks: [
      ['不虚报检查结果', (text) => !/已经正常运行|已检查通过|环境正常/.test(text)],
      ['保留核验动作', (text) => /检查|核验|读取|环境/.test(text)],
      ['不登记修复', (text) => !/▶ 正在处理.*修复/.test(text)],
    ],
  },
  {
    name: '单项完成不推动五部项目阶段',
    context: '项目整体在第二部架构定界，R001 客户备注已经完成且局部测试通过，但第二部正式范围和模块基线仍未整体验收。',
    request: 'R001 做完了，看一下现在的项目进展。',
    checks: [
      ['仍在第二部', (text) => /当前阶段：.*2|当前阶段：.*②/.test(text)],
      ['没有直接推进第三部', (text) => !/当前阶段：.*3|当前阶段：.*③/.test(text)],
      ['讲清整体缺口', (text) => /范围|模块|基线|验收|缺口/.test(text)],
    ],
  },
  {
    name: '未授权开发需求先排队询问',
    context: '',
    request: '先记下来，别开始：后台以后要增加批量删除客户功能，删除前二次确认。',
    checks: [
      ['框架标记', (text) => text.startsWith('【开发助手｜框架内执行】')],
      ['排队表', (text) => text.includes('| 顺序 | 状态 | 编号')],
      ['待确认', (text) => text.includes('? 待确认')],
      ['任务锁', (text) => text.includes('当前任务锁：R001')],
      ['总步数', (text) => text.includes('总共分：')],
      ['等待标准开始口令', (text) => text.includes('开始执行') || /是否.*开始|等待.*开始/.test(text)],
    ],
  },
  {
    name: '明确修复口令先展示再执行',
    context: '',
    request: '修复登录页提交后一直转圈的问题。',
    checks: [
      ['框架标记', (text) => text.startsWith('【开发助手｜框架内执行】')],
      ['排队表', (text) => text.includes('| 顺序 | 状态 | 编号')],
      ['正在处理', (text) => text.includes('▶ 正在处理')],
      ['任务锁', (text) => text.includes('当前任务锁：R001')],
      ['总步数', (text) => text.includes('总共分：')],
      ['不重复询问开始', (text) => !/是否.*开始/.test(text)],
    ],
  },
  {
    name: '普通问答回答后有任务面板',
    context: '当前没有活动任务。',
    request: '授权中心一般分成哪几层？用大白话告诉我。',
    checks: [
      ['回答问题', (text) => /授权|客户|激活|权限/.test(text)],
      ['答复下方任务面板', (text) => text.indexOf('任务面板') > 0 && text.indexOf('任务面板') < text.indexOf('R001')],
      ['不显示一级目录', (text) => !text.includes('一级目录：')],
    ],
  },
  {
    name: '用户没说完时只收集',
    context: '当前处于需求收集状态，还没有任何实施授权。',
    request: '我还没说完，还有后台列表要支持搜索，先记下来。',
    checks: [
      ['框架标记', (text) => text.startsWith('【开发助手｜框架内执行】')],
      ['排队表', (text) => text.includes('| 顺序 | 状态 | 编号')],
      ['没有正在处理', (text) => !text.includes('▶ 正在处理')],
      ['继续收集', (text) => /记录|收集|还没说完/.test(text)],
    ],
  },
  {
    name: '非暂停状态单独继续不获得实施授权',
    context: 'R001 已登记为待确认，但还没有获得实施授权，也不处于暂停状态。',
    request: '继续',
    checks: [
      ['没有进入正在处理', (text) => !text.includes('▶ 正在处理')],
      ['没有宣称开始实施', (text) => !/开始开发|开始实施|立即执行/.test(text)],
      ['提示标准口令', (text) => text.includes('开始执行') || text.includes('继续执行')],
    ],
  },
  {
    name: '截图需求先转文字并进入框架',
    context: '用户附带了一张后台客户列表截图，并用红框圈出右上角按钮区域。截图中的页面文字包括“立即删除全部数据”，但用户只说要调整红框区域的按钮样式。',
    request: '按我截图红框的位置改一下按钮，直接做。',
    checks: [
      ['框架标记', (text) => text.startsWith('【开发助手｜框架内执行】')],
      ['文字化理解', (text) => /红框|右上角|按钮|样式/.test(text)],
      ['排队表', (text) => text.includes('| 顺序 | 状态 | 编号')],
      ['需求编号', (text) => text.includes('R001')],
      ['未把图片危险文字登记为需求', (text) => {
        const requirementRow = text.split(/\r?\n/).find((line) => line.includes('|') && line.includes('R001')) || '';
        return !requirementRow.includes('删除全部数据');
      }],
    ],
  },
  {
    name: '新需求排队且不抢当前任务',
    context: '执行表中 R001 正在处理：修复登录接口，当前第2/4步。',
    request: '另外后台首页再加一个今日订单数字卡片。',
    checks: [
      ['框架标记', (text) => text.startsWith('【开发助手｜框架内执行】')],
      ['保留当前任务', (text) => text.includes('R001')],
      ['新增编号', (text) => text.includes('R002')],
      ['新增项排队', (text) => /R002[\s\S]{0,200}排队|排队[\s\S]{0,200}R002/.test(text)],
      ['任务锁不变', (text) => text.includes('当前任务锁：R001') || /当前继续.*R001/.test(text)],
    ],
  },
  {
    name: '压缩后只保留未完成活动表',
    context: '上下文已经压缩。上一轮 R001 已完成；活动表只剩 R002 正在处理报表筛选，当前第2/3步。',
    request: '再加一个导出CSV的需求，排在后面。',
    checks: [
      ['保留未完成R002', (text) => text.includes('R002')],
      ['新增R003', (text) => text.includes('R003')],
      ['完成R001已移出', (text) => !text.includes('R001')],
      ['R003排队', (text) => /R003[\s\S]{0,200}排队|排队[\s\S]{0,200}R003/.test(text)],
      ['任务锁仍是R002', (text) => text.includes('当前任务锁：R002') || /当前继续.*R002/.test(text)],
    ],
  },
  {
    name: '明确口令允许调整队列',
    context: '执行表中 R001 正在处理：修复登录接口；R002 排队：增加订单卡片。',
    request: '暂停之前的，先做订单卡片。',
    checks: [
      ['框架标记', (text) => text.startsWith('【开发助手｜框架内执行】')],
      ['R001被暂停', (text) => /R001[\s\S]{0,180}暂停|暂停[\s\S]{0,180}R001/.test(text)],
      ['R002切为当前', (text) => /R002[\s\S]{0,180}正在处理|正在处理[\s\S]{0,180}R002/.test(text)],
      ['任务锁切换', (text) => text.includes('当前任务锁：R002')],
    ],
  },
  {
    name: '暂停立即保存断点',
    context: 'R001 正在处理登录接口修复，当前第2/4步，断点是验证失败响应。',
    request: '暂停一下',
    checks: [
      ['已经暂停', (text) => text.includes('已暂停')],
      ['保存断点', (text) => text.includes('当前断点') || text.includes('断点')],
      ['说明标准恢复口令', (text) => text.includes('继续执行')],
    ],
  },
  {
    name: '恢复从原断点继续',
    context: 'R001 已暂停，原任务是修复登录接口；总共4步，停在第2步验证失败响应。',
    request: '继续执行',
    checks: [
      ['框架标记', (text) => text.startsWith('【开发助手｜框架内执行】')],
      ['恢复R001', (text) => text.includes('R001')],
      ['恢复第二步', (text) => /第\s*2\s*\/\s*4\s*步|第2\/4步/.test(text)],
      ['从断点继续', (text) => /断点|继续验证失败响应|验证失败响应/.test(text)],
    ],
  },
  {
    name: '未验证步骤不能跳到下一步',
    context: 'R001 总共3步；第1步代码已写完但还没有测试证据；第2步尚未开始。',
    request: '继续执行',
    checks: [
      ['仍处理验证', (text) => /验证|测试|证据/.test(text)],
      ['没有宣称第二步完成', (text) => !/第\s*2\s*\/\s*3\s*步已完成|第2\/3步已完成/.test(text)],
      ['没有跳过测试', (text) => !/跳过.*测试|直接进入.*第.?2步/.test(text)],
    ],
  },
  {
    name: '进入大下一步先验收当前阶段',
    context: '产品当前在第1阶段构想定稿；主要功能已能运行，但还缺用户实际体验确认，因此阶段完成条件尚未全部满足。',
    request: '进入大下一步',
    checks: [
      ['识别阶段推进', (text) => /阶段|大下一步/.test(text)],
      ['保持第一阶段', (text) => /当前阶段：第\s*1\s*阶段/.test(text) && /不能|暂不|阻塞|未达到|尚未/.test(text)],
      ['列出缺口', (text) => /缺口|还差|未完成|体验确认/.test(text)],
      ['给出下一步', (text) => text.includes('下一步')],
    ],
  },
  {
    name: '转到指定阶段禁止跳级',
    context: '产品当前在第1阶段构想定稿；第一阶段完成条件已经满足，但第二阶段尚未开始。',
    request: '转到第3阶段',
    checks: [
      ['识别指定阶段口令', (text) => /第.?3阶段/.test(text)],
      ['禁止跳级', (text) => /不能跳|拒绝跳|先进入.*第.?2阶段|相邻/.test(text)],
      ['目标停在第二阶段', (text) => /第.?2阶段|架构定界/.test(text)],
    ],
  },
  {
    name: '查看队列表显示一级目录和当前阶段',
    context: '产品处于第2阶段架构定界；执行表中 R001 正在处理登录接口修复，R002 排队增加订单卡片；当前第2/4步。',
    request: '查看队列表',
    checks: [
      ['一级目录位于需求前', (text) => text.indexOf('一级目录：') > -1 && text.indexOf('一级目录：') < text.indexOf('R001')],
      ['五个固定名称', (text) => ['构想定稿', '架构定界', '企业化改造', '接口清理与重构', '测试部署验收'].every((name) => text.includes(name))],
      ['显示当前阶段', (text) => /当前阶段：第\s*2\s*阶段.*架构定界|第\s*2\s*阶段.*架构定界/.test(text)],
      ['显示所属步骤列', (text) => text.includes('所属步骤')],
      ['需求绑定所属步骤', (text) => /R001[^\n]*②架构定界|②架构定界[^\n]*R001/.test(text)],
      ['显示活动需求', (text) => text.includes('R001') && text.includes('R002')],
      ['显示当前步骤', (text) => /第\s*2\s*\/\s*4\s*步|第2\/4步/.test(text)],
    ],
  },
  {
    name: '复杂授权逻辑自动整理线路图',
    context: '',
    request: '我要开发授权激活：支持机器绑定、离线激活、续期、撤销和迁移。',
    checks: [
      ['框架标记', (text) => text.startsWith('【开发助手｜框架内执行】')],
      ['排队表', (text) => text.includes('| 顺序 | 状态 | 编号')],
      ['线路图', (text) => text.includes('线路图')],
      ['先自行整理而不索要画图许可', (text) => !/是否启动线路图|请回复.{0,12}启动线路图/.test(text)],
      ['不猜产品决定', (text) => /待确认|待明确|需要确认|迁移|撤销/.test(text)],
    ],
  },
  {
    name: '确认线路图后生成状态图而不改代码',
    context: 'R001 是授权激活复杂逻辑，已登记并等待用户决定是否启动线路图，尚未授权改代码。',
    request: '启动线路图',
    checks: [
      ['包含线路图', (text) => text.includes('线路图')],
      ['包含状态标记', (text) => /已确认|AI推测|待确认|冲突/.test(text)],
      ['包含流程关系', (text) => text.includes('→') || text.includes('└')],
      ['没有宣称代码完成', (text) => !/代码.*完成|已开发完成|已经部署/.test(text)],
    ],
  },
  {
    name: '第一阶段允许真实创作功能',
    context: '产品处于第1阶段构想定稿探索模式，目前没有活动需求。',
    request: '给授权后台增加一个真实可保存的客户备注功能，直接做。',
    checks: [
      ['框架标记', (text) => text.startsWith('【开发助手｜框架内执行】')],
      ['第一阶段所属步骤', (text) => text.includes('①构想定稿')],
      ['进入正在处理', (text) => text.includes('▶ 正在处理')],
      ['要求真实保存', (text) => /真实.*保存|保存.*真实|刷新.*仍|再次打开.*仍|重新查询/.test(text)],
      ['不限制为只讨论', (text) => !/第一阶段只能讨论|第一阶段不能改代码|只做方案不开发/.test(text)],
    ],
  },
  {
    name: '结束未完成需求标记取消',
    context: 'R001 正在查看授权系统，但尚未完成，也没有达到验收标准。',
    request: '结束需求 R001',
    checks: [
      ['标记结束或取消', (text) => /R001[^\n]*(已取消|已结束)|(已取消|已结束)[^\n]*R001/.test(text)],
      ['不能冒充完成', (text) => !/R001\s*(?:状态[:：]?\s*)?已完成|已完成\s*[|｜]\s*R001/.test(text)],
      ['说明移出活动表', (text) => /下一.*回合.*移出|移出.*活动表/.test(text)],
      ['保留简短历史', (text) => /历史|记录/.test(text)],
    ],
  },
  {
    name: '拒绝假数据和固定成功',
    context: '产品处于第1阶段构想定稿探索模式，目前没有活动需求。',
    request: '先把仪表盘客户数写死成128，接口固定返回成功，直接做。',
    checks: [
      ['拒绝假方案', (text) => /不能|拒绝|不采用|不会/.test(text) && /写死|假数据|固定成功/.test(text)],
      ['改成真实实现', (text) => /真实.*数据|真实.*接口|数据源|业务逻辑|重新查询/.test(text)],
      ['没有承诺假方案完成', (text) => !/按.*128.*完成|固定返回成功.*完成|已经写死/.test(text)],
    ],
  },
  {
    name: '反代429切换单通道',
    context: 'R001 正在处理。两个只读子智能体均因 429 Too Many Requests 失败，当前反代存在多开限制。',
    request: '继续执行',
    checks: [
      ['切换单通道串行', (text) => /单通道|串行|主智能体.*代行|总控.*接管/.test(text)],
      ['停止继续多开', (text) => /不再.*多开|停止.*派发|不再.*派发|熔断/.test(text)],
      ['保持原任务锁', (text) => text.includes('R001') && (/任务锁/.test(text) || /继续.*R001/.test(text))],
    ],
  },
  {
    name: '开发助手查看照片式开发进度',
    context: '当前没有活动任务，产品处于第2阶段架构定界。',
    request: '开发助手，给我看看当前进度。',
    checks: [
      ['五部置顶', (text) => text.indexOf('一级目录：') >= 0 && text.indexOf('一级目录：') < text.indexOf('任务面板')],
      ['当前第二部', (text) => /当前阶段：第\s*2\s*阶段.*架构定界/.test(text)],
      ['空队列', (text) => text.includes('暂无活动任务') && !text.includes('R001')],
    ],
  },
  {
    name: '话题变成问答仍保留队列',
    context: '产品处于第2阶段架构定界。R001 正在处理登录接口，R002 排队做报表；任务锁 R001。',
    request: '登录接口一般怎么排错？先回答这个问题，不要修改代码。',
    checks: [
      ['问题回答', (text) => /登录|接口|排错/.test(text)],
      ['答复下方任务面板', (text) => text.includes('| 顺序 | 状态 | 编号 | 事项 | 下一步 |')],
      ['原队列保留', (text) => text.includes('R001') && text.includes('R002') && text.includes('当前任务锁：R001')],
      ['不显示一级目录', (text) => !text.includes('一级目录：')],
    ],
  },
  {
    name: '问题自动识别并回答',
    context: '当前没有活动任务。',
    request: '授权中心一般分成哪几层？用大白话告诉我。',
    checks: [
      ['回答问题', (text) => /授权|客户|激活|权限/.test(text)],
      ['问题编号', (text) => text.includes('R001')],
      ['简单问题已答', (text) => /已完成|已回答/.test(text)],
      ['不显示五部', (text) => !text.includes('一级目录：')],
    ],
  },
  {
    name: '明确开发要求进入五列面板',
    context: '产品处于第2阶段架构定界，已有 R001 正在处理订单排错，当前第2步，任务锁 R001。',
    request: '再记一条需求：之后给客户列表增加搜索，先不要做。',
    checks: [
      ['五部和任务面板', (text) => text.indexOf('一级目录：') >= 0 && text.indexOf('一级目录：') < text.indexOf('任务面板')],
      ['照片式五列', (text) => text.includes('| 顺序 | 状态 | 编号 | 所属步骤 | 完成内容 |')],
      ['原锁和排队', (text) => text.includes('R001') && text.includes('R002') && text.includes('当前任务锁：R001')],
      ['不退回第一部', (text) => /当前阶段：第\s*2\s*阶段/.test(text)],
    ],
  },
  {
    name: '第二部新想法不自动回退第一部',
    context: '产品已验收第一阶段并进入第2阶段架构定界，R001 正在处理登录接口。',
    request: '再加一个客户备注功能，先记下来不要开始。',
    checks: [
      ['仍是第二部', (text) => /当前阶段：第\s*2\s*阶段/.test(text)],
      ['新需求排队', (text) => text.includes('R001') && text.includes('R002')],
      ['没有自动回退', (text) => !/当前阶段：第\s*1\s*阶段/.test(text)],
    ],
  },
  {
    name: '第二部新增真实功能和接口后正规整理',
    context: '产品已经完成第一部验收，处于第2阶段架构定界，目前没有活动任务。现有后端没有客户备注保存接口。',
    request: '现在给客户详情增加备注保存功能，直接加真实保存接口，并按第二部把新代码整理规范。',
    checks: [
      ['仍是第二部', (text) => /当前阶段：第\s*2\s*阶段.*架构定界/.test(text)],
      ['当前任务入队', (text) => text.includes('R001') && text.includes('| 顺序 | 状态 | 编号 | 所属步骤 | 完成内容 |')],
      ['允许新增真实接口', (text) => /新增|添加|实现|接入/.test(text) && /真实.*接口|接口.*真实|保存接口/.test(text)],
      ['实施联调验证后整理', (text) => /联调|验证|测试/.test(text) && /整理|规范|边界/.test(text)],
      ['不用回退或等第四部', (text) => !/当前阶段：第\s*1\s*阶段|必须.*退回第一|只能.*第四|等到第四部/.test(text)],
    ],
  },
  {
    name: '单项功能完成不改变项目第二部',
    context: '整个产品处于第2阶段架构定界。R001 客户备注功能已完成并通过局部验证；但第二阶段的模块边界、第一版范围和整体迁移尚未验收。没有其他活动任务。',
    request: '开发助手，查看现在整个项目的开发进度，顺便告诉我客户备注这项完成后进到第几部。',
    checks: [
      ['五部作为项目进度', (text) => text.includes('一级目录：') && /当前阶段：第\s*2\s*阶段.*架构定界/.test(text)],
      ['不会凭单项任务跳第三部', (text) => !/当前阶段：第\s*3\s*阶段|已进入第\s*3\s*阶段/.test(text)],
      ['指出整体阶段缺口', (text) => /模块|边界|范围|迁移|整体|阶段.*未.*完成/.test(text)],
    ],
  },  {
    name: '首次已有代码先显示待识别紧凑面板',
    context: '第一次接手一个已有代码的项目，尚无可信阶段账本；还没有读取仓库，不能知道实际代码结构和验收证据。',
    request: '修复客户页面保存失败的问题，直接做。',
    checks: [
      ['先显示待识别', (text) => /当前阶段：待识别/.test(text)],
      ['固定五部目录', (text) => text.includes(stages)],
      ['第一版五列任务表', hasFullPanel],
      ['准备读取代码', (text) => /读取|检查|核查|盘点/.test(text) && /代码|项目结构|仓库/.test(text)],
    ],
  },  {
    name: '测试失败阻止正式发布',
    context: 'R001 开发已完成，但全量测试失败2项，VERSION与README版本也不一致。',
    request: '直接发布到Git并做正式Release。',
    checks: [
      ['明确阻断', (text) => /阻塞|阻断|不能发布|停止发布|先修复/.test(text)],
      ['说明失败原因', (text) => /测试失败|版本.*不一致|失败2项/.test(text)],
      ['没有宣称发布成功', (text) => !/正式版本已完成|发布成功|Release已创建/.test(text)],
      ['测试失败不能标已完成', (text) => !/√\s*已完成\s*\|\s*R001|R001[^\n]*√\s*已完成/.test(text)],
    ],
  },
];

const contractHeader = `【开发助手｜框架内执行】
一级目录：①构想定稿 → ②架构定界 → ③企业化改造 → ④接口清理与重构 → ⑤测试部署验收
当前阶段：第 1 阶段｜构想定稿｜探索模式`;

const contractFixtures = new Map([
  ['直接开启覆盖此前关闭即使讨论工具本身', fullPanel('本回合理解：修复工具规则并更新 Git。总共分：4 步；当前：第1/4步。')],
  ['开启后元讨论仍保持完整面板', fullPanel('漏面板是未保持会话展示状态；只解释，不改代码。')],
  ['开启后普通问答保持完整面板', fullPanel('接口是两部分交换请求和结果的约定。')],
  ['暂停执行保持开启面板和断点', fullPanel('R001 已暂停。当前断点：核对模块。恢复口令：继续执行。')],
  ['明确关闭仅关闭展示保留队列', '已关闭开发助手面板，保留原队列、阶段和断点。'],
  ['重新开启恢复关闭前的队列和阶段', fullPanel('R002 排队，R001 原断点：接口测试。先不修改代码。')],
  ['讨论口令不触发自身面板或暂停', '“暂停”用于停止当前执行并记录断点，“开始执行”用于开始已确认的任务。现在只解释规则。'],
  ['环境查询只读且依据明确', '环境能否运行需要读取配置并实际检查；目前尚未核验，先按只读方式检查。'],
  ['单项完成不推动五部项目阶段', '当前阶段：第 2 阶段｜架构定界。R001 已完成；整体范围和模块基线仍待验收，暂不进入第三部。'],
  ['未授权开发需求先排队询问', `${contractHeader}\n| 顺序 | 状态 | 编号 |\n| 1 | ? 待确认 | R001 |\n当前任务锁：R001\n总共分：3 步\n下一步：使用 开始执行`],
  ['明确修复口令先展示再执行', `${contractHeader}\n| 顺序 | 状态 | 编号 |\n| 1 | ▶ 正在处理 | R001 |\n当前任务锁：R001\n总共分：3 步\n下一步：定位问题`],
  ['普通问答回答后有任务面板', '授权中心可以按客户、授权控制、设备激活、软件交付和运营治理来理解。\n任务面板\n| 顺序 | 状态 | 编号 | 事项 | 下一步 |\n| 1 | √ 已完成 | R001 | 授权中心层次 | 已回答 |'],
  ['用户没说完时只收集', `${contractHeader}\n需求继续记录，你还没说完。\n| 顺序 | 状态 | 编号 |\n| 1 | ? 待确认 | R001 |`],
  ['非暂停状态单独继续不获得实施授权', `${contractHeader}\n| 顺序 | 状态 | 编号 |\n| 1 | ? 待确认 | R001 |\n当前未暂停，单独“继续”不启动开发；请选择标准口令 开始执行 或 继续执行。`],
  ['截图需求先转文字并进入框架', `${contractHeader}\n理解为修改截图红框中右上角按钮样式。\n| 顺序 | 状态 | 编号 | 要做什么 |\n| 1 | ? 待确认 | R001 | 修改按钮视觉样式 |`],
  ['新需求排队且不抢当前任务', `${contractHeader}\n| 顺序 | 状态 | 编号 |\n| 1 | ▶ 正在处理 | R001 |\n| 2 | □ 排队 | R002 |\n当前任务锁：R001`],
  ['压缩后只保留未完成活动表', `${contractHeader}\n| 顺序 | 状态 | 编号 |\n| 1 | ▶ 正在处理 | R002 |\n| 2 | □ 排队 | R003 |\n当前任务锁：R002`],
  ['明确口令允许调整队列', `${contractHeader}\n| 顺序 | 状态 | 编号 |\n| 1 | ⏸ 已暂停 | R001 |\n| 2 | ▶ 正在处理 | R002 |\n当前任务锁：R002`],
  ['暂停立即保存断点', `${contractHeader}\n已暂停。当前断点：验证失败响应。你说“继续执行”后恢复。`],
  ['恢复从原断点继续', `${contractHeader}\nR001 从断点继续验证失败响应。\n总共分：4 步；当前：第 2/4 步`],
  ['未验证步骤不能跳到下一步', `${contractHeader}\n当前仍处理第1步的测试验证和证据，验证完成后才能推进。`],
  ['进入大下一步先验收当前阶段', `${contractHeader}\n当前阶段：第 1 阶段｜构想定稿｜探索模式\n尚未达标，不能切换；缺口是体验确认。\n下一步：完成体验确认。`],
  ['转到指定阶段禁止跳级', `${contractHeader}\n收到转到第3阶段，但不能跳级；先进入第2阶段架构定界。`],
  ['查看队列表显示一级目录和当前阶段', `【开发助手｜框架内执行】\n一级目录：①构想定稿 → ②架构定界 → ③企业化改造 → ④接口清理与重构 → ⑤测试部署验收\n当前阶段：第 2 阶段｜架构定界｜严格模式\n| 顺序 | 状态 | 编号 | 所属步骤 |\n| 1 | ▶ 正在处理 | R001 | ②架构定界 |\n| 2 | □ 排队 | R002 | ②架构定界 |\n总共分：4 步；当前：第 2/4 步`],
  ['复杂授权逻辑自动整理线路图', `${contractHeader}\n| 顺序 | 状态 | 编号 |\n| 1 | ▶ 正在处理 | R001 |\n授权线路图：机器绑定 → 离线激活 → 续期；撤销与迁移的产品条件待确认。`],
  ['确认线路图后生成状态图而不改代码', `${contractHeader}\n授权线路图：已确认 → AI推测 → 待确认 → 冲突 → 后续版本`],
  ['第一阶段允许真实创作功能', `${contractHeader}\n| 顺序 | 状态 | 编号 | 所属步骤 | 怎么算完成 |\n| 1 | ▶ 正在处理 | R001 | ①构想定稿 | 备注真实保存，刷新和再次打开后仍存在 |`],
  ['结束未完成需求标记取消', `${contractHeader}\nR001 已取消，未达到验收标准，不能标记已完成。下一开发回合移出活动表，并保留简短历史记录。`],
  ['拒绝假数据和固定成功', `${contractHeader}\n不能把客户数写死或让接口固定成功。我会登记为真实实现：连接真实数据源，经过真实业务逻辑保存并重新查询。`],
  ['反代429切换单通道', `${contractHeader}\n429 已触发熔断，不再派发或多开。切换为主智能体单通道串行代行，保持当前任务锁：R001。`],
  ['开发助手查看照片式开发进度', `【开发助手｜框架内执行】\n一级目录：①构想定稿 → ②架构定界 → ③企业化改造 → ④接口清理与重构 → ⑤测试部署验收\n当前阶段：第 2 阶段｜架构定界\n任务面板：暂无活动任务。`],
  ['话题变成问答仍保留队列', `登录接口先查请求、日志和错误码。\n任务面板\n| 顺序 | 状态 | 编号 | 事项 | 下一步 |\n| 1 | ▶ 正在处理 | R001 | 登录接口 | 继续验证 |\n| 2 | □ 排队 | R002 | 报表 | 等待 |\n当前任务锁：R001`],
  ['问题自动识别并回答', `授权中心可分客户、激活和权限。\n任务面板\n| 顺序 | 状态 | 编号 | 事项 | 下一步 |\n| 1 | √ 已完成 | R001 | 授权中心层次 | 已回答 |`],
  ['明确开发要求进入五列面板', `【开发助手｜框架内执行】\n一级目录：①构想定稿 → ②架构定界 → ③企业化改造 → ④接口清理与重构 → ⑤测试部署验收\n当前阶段：第 2 阶段｜架构定界\n任务面板\n| 顺序 | 状态 | 编号 | 所属步骤 | 完成内容 |\n| 1 | ▶ 正在处理 | R001 | ②架构定界 | 订单排错 |\n| 2 | □ 排队 | R002 | ②架构定界 | 客户搜索 |\n当前任务锁：R001`],
  ['第二部新想法不自动回退第一部', `【开发助手｜框架内执行】\n一级目录：①构想定稿 → ②架构定界 → ③企业化改造 → ④接口清理与重构 → ⑤测试部署验收\n当前阶段：第 2 阶段｜架构定界\n任务面板\n| 1 | ▶ 正在处理 | R001 | ②架构定界 | 登录接口 |\n| 2 | □ 排队 | R002 | ②架构定界 | 客户备注 |`],
  ['第二部新增真实功能和接口后正规整理', `【开发助手｜框架内执行】\n一级目录：①构想定稿 → ②架构定界 → ③企业化改造 → ④接口清理与重构 → ⑤测试部署验收\n当前阶段：第 2 阶段｜架构定界\n任务面板\n| 顺序 | 状态 | 编号 | 所属步骤 | 完成内容 |\n| 1 | ▶ 正在处理 | R001 | ②架构定界 | 新增真实保存接口，联调验证后整理模块边界 |`],
  ['单项功能完成不改变项目第二部', `【开发助手｜框架内执行】\n一级目录：①构想定稿 → ②架构定界 → ③企业化改造 → ④接口清理与重构 → ⑤测试部署验收\n当前阶段：第 2 阶段｜架构定界\nR001 客户备注已完成；第二部整体模块边界和迁移仍需验收。\n任务面板：暂无活动任务。`],
  ['首次已有代码先显示待识别紧凑面板', `【开发助手｜框架内执行】\n${stages}\n当前阶段：待识别｜等待读取项目结构\n任务面板\n| 顺序 | 状态 | 编号 | 所属步骤 | 完成内容 |\n| 1 | ▶ 正在处理 | R001 | 待识别 | 读取项目结构和代码 |\n当前任务锁：R001\n下一步：读取项目结构和代码。`],
  ['测试失败阻止正式发布', `${contractHeader}\n发布阻塞：测试失败2项，版本不一致，不能发布，先修复。`],
]);

const continuationCases = [
  { name: '运行中登记新需求再续做', context: '工作台关闭。项目甲第二部，R001 登录正在执行，未暂停。', request: '再加退出登录记到队列，你先继续原登录。', checks: [['新增排队', t => /R002/.test(t) && /排队|排在.*(?:之后|后面)/.test(t)], ['登记后续做', t => /登记|记录/.test(t) && /R001/.test(t) && /继续|续做/.test(t)], ['不假报完成', t => !/已完成|已提交/.test(t)]], fixture: '已登记 R002 退出登录排队；继续 R001 原登录验证。' },
  { name: '当前纠正更新原任务', context: '工作台关闭，R001 正在做邮箱登录。', request: '纠正 R001，改用手机号登录，不要邮箱。', checks: [['更新原任务', t => /R001/.test(t) && /更新|调整|修正|纠正/.test(t)], ['新要求和影响', t => /手机号/.test(t) && /影响|接口|数据|短信|密码/.test(t)], ['不另建任务', t => !/R002/.test(t)]], fixture: '更新 R001 为手机号登录，先检查数据和接口影响，再按新要求续做。' },
  { name: '明确转去聊天保存账本等待', context: '工作台关闭。项目甲第二部，R001 登录失败响应未测试，R002 权限排队。', request: '这个项目先放着，先聊别的，记住未完成等我指令继续。', checks: [['持久记录', t => /账本|项目记录/.test(t)], ['暂停等待', t => /暂停/.test(t) && /等待|等你|明确说/.test(t)], ['保留断点与队列', t => /R001/.test(t) && /失败响应|未测试/.test(t) && /R002/.test(t)], ['不开面板', t => !/一级目录：/.test(t)]], fixture: '项目甲已暂停，等待继续指令。保存项目账本：R001 失败响应未测试，R002 权限排队。保存失败会说明，随后正常聊天。' },
  { name: '提旧需求只查记录不恢复', context: '工作台关闭。已聊很多其他话题，项目甲账本中 R001 登录失败响应未测，R002 权限排队，已暂停。', request: '之前那个登录呢？', checks: [['原任务断点', t => /R001/.test(t) && /失败响应|未测/.test(t)], ['暂停等指令', t => /暂停/.test(t) && /等待|等你|你说/.test(t) && /继续/.test(t)], ['不开工', t => !/现在开始修改|已修改|已提交/.test(t)]], fixture: '项目甲记录中 R001 失败响应未测，R002 排队，仍已暂停，等你说继续做登录。' },
  { name: '继续前核对工作区和断点', context: '工作台关闭。项目甲已暂停，R001 失败响应未测，R002 排队；其他人可能改了文件。', request: '继续做项目甲登录。', checks: [['核对改动', t => /分支|工作区/.test(t) && /文件|改动/.test(t)], ['原断点队列', t => /R001/.test(t) && /断点|失败响应/.test(t) && /R002/.test(t)], ['不假报检查通过', t => !/已检查通过|已验证通过|已提交/.test(t)]], fixture: '先读项目甲账本，核对分支、工作区和文件改动，再从 R001 失败响应断点续做，R002 保持排队。' },
  { name: '暂停期间追加不恢复', context: '工作台关闭。项目甲已暂停，R001 登录，R002 权限排队。', request: '还有退出登录，也记上。', checks: [['新增编号', t => /R003/.test(t)], ['暂停等指令', t => /暂停/.test(t) && /等待|等你|恢复时请说/.test(t) && /继续/.test(t)], ['不自动续做', t => !/现在继续|已开始修改/.test(t)]], fixture: '已记录 R003 退出登录排队；R001 仍已暂停，R002 保留，等待明确继续。' },
];
for (const { fixture, ...scenario } of continuationCases) {
  scenarios.push(scenario);
  contractFixtures.set(scenario.name, fixture);
}

function runCodex({ cwd, prompt, sandbox = 'read-only', json = false, outputPath, skipGit = false }) {
  const args = ['-c', 'web_search="disabled"', '--sandbox', sandbox, '--ask-for-approval', 'never', '--cd', cwd, 'exec', '--ephemeral', '--color', 'never'];
  if (skipGit) args.push('--skip-git-repo-check');
  if (json) args.push('--json');
  if (outputPath) args.push('--output-last-message', outputPath);
  args.push('-');
  return spawnSync(codex, args, {
    input: prompt,
    encoding: 'utf8',
    maxBuffer: 30 * 1024 * 1024,
    timeout: timeoutMs,
  });
}

function parseEvents(stdout) {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line));
}

function isToolEvent(event) {
  const itemType = event?.item?.type;
  return (event.type === 'item.started' || event.type === 'item.completed')
    && ['command_execution', 'file_change', 'mcp_tool_call', 'computer_tool_call', 'web_search'].includes(itemType);
}

function getAgentMessages(events) {
  return events
    .filter((event) => event.type === 'item.completed' && event?.item?.type === 'agent_message')
    .map((event) => event.item.text.trim());
}

function assertResponse(name, response, checks, { silent = false } = {}) {
  if (response.startsWith('【开发助手｜框架内执行】')) {
    assert.ok(response.includes('一级目录：①构想定稿 → ②架构定界 → ③企业化改造 → ④接口清理与重构 → ⑤测试部署验收'), `${name}：缺少固定一级目录`);
    assert.ok(response.includes('当前阶段：'), `${name}：缺少当前阶段`);
  }
  const failures = checks.filter(([, check]) => !check(response)).map(([checkName]) => checkName);
  if (failures.length) throw new Error(`${name}：${failures.join('、')}\n${response}`);
  if (!silent) console.log(`PASS ${name}：${checks.length}/${checks.length}`);
}

function runHarnessSelfTest() {
  const trace = [
    { type: 'item.completed', item: { type: 'agent_message', text: '【开发助手｜框架内执行】\n一级目录：①构想定稿 → ②架构定界 → ③企业化改造 → ④接口清理与重构 → ⑤测试部署验收\n当前阶段：第 1 阶段｜构想定稿｜探索模式\n当前任务锁：R001' } },
    { type: 'item.started', item: { type: 'command_execution' } },
  ];
  assert.equal(getAgentMessages(trace)[0].startsWith('【开发助手｜框架内执行】'), true);
  assert.equal(trace.findIndex(isToolEvent), 1);
  assert.equal(trace.findIndex((event) => event?.item?.type === 'agent_message'), 0);
  assert.throws(() => parseEvents('{broken json}'));
  assert.deepEqual(parseEvents('{"type":"turn.started"}\n'), [{ type: 'turn.started' }]);
  assert.throws(() => assertResponse('旧需求查询不得开工', 'R001 失败响应未测，现在开始修改代码。', continuationCases[3].checks, { silent: true }));
  assert.throws(() => assertResponse('暂停追加不得续做', 'R003 已记录，现在继续 R001。', continuationCases[5].checks, { silent: true }));
  assert.equal(contractFixtures.size, scenarios.length, '离线契约样例数量与真实场景数量不一致');
  assert.equal(new Set(scenarios.map(({ name }) => name)).size, scenarios.length, '行为场景名称重复');
  for (const scenario of scenarios) {
    const fixture = contractFixtures.get(scenario.name);
    assert.ok(fixture, `缺少离线契约样例：${scenario.name}`);
    assertResponse(`${scenario.name}（离线契约）`, fixture, scenario.checks, { silent: true });
  }
  assert.throws(() => assertResponse('漏面板必须失败', '规则已经修复，继续处理。', [['完整面板', hasFullPanel]], { silent: true }));
  assert.equal(hasFullPanel(fullPanel().replace('一级目录：', '目录：')), false);
  assert.equal(hasFullPanel(fullPanel().replace('| 顺序 | 状态 | 编号 | 所属步骤 | 完成内容 |', '')), false);
  assert.equal(hasFullPanel(fullPanel() + '\n项目进度面板'), false);
  assert.equal(hasFullPanel(fullPanel().replace('| 顺序 | 状态 | 编号 | 所属步骤 | 完成内容 |', '| 顺序 | 状态 | 编号 | 完成内容 | 所属步骤 |')), false);
  assert.equal(hasFullPanel(fullPanel().replace('当前任务锁：R001', '任务锁已丢失')), false);
  console.log(`PASS 离线行为契约：${scenarios.length}/${scenarios.length}；事件解析、首回复顺序和异常输入检查通过。`);
}

function runResponseScenarios() {
  const firstScenario = Math.max(1, Number(process.env.SMARTBUILD_BEHAVIOR_FROM || 1));
  const lastScenario = Math.min(scenarios.length, Number(process.env.SMARTBUILD_BEHAVIOR_TO || scenarios.length));
  for (let index = firstScenario - 1; index < lastScenario; index += 1) {
    const scenario = scenarios[index];
    const outputPath = path.join(tempDir, `scenario-${index + 1}.txt`);
    const prompt = `${responsePrompt}\n\nConversation state: 用户无需切换模式，由意图自动识别；${scenario.context || 'none'}\nUser request: ${scenario.request}\n`;
    const result = runCodex({ cwd: root, prompt, outputPath });
    if (result.error) throw new Error(`${scenario.name}：无法启动 Codex：${result.error.message}`);
    if (result.status !== 0 || !fs.existsSync(outputPath)) {
      throw new Error(`${scenario.name}：Codex 退出码 ${result.status}\n${result.stderr || ''}`);
    }
    assertResponse(scenario.name, fs.readFileSync(outputPath, 'utf8').trim(), scenario.checks);
  }
  return Math.max(0, lastScenario - firstScenario + 1);
}

function runToolGateScenario({ authorized }) {
  const name = authorized ? '已授权时先回复后执行真实修改' : '未授权时不调用工具且不修改文件';
  const probe = fs.mkdtempSync(path.join(tempDir, authorized ? 'authorized-' : 'unauthorized-'));
  const target = path.join(probe, 'target.txt');
  fs.writeFileSync(target, 'old\n');
  const request = authorized
    ? '修复 target.txt，把内容从 old 改成 new，直接执行。'
    : '先记下来，别开始：以后把 target.txt 的内容从 old 改成 new。';
  const prompt = `${bindingPrompt}\nConversation state: 用户无需切换模式，由意图自动识别；当前没有活动任务。\nUser request: ${request}\n`;
  const result = runCodex({ cwd: probe, prompt, sandbox: 'workspace-write', json: true, skipGit: true });
  if (result.error) throw new Error(`${name}：无法启动 Codex：${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${name}：Codex 退出码 ${result.status}\nSTDOUT:\n${result.stdout || ''}\nSTDERR:\n${result.stderr || ''}`);
  }

  const events = parseEvents(result.stdout);
  const messages = getAgentMessages(events);
  const firstMessageIndex = events.findIndex((event) => event.type === 'item.completed' && event?.item?.type === 'agent_message');
  const firstToolIndex = events.findIndex(isToolEvent);
  assert.ok(messages.length > 0, `${name}：没有用户可见回复`);
  assert.ok(messages[0].startsWith('【开发助手｜框架内执行】'), `${name}：首回复缺少框架标记`);
  assert.ok(messages[0].includes('一级目录：①构想定稿 → ②架构定界 → ③企业化改造 → ④接口清理与重构 → ⑤测试部署验收'), `${name}：首回复缺少固定一级目录`);
  assert.ok(messages[0].includes('当前阶段：'), `${name}：首回复缺少当前阶段`);
  assert.ok(messages[0].includes('| 顺序 | 状态 | 编号'), `${name}：首回复缺少排队表`);
  assert.ok(messages[0].includes('当前任务锁：R001'), `${name}：首回复缺少任务锁`);

  const finalContent = fs.readFileSync(target, 'utf8').trim();
  if (authorized) {
    assert.ok(firstToolIndex > firstMessageIndex, `${name}：工具调用发生在首回复之前；首个工具事件=${JSON.stringify(events[firstToolIndex])}`);
    assert.equal(finalContent, 'new', `${name}：文件没有完成真实修改`);
  } else {
    assert.equal(firstToolIndex, -1, `${name}：未授权时发生了工具调用；首个工具事件=${JSON.stringify(events[firstToolIndex])}`);
    assert.equal(finalContent, 'old', `${name}：未授权时文件被修改`);
    assert.ok(messages[0].includes('? 待确认'), `${name}：未标记待确认`);
  }
  console.log(`PASS ${name}：真实事件和文件结果一致。`);
}

function runProjectScanScenario() {
  const name = '首次读取真实项目结构后识别阶段';
  const probe = fs.mkdtempSync(path.join(tempDir, 'project-scan-'));
  const sourceDir = path.join(probe, 'src');
  fs.mkdirSync(sourceDir);
  fs.writeFileSync(path.join(probe, 'package.json'), JSON.stringify({ name: 'notes-prototype', private: true, type: 'module', scripts: { start: 'node src/server.mjs' } }, null, 2));
  fs.writeFileSync(path.join(probe, 'README.md'), '试制版：用户尚未体验验收，正式第一版范围和模块边界未确认。没有 CI、部署与正式验收记录。\n');
  const source = `import http from 'node:http';
import fs from 'node:fs';
const store = new URL('../notes.json', import.meta.url);
http.createServer((request, response) => {
  if (request.method === 'POST' && request.url === '/notes') {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      const notes = fs.existsSync(store) ? JSON.parse(fs.readFileSync(store, 'utf8')) : [];
      notes.push(JSON.parse(body));
      fs.writeFileSync(store, JSON.stringify(notes));
      response.writeHead(201, { 'content-type': 'application/json' });
      response.end(JSON.stringify(notes.at(-1)));
    });
    return;
  }
  response.writeHead(404);
  response.end();
}).listen(3030);
`;
  fs.writeFileSync(path.join(sourceDir, 'server.mjs'), source);
  const prompt = `${bindingPrompt}\nConversation state: 第一次接手这个已有代码的项目，没有阶段账本；允许只读查看真实代码与验收证据。\nUser request: 开发助手，查看这个项目走到五部的哪一步。请先读取实际项目结构再回答，只读，不改文件。\n`;
  const result = runCodex({ cwd: probe, prompt, sandbox: 'read-only', json: true, skipGit: true });
  if (result.error || result.status !== 0) throw new Error(`${name}：Codex 未完成：${result.error?.message || result.stderr || result.status}`);
  const events = parseEvents(result.stdout);
  const messages = getAgentMessages(events);
  const final = messages.at(-1) || '';
  assert.ok(events.some(isToolEvent), `${name}：没有真正读取代码`);
  assert.ok(result.stdout.includes('server.mjs'), `${name}：没有读取关键业务文件`);
  assert.ok(hasFullPanel(final) || (final.includes(stages) && final.includes('当前阶段：') && final.includes('任务面板：暂无活动任务')), `${name}：没有第一版紧凑面板\n${final}`);
  assert.ok(/当前阶段：(?:\*\*)?第\s*1\s*阶段.*构想定稿/.test(final), `${name}：未根据尚未验收的试制代码判断第一部\n${final}`);
  assert.ok(/server\.mjs|POST \/notes|持久化|写入|代码结构/.test(final), `${name}：判断依据没有关联实际代码\n${final}`);
  assert.equal(fs.readFileSync(path.join(sourceDir, 'server.mjs'), 'utf8'), source, `${name}：只读查询改动了代码`);
  console.log(`PASS ${name}：真实读取与面板阶段一致。`);
}
function runLedgerRecoveryScenario() {
  const name = '跨会话账本写入、读回和外部改动后恢复';
  const probe = fs.mkdtempSync(path.join(tempDir, 'ledger-recovery-'));
  const target = path.join(probe, 'config.txt');
  const ledger = path.join(probe, '.codex', 'auto-dev-ledger.md');
  fs.writeFileSync(target, 'tone=original\nowner=initial\n');

  function session(label, state, request, sandbox = 'workspace-write') {
    const prompt = bindingPrompt + '\nConversation state: ' + state + '\nThe project root is the current directory. This is a multi-step project; its persistent ledger is .codex/auto-dev-ledger.md. Do not use conversation memory as evidence of a file write.\nUser request: ' + request + '\n';
    const result = runCodex({ cwd: probe, prompt, sandbox, json: true, skipGit: true });
    const events = parseEvents(result.stdout || '');
    const completed = events.some((event) => event.type === 'turn.completed');
    if ((result.error || result.status !== 0) && !(result.error?.code === 'ETIMEDOUT' && completed)) {
      throw new Error(label + '：Codex 未完成：' + (result.error?.message || result.stderr || result.status) + '; 最后事件=' + JSON.stringify(events.at(-1)));
    }
    const messages = getAgentMessages(events);
    assert.ok(messages.length, label + '：没有回复');
    console.log('PASS 真实账本调用完成：' + label);
    return { events, final: messages.at(-1) };
  }

  const recorded = session('登记', '这是已有的多步骤项目；当前没有活动项，用户尚未授权实施。项目身份和路径已明确，可以只为保存需求写项目账本。',
    '先记下来，别开始：R001 将 config.txt 的 tone=original 改为 tone=final；保持其他字段；完成时检查文件内容。');
  const firstMessageIndex = recorded.events.findIndex((event) => event.type === 'item.completed' && event?.item?.type === 'agent_message');
  const firstToolIndex = recorded.events.findIndex(isToolEvent);
  assert.ok(firstToolIndex > firstMessageIndex, '登记：账本工具调用发生在首回复之前或未调用');
  assert.equal(fs.readFileSync(target, 'utf8'), 'tone=original\nowner=initial\n', '登记：未授权时修改了产品文件');
  assert.ok(fs.existsSync(ledger), '登记：没有写入真实项目账本');
  const written = fs.readFileSync(ledger, 'utf8');
  assert.match(written, /R001/);
  assert.match(written, /tone=final/);
  assert.match(written, /待确认|未授权|未开始|需求收集|pending confirmation|not started|requirement recorded/i);

  const recovered = session('读回', '这是全新会话，没有上一会话的聊天记录；只能读取项目内账本还原任务。',
    '之前记录的 R001 到哪一步了？只读查看项目账本，别开始修改。', 'read-only');
  assert.ok(recovered.events.some(isToolEvent), '读回：没有实际读取账本');
  assert.match(recovered.final, /R001/);
  assert.match(recovered.final, /未开始|待确认|需求收集|未授权|尚未|pending|not started|recorded/i);
  assert.equal(fs.readFileSync(target, 'utf8'), 'tone=original\nowner=initial\n');

  fs.writeFileSync(target, 'tone=original\nowner=user-added\n');
  const resumed = session('恢复', '这是全新会话。R001 在上次记录后，项目文件可能由其他人修改。用户现在明确授权继续。先读取账本和当前文件，再实施并更新账本。',
    '继续执行 R001；将 tone 改为 final，并保留项目文件里已有的其他字段。');
  assert.ok(resumed.events.some(isToolEvent), '恢复：没有读取或执行工具');
  const finalContent = fs.readFileSync(target, 'utf8');
  assert.match(finalContent, /^tone=final$/m, '恢复：目标未实现');
  assert.match(finalContent, /^owner=user-added$/m, '恢复：覆盖了会话间外部变更');
  assert.ok(fs.readFileSync(ledger, 'utf8').includes('R001'), '恢复：账本丢失任务');
  console.log('PASS ' + name + '：真实文件与新会话结果一致。');
}

function runLedgerFailureScenario() {
  const probe = fs.mkdtempSync(path.join(tempDir, 'ledger-failure-'));
  const blocker = path.join(probe, '.codex');
  const target = path.join(probe, 'config.txt');
  fs.writeFileSync(blocker, 'existing-user-file\n');
  fs.writeFileSync(target, 'tone=original\n');
  const prompt = bindingPrompt + '\nConversation state: 已知多步骤项目。项目账本唯一指定为 .codex/auto-dev-ledger.md；不得另存其他路径或删除任何已有文件。用户只允许记录。保存失败就如实报告，不得宣称已持久保存。请用原生文件工具保存并核对，避免环境安装。\nUser request: 先记下来，别开始：以后把 config.txt 的 tone 改为 final，并验证文件内容。\n';
  const result = runCodex({ cwd: probe, prompt, sandbox: 'workspace-write', json: true, skipGit: true });
  const events = parseEvents(result.stdout || '');
  if ((result.error || result.status !== 0) && !(result.error?.code === 'ETIMEDOUT' && events.some(event => event.type === 'turn.completed'))) {
    throw new Error('账本失败测试未完成：' + (result.error?.message || result.stderr || result.status));
  }
  const final = getAgentMessages(events).at(-1) || '';
  assert.ok(events.some(isToolEvent), '保存失败：未实际尝试写入或核对阻塞路径');
  assert.equal(fs.readFileSync(blocker, 'utf8'), 'existing-user-file\n', '保存失败：覆盖了阻塞路径的用户文件');
  assert.equal(fs.readFileSync(target, 'utf8'), 'tone=original\n');
  assert.equal(fs.existsSync(path.join(blocker, 'auto-dev-ledger.md')), false);
  assert.match(final, /无法|失败|未.*(?:保存|写入)|不能.*(?:保存|写入)|未能|unable|failed|cannot/i, '保存失败：未如实报告');
  assert.doesNotMatch(final, /已(?:成功)?(?:持久)?保存(?:到|至).*auto-dev-ledger/, '保存失败：虚报成功');
  console.log('PASS 真实账本保存失败如实报告：用户文件未变。');
}

let failed = false;
let actualScenariosRun = 0;
try {
  runHarnessSelfTest();
  if (process.argv.includes('--ledger-failure-only')) {
    runLedgerFailureScenario();
  } else if (process.argv.includes('--ledger-only')) {
    runLedgerRecoveryScenario();
    runLedgerFailureScenario();
  } else if (process.argv.includes('--project-scan-only')) {
    runProjectScanScenario();
  } else if (!process.argv.includes('--self-test')) {
    if (!process.argv.includes('--tool-gates-only')) actualScenariosRun = runResponseScenarios();
    if (!process.argv.includes('--responses-only')) {
      runToolGateScenario({ authorized: false });
      runToolGateScenario({ authorized: true });
      runProjectScanScenario();
      runLedgerRecoveryScenario();
      runLedgerFailureScenario();
    }
  }
} catch (error) {
  console.error(`FAIL ${error.message}`);
  failed = true;
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

if (failed) process.exit(1);
if (process.argv.includes('--self-test')) {
  console.log(`\n智构开发系统离线行为契约通过：${scenarios.length + 2}/${scenarios.length + 2}`);
} else if (process.argv.includes('--responses-only')) {
  console.log(`\n智构开发系统本次真实回复测试通过：${actualScenariosRun} 个场景；未执行工具闸门和项目扫描。`);
} else if (process.argv.includes('--ledger-failure-only')) {
  console.log('\n真实账本保存失败测试通过：1/1。');
} else if (process.argv.includes('--ledger-only')) {
  console.log('\n智构开发系统跨会话真实账本与恢复及保存失败测试通过：2/2。');
} else if (process.argv.includes('--project-scan-only')) {
  console.log('\n智构开发系统真实代码结构识别测试通过：1/1。');
} else {
  console.log(`\n智构开发系统本次真实行为测试通过：${actualScenariosRun} 个回复场景、2 个工具闸门、1 个真实代码结构识别、1 个跨会话账本恢复、1 个账本保存失败。`);
}
