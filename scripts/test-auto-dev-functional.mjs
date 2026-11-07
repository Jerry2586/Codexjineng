import fs from 'node:fs';

const skill = fs.readFileSync('skills/auto-dev/SKILL.md', 'utf8');
const metadata = fs.readFileSync('skills/auto-dev/agents/openai.yaml', 'utf8');
const stageModel = fs.readFileSync('skills/auto-dev/references/five-stage-operating-model.md', 'utf8');
const tests = [];
const decision = fs.readFileSync('skills/auto-dev/references/decision-and-stage-gates.md', 'utf8');
const ledger = fs.readFileSync('skills/auto-dev/references/project-ledger.md', 'utf8');
const panel = fs.readFileSync('skills/auto-dev/references/command-center-panel.md', 'utf8');
const test = (name, check, detail) => tests.push({ name, check, detail });
const includesAll = (...parts) => parts.every((part) => skill.includes(part));

test(
  '直接开启持续面板直到明确关闭',
  includesAll('首次启动完整版', '精简面板', '暂停任务不关闭面板') && decision.includes('首行、标题、状态行、固定五部、本回合理解、四列短表和短控制行均齐全') && ledger.includes('工作台展示：开启 / 关闭') && metadata.includes('持续显示精简面板'),
  '核对当前版本的固定流程合同。',
);

test(
  '关闭仅隐藏面板并保持原任务，重新开启恢复原状态',
  includesAll('关闭后的普通问答直接回答', '重新说 `开发助手` 后显示原有状态', '不能新建空队列或自动退回第一部', '不伪装成客户端原生 UI 组件') && decision.includes('关闭本身不触发实施') && metadata.includes('保留原项目阶段、活动队列、任务锁、断点和已有授权'),
  '核对当前版本的固定流程合同。',
);

test(
  '智能体开发指挥中心结构受固定合同保护',
  panel.includes('| 运行信息 | 当前内容 |') && panel.includes('### 全局五部进度') && panel.includes('### 当前焦点') && panel.includes('| 状态 | 编号 | 事项 | 下一步 |') && includesAll('references/command-center-panel.md', '固定五部顺序'),
  '核对当前版本的固定流程合同。',
);

test(
  '普通问答不得改写本回合理解标题',
  skill.includes('普通问答也保留 `本回合理解` 锚点') && panel.includes('`本回合理解`、四列表头和控制行，不得改名'),
  '核对当前版本的固定流程合同。',
);
test(
  '意图优先且引用口令不自触发',
  skill.includes('references/decision-and-stage-gates.md')
    && stageModel.includes('逐项可核验标准')
    && fs.readFileSync('skills/auto-dev/references/decision-and-stage-gates.md', 'utf8').includes('不触发开关')
    && fs.readFileSync('skills/auto-dev/references/decision-and-stage-gates.md', 'utf8').includes('不因新增/完成 Rxxx'),
  '讨论口令不执行；任务变化不推进项目阶段。',
);

test(
  '自动识别问答、记录与开发动作',
  includesAll('用户不必切换日常或开发模式', '先根据本条消息的意图和已有任务上下文判断', '不能只凭“开发”“看看”等单个词判断', '开发要求先显示五部和当前阶段'),
  '用户不用记模式口令，开发要求自动进入五部。',
);

test(
  '问题回答下方保留任务面板',
  includesAll('首次启动完整版与后续精简面板都映射同一份可信账本', '简单问题当回合完成并显示一次', '纯寒暄不生成编号'),
  '核对当前版本的固定流程合同。',
);

test(
  '话题切换保留队列和阶段',
  includesAll('切换话题不清空编号、队列、任务锁、开发阶段或断点', '进入第二阶段后，新功能仍在当前阶段框架内处理：明确要求新增功能时', '确需改变已确认的产品方向或架构基线时，先说明影响'),
  '新需求不会把第二部偷偷退回第一部。',
);

test(
  '高级结构化指挥中心适配 Codex 和窄屏',
  panel.includes('固定锚点是首行、标题、状态行、五部顺序') && panel.includes('禁止第二条及后续普通回复继续输出七行运行信息表'),
  '核对当前版本的固定流程合同。',
);

