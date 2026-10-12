# Token Saver Bench

**五个省 Token 工具，完整开发任务算下来到底省没省？** 本仓库提供实验结果、评测源码、任务与配置说明。

本次观察到 Caveman 的输出缩减和 RTK 的未缓存输入缩减，但还没有足够证据证明稳定的整项任务总 Token 收益。结果来自 Codex CLI、`gpt-5.6-sol`／medium，每工具与同任务 baseline 四次配对；不跨任务排名，不推算费用或订阅额度。

## 从视频过来，先看这里

- **结论与五工具使用建议**：[实验总结](docs/token-saver-experiment-summary.md)。
- **逐次结果**：[Caveman／Ponytail／CodeGraph](docs/decision-study-results.md)（[JSON](docs/decision-study-results.json)／[CSV](docs/decision-study-results.csv)）；[RTK／Headroom](docs/output-study-results.md)（[JSON](docs/output-study-results.json)／[CSV](docs/output-study-results.csv)）。
- **实验怎么做**：[实验协议](docs/benchmark-protocol.md)。
- **版本、接入和重跑限制**：[复现指南](docs/reproduction-guide.md)。配置是本次评测的固定方案，不是可直接覆盖个人全局配置的安装包。

## 下载后能做什么

阅读结果无需安装依赖。基础检查需要 Node.js >= 22；根项目没有第三方 npm 运行依赖。解压或克隆后，在项目根目录执行：

```bash
# 不调用模型，也不需要历史 runs/ 或 .cache/
node --test test/scenario-events.test.js test/output-study.test.js
node bin/decision-study.js candidate
npm run real-dev -- scenario-plan
```

这些命令验证计量与计划逻辑、展示候选任务，**不运行真实 Agent，也不代表完成实验复现**。

完整 `npm test` 还包含依赖固定源码、工具构建产物和本地缓存的集成测试；干净下载缺少这些资源时会失败。先按[复现指南](docs/reproduction-guide.md)了解限制，不要将测试通过等同于真实工具接入成功。

## 重跑限制

目前不能仅靠下载一键重跑：正式运行依赖固定源码与工具构建、私有历史审阅证据，部分接入绑定 macOS。具体缺口见[复现指南](docs/reproduction-guide.md)。当前交付是结果、源码与方法；真实重跑需重新准备和校准，会消耗模型额度。

## 文件怎么读

| 路径 | 内容 |
| --- | --- |
| `docs/` | 实验总结、各批次结果、协议与复现说明 |
| `task-cards/`、`prompts/` | 任务要求与实际模型提示 |
| `src/`、`bin/` | 评测运行器及工具接入代码 |
| `verifiers/`、`test/`、`requirements/` | 独立验收、测试与固定 Python 依赖 |

`.cache/`、`runs/`、`node_modules/`、认证与原始日志不属于观众下载内容。不要直接打包整个本地工作目录；历史源码与结果保留以便追溯，不作为默认快速开始入口。
