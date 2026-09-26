# 智构开发系统 SmartBuild

[![version](https://img.shields.io/badge/version-1.0.1-blue)](./VERSION)
[![Validate SmartBuild](https://github.com/Jerry2586/Codexjineng/actions/workflows/validate-smartbuild.yml/badge.svg)](https://github.com/Jerry2586/Codexjineng/actions/workflows/validate-smartbuild.yml)
[![skills.sh](https://skills.sh/b/Jerry2586/Codexjineng)](https://skills.sh/Jerry2586/Codexjineng)

**你用大白话指挥，AI 按企业级方式规划、开发、测试和交付。**

智构开发系统是 Jerry2586 的个人 AI 开发产品。它把正规开发团队的需求管理、架构、前后端、接口、测试、环境和发布能力，整合成一套适合个人指挥的智能体工作方式。

<!-- smartbuild-install:start -->
## 安装

安装你的完整技能包，并选择需要的技能：

```bash
npx skills@latest add Jerry2586/Codexjineng
```

只安装“智构开发系统”：

```bash
npx skills@latest add Jerry2586/Codexjineng --skill auto-dev -g -y
```
<!-- smartbuild-install:end -->

## 五阶段开发骨架

```text
1. 构想开发确定
→ 2. 架构拆分、边界确定、防止越界
→ 3. 企业正规化改造
→ 4. 删除多余API和废弃接口、优化屎山
→ 5. 接口测试、功能测试、部署使用
```

- 第一阶段是探索模式：允许边想边改、快速验证功能；
- 第二阶段是定型分界线：业务逻辑、架构和边界开始严格管理；
- 第三至第五阶段按照企业标准完成改造、治理、测试和交付。

## 日常运行规则

- 普通问题直接回答，不进入开发队列；
- 开发需求自动总结、编号、排队并锁定当前任务；
- 新消息默认不覆盖正在处理的旧任务；
- 复杂逻辑先询问是否启动线路图；
- 所有开发任务开始前必须说明总共分几步；
- 一次执行一步，每一步完成后测试；
- 支持暂停、恢复、断点续做和专业智能体接力；
- 正式版本统一版本号、Git、CI、成品和按授权部署。

<!-- smartbuild:start -->
## 核心智能体

- **[智构开发系统 v1.0.1](./SMARTBUILD.md)**：技能入口位于 [`skills/auto-dev`](./skills/auto-dev/SKILL.md)。
<!-- smartbuild:end -->

## 吸收上游专业能力

本产品可以持续吸收 [`emilkowalski/skills`](https://github.com/emilkowalski/skills) 的设计、动画、移动端和 Swift 等专业技能更新，但采用严格隔离方式：

```text
检查上游更新
→ 建立独立同步分支
→ 保护智构核心、README和安装入口
→ 合并公共专业技能
→ 自动校验
→ 创建待审查PR
→ 确认后才进入主分支
```

因此，上游可以增强你的产品，但不能覆盖“智构开发系统”的名称、开发骨架、运行规则、安装入口和发布版本。详细规则见 [`UPSTREAM.md`](./UPSTREAM.md)。

## 随包提供的专业技能

除核心 `auto-dev` 外，仓库还包含来自上游并持续同步的 UI、动画、移动网页、Swift 等专业技能。它们保留各自的来源与专业定位，由智构开发系统按实际任务选择使用。

## 版本与更新

- 当前版本：[`v1.0.1`](./CHANGELOG.md)；
- 正式版本通过 GitHub Actions 自动校验；
- 原作者更新每周检查，也可手工启动；
- 本机安装脚本：[`scripts/install-smartbuild.ps1`](./scripts/install-smartbuild.ps1)。

## 来源与许可证

本仓库最初基于 `emilkowalski/skills` 分叉，并遵守原仓库的 MIT License。智构开发系统的产品结构、五阶段开发模式、运行规则、自动排队、任务锁、分段开发、测试交付和上游保护机制由本仓库维护。

第三方技能仍保留其原始内容、来源和许可证信息；吸收上游不代表删除原作者署名。
