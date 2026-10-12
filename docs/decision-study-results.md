# Codex CLI 日常开发工具使用决策结果

## 结论

这批结果支持按场景试用与关闭判断，未形成稳定省 Token 的通用工具排名。Ponytail 在本前端功能任务未显示稳定总量优势，质量与 baseline 均为 4/4；Caveman 在 Cookie 修复中输出四次更低，但总工作量方向不一致；CodeGraph 可按结构检索需要试用，本 Cookie 样本未缓存输入四次更高。RTK、Headroom 在该正式批次中效果未测量。

**2026-10-10 后续接入修复：RTK 和 Headroom 均已在 Codex CLI 0.158.0＋GPT-5.6 Sol／medium 的真实校准中触发。** RTK 普通命令被 Hook 自动改写并执行；Headroom 原生命名 provider 收到真实请求，并将一份重复构建日志从 32,029 字符折叠为 175 字符，保留最终错误、重复次数，原文可完整还原。该校准不是配对效果实验，不能据此宣称日常开发节省比例；下面的 32 个正式位置及其 JSON／CSV 成绩保持原样。RTK 的 `git diff --no-index` 出现空输出，退出码仍为 1，作为使用限制保留。

**2026-10-11 后续效果补测已完成。** 独立的[三阶段维护结果](output-study-results.md)包含 RTK／Headroom 各四次配对，12 个位置最终通过，首次失败与两次反馈成本保留。RTK 可在受支持命令的长输出工作流有条件试装；本维护工作流不支持以省 tokens 为由默认安装 Headroom。新结果单列，不合并下面的 32 位置计量；日志探针取消近期保护，其压缩比不代表正常保护配置的日常收益。

正式范围：Codex CLI 0.158.0、gpt-5.6-sol／medium，无 Agent 超时、无模型回退；20 个正常接入新任务加全部 12 个历史诊断续接，每比较四次重复。32 个位置最终验收通过，首次交付 27/32 通过，共五次反馈；原 12 个诊断成绩保持 baseline 3/4、Caveman 3/4、CodeGraph 2/4，不被修复成功改写。37 次本批次模型回合，完整工作流另外计入原 12 次诊断的用量和 Agent 耗时。

数据：[完整 JSON](decision-study-results.json)、[完整 CSV](decision-study-results.csv)。全部首次失败、反馈、未知值保留；校准和 Cursor/Luna 结果不混入。旧首次交付研究见[原 Sol 结果](codex-sol-results.md)，新增真实功能任务与继承历史配置不合并排行。

## 日常开发如何选择

| 工具 | 当前可支持的决策 | 使用前检查 | 关闭或停止试用条件 |
| --- | --- | --- | --- |
| Ponytail | 在附件搜索这类前端功能任务中，不能以节省总 Token 为理由默认启用；四次配对总量只一次更低，双方首次与最终质量均 4/4。其他用途需另行确认。 | 在新会话记录中确认 SessionStart Hook 正文加载，版本固定、无重复目录注入、无预算警告。 | 连续代表性工作没有减少完整消耗或返工，或出现重复注入、加载缺失；停用后用同样验收对照。 |
| Caveman | 对希望控制输出长度的 Cookie 修复任务可按需试用；供应商记录的整个工作流输出 Token 四次均更低，但完整总量两次低、两次高，不能等同省钱或更好开发。诊断续接总量两次低、两次高，中位比值为 1.177；不能把 Cookie 输出表现推广到完整诊断工作流。 | 确认选中的沟通 Skill 正文实际加载；保留错误原因、验证证据和风险说明。 | 解释缺少必要信息、需要反复追问，或把补问和修复计入后不再有收益。 |
| CodeGraph | 对跨文件调用链、影响范围检索可试用；本 Cookie 任务实际 CLI 激活，未缓存输入四次均更高，不能据此默认启用来省 Token。 | 先确认实际调用和固定版本；用符号改名或删除检查索引更新，区分 CLI 与 MCP。 | 索引滞后、无法确认作用机会、或检索加准备的成本持续高于实际开发收益；回到常规检索并保留失败记录。 |
| RTK | 本文原批次未测效果；后续四组维护配对总量两次低、两次高，中位变化 -3.9%，未缓存输入中位变化 -22.0%。可在受支持命令的长输出工作流有条件试装，不能承诺稳定省额度。 | 验证普通命令真实改写及输出完整性；固定版本的 `git diff --no-index` 返回空输出，`.venv/bin/` 前缀命令不改写。 | 没有自动触发，关键错误丢失或出现空输出；关闭对应过滤路径，需要完整输出时使用原生命令或 `rtk proxy`。 |
| Headroom | 本文原批次未测效果；后续四组维护配对总量一次低、三次高，中位变化 +14.5%。不建议仅为本工作流省 tokens 默认安装；历史大输出场景可另行配对试用。 | 核对原生命名 provider、真实输出变化、固定配置及独立验收；日志探针和正常近期保护配置分开。 | 仅经过代理但未改变输出、模型身份变化、质量下降或重复试用用量持续增加；停止该路径。 |

