# 求索 SeekStudio

[English](README.md) | 简体中文

基于 DeepSeek API 的开源 AI 工作台，Fork 自 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo)。这是社区项目，非 DeepSeek 官方产品。

## 统一工作台

左上角选择功能，左侧保留会话历史，中间发送消息、查看连续回答，右侧配置文件、参数和定时任务。联网搜索共用聊天历史，刷新后仍可查看；模型可读取消息中的链接并结合上下文回答。

OCR 以 Markdown 展示标题、表格和正文；选择文字时，左侧 PDF 自动切换到对应页，有区域坐标时高亮原文。网页监测支持直接输入“链接 + 检测目标”，首次读取即可作答，同一会话后续可比较变化。

左下角「设置 → 模型与功能」可配置 API Key、选择模型，分别开关内容安全审计、用户元信息和自动朗读。新回答自动播放时仍保留文字，可随时停止。审计记录在「设置 → 安全审计」查看、导出，不保存提问、回复正文或密钥。

## 应用工作台

左上角提供 OCR、文档分析、播客、会议助手、网页监测、信息订阅和顺序工作流。支持本地持久会话、取消、定时执行和带令牌的本地工作流 API。

新增应用依赖 `pnpm dev` 启动的本地后端；会议处理还需要 FFmpeg。数据保存在 `.seek-studio/`。具体用法、验证命令和各功能边界见[应用工作台说明](docs/apps.md)。

## 本地 API Key 配置

项目提供 `.env.example`，复制为 `.env` 后填写：

```dotenv
DEEPSEEK_API_KEY=你的DeepSeek开放平台APIKey
```

运行 `pnpm dev` 时，本地服务读取该变量并通过 `/api` 代理请求 DeepSeek。密钥只存在于本地服务端，不注入前端 JavaScript、不写入浏览器存储。服务默认只监听 `127.0.0.1`；修改 `.env` 后需要重启。`.env` 被 Git 忽略，切勿提交真实密钥。

也可在「设置 → 模型与功能」填写 API Key。手动请求优先使用浏览器密钥，清除后恢复 `.env` 密钥；定时任务和发布 API 使用 `.env`。无 `.env` 时聊天使用浏览器直连模式。

**`.env` 代理仅用于本地开发。** `pnpm build` 的静态产物不会携带服务端密钥或代理；静态部署后使用浏览器设置中的 Key。若要为多用户部署统一服务端密钥，需要另行部署带鉴权、限流的后端。

## 运行

准备 Node.js 22.13+ 和 pnpm：

```sh
git clone https://github.com/NightThought/seek-studio.git
cd seek-studio
pnpm install
cp .env.example .env
# 在 .env 中填写 DEEPSEEK_API_KEY
pnpm dev
```

打开 http://127.0.0.1:8090 。

生成静态产物：

```sh
pnpm build
```

产物位于 `dist/`，可部署到静态服务器，也可直接打开 `dist/index.html`。直接打开时，浏览器和 API 服务需允许 `file://` 页面的存储与跨域请求。

## 功能

- 多会话、自动标题、重命名与删除；编辑提问、重新生成和切换消息分支。
- 流式回答、深度思考、智能搜索、链接阅读与来源引用；支持停止和符合条件的继续生成。
- 附件上传、粘贴与拖拽，语音输入和回复朗读；移动端录音时输入框首行显示实时频谱。
- Markdown、代码高亮、KaTeX 公式和 Mermaid 图表。
- 简体中文与英文、浅色与深色主题、移动端布局、位置设置、历史导入导出。

## 数据

浏览器直连模式的 API Key 和设置保存在浏览器 localStorage，会话及附件原件保存在 IndexedDB，本地数据按浏览器用户配置和站点源（origin）隔离。发送对话、上传附件和使用语音功能时，相应内容会提交给配置的 API 服务。

设置中的历史导入导出使用 ZIP 格式。导入会在确认并校验成功后替换全部本地会话和附件；导出包含会话与本地可用的图片原件，不包含 API Key、设置或非图片附件原件。格式与保留范围见[历史导入导出](src/services/chat/history/README.md)。

设置 → 数据管理 → 删除所有对话，会在确认后清空浏览器中的聊天、附件原件和草稿，停止正在生成的回复。此操作不包含服务端应用任务或审计数据。API Key 和其他设置保留，已上传到 API 服务的文件不受影响。

## 开发

| 命令          | 用途                                       |
| ------------- | ------------------------------------------ |
| `pnpm dev`    | 启动开发服务器                             |
| `pnpm build`  | 构建到 `dist/`                             |
| `pnpm test`   | 模拟接口与搜索导出回归测试（无需真实 Key） |
| `pnpm type`   | TypeScript 类型检查                        |
| `pnpm lint`   | oxlint 检查                                |
| `pnpm format` | oxfmt 格式化                               |

[rspack.config.ts](rspack.config.ts) 默认连接 `https://api.deepseek.com`。`createConfig({ apiOrigin, devServer })` 支持自定义 API 地址和开发服务器代理。

聊天默认使用 `deepseek-flash`，通过 Anthropic 兼容的 Messages / Files API 通信；语音使用 ASR / TTS 接口。Flash 支持联网、文件和安全审核等扩展，Pro 用于关闭扩展后的纯文本对话。安全开关开启时发送 `safety_check.level=high` 并记录审计，关闭时使用 `low` 默认检查。元信息只在开关开启时通过 `latest_reminder` 发送。附件格式以服务端校验为准。

```text
src/
  app/                 应用布局、主题与全局样式
  components/          聊天、设置、Markdown 等界面组件
  i18n/                中英文文案
  services/
    api/               API 请求、SSE 与协议类型
    chat/              会话、消息分支、本地存储与历史导入导出
    markdown/          Markdown 解析、代码高亮与图表
    speech/            录音与朗读
  utils/               通用工具
```

## 许可证

[MIT](LICENSE)。构建会将许可证复制到 `dist/LICENSE`，分发时请一并保留；第三方依赖遵循各自的许可证。
