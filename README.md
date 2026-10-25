# Ridley-AI

个人用的 Chrome / Edge 侧边栏 AI 助手：在任意网页选中文字右键「询问 Ridley-AI」，右侧边栏直接开始对话；聊天记录以纯文件形式保存在 `C:\Users\<你>\.ridley-ai`。

- 浏览器：Chrome 116+ / Edge 116+（MV3）
- 形态：原生 Side Panel，不遮挡网页
- 接口：OpenAI 兼容（`chat/completions`），支持多家供应商、各自独立的模型列表
- 工具：内置 `web_search` 与 `web_fetch`，模型可自主调用，地址与 Key 可配置
- 存储：本地文件（JSONL），可随时备份、搜索、手动编辑
- 依赖：本机已安装 Node.js（仅用于运行本地存储服务）

---

## 一、安装

### 1. 构建扩展

```bash
pnpm install
pnpm build
```

产物在 `dist/`。

### 2. 加载扩展

1. 打开 `chrome://extensions`（Edge 为 `edge://extensions`）
2. 打开右上角「开发者模式」
3. 点「加载已解压的扩展程序」，选择本项目的 `dist` 目录
4. **记下扩展 ID**（也可以在项目根运行 `node tools/gen-key.mjs` 查看）

> 扩展 ID 由 `manifest.json` 的 `key` 字段固定，重装、换目录都不会变，本地服务依赖它做鉴权。

### 3. 安装本地存储服务

```bash
pnpm host:install
```

脚本会：

- 把 host 复制到 `%LOCALAPPDATA%\RidleyAI\native`
- 注册 Chrome 与 Edge 的 Native Messaging 注册表项（当前用户，无需管理员）
- 优先使用打包好的 `ridley-host.exe`；没有则回退到 `host.bat` + 本机 Node

可选：先打包成不依赖 Node 的单文件 exe（约 87 MB）：

```bash
pnpm host:build   # 生成 native-host/build/ridley-host.exe
pnpm host:install # 安装时会自动改用 exe
```

### 4. 完全重启浏览器

**必须完全退出 Chrome / Edge（含后台托盘进程）再打开**，浏览器只在启动时读取注册表。

---

## 二、使用

### 右键提问

- 选中文字 → 右键 **「询问 Ridley-AI」**：侧边栏打开，选中内容自动进入输入框（折叠为引用卡片，可展开/删除），点发送即可开始询问；也可以继续补充自己的问题
- 空白处 → 右键 **「呼叫 Ridley-AI」**：打开侧边栏并聚焦输入框
- 点击工具栏的扩展图标也可以打开侧边栏

> `chrome://`、扩展商店、PDF 查看器等特殊页面不显示右键菜单，属浏览器限制。

### 首次配置

点右上角齿轮 → 渠道与模型：

1. 从下方预设添加一个渠道（DeepSeek / OpenAI / Moonshot / 智谱 / SiliconFlow / Ollama）
2. 填入 API Key
3. 按需修改「上下文窗口」「最大输出」等参数，或点「拉取模型」从端点同步模型列表
4. 「测试连接」验证地址与密钥

同一模型名可以出现在多个供应商下，它们被视为**不同模型**，下拉里按供应商分组、互不干扰。

### 对话

| 操作 | 说明 |
| --- | --- |
| `Enter` | 发送（可在设置里改为 `Ctrl+Enter`） |
| `Shift+Enter` | 换行 |
| `Esc` | 停止生成 |
| `+` | 添加附件（图片走视觉模型，文本文件内联） |
| 粘贴图片 | 直接作为附件 |
| 输入框左侧 | 切换当前模型（可搜索，按供应商分组） |
| 环形指示 | 上下文占用估算 |

生成期间，消息尾部、输入框、顶栏、历史列表都会显示「生成中」状态；中断后保留已生成内容并标记「已中断」。

### 工具：网页搜索与网页抓取

在 **设置 → 工具** 里启用，模型会在需要时自主调用，调用过程在对话中以可展开的卡片展示：

| 工具 | 说明 | 默认接口 |
| --- | --- | --- |
| `web_search` | 联网搜索，返回标题、链接、摘要与日期 | DeepSeek 官方 Search API：`POST https://api.deepseek.com/v1/tools/search` |
| `web_fetch` | 抓取网页并转换为 Markdown | DeepSeek 官方 Fetch API：`POST https://api.deepseek.com/v1/tools/fetch`，也可切换为扩展直接抓取 |

两个工具的地址与 API Key 都可单独配置。**Search / Fetch 与模型使用同一个 DeepSeek API Key 和账户余额**，Fetch 的 Key 留空时会自动复用搜索的 Key。官方按成功请求计费（约 5 元 / 1000 次，失败与零结果不计费）。

注意事项：

