# ⚡ TinySite · 静态网站部署工具

基于 **Cloudflare Workers + R2 + D1** 的轻量静态网站托管与部署平台：将 AI 生成的 HTML、dist 目录或 Markdown 文档拖入上传 → 自动发布新版本 → 获得固定访问地址 → 一键回滚历史版本。

## 功能

| 功能 | 说明 |
| --- | --- |
| 项目管理 | 创建项目（每个项目 = 独立网站空间）、列表查看、按名称 / slug 搜索、删除项目 |
| 拖拽部署 | 拖入 HTML 文件或整个 dist 目录，分批上传 + 实时进度条，上传完成即自动发布新版本 |
| ZIP 制品发布 | 直接上传 AI 工具导出的 ZIP，自动解压并去除顶层目录后发布 |
| Markdown 发布 | 上传包含 `index.md` 的目录，自动渲染为适合分享的响应式文档页 |
| 版本管理 | 每次部署生成版本记录（部署时间、文件数、总大小、状态），支持一键回滚到任意历史版本 |
| 访问地址 | 固定地址 `https://{slug}-ts.yongkl.cc/` 永远指向当前版本；历史版本通过 `https://{slug}-v{version}-ts.yongkl.cc/` 独立访问 |
| 默认页面 | 创建项目时生成并发布 `index.html` 模板；其他 HTML 文件可通过 `/{文件名}` 访问 |

## 架构

```
┌────────────┐   拖拽上传(分批 multipart + XHR 进度)
│  管理后台   │ ──────────────────────────────┐
│ public/    │                               ▼
│ (ASSETS)   │   ┌───────────────────────────────────────┐
└────────────┘   │           Cloudflare Worker           │
                 │  /api/*   管理接口（项目/版本/回滚）    │
  访客浏览器 ───▶ │  {slug}-ts.yongkl.cc → 当前版本        │
                 │  {slug}-v{n}-ts.yongkl.cc → 历史        │
                 └───────┬───────────────┬───────────────┘
                         │               │
                    ┌────▼───┐      ┌────▼─────────────────┐
                    │   D1   │      │  R2                  │
                    │ 元数据  │      │ 站点文件对象存储       │
                    └────────┘      └──────────────────────┘
```

## API 路由设计

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/projects` | 创建项目 `{ name }` |
| GET | `/api/projects?q=` | 项目列表 / 搜索 |
| GET | `/api/projects/:id` | 项目详情 |
| DELETE | `/api/projects/:id` | 删除项目（含 R2 全部文件） |
| GET | `/api/projects/:id/versions` | 版本列表 |
| POST | `/api/projects/:id/versions` | 创建新版本（开始一次部署） |
| POST | `/api/projects/:id/rollback` | 回滚 `{ versionId }` |
| POST | `/api/versions/:id/files` | 上传文件批次（multipart，`path_N` + `file_N`） |
| POST | `/api/versions/:id/finalize` | 完成部署并发布为当前版本 |
| POST | `/api/versions/:id/abort` | 中止部署并清理残留 |
| GET | `https://{slug}-ts.yongkl.cc/*` | 固定地址，始终指向当前发布版本 |
| GET | `https://{slug}-v{version}-ts.yongkl.cc/*` | 历史版本地址 |

部署采用三段式：**创建版本 → 分批上传文件 → finalize 发布**。回滚只是切换 `projects.current_version_id` 指针，历史版本文件全量保留，因此回滚秒级完成，且可以随时再切回新版本。

## D1 表结构

见 [schema.sql](./schema.sql)，三张表：

- **projects** `id / name / slug(唯一) / created_at / current_version_id` — 项目与当前版本指针
- **versions** `id / project_id / version(项目内递增) / file_count / total_size / status(uploading|active|failed) / created_at`
- **files** `version_id / path / r2_key / size / mime` — 每个版本的文件清单

## R2 目录规划

```
sites/{projectId}/v{version}/{文件相对路径}
├── sites/p_x8k2n1a9q3/v1/index.html
├── sites/p_x8k2n1a9q3/v1/assets/app.a1b2c3.js
├── sites/p_x8k2n1a9q3/v2/index.html
└── ...

sites/{projectId}/defaults/{index.html,404.html,50x.html}
```

每个版本全量独立存储，天然支持版本隔离与任意回滚；删除项目 / 中止部署时按前缀批量清理。

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 初始化本地数据库并启动
npm run db:init:local
npm run dev          # http://localhost:8787

# 3. 部署到 Cloudflare
npm run db:create    # 创建 D1,把输出的 database_id 填入 wrangler.toml
npm run db:init:remote
npm run r2:create    # 创建 R2 存储桶
npm run deploy
```

本地初始化只会创建管理员账号：`qq1194117884@gmail.com` / `LocalAdmin!2026`。该账号仅由 `seed.local.sql` 创建，不会出现在远程数据库初始化中。

## 使用说明

1. 打开管理后台 →「新建项目」
2. 进入项目，把编译产物（整个 `dist` 目录或若干 HTML 文件）拖入虚线框
3. 点击「开始部署」，进度条实时展示上传进度，完成后自动发布为新版本
4. 固定地址 `https://{slug}-ts.yongkl.cc/` 立即更新；历史版本可在下方表格中访问独立地址或回滚

## 注意事项

- **资源路径**：每个项目独占子域名根路径，`/assets/...` 等绝对资源路径可正常使用；相对路径同样兼容。
- **SPA 支持**：无扩展名的路径自动回退到 `index.html`；站点自带 `404.html` 时会用于 404 页面。
- **上传限制**：前端按「≤20 个文件 且 ≤30MB」分批上传；ZIP 最大 30MB、解压后最大 100MB / 1000 个文件；单请求体积受 Cloudflare Workers 套餐限制（免费版 100MB）。
- 管理后台本身无鉴权，公网部署建议套一层 Cloudflare Access 或自行在 Worker 里加访问控制。
