import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');
const skill = read('skills/auto-dev/SKILL.md');
const metadata = read('skills/auto-dev/agents/openai.yaml');
const panel = read('skills/auto-dev/references/command-center-panel.md');
const bootstrap = read('skills/auto-dev/references/global-bootstrap.md');
const installer = read('skills/auto-dev/scripts/install-global-bootstrap.ps1');
const localInstaller = read('scripts/install-smartbuild.ps1');
const decision = read('skills/auto-dev/references/decision-and-stage-gates.md');
const ledger = read('skills/auto-dev/references/project-ledger.md');
const stageModel = read('skills/auto-dev/references/five-stage-operating-model.md');
const tests = [];
const test = (name, check, detail) => tests.push({ name, check: Boolean(check), detail });
const all = (source, ...parts) => parts.every((part) => source.includes(part));

const fullHeader = '| 状态 | 编号 | 所属步骤 | 当前步骤 | 内容摘要 | 验证结果 |';
const compactHeader = '| 状态 | 编号 | 事项 | 下一步 |';
const fixedFirstLine = '【开发助手｜框架内执行】';
const stages = ['①构想定稿', '②架构定界', '③企业化改造', '④接口清理与重构', '⑤测试部署验收'];

// 启动入口与两段式面板
test('开发助手独立口令是全局强制入口', all(skill,
  '用户当前消息去除首尾空白后全文恰好是 `开发助手` 时',
  '第一条用户可见回复必须直接显示完整指挥中心',
) && all(bootstrap, '全文恰好是 `开发助手`', '不得静默退回普通回答'), '新会话不依赖隐式猜测。');
test('首行逐字写死', skill.includes(`首行永远固定为 \`${fixedFirstLine}\``)
  && bootstrap.includes(`第一行必须逐字为 \`${fixedFirstLine}\``)
  && metadata.includes(`第一条回复第一行必须逐字是${fixedFirstLine}`), '三个入口共同固定首行。');
test('首次启动必须显示完整版', all(panel,
  '## 首次启动完整版（强制且只显示一次）',
  '| 运行信息 | 当前内容 |',
  '### 全局五部进度',
  '### 本回合理解',
  fullHeader,
  '### 当前焦点',
  '### 控制口令',
), '首次恢复项目、阶段、队列和断点。');
test('第二条回复起必须显示精简版', all(panel,
  '## 后续精简面板（第二条回复起强制）',
  compactHeader,
  '控制：暂停一下 · 查看队列表 · 关闭开发助手',
  '不得改名或恢复成长面板',
), '需求页面保持简洁。');
test('全局入口同时写死首次完整版和后续精简版', all(bootstrap,
  '首次启动完整版',
  '从第二条用户消息起',
  '每条用户可见回复必须显示精简面板',
), '前端入口和后台规则一致。');
test('显示层和运行层边界同时写死', all(panel,
  '## 显示层与运行层边界（写死）',
  '显示层相当于网站前端',
  '运行层相当于网站后端',
  '两层必须同时生效',
) && all(skill,
  '固定模板是用户可见的显示层',
  '项目识别、Rxxx 队列、任务锁、断点恢复、测试和 Git 证据是运行层',
  '两层任一缺失都视为开发助手未正确启动',
) && all(bootstrap,
  '面板模板是写死的显示层，等同网站前端',
  '项目识别、Rxxx 队列、任务锁、断点恢复和测试证据是运行层',
), '模板不可消失，后台只填真实状态。');
test('关闭只隐藏展示并保留状态', all(skill,
  '关闭后的普通问答直接回答',
  '保留当前项目阶段、活动队列、任务锁、断点和已获实施授权',
  '不能新建空队列或自动退回第一部',
), '重新开启恢复原状态。');
test('引用和附件中的口令不触发开关', all(skill, '引用、附件或示例里的同名词不触发开关', '图片和附件只提供需求证据'), '截图文字只作资料。');

