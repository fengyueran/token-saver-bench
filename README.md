# Token Saver Bench

面向 AI 编程场景，对比 Caveman、Ponytail、RTK、Headroom、CodeGraph 与原版 Codex 的 token 消耗和任务完成质量。

## 当前状态

五工具接入试跑和六题基线预检已完成，108 次正式对照已启动。尚无可发布的节省百分比或工具排名。首轮预检前四题通过，后两题被账号额度限制中断；连接恢复后，两道功能题在单独记录中重跑通过，原始失败保留。

- 用户指定模型：`gpt-6-sol`；推理强度：`medium`。
- 主模型固定；不得用模型回退替代失败调用。服务端若不返回具体模型快照，记录为未知，不能声称固定了不可变权重版本。
- 第一轮六组：原版、Caveman Skill、Ponytail Skill、RTK、Headroom、CodeGraph。每组只启用一个干预。
- 正式计划六个任务 × 三次重复 × 六组 = 108 次。启动时冻结源码、配置和验收器指纹。
- 当前以订阅登录记录 token；美元实际费用未知，不用工具自报压缩率或套餐额度推算账单。

### 已完成的接入验证

- 固定 Koa 提交 `824c1cf8de9a91a2941973b25dc8a3d3029b9e4f`，第一题是人为移除 `Application.use` 参数校验的回归修复。
- 原版和五工具均完成过这道题并通过外部契约验收；这不是六任务完成率。
- Caveman、Ponytail 使用固定提交的原版指令，强制激活 full 模式；不代表完整插件生命周期，注入成功也不等于每条指令都被遵守。
- RTK 0.49.0 使用原生 PreToolUse hook，记录实际重写次数。首轮未获 hook 信任而未触发；重试只对已检查的本次 hook 放行，保留 Codex 命令审批和文件沙箱。
- CodeGraph 1.6.0 使用每次独立索引和 MCP；JSONL 已记录成功的 `codegraph_explore` 调用。
- Headroom 0.39.1 使用本地 cache 模式代理，关闭遥测和学习，不运行会修改全局配置的 `wrap`，不附带 Serena。订阅认证正常转发，日志记录了实际转换。
- 初轮发现本地端口权限、缺少预构建文件和 lint 缓存权限干扰。当前运行器已允许测试联网、要求预构建、把 lint 缓存放进任务目录。早期样本保留，并标注环境版本，全部不进入正式排名。
- 外部契约检查只验证明确任务要求；另有独立副本运行未经模型改写的上游测试。原始失败保留，需排除宿主机网络干扰，不能把异常 HTTP 响应直接归因于工具。

## 运行

需要 Node.js 22+ 和已登录的全局 Codex CLI，无项目内 npm 依赖。本轮实验固定 CLI `0.158.0`，启动前检查版本，避免不同版本混入同一轮结果。

```bash
npm install -g @openai/codex@0.158.0
codex --version
```

已经安装此版本的用户无需重复安装。工具版本固定是本轮复测要求，日常使用不要求项目内安装 Codex。

```bash
npm test
npm run plan
npm run smoke
npm run pilot -- baseline
npm run pilot -- caveman
npm run pilot -- ponytail
npm run pilot -- rtk
npm run pilot -- codegraph
npm run pilot -- headroom
npm run verify:pilots
npm run audit
npm run setup
npm run campaign -- preflight
npm run campaign -- full
npm run report -- <campaign-id>
```

`test` 和 `plan` 不调用模型。`smoke` **会真实调用一次模型，消耗额度**，只检查连接与 JSONL 用量记录；它不是省 token 实测。运行记录位于被 Git 忽略的 `runs/`。

`pilot` 每次调用模型，限时 180 秒，只执行第一道接入题。`verify:pilots` 和 `audit` 不调用模型；后者输出 `runs/pilot-audit.json`，逐条保留激活状态、质量、缓存 token 与失败记录。试跑曾并发执行，不比较其耗时。

工具缓存在 `.cache/tools/` 和 `.cache/runtime/`。`setup` 需要 Git、npm、Rust/Cargo 和 uv；安装工具到本项目缓存，不修改全局 Agent 配置。此安装器尚未在空白机器上验收。`config/sources-lock.json` 记录检查用源码提交和实际运行版本；Headroom、CodeGraph 的发布包不等同于检查用源码 HEAD。依赖快照位于 `config/`，正式公开复测前需验证干净安装。