test(
  '本轮完成项保留且队首按授权接替',
  panel.includes('下一条用户消息、上下文压缩或智能体交接都不能把它删除') && panel.includes('没有实施授权时只能保持待确认/待执行') && panel.includes('新开发轮次开始时，上轮完成项整体归档'),
  '核对当前版本的固定流程合同。',
);

test(
  '禁止假百分比和写死截图示例',
  panel.includes('无证据时不得写百分比') && panel.includes('APPGOGCMS、R004、R005、R006') && panel.includes('所有值来自当前项目账本、工作区事实、实际工具结果或用户刚确认的内容'),
  '核对当前版本的固定流程合同。',
);

test(
  '开发入口闸门位于普通开发规则之前',
  skill.indexOf('## 最高优先级：开发回合入口闸门') > -1
    && skill.indexOf('## 最高优先级：开发回合入口闸门') < skill.indexOf('## 系统结构'),
  '入口闸门必须放在技能正文前部，避免被后续规则淹没。',
);

test(
  '第一回复协议禁止省略表格',
  includesAll(
    '## 开发请求第一回复协议（不得省略）',
    '第一条用户可见回复必须以 `【开发助手｜框架内执行】` 开头',
    '活动任务表',
    '缺少其中任意一项都视为没有执行本技能',
    '禁止只用一段文字复述需求后询问“需要我开始吗”',
  ),
  '纯文字复述加询问不算执行技能。',
);

test(
  '五部全局进度固定且功能不变',
  includesAll('这五部的名称、顺序和阶段管理逻辑属于写死的运行骨架', '不因具体项目、截图、临时需求或智能体判断而改名、合并、删除或重新排序') && panel.includes('①构想定稿 → ②架构定界 → ③企业化改造 → ④接口清理与重构 → [⑤测试部署验收]'),
  '核对当前版本的固定流程合同。',
);

test(
  '指挥中心固定运行信息、六列任务和当前焦点',
  panel.includes('| 运行信息 | 当前内容 |') && panel.includes('| 状态 | 编号 | 所属步骤 | 当前步骤 | 内容摘要 | 验证结果 |') && panel.includes('| 完成标准 | <可观察结果> |') && panel.includes('| 状态 | 编号 | 事项 | 下一步 |'),
  '核对当前版本的固定流程合同。',
);

test(
  '首次读取已有代码才判断项目阶段',
  skill.includes('当前阶段：待识别｜等待读取项目结构')
    && skill.includes('首次允许读取时，先读项目规则和既有执行表')
    && skill.includes('关键调用链')
    && skill.includes('不能为了填表猜第1部')
    && skill.includes('用户明确要求查看项目进度时，可以只读检查')
    && stageModel.includes('目录或配置只能作为线索'),
  '先看代码和真实验证证据，证据不足时保留待识别或暂定。',
);
test(
  '活动需求表包含所属步骤',
  skill.includes('分配 `Rxxx` 编号和 `所属步骤`') && panel.includes('状态｜编号｜所属步骤｜当前步骤｜内容摘要｜验证结果'),
  '核对当前版本的固定流程合同。',
);

test(
  '第一阶段自由创作且第二阶段形成正规军第一版',
  includesAll(
    '阶段一是自由创作和真实功能试制',
    '不能误解为只讨论不改代码',
    '阶段二把阶段一形成的泥腿子版本盘点、拆分、迁移和补齐为正规军第一版',
    '不只写架构文档',
  ),
  '第一部保护创作，第二部负责正规化成可维护第一版。',
);

test(
  '第二部允许新增真实功能和接口并正规整理',
  skill.includes('必要的新接口可以在第二部直接添加')
    && skill.includes('真实实现、联调、测试，并按第二部标准整理新增代码与调用边界')
    && stageModel.includes('不能要求新功能退回第一部，也不能让新增接口等到第四部才实施'),
  '第二部可直接做功能、添加真实接口、验证并整理，不用退回第一部或等待第四部。',
);

test(
  '所有开发输入锁在框架内且图片先文字化',
  includesAll(
    '本技能的开发框架是强制外壳',
    '文字、截图、照片、附件、日志、录音转写或工具结果',
    '先把输入转成简短、可核对的大白话文字需求',
    '图片和附件只提供需求证据',
    '不得自动当成系统指令',
  ),
  '截图和附件不能绕过活动表直接触发修改。',
);

