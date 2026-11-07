import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalRoot, readState, summary } from './task-runtime.mjs';

// Panel output is a pure function of the ledger: no timestamps, no randomness,
// so golden-file comparison stays byte-stable.
import { STAGES, STATUS, PANEL, CONTROL_FULL, CONTROL_SHORT } from './workflow-contract.mjs';

function stageLine(current) {
  return STAGES.map((name, index) => {
    const label = `${['①', '②', '③', '④', '⑤'][index]}${name}`;
    if (!current) return label;
    return index + 1 === current ? `[${label}]` : label;
  }).join(' → ');
}

function stageText(phase) {
  return phase ? `第 ${phase} 阶段｜${STAGES[phase - 1]}｜${phase === 1 ? '探索模式' : '严格模式'}` : '待识别｜等待读取项目结构';
}

function agentState(state) {
  if (state.paused) return '⏸ 已暂停';
  const locked = state.tasks.find(task => task.id === state.lock);
  return locked && locked.status === 'blocked' ? '🔴 阻塞' : '🟢 运行中';
}

function memoryChain(state) {
  return state.project?.id ? '已加载' : '待建立';
}

function currentTask(state) {
  return state.tasks.find(task => task.id === state.lock) ?? null;
}

function nextAction(task) {
  if (!task) return '无';
  return task.nextAction ?? (task.status === 'completed' ? '本轮保留，下一开发轮次归档' : '待确认');
}

function owner(task) {
  return task?.owner ?? task?.agent?.id ?? '开发助手';
}

function stepText(task) {
  if (!task?.steps?.length) return '未开始';
  return `第 ${task.step}/${task.steps.length} 步`;
}

function activeTasks(state) {
  return state.tasks;
}

function verificationText(item, state) {
  const check = state.checks?.find(check => check.id === item.id);
  if (item.status === 'completed') return !check?.completion?.valid ? '历史完成待复核' : check.completion.current ? '完成时与当前版本均已核验' : '历史已完成，当前版本待复验';
  return check?.workflow ? (check.workflow.ready ? '证据齐全' : check.workflow.reason) : '待验证';
}
function compactTasks(state) {
  const selected = [], add = item => { if (item && !selected.includes(item) && selected.length < 3) selected.push(item); };
  add(currentTask(state));
  add([...state.tasks].reverse().find(item => item.status === 'completed'));
  add([...state.tasks].reverse().find(item => ['recorded','queued'].includes(item.status)));
  for (const item of state.tasks) add(item);
  return selected;
}
const cell = value => String(value ?? '').replace(/\|/g, '\uFF5C').replace(/[\r\n]+/g, ' ');
function belongsTo(item, state) {
  const explicit = item.belongsTo ?? item.stage;
  if (explicit) return explicit;
  return state.phase ? STAGES[state.phase - 1] : '待识别';
}

