import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initialize, transact, readState } from '../skills/auto-dev/scripts/task-runtime.mjs';
import { renderPanel } from '../skills/auto-dev/scripts/panel.mjs';

const GOLDEN_DIR = 'scripts/golden';

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'smartbuild-panel-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'app.txt'), 'fixture\n');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'index.js'), 'export const value = 1;\n');
  initialize(root, '面板样例', 'session-panel');
  const add = {
    action: 'add', expectedRevision: readState(root).revision,
    title: '校验面板字段', scope: 'src 与 app.txt', acceptance: ['表头固定', '状态来自账本'],
    watch: ['app.txt', 'src'], deliveries: ['local'], aociRequired: false,
  };
  transact(root, add);
  return root;
}

for (const [mode, golden] of [['full', 'panel-full.txt'], ['compact', 'panel-compact.txt']]) {
  test(`面板 ${mode} 输出与黄金文件一致`, t => {
    const root = fixture(t);
    const output = renderPanel(root, { mode, understanding: '核对本期面板渲染。' });
    const expected = fs.readFileSync(path.join(GOLDEN_DIR, golden), 'utf8');
    assert.equal(output, expected);
  });
}

test('面板输出不含时间戳、随机数或百分比', t => {
  const root = fixture(t);
  const output = renderPanel(root, { mode: 'full', understanding: '核对本期面板渲染。' });
  assert.doesNotMatch(output, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  assert.doesNotMatch(output, /\d+%/);
});

test('空队列仍展示固定表头，不生成任务编号', t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'smartbuild-empty-panel-')));
  t.after(() => fs.rmSync(root, {recursive:true,force:true}));
  initialize(root, '空项目', 'session-empty');
  for (const [mode, header] of [['full', '| 状态 | 编号 | 所属步骤 | 当前步骤 | 内容摘要 | 验证结果 |'], ['compact', '| 状态 | 编号 | 事项 | 下一步 |']]) {
    const output = renderPanel(root, {mode});
    assert.ok(output.includes(header)); assert.match(output, /暂无活动任务/); assert.doesNotMatch(output, /R\d{3}/);
  }
});
test('项目、验收和断点中的分隔符与换行不会破坏固定表格', t => {
  const root = fixture(t); const state = readState(root);
  state.project.name = '项目|中文\n第二行';
  state.tasks[0].title = '修复|输入\n换行'; state.tasks[0].acceptance = ['验收|内容\n一条'];
  state.tasks[0].owner = '作者|A'; state.tasks[0].belongsTo = '阶段|甲';
  state.tasks[0].checkpoint = {nextAction:'复核|结果\n断点'}; state.tasks[0].nextAction = '继续|回归\n测试';
  fs.writeFileSync(path.join(root, 'auto-dev-state.json'), JSON.stringify(state));
  const output = renderPanel(root, {mode:'full'}); let columns = 2;
  for (const line of output.split('\n')) {
    if (line.startsWith('| 状态 |')) columns=6;
    if (line.startsWith('| 项目 |')) columns=2;
    if (line.startsWith('|')) assert.equal(line.split('|').length-2, columns, line);
  }
  assert.ok(output.includes('验收｜内容 一条'));
  assert.ok(output.includes('复核｜结果 断点'));
});