// 固定骨架和入口闸门
test('五阶段名称和顺序写死', stages.every((stage) => panel.includes(stage))
  && all(skill, '这五部的名称、顺序和阶段管理逻辑属于写死的运行骨架', '不因具体项目、截图、临时需求或智能体判断而改名、合并、删除或重新排序'), '所有项目共用同一骨架。');
test('开发动作前先显示面板再调用工具', all(skill,
  '在进行任何工具调用、子智能体派发、代码修改、测试或外部写入之前',
  '第一行写 `【开发助手｜框架内执行】`',
  '显示四列短表',
  '写明唯一下一步',
), '面板是开发入口闸门。');
test('明确开发命令不重复询问', all(skill,
  '用户一次把明确需求说完整时，视为已经授权',
  '不要重复询问；仍要先显示入口表，再开始动作',
), '清楚命令先入表再执行。');
test('用户没说完时只记录不实施', all(skill,
  '“还有”“继续”“我还没说完”“先记下来”“别开始”',
  '只更新执行表，不修改代码',
), '需求收集不会提前开工。');
test('开发任务必须分段且一次一步', all(skill,
  '## 开发任务强制分段',
  '开始实施前必须先确定总共分几步',
  '一次只执行当前一步',
  '每一步完成后验证',
), '防止一次写完卡死。');

// 排队、滚动和记忆
test('运行中新需求先登记到队尾', all(skill,
  '新增项默认排到队尾，然后继续原锁定任务',
  '最新消息不等于最高优先级',
), '新消息不抢当前任务。');
test('登记新需求后自动恢复原任务', all(panel,
  '登记新需求的回复同时显示当前任务和本回合新增排队项',
  '自动回到原任务断点继续',
  '不要求用户再次说 `继续执行`',
), '追加需求后自动续做。');
test('冲突、调序或暂停才停止原任务', all(panel,
  '只有需求互斥、用户明确调整优先级或用户说 `暂停一下` 时，才停止原任务',
), '正常新增不会中断当前任务。');
test('当前功能纠正更新原编号', all(panel, '当前功能的补充或纠正更新原编号', '不机械新建重复任务'), '纠正不制造重复队列。');
test('完成项只显示一轮并在下一回合顶出', all(panel,
  '当前任务完成并验证后，本回合可显示一次 `✅`',
  '下一开发回合把该完成项移出短表',
  '由队首下一项接替当前任务',
), '短记忆不会越积越长。');
test('精简记忆只保留活动项和断点', all(skill,
  '## 精简需求记忆体',
  '唯一执行记忆是一张短小的“活动需求表”',
  '到下一开发回合时自动从活动表删除',
  '直接按账本活动表和断点继续',
), '长对话压缩后仍能续做。');
test('取消需求不能伪装完成', all(skill, '只能标记 `已取消/已结束`', '不得伪装成 `已完成`'), '完成状态必须有证据。');

// 阶段、边界和专业开发
test('项目阶段和单项任务相互独立', all(skill,
  '一级目录只记录整个项目的推进位置',
  '不因加入、完成或取消 Rxxx 而改变项目的当前阶段',
) && stageModel.includes('单个任务有自己的队列、状态和局部步骤'), '完成一个功能不会乱跳大阶段。');
test('已有项目先按证据识别阶段', all(skill,
  '不能为了填表猜第1部',
  '首次允许读取时，先读项目规则和既有执行表',
  '关键调用链',
), '未知阶段写待识别。');
test('第一阶段允许真实功能创作', all(skill, '阶段一是自由创作和真实功能试制', '允许边想边做'), '构想阶段不是只讨论。');
test('第二阶段形成正规军第一版', all(skill, '泥腿子版本盘点、拆分、迁移和补齐为正规军第一版', '必要的新接口可以在第二部直接添加'), '边界确定后严格开发。');
test('复杂逻辑先形成线路图', all(skill, '复杂逻辑的线路图澄清', '先自行整理大白话线路图和边界', '只有会改变产品结果的关键决定缺失时'), '不懂代码也能核对逻辑。');
test('单窗口单任务锁单修改通道', all(skill,
  '一个聊天窗口和一个开发助手',
  '一个工具调用通道和一个代码修改执行者',
  '不得同时多开执行智能体',
), '反代理受限时不多开碰运气。');
test('429 和卡死有限重试后熔断', all(skill,
  '同类失败最多有限重试一次',
  '随后熔断',
  '不得无限等待',
  '同一种失败只允许换一种等价的安全方式重试一次',
), '失败不会陷入死循环。');

