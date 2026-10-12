# 环境配置与复现边界

阅读结果和基础检查见 [README](../README.md)。本文保留构建与接入所需信息；实验成绩见[总结](token-saver-experiment-summary.md)，不重复记录执行进度。

## 当前能运行到哪一步

干净下载可运行计划预览和纯逻辑测试；完整 `npm test` 还依赖固定源码和本地缓存。正式重跑尚不具备新机器一键初始化能力：

- `src/output-study-runner.js` 绑定历史 `native-integration-readiness-review.json`、RTK 构建路径，并调用 macOS `scutil`。
- `src/headroom-adapter.js` 绑定 macOS ARM wheel、私有构建证明及展开目录；`src/codegraph-adapter.js` 绑定历史源码缓存。
- 下文通用构建目录与部分运行器实际读取目录不同，构建完成不等于接通；Caveman／CodeGraph 等仍缺完整初始化流程。

不得用空文件或伪造证据绕过门禁。完整重跑需要先消除历史路径依赖，再重新校准隔离、工具触发和独立验收。跨平台运行尚未验证。

## 固定依赖

| 依赖 | 本次版本／要求 |
| --- | --- |
| Node.js | >= 22 |
| Codex CLI | 0.158.0 |
| 模型 | gpt-5.6-sol／medium |
| pnpm（Memos） | 11.0.1 |
| Python（HTTPie） | 实验使用 3.11.15，依赖见 `requirements/httpie-python311.txt` |
| Headroom 构建 | Python 3.12、Maturin 1.9.4 |
| RTK 构建 | Rust >= 1.91，保留 Cargo.lock |

准备依赖可以联网，应在正式计时前完成。预检会核对固定提交、工作树、版本及文件哈希；不要通过修改锁定值掩盖环境漂移。

## 源码与构建

以下是准备步骤，不构成完整可执行的新机器安装教程。保留已有改动，在干净副本构建，不修改用户全局配置。

### 准备 Memos 代码与前端依赖（`.cache/candidate-memos`）

```bash
mkdir -p .cache
git clone https://github.com/usememos/memos.git .cache/candidate-memos
cd .cache/candidate-memos
# 检出评测锁定的稳定提交
git checkout b1fa9aefcc22fde5774b7f6cf0b3e19fc67acc6e
# 确保工作树纯净无改动
git status --porcelain

# 安装前端依赖
cd web
pnpm install --frozen-lockfile
# 验证 Vitest 可执行文件存在
test -f node_modules/.bin/vitest && echo "Memos dependencies ready"
cd ../../..
```

### 准备 HTTPie 代码与 Python 虚拟环境（`.cache/candidate-httpie`）

```bash
git clone https://github.com/httpie/cli.git .cache/candidate-httpie
cd .cache/candidate-httpie
# 检出评测锁定的稳定提交
git checkout 5b604c37c6c67e18e7c3e9aee6c88a8c22b98345
git status --porcelain

cd ../..
# 使用 Python 3.11.15；若机器没有该版本，先在项目缓存安装，不改全局配置
python3.11 -m venv .cache/runtime/httpie-python311
.cache/runtime/httpie-python311/bin/python -m pip install -r requirements/httpie-python311.txt
# HTTPie 从上述固定源码单独安装；不从包仓库替代固定提交
.cache/runtime/httpie-python311/bin/python -m pip install --no-deps --no-build-isolation .cache/candidate-httpie
.cache/runtime/httpie-python311/bin/python -c 'import sys,ssl; print(sys.version); print(ssl.OPENSSL_VERSION)'
test -f .cache/runtime/httpie-python311/bin/http && echo "HTTPie environment ready"
```

### 准备 Ponytail 工具规则源码（`.cache/tools/ponytail`）

```bash
mkdir -p .cache/tools
git clone https://github.com/DietrichGebert/ponytail.git .cache/tools/ponytail
cd .cache/tools/ponytail
# 检出评测锁定的规则版本
git checkout e3ba2aa6f1e6f0bc4d69eb09c9f0d0a93af56156
git status --porcelain
cd ../../..
```


### RTK 与 Headroom 的固定源码构建

不能仅凭版本号使用既有二进制或原生扩展。先将源码固定为 RTK `7efbaef462911f0fcb112c8a01025dc90f280617`、Headroom `d13e1966f820220b482a33c30bde1e926743939a`，确认 tracked 工作树干净；在独立副本构建，不覆盖原始缓存。以下命令的源码路径应指向这些副本：

```bash
# Rust >= 1.91；Cargo.lock 不得更新
CARGO_HOME="$PWD/.cache/runtime/cargo-build" \
CARGO_TARGET_DIR="$PWD/.cache/runtime/rtk-build" \
cargo build --manifest-path .cache/tools/rtk/Cargo.toml --release --locked --bin rtk

# 构建工具放在专用 venv；不修改用户全局 Python 环境
python3.12 -m venv .cache/runtime/tool-build-env
.cache/runtime/tool-build-env/bin/python -m pip install 'maturin==1.9.4'
bench_root="$PWD"
cd .cache/tools/headroom
# 在项目根目录读取 pyproject.toml，保证 Python 源码与原生扩展打入同一 wheel
CARGO_HOME="$bench_root/.cache/runtime/cargo-build" \
CARGO_TARGET_DIR="$bench_root/.cache/runtime/headroom-build" \
"$bench_root/.cache/runtime/tool-build-env/bin/maturin" build \
  --release --locked -i "$bench_root/.cache/runtime/tool-build-env/bin/python" \
  --out "$bench_root/.cache/runtime/headroom-wheels"
cd "$bench_root"
```

