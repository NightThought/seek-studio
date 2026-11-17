# 求索 SeekStudio

[English](README.md) | 简体中文

基于 DeepSeek API 的开源 AI 工作台，Fork 自 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo)。这是社区项目，非 DeepSeek 官方产品。

## AI 搜索工作台

默认打开独立搜索页面：输入问题，流式查看回答与引用来源，支持停止、手动重试、复制和导出带来源的 Markdown。一次运行一个搜索任务；切换到「对话」后结果保留，刷新或关闭页面会清空，请及时导出。

没有返回来源、网页工具失败、回答被截断或请求中断时，会明确提示；不完整导出也会标注状态。原有聊天、文件和语音功能仍可通过「对话」使用。

## 本地 API Key 配置

项目提供 `.env.example`，复制为 `.env` 后填写：

```dotenv
DEEPSEEK_API_KEY=你的DeepSeek开放平台APIKey
```

运行 `pnpm dev` 时，本地服务读取该变量并通过 `/api` 代理请求 DeepSeek。密钥只存在于本地服务端，不注入前端 JavaScript、不写入浏览器存储。服务默认只监听 `127.0.0.1`；修改 `.env` 后需要重启。`.env` 被 Git 忽略，切勿提交真实密钥。

不配置 `.env` 时，也可在「设置 → 数据管理」填写自己的 API Key，沿用原项目的浏览器直连模式。

**`.env` 代理仅用于本地开发。** `pnpm build` 的静态产物不会携带服务端密钥或代理；静态部署后使用浏览器设置中的 Key。若要为多用户部署统一服务端密钥，需要另行部署带鉴权、限流的后端。

## 运行

准备 Node.js 22.12+ 和 pnpm：

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

设置 → 数据管理 → 删除所有对话，会在确认后清空全部本地会话、附件原件和未发送的草稿，停止正在生成的回复并回到新对话。API Key 和其他设置保留，已上传到 API 服务的文件不受影响。

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

聊天默认使用 `deepseek-flash`，通过 Anthropic 兼容的 Messages / Files API 通信；语音使用 ASR / TTS 接口。请求使用搜索、链接阅读、标题和 `latest_reminder` 等扩展，接入服务需支持相应能力。附件实际支持的格式以服务端校验为准。

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