// 真实性、测试和发布
test('禁止假数据假接口假测试', all(skill,
  '禁止用假数值、随机统计、写死结果、Mock 接口、占位按钮、固定成功响应',
  '真实页面、真实接口、真实业务逻辑和真实测试数据源',
  '不得伪造正式成功',
), '成品必须真实可用。');
test('暂停立即停止并保存断点', all(skill,
  '当用户对正在执行的任务说“暂停一下”时',
  '立即停止继续开发、测试、修复、重试、Git、发布、部署和新的工具调用',
  '恢复前先读取断点',
), '暂停不关闭面板。');
test('第五阶段先测试再部署验收', skill.includes('先测试、通过后部署、部署后验收')
  && stageModel.includes('关键测试、CI、版本合同或安装验证失败时立即阻止部署'), '红灯不能发布。');
test('发布失败保持阻塞', all(skill,
  '测试、CI、签名、版本合同或制品验证失败时停止发布并修复',
  '代码写完不等于需求 "√ 已完成"',
), '不伪造发布成功。');
test('全功能回归覆盖入口、排队、暂停和发布', all(skill,
  '## 全功能测试与发布闸门',
  '首次开发要求先展示入口表',
  '开发中新增要求进入队尾',
  '`暂停一下` 立即保存断点并停止',
  '测试失败、CI失败、版本不一致或真实安装失败会阻止正式发布',
), '正式版本前覆盖完整行为。');

// 安装与可发现性
test('技能允许自动发现', metadata.includes('allow_implicit_invocation: true'), '安装后可自动调用。');
test('默认提示包含两段式面板和排队恢复', all(metadata,
  '首次启动完整版',
  '从第二条用户消息起持续显示精简面板',
  '登记后自动恢复原任务断点',
  '下一开发回合移出并由队首下一项接替',
), 'UI 默认提示与技能合同一致。');
test('全局安装器只管理标记区块且支持移除', all(installer,
  '[switch]$Remove',
  'SMARTBUILD-GLOBAL-BOOTSTRAP:START',
  'SMARTBUILD-GLOBAL-BOOTSTRAP:END',
  'Move-Item',
), '不覆盖用户其它全局规则。');
test('本地安装同时复制技能脚本并安装全局入口', all(localInstaller,
  "@('agents', 'references', 'scripts')",
  'install-global-bootstrap.ps1',
  '& $bootstrapInstaller',
), '本机安装后直接可用。');
test('账本在隐藏目录不可写时只使用一个根目录账本', all(skill, '项目根目录 `auto-dev-ledger.md`', '禁止两处同时维护')
  && ledger.includes('只保留一个有效账本'), '断点持久化不制造双账本。');
test('查询旧需求不自动恢复', decision.includes('汇报未完成项和断点，不自动恢复')
  && skill.includes('回来提及旧需求只读对应账本汇报，不自动开工'), '用户明确继续后才恢复。');

const failures = tests.filter(({ check }) => !check);
for (const { name, check, detail } of tests) console.log(`${check ? 'PASS' : 'FAIL'} ${name}：${detail}`);
if (failures.length) {
  console.error(`\n智构开发系统全功能规则测试失败：${failures.length}/${tests.length}`);
  process.exit(1);
}
console.log(`\n智构开发系统全功能规则测试通过：${tests.length}/${tests.length}`);