准备依赖可以联网，正式计时前须完成。使用镜像时记录下载来源并保留 Cargo.lock 校验；构建工具 wheel 应与官方元数据 SHA-256 一致。每次保留提交、锁文件哈希、Rust/Maturin/Python 版本、构建日志和产物哈希；重验必须核对被执行二进制、被导入扩展与构建产物匹配。依赖齐全后可加 `--offline` 构建。

## 工具接入要点

固定 Codex CLI 0.158.0、GPT-5.6 Sol／medium 和原 RTK／Headroom 构建产物。每组建立同一私有父目录下的 `workspace`、权限 0700 的 `state`，认证副本权限 0600，并在 finally 删除；不得使用用户全局配置目录作为 state。

1. RTK 调用 `prepareRtkTrustedSession({ workspace, state, binaryPath })`，安装原版 `Bash` Hook、写入私有信任配置并返回宿主参数。调用 `codex --no-daemon -a never exec … <adapter.hostArgs> -`，所有配置参数置于 `exec` 后，模型固定 Sol／medium，`timeoutMs: null`。不要加 `--ignore-user-config`，它会忽略刚创建的私有信任配置。核对 Pre／PostToolUse 和 CLI 的实际输出及退出码。
2. Headroom 的历史输出探针调用 `startHeadroomProxy(root, privateProxyOutput, { observeResponses: true })`、`buildHeadroomSubscriptionLaunch(proxy.port, privateEnv)` 与只读的 `buildHeadroomRepairArgs(launch)`。该代理函数未传 profile 时采用 `calibration-unprotected`，仅用于历史重复日志校准。实际维护任务由 `bin/output-study.js` 明确传入 `profile: "native-offline"`，保留近期回合保护。函数来自 `src/integration-repair.js`，代理来自 `src/headroom-adapter.js`。全部 provider override 与 reasoning 参数在同一 `exec` 作用域，沿用 ChatGPT OAuth。必须确认原生会话 `session_meta.model_provider === "headroom"`，不能仅检查 launch 文件。网络配置只在子进程环境中设置，维持可用的出站代理并使回环地址直连，不改系统代理。
3. 私有 `response-observations.jsonl` 记录 Headroom 原生观察回调，不修改压缩算法。调用 `summarizeHeadroomResponses(rows)` 核对 Responses 的 call ID／text part 配对、输出变化和不透明项目完整性，再以 `requireHeadroomActivation(report)` 检查真实调用、来源与清理证据。此次 messages feed 为空不能用来判断没有请求。
4. RTK 的 `git diff --no-index` 此次返回空输出，虽保留失败码，仍是使用限制；`rtk proxy git diff --no-index …` 已核对与原生输出一致。固定版本能改写裸 `pytest`／`python -m pytest`，不能改写带 `.venv/bin/` 前缀的对应命令。Headroom 的重复日志可完整还原，不证明其他有损压缩的 CCR 原文找回。单次接入校准不代替日常任务配对效果实验；旧正式成绩不改写。

## 运行入口

| 入口 | 用途与限制 |
| --- | --- |
| `bin/decision-study.js candidate` | 预览决策补测候选计划，不调用模型 |
| `bin/decision-study.js preflight` | 核对本地固定环境，不证明正式接入就绪 |
| `bin/decision-study.js freeze / start / review / resume / report` | 决策补测；需要审阅证据、冻结计划与人工验收 |
| `bin/output-study.js calibrate / start / resume / report` | 三阶段输出工具批次；依赖上述本机产物与证据 |
| `bin/campaign.js` | [原 Sol 批次](codex-sol-results.md)入口，保留用于追溯 |

真实 `calibrate`、`start`、`resume` 会消耗模型额度，参数定义见对应 CLI。不要把历史批次 ID 当作下载自带的数据；`report` 读取私有 `runs/`，公开结果直接读取 `docs/` 下的 Markdown／JSON／CSV。

旧 `npm run real-dev -- plan` 输出 Ponytail 子集；`preflight` 检查固定环境，`prepare` 使用已备缓存建立隔离副本，不能代替安装。旧 `start`／`resume` 已关闭。`scenario-check` 使用模拟器和本地验收，不产生真实模型效果数据。

## 冻结、验收与记录

- 决策批次冻结需六项实际审阅门禁及证据哈希；哈希只绑定文件内容，不能证明审阅结论。
- 独立副本、新会话、私有配置隔离；多阶段沿同位置会话继续。认证副本在结束时删除，不公开原始日志。
- 首次失败与后续反馈分别保留，最多两轮失败反馈；人工待审阅、额度限制或不完整调用停止后续派发。不得删掉失败位置重新开始。
- `manifest.json`／`plan.json` 绑定身份，`summary.json`／`result.json` 保存结果。未完成目录须先核查，不自动覆盖或重跑。
- 总 Token 为输入加输出；缓存输入已包含在输入中。缺失用量、费用及未判定质量保持 null。
- 正式结果、质量限制与各批次范围分别见[决策结果](decision-study-results.md)、[输出工具结果](output-study-results.md)和[实验协议](benchmark-protocol.md)。