正式批次最多并发三个独立模型进程，测试副本、索引和代理均独立；不发布耗时排名。每次任务限定 180 秒，失败、超时和未触发全部留档。用 `campaign -- resume <campaign-id>` 继续时，已记录结果不会重跑，配置和执行源码变动则拒绝混入旧批次。中断且没有 summary 的半成品不会被覆盖。

遇到供应商明确返回额度或频率限制时，停止派发新任务，在 `stopped.json` 留下原因；已经开始的任务完成收尾。不会自动购买额度、使用额度重置券或切换模型。账号限制与自动验收失败分开统计，缺失 token 保留未知。

## 任务与质量判定

| 类别   | 任务           | 验收                                                    |
| ------ | -------------- | ------------------------------------------------------- |
| 读代码 | 请求处理流程   | 文件、符号、回调分支、状态隔离、async storage；另审解释 |
| 读代码 | 代理设置影响   | 协议、主机、IP 截断方向与给定实例；另审安全解释         |
| 修回归 | 中间件参数校验 | 外部边界用例 + 原始上游测试                             |
| 修回归 | 请求状态泄漏   | 外部独立上下文检查 + 原始上游测试                       |
| 加功能 | 查询字段筛选   | 复制语义、重复值、特殊键、边界校验 + 上游测试           |
| 加功能 | 响应头导出     | 快照隔离、大小写排除、旧接口兼容 + 上游测试             |

两道回归是人为植入，两道功能是为评测设计的需求；不能称为六个真实生产故障。所有题使用同一个小型 JavaScript 框架，因此结论不能外推到大型仓库、多语言或长期 Agent 会话。探索题自动验收只核对结构化事实，解释须人工复核。

环境版本 5 为所有组加载同一个测试专用适配器 `.bench/loopback.cjs`：Supertest 连接地址跟随服务器实际监听的 IPv4/IPv6 类型。宿主机上未修改的上游测试也曾收到无关 HTTP 响应，适配后原始 461 项连续两次通过。适配器不修改应用源码和测试断言；独立验证也使用相同适配，并有双协议及错误响应仍失败的测试。旧环境失败仍留档，不用重跑覆盖。

正式修复和功能验收在独立副本中运行未经 Agent 改写的原始测试，避免“改测试变绿”。报告并列质量通过率和 token 变化；有用量的失败样本仍参与 token 汇总，未知用量不会算零。每题三次仅用于初步观察波动，不宣称统计显著或质量等效。

## 隔离与计量

连接检查使用系统临时目录、新会话、只读沙箱，关闭用户配置、规则文件和项目说明读取。尚须在工具接入时审计全局 Skill/插件发现和工具实际激活，不能仅凭 CLI 参数宣称完成隔离。

正式实验每次使用同一提交的独立副本；初始化索引时间另记。每个任务按重复轮次轮换六组的运行顺序，保存缓存计数；顺序交错不能保证缓存相同。所有组保持相同环境、任务、超时和验收器，记录失败与超时，不能只挑通过或省得最多的样本。

Codex 的 `cached_input_tokens` 已包含在 `input_tokens` 中，总 token 为 input + output，不再加一次 cache。没有暴露的 reasoning token 保留未知，不用输出字符数代替。美元费用仅可从有效的供应商计费数据或明确标记的价格估算取得；当前 `actualCostUsd` 为 null。

## 后续实施顺序

1. 跑通 `gpt-6-sol` 连接和 token 记录。
2. 固定五个工具的具体提交、接入方式及隔离配置；验证工具确实触发。
3. 选择真实仓库并冻结六个任务、起始代码、验收器；验收器放在 Agent 工作目录外。
4. 先完成同任务基线和单工具试跑，检查计量、环境污染与质量判定，再扩样。
5. 输出每任务分布、完成率、失败原因、token 分项和有依据的费用字段。脱敏后导出给视频项目。

## 方法参考

- [JetBrains Caveman 配对评测](https://blog.jetbrains.com/ai/2026/07/speak-to-ai-agents-like-cavemen-tosave-tokens/)
- [JetBrains RTK 计量与激活审计](https://blog.jetbrains.com/ai/2026/07/rtk-claude-code-token-savings/)
- [JetBrains Ponytail 重复试验](https://blog.jetbrains.com/ai/2026/07/ponytail-skill-claude-tested/)

这是独立复测，以上作者结论不作为本项目结果。原始日志可能含本地路径、任务内容与模型回答；公开前检查脱敏。未创建远程仓库、未发布或推送。