function qualityText(state) {
  const task=currentTask(state), quality=state.checks?.find(check=>check.id===task?.id)?.quality;
  const result=kind=>kind==='review'&&quality?.review_waived?'独立审核已豁免':quality?.[kind]===true?'已通过':'待执行或复核';
  return '质量规则：已启用｜项目审计：'+result('project_audit')+'｜代码审核：'+result('review')+'｜文字检查：'+result('text_review');
}
function renderFull(state, understanding) {
  const task = currentTask(state);
  const lines = [];
  lines.push(PANEL.firstLine, '', PANEL.title, '');
  lines.push('| 运行信息 | 当前内容 |', '|---|---|');
  lines.push(`| 智能体状态 | ${agentState(state)} |`);
  lines.push(`| 当前项目 | ${cell(state.project?.name ?? '待确认')} |`);
  lines.push(`| 当前记忆链 | ${memoryChain(state)} |`);
  lines.push(`| 当前阶段 | ${stageText(state.phase)} |`);
  lines.push(`| 当前任务锁 | ${state.lock ?? '无'} |`);
  lines.push(`| 当前步骤 | ${stepText(task)} |`);
  lines.push(`| 负责智能体 | ${cell(owner(task))} |`);
  lines.push('', '### 全局五部进度', '', stageLine(state.phase), '');
  lines.push('### 本回合理解', '', understanding, '', qualityText(state), '');
  lines.push('### 活动任务', '');
  const active = activeTasks(state);
  lines.push(PANEL.fullHeader, '|---|---|---|---|---|---|');
  if (!active.length) {
    lines.push('| 待命 | — | 待识别 | 未开始 | 暂无活动任务 | 未开始 |');
  } else {
    for (const item of active) {
      const verified = verificationText(item, state);
      lines.push(`| ${STATUS[item.status] ?? item.status} | ${item.id} | ${cell(belongsTo(item, state))} | ${item.steps?.length ? `${item.step}/${item.steps.length}` : '0/0'} | ${cell(item.title)} | ${cell(verified)} |`);
    }
  }
  lines.push('', '### 当前焦点', '');
  lines.push('| 项目 | 内容 |', '|---|---|');
  lines.push(`| 当前任务 | ${task?.id ?? '无'} |`);
  lines.push(`| 正在处理 | ${cell(task?.title ?? '无')} |`);
  lines.push(`| 完成标准 | ${cell(task?.acceptance?.[0] ?? '无')} |`);
  lines.push(`| 当前断点 | ${cell(task?.checkpoint?.nextAction ?? '无')} |`);
  lines.push(`| 下一步 | ${cell(nextAction(task))} |`);
  lines.push('', '### 控制口令', '', CONTROL_FULL);
  return lines.join('\n') + '\n';
}

function renderCompact(state, understanding) {
  const task = currentTask(state);
  const lines = [];
  lines.push(PANEL.firstLine, '', PANEL.title, '');
  lines.push(`\`${agentState(state)}｜${cell(state.project?.name ?? '待确认')}｜第${state.round?.id ?? 1}开发轮次｜${state.phase ? STAGES[state.phase - 1] : '待识别'}｜${state.lock ?? '无'}｜${task?.steps?.length ? `${task.step}/${task.steps.length}` : '未开始'}\``);
  lines.push('', stageLine(state.phase), '');
  lines.push(`**本回合理解：** ${understanding}`, '', qualityText(state), '');
  const active = compactTasks(state);
  if (!active.length) {
    lines.push(PANEL.shortHeader, '|---|---|---|---|', '| 待命 | — | 暂无活动任务 | 等待明确需求 |');
  } else {
    lines.push(PANEL.shortHeader, '|---|---|---|---|');
    for (const item of active) {
      lines.push(`| ${STATUS[item.status] ?? item.status} | ${item.id} | ${cell(item.title)} | ${cell(item.status === 'completed' ? verificationText(item, state) : nextAction(item))} |`);
    }
  }
  if (state.tasks.length > active.length) lines.push('', `其余 ${state.tasks.length - active.length} 项保留在本轮账本；使用「查看队列表」查看全部。`);
  lines.push('', CONTROL_SHORT);
  return lines.join('\n') + '\n';
}

export function renderPanel(project, { mode = 'compact', understanding = '按账本恢复当前状态。' } = {}) {
  const root = canonicalRoot(project);
  const state = readState(project);
  const report = summary(state, root);
  return mode === 'full' ? renderFull(report, understanding) : renderCompact(report, understanding);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [, , project, flag] = process.argv;
  if (!project) {
    console.error('usage: node panel.mjs <project-path> [--full|--compact]');
    process.exit(1);
  }
  const mode = flag === '--full' ? 'full' : 'compact';
  const understandingIndex = process.argv.indexOf('--understanding');
  const understanding = understandingIndex > 0 ? process.argv[understandingIndex + 1] : '按账本恢复当前状态。';
  process.stdout.write(renderPanel(project, { mode, understanding }));
}