这些是实验条件下的试用建议，关闭条件是实际使用的判断方法，没有用本实验测过的固定阈值。想指导自己的工作，可选几项近期常见任务，记录首次合格、返工、完整 Token 分项和耗时，再决定是否保留；质量或身份条件不满足的样本也必须保留。

## 数字如何解读

总 Token 包含每轮重复输入和缓存输入，未缓存输入、缓存输入、输出分别展示。它们不是支付费用、订阅额度扣除或有效上下文长度；供应商费用和真人介入时间未知。输出 Token 为供应商记录的整个模型工作流输出，不单独等同于最后一段答复长度，推理 Token 未独立报告时保持未知。每种比较四组配对，只提供描述性结果，不推断普适排名或统计显著性。中位数使用每区组工具／baseline 比值的中位数，不以所有样本先汇总的比值代替。

新任务为正常接入，历史诊断续接保持原配置，两者分开。新 CodeGraph 用 CLI，续接实际使用 MCP；继承配置的结果不代表本期新插件接入效果。完整工作成本包含失败交付和所有反馈；旧诊断成绩不改，不能只展示修复成功后的单轮。

## 准备与维护边界

局部准备耗时来自已经下载、构建好的固定来源在私有目录安装或索引，不是首次联网安装总时间，也不包含真人配置时间。四个新位置分别记录：Ponytail 私有准备 223.3–246.8ms；Caveman 本地 Skill 准备 1.12–1.31ms；CodeGraph 私有安装 20.7–26.3ms、索引 733.1–842.9ms。这些值不代表下载、依赖安装、构建、学习和日常维护总成本。CodeGraph 单文件改名自动同步校准仅是非正式小探针：索引初始化约 349ms，观察到符号更新约 518ms，不能推广为大型仓库维护耗时。正式新任务与继承配置的 watch 状态应分别说明。

Memos 使用真实本地服务和合成数据，各交付有自动检查及九项浏览器检查；图片真实解码，但视频占位文件播放保持未验证。HTTPie 使用真实本地 HTTP 合同和固定起点回归；完整回归的三项既有失败仍展示。第二轮 CodeGraph 续接原完整回归 1005 通过、16 跳过，额外 11 跳过项另行补验覆盖，不能重写原成绩为 1016 通过。

## 四组配对的描述性结果

数字为工具／同区组 baseline 的比值中位数相对 1 的变化。负数表示更低；每个总量都含失败及反馈，历史配置包含旧诊断。不能换算费用。

| 阶段 | 场景 | 工具 | 总 Token | 未缓存输入 | 缓存输入 | 输出 | Agent 耗时 | 总量更低／更高 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 正常接入新任务 | Memos 附件搜索 | ponytail | 10.8% | 5.3% | 10.0% | -5.8% | 2.4% | 1/4 ／ 3/4 |
| 正常接入新任务 | HTTPie Cookie 修复 | codegraph | 2.9% | 21.8% | 2.6% | -13.0% | 0.3% | 2/4 ／ 2/4 |
| 正常接入新任务 | HTTPie Cookie 修复 | caveman | -7.8% | 13.5% | -8.6% | -28.7% | -14.1% | 2/4 ／ 2/4 |
| 继承旧配置完整工作流 | HTTPie 诊断到下载修复 | caveman | 17.7% | 0.3% | 19.7% | -4.3% | -14.4% | 2/4 ／ 2/4 |
| 继承旧配置完整工作流 | HTTPie 诊断到下载修复 | codegraph | -3.1% | 5.6% | -3.4% | 8.5% | -3.8% | 2/4 ／ 2/4 |

