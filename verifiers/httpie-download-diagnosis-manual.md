# HTTPie 下载诊断：评测者独立核对表

适用于 [诊断任务卡](../task-cards/httpie-download-diagnosis.md)。这是评测者材料，不能放进 Agent 项目副本或当作模型提示词。固定 `httpie/cli` 提交 `5b604c37c6c67e18e7c3e9aee6c88a8c22b98345`，不要用已修复参考实现评判“当前实现”。

## 判卷方式

保存原回答、原始事件及业务源码前后完整指纹；给回答分配匿名组号。下面每项记 `pass / fail / not-run`，附回答摘录、核对的源码范围和原因。先核对技术与引用，再核对可读性，不按字数、文风或关键词匹配评分。

技术项全部通过、可读性全部通过、业务源码未改且没有伪造结果，才可记 `qualityPassed = true`；存在已确认必需项失败记 false，必需项未核对且没有已确认失败记 null。保留技术和可读性两个分项。匿名组号不能保证文风完全盲化，评测者推测出工具时须披露。

## 技术事实与依据

| 必需项 | 固定起点的正确事实 | 评测者源码依据 |
| --- | --- | --- |
| CLI 与调用流程 | 参数解析处理下载选项；正常在线模式下 continue 需要 download 与 output。流程经过 core 的解析与 program、请求消息收集、Downloader、流写入和最终状态；不能把符号清单当成调用链 | `httpie/__main__.py`；`httpie/core.py` 的 `main / raw_main / program`；`httpie/cli/argparser.py` 的 `HTTPieArgumentParser.parse_args / _process_download_options` |
| 请求头和发送 | Downloader 在发送前要求 identity；已有非空文件续传时按文件大小设置开放式 Range。client 构造、发送请求并产出响应 | `httpie/downloads.py` 的 `Downloader.pre_request`；`httpie/client.py` 的 `collect_messages / make_request_kwargs`；数字示例 Range 起点 137，不是 0 |
| 200 回退 | 指定 output 时，非续传 206 分支重置 resumed_from，seek(0) 并 truncate 后写完整响应；不直接把完整 200 追加到旧文件 | `httpie/downloads.py` 的 `Downloader.start` |
| 合法分段 206 被拒绝 | `parse_content_range` 要求首字节匹配请求位置，并要求已知总长度时 last_byte_pos + 1 等于总长度；合法短段未抵达末尾会被拒绝，现有 program 没有按下一偏移循环拉取 | `httpie/downloads.py` 的 `parse_content_range`；`httpie/core.py` 的 `program`。fixture 为 bytes 137-1160/9728，不能写成首段成功下载后误判完成 |
| gzip 完整响应 | RawStream 调用 HTTPResponse.iter_body，后者交给 Requests iter_content；本地复现写出解码后内容，但 total_size 取响应 Content-Length，编码长度与解码进度不同，finish 后 interrupted 判断造成错误状态 | `httpie/downloads.py` 的 `Downloader.start / interrupted / chunk_downloaded`；`httpie/output/streams.py` 的 `BaseStream.__iter__ / RawStream.iter_body`；`httpie/models.py` 的 `HTTPResponse.iter_body`；`httpie/output/writer.py` 的 `write_stream`；`httpie/core.py` 的 `program`。日志 size=79、downloaded=9728，否定与数字必须准确 |
| gzip 续传风险 | 现有 206 分支没有先拒绝 gzip 编码，合法 Content-Range 可继续进入写入；解码字节追加到原文件后失败不能恢复已改字节。identity 是请求要求，不保证服务端遵从 | `httpie/downloads.py` 的 `Downloader.pre_request / start` 与 `httpie/core.py` 的写入、finish；本地 gzip-resume 检查原文件被改变 |
| 建议可实施 | 建议区分 gzip 完整下载的大小校验与危险续传保护；分段响应按真实进度继续且有无进展停止条件；保留正常单段、200 回退和文件保护。不把建议写成已经实现，不用关闭全部续传或禁止 gzip 完整下载替代需求 | 结合上述源码及既有 `tests/test_downloads.py` 核对，不限定唯一补丁或符号命名 |
| 验证可执行、引用真实 | 给出本地测试或复现命令与相应预期结果，包含普通 gzip、单段、多段、200 回退、无进展、危险 gzip 续传；URL 占位符标明，CLI 参数有效。路径、符号、行号均对应固定起点；只引用源码不能虚报已实际运行测试 | 对固定源码、CLI 参数定义及下述六项黑盒逐条检查；不接受凭空引用或“所有情况都安全” |

## 交付可读性

| 必需项 | 通过要求 |
| --- | --- |
| 原因可理解 | 同事无需追问即可区分三个问题；当前行为、推断、建议各自清楚，技术事实未被缩写或省略损坏 |
| 行动可执行 | 建议有可执行顺序和检验条件；关键否定、保留原文件、不能无限请求等约束完整 |
| 语言和边界准确 | 按 Prompt 用中文解释，代码、命令、API、错误及数字准确；未验证内容明确标出；没有无依据的通过或安全保证 |

## 离线校准依据

在 benchmark 根目录使用独立源码路径选择被测实现，下列命令不调用模型，只访问本地临时 HTTP 服务器并使用临时文件：

```bash
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH="$PWD/.cache/candidate-httpie" \
  node verifiers/httpie-download-integrity.cjs \
  "$PWD/.cache/runtime/httpie-python311/bin/http"
```

2026-10-08 固定起点得到 `plain-resume / range-ignored / stalled-resume` 通过；`gzip-full / bounded-resume / gzip-resume` 失败，退出码 1。隔离参考实现用相同 venv 可执行文件、仅将 PYTHONPATH 改为 `.cache/candidate-httpie-reference` 后六项通过，退出码 0。复核需确认导入的 httpie 确实来自指定源码路径；参考实现不提供给 Agent。

此前 Python 3.9 / LibreSSL 结果仅为历史记录。已用 Python 3.11.15 专用环境与固定依赖重验，六项黑盒结果不变；不能把供应商用量、Agent 诊断质量或机制激活当作已校准。手工参考答案可核对技术事实，但不存在新的 Agent 结果或自动语义判卷器。
