# SeekStudio

English | [简体中文](README.zh-CN.md)

An open-source AI workspace powered by DeepSeek APIs, forked from [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo). This is a community project, not an official DeepSeek product.

## Unified workspace

Choose Chat, Web Search, OCR, Documents, Podcasts, Meetings, Web Monitoring, Subscriptions, or Workflows in the upper-left selector. History stays on the left. Each application has its own task form, results, saved presets, and schedules. Chat keeps thinking and smart-search controls in its composer without a configuration sidebar. Web Search is a standalone single-query demo with answers, sources, and Markdown export; results survive mode switches but reset on reload. Chat can still read links in context.

OCR displays Markdown alongside the original PDF. Selecting recognized text navigates to its source page and highlights the region when coordinates are available. Web monitoring accepts a URL and a natural-language goal, answers on the first visit, and compares later snapshots using the same saved preset.

Bottom-left Settings provides API keys, model selection, independent safety/metadata/automatic speech toggles, and exportable audit logs. Automatic speech preserves the written reply. Logs contain request metadata and outcomes, not prompts, answers or keys.

Application jobs, files, schedules, and audit records are stored in `.seek-studio/` (Git-ignored). These apps require `pnpm dev`; meeting/ASR processing also requires FFmpeg. Schedules require a server-side key and a running computer/service. Workflow APIs are token-protected and local-only. See [the application guide](docs/apps.md).

## Local API key

Copy `.env.example` to `.env` and set `DEEPSEEK_API_KEY`. Restart `pnpm dev` after changes. The local server injects this key into upstream requests through `/api`; it is never embedded in client JavaScript or browser storage. The dev server binds to `127.0.0.1`. `.env` is ignored by Git.

Settings → Model & features accepts a browser-specific key, which takes priority for manual requests. Clearing it restores the `.env` key. Schedules and published APIs use `.env`. Without `.env`, chat uses browser-direct requests.

The env proxy is **local development only**. Static `pnpm build` output contains neither the server key nor a proxy and uses the key configured in the browser. A shared, multi-user deployment requires a separately authenticated backend.

## Getting started

Install Node.js 22.13+ and pnpm, then run:

```sh
git clone https://github.com/NightThought/seek-studio.git
cd seek-studio
pnpm install
cp .env.example .env
# Set DEEPSEEK_API_KEY in .env
pnpm dev
```

Open http://127.0.0.1:8090.

To build the static site:

```sh
pnpm build
```

The output is written to `dist/`. Deploy it to a static web server or open `dist/index.html` directly. Opening the file directly requires browser support for storage on `file://` pages and an API service that permits their cross-origin requests.

## Features

- Multiple conversations with automatic titles, renaming, and deletion; edit prompts, regenerate replies, and switch between message branches.
- Streaming replies, deep thinking, smart search, link reading, and source citations; stop generation or continue eligible replies.
- Upload, paste, or drag and drop attachments; use voice input and read replies aloud. A live audio spectrum appears in the first row of the input area while recording on mobile.
- Markdown, syntax highlighting, KaTeX math, and Mermaid diagrams.
- Simplified Chinese and English, light and dark themes, mobile layouts, location settings, and chat history import and export.

## Data and storage

Your API key and settings are stored in the browser's localStorage. Conversations and original attachments are stored in IndexedDB. Local data is isolated by browser profile and site origin. Sending messages, uploading attachments, and using speech features sends the relevant content to the configured API service.

History import and export in Settings use ZIP archives. After confirmation and successful validation, importing replaces all local conversations and attachments. Exports include conversations and locally available original images, but exclude API keys, settings, and original non-image attachments. See the [history import/export documentation (Chinese)](src/services/chat/history/README.md) for the archive format and preservation details.

Settings → Data → Delete all chats clears browser chat conversations, original attachments, and unsent drafts (not server-side application jobs or audit records) after confirmation. It stops ongoing replies and returns to a new chat. Your API key and settings are preserved; files already uploaded to the API service are not deleted.

## Development

| Command       | Description                  |
| ------------- | ---------------------------- |
| `pnpm dev`    | Start the development server |
| `pnpm build`  | Build into `dist/`           |
| `pnpm type`   | Run TypeScript type checks   |
| `pnpm lint`   | Lint with oxlint             |
| `pnpm format` | Format with oxfmt            |

[rspack.config.ts](rspack.config.ts) uses `https://api.deepseek.com` by default. Use `createConfig({ apiOrigin, devServer })` to customize the API origin and development server proxy.

Chat uses `deepseek-flash` by default through Anthropic-compatible Messages / Files APIs. Speech features use ASR / TTS endpoints. Flash supports tools and files; Pro is available for plain-text chat with extensions disabled. Safety auditing requests `safety_check.level=high`; disabling it uses the API default (`low`). User metadata is sent as `latest_reminder` only when enabled. Supported attachment formats are determined by server-side validation.

```text
src/
  app/                 Application layout, themes, and global styles
  components/          Chat, settings, Markdown, and other UI components
  i18n/                English and Chinese translations
  services/
    api/               API requests, SSE, and protocol types
    chat/              Conversations, message branches, storage, and history import/export
    markdown/          Markdown parsing, syntax highlighting, and diagrams
    speech/            Audio recording and read-aloud playback
  utils/               Shared utilities
```

## License

[MIT](LICENSE). The build copies the license to `dist/LICENSE`; include it when distributing the app. Third-party dependencies are subject to their own licenses.

## Search regression checks

Run `pnpm test` for mocked streaming, HTTP errors, cancellation, refusal, interrupted responses, citation exports, and source URL validation. No API key or paid request is required. Also run `pnpm type`, `pnpm lint`, and `pnpm build`.
