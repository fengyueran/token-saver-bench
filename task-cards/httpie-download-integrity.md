# HTTPie 下载完整性：第二道任务候选

状态：**固定起点的 RED、隔离参考实现的 GREEN，以及 Codex CLI baseline / Ponytail 各一次试跑已完成；尚无正式结果**。这是基于开源项目现有下载路径设计的维护任务，不冒充上游 Issue。目标是补一项与 Memos 前端功能开发不同的 CLI、HTTP 协议与文件完整性场景。

## 固定起点

- 仓库：`httpie/cli`，提交 `5b604c37c6c67e18e7c3e9aee6c88a8c22b98345`，本地版本 `3.2.4`。
- 在独立副本和新会话中运行；Python 环境、依赖和本地测试服务器在计时前准备。不得让一组的下载文件、配置或会话影响另一组。
- 与 Memos 题分别报告场景结果。Codex CLI 与 Cursor 编辑器 Agent 使用各自指定模型，在环境内做 baseline 对照，原始 token 不跨环境相加。

## 给 Agent 的候选任务说明

> 修复 HTTPie 下载模式的完整性问题。`--download --continue --output FILE` 遇到服务端对开放式 Range 分段返回多个有效 `206` 响应时，应继续获取剩余字节，最终文件必须与完整响应一致；不能把首段当成完整文件或无限重复请求。服务端忽略 Range 并返回完整 `200` 时，应安全地从头下载。若服务端在请求 `Accept-Encoding: identity` 后仍返回 gzip，普通 `--download` 应写出可读的解码内容且不误报下载中断；续传时不得将解码字节直接拼到已有的部分文件，无法安全续传就清晰失败并保留原文件。保留原有普通下载与损坏响应的错误行为。

## 外置验收

`verifiers/httpie-download-integrity.cjs` 在本地 HTTP 服务器上执行六项端到端检查：

1. gzip 完整响应：输出为解码后的正文，退出成功。
2. 正常单段 `206` 续传：按已有文件大小发送 Range，最终字节正确。
3. 服务端忽略 Range 返回 `200`：从头下载，不能重复前缀。
4. 服务端把开放式 Range 拆为多段 `206`：请求偏移连续递增，最终字节正确，调用次数有上界。
5. 续传收到没有实际字节进展的 `206`：及时失败，已有文件不变，不能无限重试。
6. 已有部分文件遇到 gzip 编码的 `206`：必须拒绝危险拼接，失败时原文件字节不变。

验收器 SHA-256：`fb5f16bdf0ec266ef7bd5e5688d3731ddfe3eef74b064b9f74c05bee45e09546`（下述记录使用的最终版本）。未修改起点 **3 项通过、3 项失败（RED）**：普通单段续传、忽略 Range、无进展失败行为通过；gzip 完整响应误报不完整，多段 `206` 无法完成，gzip 编码续传损坏已有文件。独立的 `.cache/candidate-httpie-reference` 只用于验收器正向校准，修改 `httpie/core.py` 和 `httpie/downloads.py` 后 **6 项全部通过（GREEN）**；这不是 Agent 产出，也不计入工具效果。参考副本另通过原项目 `tests/test_downloads.py` 的 32 项测试，以及 `verifiers/httpie-gzip-download.cjs` 的明文、截断明文和 gzip 检查。参考测试产生两条非失败警告，原样保留。未修改起点保持干净，参考副本不进入正式运行。

外置验收不在 Agent 工作目录内。2026-10-08 的 Codex CLI baseline 试跑从相同提交的独立副本启动，使用新会话、`gpt-6-sol` / `medium`、600 秒上限；依赖在计时前备好。模型于 **348.088 秒**结束，外置验收 **6/6**，下载专项测试 **40/40**，改动涉及 `httpie/client.py`、`httpie/core.py`、`httpie/downloads.py` 和 `tests/test_downloads.py`。供应商事件记录 `input_tokens=999153`（其中缓存输入 `937216`，已包含在 input 内）、`output_tokens=10224`；实际美元费用未知。试跑原始记录在忽略提交的 `runs/httpie-download-integrity-baseline-1/`。

宽回归结果为 **1024 通过、3 失败、5 跳过、4 xfailed**。三项失败分别为两项 Big5 字符集识别和一项双 quiet 模式的域名错误文案；在未修改的固定起点上单独重跑相同测试，也得到相同三项失败。故目前没有证据表明这三项是本次修改引入，但宽回归不能写成全绿。此试跑只校验题目可完成性，不用于计算任何工具的节省率或排名；正式比较还须冻结同一任务说明与验收器，并在各环境内另跑 baseline 与工具组。

同日又从相同提交新建独立副本和会话，运行 Ponytail full 指令组。两组任务 Prompt 完全相同（SHA-256 `ed71d0732fe53941849b3143de5dfd510ef8db42f496c2e0390dd5c1ee07400c`），同为 `gpt-6-sol` / `medium`、600 秒上限；Ponytail 指令来自固定提交 `e3ba2aa6f1e6f0bc4d69eb09c9f0d0a93af56156`（指令 SHA-256 `da4fb09cff2f6726691ce6591cebc38c95597d79da132e49c6fa2665c4e8a3ff`）。指令注入可核对，不等于证明每条规则都被遵循。

| 单次试跑指标 | baseline | Ponytail full |
| --- | ---: | ---: |
| 执行时间 | 348.088 秒 | 297.008 秒 |
| Input token（含缓存） | 999,153 | 778,254 |
| 其中缓存 Input | 937,216 | 721,280 |
| Output token | 10,224 | 8,960 |
| 外置验收 | 6/6 | 6/6 |
| 下载专项测试 | 40/40 | 39/39 |
| 宽回归 | 1024 通过、3 失败 | 1023 通过、3 失败 |

Ponytail 的宽回归三项失败名称与未修改起点一致，另外有 5 跳过、4 xfailed。两组执行顺序固定为 baseline 后 Ponytail，服务端缓存、运行波动和各自新增测试数量都不同；**这张表只能描述两次试跑，不能据此声称 Ponytail 稳定节省 token、费用或时间**。实际美元费用均未知。Ponytail 原始记录在忽略提交的 `runs/httpie-download-integrity-ponytail-1/`，尚未做跨重复轮次的正式配对统计。

## 选题理由与限制

单独修 gzip 大小统计可能只是极小改动，不足以代表用户关心的日常开发；加入分段续传与已有文件保护后，任务需要理解 CLI 参数、HTTP 响应、下载状态与文件写入的联动。隔离参考实现在两处源文件共改动 41 行，说明此题至少跨越下载状态与请求编排，但不能用参考补丁行数预测 Agent 工作量。这里的分段响应由本地服务器确定性产生，不声称所有服务器都这样实现。[RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html)定义了 Range、`206` 与部分响应组合的语义；本题要求的是上述明确场景下的客户端行为。单次试跑已表明两组可在 600 秒内完成；正式运行顺序与停止条件见 [协议](../docs/real-development-protocol.md)，仍需重复配对才能讨论工具效果。