## 正常接入、准备与维护事实

| 工具 | 本期接入与实际触发 | 准备计量范围 |
| --- | --- | --- |
| Ponytail 4.10.0 | 四个新位置 SessionStart Hook 正文加载，四次均隔离通过；目录重复注入与预算警告均为零 | 已下载固定源码私有安装，各位置耗时在 JSON setup 中；不含下载、构建或真人时间 |
| Caveman full | 四个 Cookie 新位置均显式项目 Skill 加载 | 已下载固定源码私有准备，耗时在 JSON setup 中 |
| CodeGraph 1.6.0 | Cookie 新任务 CLI 共 15 次、MCP 零次；旧诊断修复 MCP 分别 3、2、2、2 次，CLI 零次 | 私有固定源码安装与索引分别列在 JSON setup 中，不计入 Agent 耗时 |
| RTK | 原批次固定二进制身份复核，自动改写路径未验证激活；后续接入已修复 | 原批次未形成正式效果样本，后续补测见[最终结果](output-study-results.md) |
| Headroom | 原批次固定 wheel 身份复核，该批次路线未观察到代理请求；后续接入已修复 | 原批次未形成正式效果样本，后续补测见[最终结果](output-study-results.md) |

新 CodeGraph 正式副本启用自动同步；旧诊断续接维持父配置的固定索引与关闭 watch 状态。续接 MCP 第二次检索出现编辑后索引滞后提醒的记录保留，不冒充自动同步正式测量。小型 watch 校准另列，见上方准备与维护边界。全部组未修改用户全局配置。

## 首次与最终交付质量

| 阶段 | 场景 | 组 | 首次通过 | 最终通过 | 需反馈位置 | 反馈轮次合计 | 质量未知位置 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 新任务正常接入 | Memos 附件搜索 | baseline | 4/4 | 4/4 | 0 | 0 | 0 |
| 新任务正常接入 | Memos 附件搜索 | ponytail | 4/4 | 4/4 | 0 | 0 | 0 |
| 新任务正常接入 | HTTPie Cookie 修复 | baseline | 2/4 | 4/4 | 2 | 2 | 0 |
| 新任务正常接入 | HTTPie Cookie 修复 | codegraph | 3/4 | 4/4 | 1 | 1 | 0 |
| 新任务正常接入 | HTTPie Cookie 修复 | caveman | 4/4 | 4/4 | 0 | 0 | 0 |
| 继承旧配置诊断续接 | HTTPie 下载修复 | baseline | 3/4 | 4/4 | 1 | 1 | 0 |
| 继承旧配置诊断续接 | HTTPie 下载修复 | caveman | 3/4 | 4/4 | 1 | 1 | 0 |
| 继承旧配置诊断续接 | HTTPie 下载修复 | codegraph | 4/4 | 4/4 | 0 | 0 | 0 |

## 20 个新任务全部结果

