# Claude Code 指南

## 项目

**chrome-automation**：GLM Coding 抢购自动化脚本，用于准时抢购 Pro 年度订阅

## 项目结构

- **docs/** - 文档
- **notes/** - 笔记和草稿
- **\*.js** - Puppeteer 自动化脚本
- **\*.png** - 运行截图记录

## 规则

- 文档使用中文，文件名使用英文
- 不自动提交，除非用户明确要求
- 敏感信息存 `.env.local`，不入 Git
- 代码必须写注释，注释用中文写
- 抢购脚本目标时间统一使用北京时间（UTC+8）
- **每次抢购必须记录完整流程数据**，用于后续分析优化：
  - 记录每个 Step 的耗时和结果（stepStats）
  - 记录验证环节的成功/失败（verificationAttempts）
  - 记录每次抢购的完整 Flow（包含 steps、errors、pageState）
  - 生成报告包含 Flow 分析和优化建议（flowAnalysis）