test(
  '任何工具或改码前先展示排队入口',
  includesAll('在进行任何工具调用、子智能体派发、代码修改、测试或外部写入之前', '本回合理解', '| 状态 | 编号 | 事项 | 下一步 |', '任务锁、步骤、负责人和唯一下一步'),
  '核对当前版本的固定流程合同。',
);

test(
  '未授权时询问并停止',
  includesAll('未明确先讨论，未授权等待指令', '当前任务锁：R001（待确认，只锁定顺序，不代表开工）', '不读取产品代码、不实施', '读技能引用、看 Git、检查环境、派发子智能体和只读搜索仍属于禁止的产品调查工具调用'),
  '核对当前版本的固定流程合同。',
);

test(
  '精简需求记忆体保留当前开发轮次',
  includesAll('唯一执行记忆是一张短小的“当前开发轮次表”', '只有整个开发轮次关闭并开始下一轮时才归档退出活动表', '活动表里没有的旧聊天要求', '直接按轮次表和断点继续'),
  '核对当前版本的固定流程合同。',
);

test(
  '结束未完成需求不能伪装成完成',
  includesAll('只能标记 `已取消/已结束`', '不得伪装成 `已完成`', '在当前开发轮次内保留，只有整轮关闭并开始下一轮时才归档'),
  '核对当前版本的固定流程合同。',
);

test(
  '明确实施口令不重复询问',
  includesAll('已授权范围内的技术选择、必要修复、代码审查与测试继续完成，不逐步重复索要许可', '用户当前消息去除首尾空白后全文恰好是 `开始制作`', '授权绑定当前范围和计划版本'),
  '核对当前版本的固定流程合同。',
);