| 位置 | 组 | 区组 | 首次修复/交付 | 最终修复/交付 | 反馈轮次 | 总 Token | 未缓存输入 | 缓存输入 | 输出 | Agent 秒 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| decision-memos-attachment-filename-search-block-1-baseline | baseline | 1 | 通过 | 通过 | 0 | 1292095 | 64708 | 1215616 | 11771 | 233.2 |
| decision-memos-attachment-filename-search-block-1-ponytail | ponytail | 1 | 通过 | 通过 | 0 | 1674837 | 62319 | 1600000 | 12518 | 264.5 |
| decision-httpie-cookie-scope-repair-block-1-baseline | baseline | 1 | 通过 | 通过 | 0 | 1440871 | 70800 | 1352832 | 17239 | 452.4 |
| decision-httpie-cookie-scope-repair-block-1-codegraph | codegraph | 1 | 通过 | 通过 | 0 | 2017575 | 99216 | 1903232 | 15127 | 531.9 |
| decision-httpie-cookie-scope-repair-block-1-caveman | caveman | 1 | 通过 | 通过 | 0 | 2552141 | 86854 | 2450944 | 14343 | 560.0 |
| decision-memos-attachment-filename-search-block-2-ponytail | ponytail | 2 | 通过 | 通过 | 0 | 932305 | 68367 | 852352 | 11586 | 292.3 |
| decision-memos-attachment-filename-search-block-2-baseline | baseline | 2 | 通过 | 通过 | 0 | 893005 | 47657 | 833152 | 12196 | 492.9 |
| decision-httpie-cookie-scope-repair-block-2-codegraph | codegraph | 2 | 通过 | 通过 | 0 | 2115871 | 88548 | 2012032 | 15291 | 566.3 |
| decision-httpie-cookie-scope-repair-block-2-caveman | caveman | 2 | 通过 | 通过 | 0 | 2573729 | 91176 | 2469504 | 13049 | 515.8 |
| decision-httpie-cookie-scope-repair-block-2-baseline | baseline | 2 | 失败 | 通过 | 1 | 2280278 | 77336 | 2185216 | 17726 | 506.4 |
| decision-memos-attachment-filename-search-block-3-baseline | baseline | 3 | 通过 | 通过 | 0 | 2329974 | 79205 | 2234240 | 16529 | 410.0 |
| decision-memos-attachment-filename-search-block-3-ponytail | ponytail | 3 | 通过 | 通过 | 0 | 2732471 | 88668 | 2628352 | 15451 | 450.7 |
| decision-httpie-cookie-scope-repair-block-3-caveman | caveman | 3 | 通过 | 通过 | 0 | 1395387 | 86817 | 1295744 | 12826 | 468.7 |
| decision-httpie-cookie-scope-repair-block-3-baseline | baseline | 3 | 通过 | 通过 | 0 | 1952829 | 79528 | 1854720 | 18581 | 670.2 |
| decision-httpie-cookie-scope-repair-block-3-codegraph | codegraph | 3 | 通过 | 通过 | 0 | 2208270 | 91223 | 2097280 | 19767 | 574.5 |
| decision-memos-attachment-filename-search-block-4-ponytail | ponytail | 4 | 通过 | 通过 | 0 | 1451390 | 68470 | 1371264 | 11656 | 322.6 |
| decision-memos-attachment-filename-search-block-4-baseline | baseline | 4 | 通过 | 通过 | 0 | 1907994 | 69383 | 1825664 | 12947 | 339.8 |
| decision-httpie-cookie-scope-repair-block-4-baseline | baseline | 4 | 失败 | 通过 | 1 | 3326600 | 110007 | 3191680 | 24913 | 830.1 |
| decision-httpie-cookie-scope-repair-block-4-codegraph | codegraph | 4 | 失败 | 通过 | 1 | 2423535 | 141861 | 2260352 | 21322 | 737.2 |
| decision-httpie-cookie-scope-repair-block-4-caveman | caveman | 4 | 通过 | 通过 | 0 | 1343186 | 90015 | 1240576 | 12595 | 510.3 |

## 12 个诊断续接全部结果