- 模型配置里需要勾选「支持工具调用」（默认勾选），不支持 function calling 的模型请取消勾选；
- 工具调用轮次上限可在 **设置 → 工具 → 调用策略** 中配置（默认 5 轮，范围 1–10）。达到上限时**不会直接中断**：剩余的工具调用会收到「已到上限」的结果，随后再发一次不带工具的请求，让模型基于已有信息给出最终回答；
- Search 的「最多返回来源」对应官方 `count`（1–50）；
- Fetch 返回 404 表示目标页面无法提取可用正文（不可达、站点限制或内容类型不支持），不是地址填错；
- 本地抓取模式不需要 Key，但默认禁止访问 `localhost` / 内网地址，可在设置中放开；
- 单页抓取上限 2MB，返回给模型前会按设置的字符数截断。

### 历史会话

顶栏时钟图标打开。支持：
- 搜索标题与内容
- 按模型、时间范围、仅收藏筛选
- 按「创建时间 / 最后活跃时间」排序，正序/倒序切换（默认最后活跃时间倒序）
- 重命名、收藏、删除

重新打开侧边栏时会自动回到上次的会话。如果上次是在生成过程中关闭的，重新打开后会以「已中断」的形式保留已生成的部分，不会丢内容。

---

## 三、数据目录

```
C:\Users\<你>\.ridley-ai\
├── settings.json                     # 渠道、模型、界面偏好（含 API Key，明文）
├── sessions\<年-月>\<会话ID>\
│   ├── meta.json                     # 标题、时间、模型、消息数
│   ├── messages.jsonl                # 每行一条消息
│   └── draft.json                    # 生成中的临时草稿（正常情况下会自动删除）
├── attachments\<sha256>              # 图片等附件，按内容去重
├── .trash\                           # 删除的会话（可手动清理）
└── logs\host.log                     # 本地服务日志（2 MB 轮转）
```

- 备份：直接复制整个 `.ridley-ai` 目录即可
- 迁移：把目录放到新机器同位置（或设置环境变量 `RIDLEY_AI_HOME` 指向别处）
- API Key 是明文存储，仅限个人机器使用；如需更安全，可自行用系统加密工具保护该目录

---

## 四、常见问题

**侧边栏显示「本地服务未连接」**

1. 确认已运行 `pnpm host:install`
2. 完全退出并重启浏览器
3. 检查 `%LOCALAPPDATA%\RidleyAI\native\com.ridley.ai.json` 是否存在
4. 检查注册表 `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.ridley.ai` 是否存在
5. 重装扩展后扩展 ID 若变化（正常情况下不会），重新运行 `pnpm host:install`

**请求报 CORS / 网络错误**

扩展已申请 `<all_urls>` 权限，正常不受 CORS 限制。请检查：Base URL 是否可访问、是否需要代理、本地 HTTP 端点是否被安全软件拦截。

**切换浏览器后没有历史记录**

数据在 `.ridley-ai` 目录而不是浏览器配置里，Chrome 与 Edge 共用同一份记录。

**右键菜单没有出现**

- 页面是 `chrome://`、扩展商店等受保护页面
- 或选中内容位于跨域 iframe 中且注入失败（会用右键菜单自带的选中文本兜底）

---

## 五、卸载

```bash
pnpm host:uninstall
```

会删除注册表项与 `%LOCALAPPDATA%\RidleyAI`，**不会删除**聊天记录。最后在 `chrome://extensions` 移除扩展即可。

---

## 六、开发

```bash
pnpm dev        # vite build --watch，改完在 chrome://extensions 点重载
pnpm build      # 生产构建
pnpm host:test  # 不经过浏览器，直接测本地服务协议
node tools/e2e-check.mjs   # 无头浏览器端到端自检（临时数据目录，不碰真实记录）
node tools/mock-llm-server.mjs 8765   # 本地假模型服务，配合自检或手动调试
```

> MV3 的 CSP 会拦截 Vite dev server 的 HMR 脚本，所以开发模式也是「构建 + 手动重载」。

### 目录

```
extension/          扩展源码（React + TypeScript + CSS Modules）
  src/background/   右键菜单、side panel 打开、native 端口转发
  src/sidepanel/    界面、状态、协议适配、Markdown 渲染
native-host/        Node 本地存储服务（Native Messaging stdio）
tools/              密钥/图标生成、自检脚本、mock 服务
```

### 已支持 / 未支持

- ✅ OpenAI 兼容 `chat/completions`（含 `reasoning_content` 思考过程、`stream_options` 用量、function calling）
- ✅ 工具调用：`web_search`（DeepSeek Anthropic 兼容搜索）+ `web_fetch`（本地直抓 / 外部抓取服务）
- ⬜ OpenAI Responses API、Anthropic Messages 聊天协议（协议适配层已预留）
- ⬜ 本地文件读写、命令执行、MCP、RAG
