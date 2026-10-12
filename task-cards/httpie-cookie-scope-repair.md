# HTTPie 会话 Cookie 作用域修复

固定源码：HTTPie `5b604c37c6c67e18e7c3e9aee6c88a8c22b98345`；Python 和依赖复用已锁定环境。题目见 [Prompt](../prompts/httpie-cookie-scope-repair.txt)。

真实问题：同一个显式 session 文件分别保存 127.0.0.1 与 localhost 的同名 Cookie，前者返回过期 Cookie 后，后者也被删掉。2026-10-10 原始源码的四次本地请求复现失败，证据为私有 `runs/decision-extension-2026-10-10/cookie-scope-original-red.json`。

## 作用机会

该问题需要沿 CLI、响应 Cookie 解析、CookieJar、会话持久化追踪作用域；适合比较 baseline 与 CodeGraph 的结构检索，另设 Caveman 沟通组观察最终说明和完整工作流用量。无需规定模型修改哪些文件。

## 独立验收

- 本地真实 HTTP 请求确认不同主机同名 Cookie 保留；同主机不同路径保留。
- Max-Age=0 和过期 Expires 均正确，有无显式 Domain 均覆盖。
- 多条 Set-Cookie、重定向中各响应的来源作用域正确。
- 恶意其他域 Cookie 不被接受；只读会话文件字节不变。
- 旧会话格式兼容；原项目 sessions 专项和宽回归无新增失败。
- Agent 业务源码单向移植到干净判卷副本，测试与验收器在 Agent 工作区外。

固定四次重复、轮换顺序、首次交付及最多两轮自动验收反馈；失败不重抽样。尚待验收器 RED／GREEN 校准和真实接入校准后冻结执行。真实账号与外网不进入测试。