| 位置 | 组 | 区组 | 旧诊断质量 | 首次修复/交付 | 最终修复/交付 | 反馈轮次 | 总 Token | 未缓存输入 | 缓存输入 | 输出 | Agent 秒 | 修复增量总 Token | 修复增量 Agent 秒 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| decision-httpie-diagnosis-followup-block-1-baseline | baseline | 1 | 通过 | 通过 | 通过 | 0 | 4098753 | 169364 | 3897088 | 32301 | 1113.9 | 3820145 | 894.4 |
| decision-httpie-diagnosis-followup-block-1-caveman | caveman | 1 | 通过 | 失败 | 通过 | 1 | 3954053 | 170526 | 3759104 | 24423 | 743.2 | 3677725 | 570.8 |
| decision-httpie-diagnosis-followup-block-1-codegraph | codegraph | 1 | 失败 | 通过 | 通过 | 0 | 2865643 | 153527 | 2686848 | 25268 | 668.7 | 2459347 | 452.8 |
| decision-httpie-diagnosis-followup-block-2-baseline | baseline | 2 | 失败 | 通过 | 通过 | 0 | 1887893 | 152629 | 1710976 | 24288 | 684.7 | 1674558 | 486.9 |
| decision-httpie-diagnosis-followup-block-2-caveman | caveman | 2 | 通过 | 通过 | 通过 | 0 | 2623494 | 152596 | 2444416 | 26482 | 673.9 | 2324943 | 484.9 |
| decision-httpie-diagnosis-followup-block-2-codegraph | codegraph | 2 | 通过 | 通过 | 通过 | 0 | 3784611 | 199223 | 3556736 | 28652 | 846.2 | 3458869 | 646.8 |
| decision-httpie-diagnosis-followup-block-3-baseline | baseline | 3 | 通过 | 通过 | 通过 | 0 | 2733712 | 157097 | 2551680 | 24935 | 665.5 | 2431322 | 475.9 |
| decision-httpie-diagnosis-followup-block-3-caveman | caveman | 3 | 通过 | 通过 | 通过 | 0 | 4145318 | 206694 | 3912192 | 26432 | 782.4 | 3741546 | 592.0 |
| decision-httpie-diagnosis-followup-block-3-codegraph | codegraph | 3 | 通过 | 通过 | 通过 | 0 | 3202712 | 158900 | 3015552 | 28260 | 699.0 | 2824521 | 474.1 |
| decision-httpie-diagnosis-followup-block-4-baseline | baseline | 4 | 通过 | 失败 | 通过 | 1 | 5010601 | 204162 | 4776960 | 29479 | 1011.0 | 4678735 | 812.2 |
| decision-httpie-diagnosis-followup-block-4-caveman | caveman | 4 | 失败 | 通过 | 通过 | 0 | 3173650 | 159265 | 2989184 | 25201 | 735.9 | 2938988 | 568.2 |
| decision-httpie-diagnosis-followup-block-4-codegraph | codegraph | 4 | 失败 | 通过 | 通过 | 0 | 3838892 | 224589 | 3583744 | 30559 | 883.5 | 3432078 | 661.5 |

新任务统计包含全部反馈回合。诊断续接主列为旧诊断加全部修复回合，增量列只含修复；旧诊断成绩保持不变。未知用量不替换为零，也不以修复增量代替未知完整消耗。

## 各区组全部配对比值

| 阶段 | 场景 | 工具 | 区组 | 总 Token | 未缓存输入 | 缓存输入 | 输出 | Agent 耗时 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 正常接入新任务 | Memos 附件搜索 | ponytail | 1 | 1.296 | 0.963 | 1.316 | 1.063 | 1.134 |
| 正常接入新任务 | Memos 附件搜索 | ponytail | 2 | 1.044 | 1.435 | 1.023 | 0.950 | 0.593 |
| 正常接入新任务 | Memos 附件搜索 | ponytail | 3 | 1.173 | 1.119 | 1.176 | 0.935 | 1.099 |
| 正常接入新任务 | Memos 附件搜索 | ponytail | 4 | 0.761 | 0.987 | 0.751 | 0.900 | 0.949 |
| 正常接入新任务 | HTTPie Cookie 修复 | codegraph | 1 | 1.400 | 1.401 | 1.407 | 0.877 | 1.176 |
| 正常接入新任务 | HTTPie Cookie 修复 | codegraph | 2 | 0.928 | 1.145 | 0.921 | 0.863 | 1.118 |
| 正常接入新任务 | HTTPie Cookie 修复 | codegraph | 3 | 1.131 | 1.147 | 1.131 | 1.064 | 0.857 |
| 正常接入新任务 | HTTPie Cookie 修复 | codegraph | 4 | 0.729 | 1.290 | 0.708 | 0.856 | 0.888 |
| 正常接入新任务 | HTTPie Cookie 修复 | caveman | 1 | 1.771 | 1.227 | 1.812 | 0.832 | 1.238 |
| 正常接入新任务 | HTTPie Cookie 修复 | caveman | 2 | 1.129 | 1.179 | 1.130 | 0.736 | 1.018 |
| 正常接入新任务 | HTTPie Cookie 修复 | caveman | 3 | 0.715 | 1.092 | 0.699 | 0.690 | 0.699 |
| 正常接入新任务 | HTTPie Cookie 修复 | caveman | 4 | 0.404 | 0.818 | 0.389 | 0.506 | 0.615 |
| 继承旧配置完整工作流 | HTTPie 诊断到下载修复 | caveman | 1 | 0.965 | 1.007 | 0.965 | 0.756 | 0.667 |
| 继承旧配置完整工作流 | HTTPie 诊断到下载修复 | caveman | 2 | 1.390 | 1.000 | 1.429 | 1.090 | 0.984 |
| 继承旧配置完整工作流 | HTTPie 诊断到下载修复 | caveman | 3 | 1.516 | 1.316 | 1.533 | 1.060 | 1.176 |
| 继承旧配置完整工作流 | HTTPie 诊断到下载修复 | caveman | 4 | 0.633 | 0.780 | 0.626 | 0.855 | 0.728 |
| 继承旧配置完整工作流 | HTTPie 诊断到下载修复 | codegraph | 1 | 0.699 | 0.906 | 0.689 | 0.782 | 0.600 |
| 继承旧配置完整工作流 | HTTPie 诊断到下载修复 | codegraph | 2 | 2.005 | 1.305 | 2.079 | 1.180 | 1.236 |
| 继承旧配置完整工作流 | HTTPie 诊断到下载修复 | codegraph | 3 | 1.172 | 1.011 | 1.182 | 1.133 | 1.050 |
| 继承旧配置完整工作流 | HTTPie 诊断到下载修复 | codegraph | 4 | 0.766 | 1.100 | 0.750 | 1.037 | 0.874 |

