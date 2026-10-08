# Token Saver Bench

本项目为抖音视频验证：在日常开发任务中，安装省 Token 工具是否真的值得。结果同时考察模型用量、任务质量和耗时；没有供应商计费明细时，不把 Token 换算成美元费用。

## 当前实验

第一批只比较 **Codex CLI `gpt-6-sol` / `medium` 的原生组与 Ponytail full 指令组**。任务来自两个固定版本的开源项目：[Memos 批量归档](task-cards/memos-bulk-archive.md)和[HTTPie 下载完整性](task-cards/httpie-download-integrity.md)。每题四对、两组交错运行，共 16 次新模型调用。固定 Prompt、验收器、调用顺序、停止条件和计量口径见[日常开发场景运行协议](docs/real-development-protocol.md)。

目前只完成各组一次试跑、独立验收校准和离线运行预检；**16 次正式批次尚未启动，没有可发布的节省率或工具排名**。试跑不计入正式样本。Memos 还需要浏览器质量复核。

Cursor 将作为**编辑器 Agent＋用户指定的 Claude 模型**另做同环境对照；先固定编辑器内的工具激活方式和正式运行顺序。Cursor 与 Codex CLI 的原始 Token 数分别报告，不跨模型、编辑器或任务相加。

## 运行

需要 Node.js 22+、Codex CLI、pnpm，以及本地已备好的固定项目副本和依赖。所有真实模型调用会消耗账号额度。运行器不会修改用户全局 Codex、Claude、MCP 或插件配置。

```bash
npm test
npm run real-dev -- plan
npm run real-dev -- preflight
npm run real-dev -- prepare
npm run real-dev -- start
```

`plan`、`preflight`、`prepare` 不调用模型。`start` 按冻结顺序串行执行 16 次真实调用；若中断，使用 `npm run real-dev -- resume <campaign-id>` 只继续尚未开始的位置。原始事件、使用量与独立验收保存在被 Git 忽略的 `runs/`；不得用成功重跑替换失败、超时或未激活的样本。

仓库中先前微任务实验的运行入口和设计文档已移除。它的原始记录继续保留在本地 `runs/` 供追溯，不参与本实验或视频结论。