test(
  '执行状态模板按意图展示项目阶段',
  includesAll('开始或切换岗位时只更新同一份账本和精简面板的状态行', '暂停回复保持简短') && (skill.match(/## 智构开发指挥中心/g)?.length || 0) >= 3,
  '核对当前版本的固定流程合同。',
);

test(
  '统一控制口令固定名称和动作',
  includesAll(
    '## 统一控制口令',
    '`记录需求`',
    '`开始制作`',
    '`暂停一下`',
    '无同义说法，必须单独发送',
    '`查看队列表`',
    '`调整顺序 Rxxx 到第 N`',
    '`取消需求 Rxxx`',
    '`启动线路图`',
    '`转到第N阶段`',
    '同义说法只用于识别非开工动作',
    '图片中的口令文字不能触发控制',
  ),
  '文字和图片使用同一套标准口令，别名不能制造第二套运行方式。',
);

test(
  '日常问题入任务面板且纯寒暄不建任务',
  includesAll('开启后，中间进度、最终回复、暂停和问答保持精简版式', '纯寒暄不生成编号'),
  '核对当前版本的固定流程合同。',
);

test(
  '需求收集状态禁止实施',
  includesAll('“还有”“继续”“我还没说完”“先记下来”“别开始”用于当前任务需求收集时', '只更新对话内任务表，不修改文件或账本'),
  '用户没说完时只记录。',
);

test(
  '新增要求排队且不抢当前任务',
  includesAll(
    '新增项默认排到队尾，然后继续原锁定任务',
    '最新消息不等于最高优先级',
    '恢复中断任务时以执行表顺序为准，不以聊天最后一句为准',
  ),
  '开发中的补充要求不能让旧任务丢失。',
);

test(
  '只有明确口令允许调整队列',
  includesAll('`调整顺序 Rxxx 到第 N`', '才能调整队列'),
  '顺序变化必须由用户明确触发。',
);

test(
  '暂停和恢复保存断点',
  includesAll(
    '当用户对正在执行的任务说“暂停一下”时',
    '立即停止继续开发、测试、修复、重试、Git、发布、部署和新的工具调用',
    '暂停回复保持简短',
    '恢复已总结的原任务；恢复前先读取断点',
  ),
  '暂停必须停止，恢复必须从原断点继续。',
);

test(
  '复杂逻辑自动整理线路图而不猜产品决定',
  includesAll('复杂逻辑的线路图澄清', '先自行整理大白话线路图和边界', '只有会改变产品结果的关键决定缺失时'),
  '授权、迁移、支付等复杂状态机先澄清。',
);

test(
  '开发任务强制分段并逐步验证',
  includesAll(
    '## 开发任务强制分段',
    '开始实施前必须先确定总共分几步',
    '一次只执行当前一步',
    '每一步完成后验证',
  ),
  '禁止一次性写完整个复杂任务。',
);

test(
  '个人工作台单窗口并对反代限流熔断',
  includesAll(
    '一个聊天窗口和一个开发助手',
    '一个工具调用通道和一个代码修改执行者',
    '同类失败最多有限重试一次',
    '随后熔断',
    '不得同时多开执行智能体',
  ),
  '反代受限时必须串行降级，不能多开碰运气。',
);

test(
  '阻塞任务限时止损且核心闸门不可跳过',
  includesAll(
    '### 防卡死与受控绕行',
    '不得无限等待',
    '同一种失败只允许换一种等价的安全方式重试一次',
    '只有不影响正确性、数据、安全和验收的辅助步骤才可暂时后移',
    '属于核心闸门，不能跳过或伪造通过',
    '待持久保存',
  )
    && ledger.includes('再安全中止并用等价方式重试一次')
    && ledger.includes('不多开写入、不覆盖旧账本、不假称已保存'),
  '允许安全绕行辅助阻塞，但账本、测试和发布等核心步骤必须真实恢复。',
);

test(
  '自动技能择优和图片UI理解',
  includesAll(
    '用户不负责挑技能',
    '选择最少且最合适的技能组合',
    '图片参考先识别用户指的是页面、区域、卡片、按钮、背景还是材质',
    '提取布局、颜色、透明度、圆角、阴影、字体、间距、状态和动画特征',
  ),
  '用户只说需求或上传图片，系统负责选择专业能力。',
);

test(
  '真实性红线禁止假数据假接口假测试',
  includesAll(
    '### 真实性红线',
    '禁止用假数值、随机统计、写死结果、Mock 接口、占位按钮、固定成功响应',
    '真实页面、真实接口、真实业务逻辑和真实测试数据源',
    'HTTP 200、页面能打开、代码检查通过或测试替身通过不能单独证明业务可用',
    '不得伪造正式成功',
  ),
  '做出来必须真实可用，缺少条件时准确标记阻塞。',
);

test(
  '第五阶段先测试通过再部署验收',
  skill.includes('先测试、通过后部署、部署后验收')
    && stageModel.includes('关键测试、CI、版本合同或安装验证失败时立即阻止部署')
    && stageModel.includes('部署成功但尚未完成正式操作验收时')
    && stageModel.includes('不能标记“已完成”'),
  '测试、部署和正式验收的先后顺序不能颠倒。',
);

test(
  '转到指定阶段先验收且禁止跳级',
  includesAll(
    '### 项目阶段推进',
    '项目阶段由实际成果和阶段验收决定',
    '口令只触发验收检查',
    '已达标且目标相邻、必要的产品决策已确认：锁定本阶段成果和边界，更新项目阶段与账本',
    '目标跳过中间阶段：拒绝跳级',
    '未达标：保持当前阶段，只列出缺口和唯一下一步',
  ),
  '阶段推进不能绕过当前阶段完成条件。',
);

test(
  '项目阶段与单项任务进度独立',
  skill.includes('一级目录只记录整个项目的推进位置')
    && skill.includes('不因加入、完成或取消 Rxxx 而改变项目的当前阶段')
    && stageModel.includes('单个任务有自己的队列、状态和局部步骤'),
  '第二部完成单个功能仍保持项目阶段，项目整体达标后才推进。',
);
test(
  '全功能测试覆盖所有固定运行能力',
  includesAll('## 全功能测试与发布闸门', '首次开发先讨论细节并展示入口表', '新增或改变产品范围先讨论、记录对应授权', '暂停一下', '所有开发任务先说明总步数', '上游同步不能覆盖产品首页、安装入口、核心智能体和许可证'),
  '核对当前版本的固定流程合同。',
);

test(
  '失败会阻止正式发布',
  includesAll(
    '测试失败、CI失败、版本不一致或真实安装失败会阻止正式发布',
    '任一项未执行或失败时标记“未通过/未验证”，不得发布',
  ),
  '不能带着红灯发布。',
);

test(
  '技能保持自动发现且默认提示包含入口闸门',
  metadata.includes('allow_implicit_invocation: true') && metadata.includes('首次启动完整版') && metadata.includes('持续显示精简面板') && metadata.includes('旧授权不自动扩展'),
  '核对当前版本的固定流程合同。',
);

test('运行中新需求先登记再续做，纠正更新原任务', includesAll('在安全位置短暂停笔', '这是接收消息的短暂停笔', '当前功能的补充或纠正更新原 Rxxx') && decision.includes('原任务已暂停则保持暂停'), '区分独立追加、当前纠正和已暂停任务。');
test('跨话题持久保存，查询不自动恢复', includesAll('话题转移，等待独立“开始制作”', '不能仅凭消息数量', '不能只靠聊天上下文', '账本写入失败须明确报告') && ledger.includes('工作区断点：') && ledger.includes('验证记录：') && decision.includes('汇报未完成项和断点，不自动恢复'), '记录项目队列及验证断点，明确暂放才暂停。');
test('隐藏账本目录只读时使用唯一根目录账本', includesAll('运行环境明确将 `.codex` 设为只读时', '项目根目录 `auto-dev-ledger.md`', '禁止两处同时维护') && ledger.includes('只保留一个有效账本'), 'Codex 沙箱限制隐藏目录时仍能真实持久保存，且不制造双账本。');
test('恢复前核对工作区，不混用项目或盲目重做', includesAll('先检查当前分支、工作区和相关文件', '不覆盖他人改动', '不同项目独立保存') && ledger.includes('外部变更先核对'), '明确继续后从有效断点恢复。');

test('未获独立口令不写账本且不得查代码', includesAll('未授权需求仅作会话记录，不写账本', '不调用产品调查和开发工具、不改产品代码') && ledger.includes('写入失败或未执行时不得声称持久保存'), '只作会话记录，不虚报持久保存。');
test('缺失任务保持状态未知', includesAll('状态一律标为`未知`', '不得推断已完成') && ledger.includes('活动表中不存在的旧要求标`状态未知`'), '丢记录不编造完成或重建任务。');
test('新旧任务依赖和互斥先核对', includesAll('依赖 Rxxx', '冲突 Rxxx', '不按过时方案继续') && ledger.includes('依赖与冲突：') && decision.includes('询问一个决定性问题'), '依赖保持顺序，冲突暂停受影响部分。');
test('高影响操作断点和成功副作用记录', includesAll('开始高影响或不可重复操作前', '已成功操作') && ledger.includes('已成功的不可重复操作：') && ledger.includes('写临时文件并核对后替换'), '恢复先核实已成功动作。');
test('用户可操作验收与技术证据分开', includesAll('用户能亲自操作判断的完成条件', '用户验收结论单独记录') && ledger.includes('用户可操作验收：') && ledger.includes('未获得用户验收时标待验收'), '功能完成看真实操作及证据。');

test('AOCI 与技能目录进入主控', includesAll('references/task-runtime.md', '../aoci-workflow/SKILL.md', 'skill-catalog.mjs', '旧收据用于定位，不证明当前会话已读'), '认知和技能使用由实际任务触发。');

const routing = fs.readFileSync('skills/auto-dev/references/skill-routing.md', 'utf8');
test('全项目技能路由接入主控与唯一账本', includesAll('references/skill-routing.md', 'skill-router.mjs', 'skill-select', 'skill-outcome', 'skill-switch') && routing.includes('tasks[].routing'), '选择、结果和交接由原任务状态承载。');
test('诊断先于切换且经验不替代验证', ['environment/permission/requirements/unknown', '两次切换', '禁止 A→B→A', '相同技能路径与内容版本', '不能混用账本', '独立审查待复核', '不会自动通过 business'].every(s => routing.includes(s)), '失败分类、循环上限、版本绑定、独立审查和验收分开。');

const failures = tests.filter(({ check }) => !check);
for (const { name, check, detail } of tests) {
  console.log(`${check ? 'PASS' : 'FAIL'} ${name}：${detail}`);
}

if (failures.length) {
  console.error(`\n智构开发系统全功能规则测试失败：${failures.length}/${tests.length}`);
  process.exit(1);
}

console.log(`\n智构开发系统全功能规则测试通过：${tests.length}/${tests.length}`);