## 验收与证据

Memos 固定起点 b1fa9aefcc22fde5774b7f6cf0b3e19fc67acc6e，HTTPie 固定起点 5b604c37c6c67e18e7c3e9aee6c88a8c22b98345。外置合同原始源码 RED、参考实现 GREEN、全部参与组接入校准、续接隔离与浏览器校准六项冻结门禁通过。独立判卷保留固定测试，只移植业务源码，并检查交付范围。

全部 32 个位置逐回合重放供应商计量，核对原生会话 model/medium、身份、版本、配置、交付范围与验收；12 个续接核对父历史哈希不变。原生会话只证明配置模型，供应商未提供 resolved model 时保持未知。8 个 Memos 交付各有九项实际浏览器验收；图片解码和权限、错误、分页、删除范围均已观察，视频播放保持未验证。全部 29 个 HTTPie 交付／反馈宽回归原计数另存于 JSON，既有三项失败不能写成全绿。

最终报告生成后根项目 `npm test` 159/159 通过；导出四项、明细表三项测试先红后绿通过。最终证据、配对和回归审计 SHA-256 位于 JSON provenance。原始 runs 日志和凭据不导出、不提交；当前只是本地生成报告，未发布。


## 五项工作完成核对

| 要求 | 完成证据 |
| --- | --- |
| 正常接入与维护边界 | Ponytail／Caveman／CodeGraph 正式新位置触发审计，固定来源私有准备计量；CodeGraph 符号改名同步小探针（旧符号查询可能回退，未据此证明删除同步）；RTK／Headroom 当前路线限制及使用前检查 |
| 诊断到修复交付 | 全部 12 个原诊断续接，父历史不变、旧诊断成绩不改；独立修复验收及诊断加全部修复累计计量 |
| 日常开发真实任务 | 20 个前端功能／跨文件 Cookie 修复交付，固定起点外置合同、项目回归与 Memos 九项实际 UI 检查 |
| 固定重复比较 | 冻结 32 个位置、每比较四次重复，新任务轮换顺序；同模型／推理强度、无超时／回退、完整失败和反馈保留 |
| 可执行决策与完整结果 | 五工具试用和关闭条件，全部 32 位置 JSON／CSV、完整工作成本及分项、配对比值、首次／最终质量和未知边界 |

32/32 证据审计、29 个 HTTPie 回归计数核对、导出与表格一致性检查通过。七组本次校准服务已核对当前进程归属后停止，正式浏览器服务已逐位置停止，实验 TaskSpace 已关闭。未提交、推送或发布；视频制作继续暂缓。
