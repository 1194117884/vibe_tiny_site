# TinySite

一个面向个人与小团队的静态网站发布平台。用户创建项目后，可上传 HTML、构建产物目录或 ZIP 包；文件修改会先进入草稿，确认后作为一个可回滚版本上线。

> Open-source note: this repository contains no production credentials or deployment configuration. Copy `wrangler.example.toml` to a private `wrangler.toml` and use your own domain and resources.

## 能力概览

- 账号体系：邮箱注册、登录、修改密码、会话管理与用户资源隔离。
- 项目工作区：文件树、任意当前目录拖拽上传、目录上传、ZIP 解压、新建文件夹、右键下载/删除。
- 草稿发布：将新增、替换、删除汇集为一组草稿操作，发布时原子生成新版本。
- 版本管理：版本备注、改动明细、历史版本独立地址、分页与一键回滚。
- 网站访问：固定地址始终指向当前版本；历史版本保持独立可访问。
- 默认页面：项目创建时自动准备 `index.html`、`404.html` 与 `50x.html`。
- 套餐与配额：Free / Pro / Plus / Ultra，按项目数、存储与月流量限制资源。
- 套餐权益队列：不同套餐按优先级排期；同套餐也独立排队，避免合并造成退款或核销歧义。
- 运营后台：用户、项目、版本、赠送码、套餐权益及审计记录管理。
- 外观：自动（按本地时间）、浅色、深色三种主题，本机记忆选择。

## 访问规则

| 场景 | 地址 |
| --- | --- |
| 管理站 | `https://console.example.com` |
| 运营后台 | `https://admin-console.example.com` |
| 项目当前版本 | `https://{slug}-site.example.com/` |
| 项目历史版本 | `https://{slug}-v{version}-site.example.com/` |
| 本地当前版本 | `http://localhost:8787/s/{slug}/` |
| 本地历史版本 | `http://localhost:8787/v/{slug}/{version}/` |

项目固定地址适合正式站点；历史版本地址适合预览、回归测试和临时保留旧页面。长期运营的多个独立网站应建立多个项目，避免配额、权限和发布节奏互相影响。

## 发布模型

```text
上传 / 删除文件
        ↓
草稿操作（新增、替换、删除）
        ↓
发布一个新版本
        ↓
更新项目当前文件树与固定地址
        ↓
保留历史快照，可访问、可回滚
```

每个版本只记录本次变更的文件操作，当前文件树用于快速读取线上内容。回滚会恢复被替换/删除的旧文件，并删除目标版本之后新增的文件；回滚本身也会生成新的发布版本。

## 技术结构

```text
public/        管理界面静态资源
src/worker.js  Worker、鉴权、部署、文件服务与运营 API
src/ui.css     Tailwind / daisyUI 输入样式
migrations/    生产环境增量数据库迁移
schema.sql     全新环境初始化结构
wrangler.toml  Worker、数据库、对象存储与域名路由配置
```

对象存储按项目和版本隔离：

```text
sites/{projectId}/v{version}/{path}
```

## 本地开发

### 前置条件

- Node.js 20+
- 已登录的 Wrangler CLI 账号

### 启动

```bash
npm install
npm run db:init:local
npm run dev
```

访问 `http://localhost:8787`。本地数据库仅用于开发；不要把本地种子数据、账号数据或 `.dev.vars` 提交到仓库。

修改界面样式后，可单独生成静态样式：

```bash
npm run ui:build
```

## 部署新环境

1. 复制配置模板，并在私有 `wrangler.toml` 中填写项目名、数据库名、对象存储桶名、根域名和项目域名后缀。
2. 创建数据库并将输出的 `database_id` 写入 `wrangler.toml`。
3. 创建对象存储桶。
4. 初始化全新生产数据库。
5. 在域名托管平台配置管理站、运营后台和项目泛域名路由。
6. 发布 Worker。

```bash
cp wrangler.example.toml wrangler.toml
npm run db:create
npm run r2:create
npm run db:init:remote
npm run deploy
```

`db:init:remote` 仅适用于全新数据库。已有生产库必须按 `migrations/` 中的顺序执行尚未应用的迁移，例如：

```bash
wrangler d1 execute tinysite_db --remote --file=./migrations/0004_plan_entitlements.sql
```

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 本地启动 Worker |
| `npm run ui:build` | 构建管理界面样式 |
| `npm run deploy` | 构建样式并发布 |
| `npm run db:create` | 创建数据库 |
| `npm run db:init:local` | 初始化本地开发数据库 |
| `npm run db:init:remote` | 初始化全新生产数据库 |
| `npm run r2:create` | 创建对象存储桶 |

## 数据与权限

- 项目、版本、当前文件树与审计记录均按 `user_id` 归属。
- 用户只能读取和操作自己的项目、版本与文件。
- 运营接口仅对管理员角色开放。
- 登录态由安全 Cookie 保存；密码使用 PBKDF2 加盐派生后存储。
- 访问网站的流量以异步方式累加，避免影响正常静态文件响应；每月按自然月独立统计。
- 上传前检查存储额度，删除文件或项目会同步释放已占用空间。

## 安全与提交约定

- 不提交 `.dev.vars`、真实密钥、Cookie、数据库导出、用户数据、本地种子数据或本地工具目录。
- `seed.local.sql` 与 `wrangler.toml` 仅供本机/私有环境使用，已在 `.gitignore` 中忽略。
- 生产配置中的资源标识不是密钥；访问令牌、私钥和第三方密钥必须只放在部署环境的机密配置中。
- 提交前执行：

```bash
git status --short
git diff --check
npm run ui:build
node --check public/app.js
node --check src/worker.js
```

## 当前非目标

- 真实支付、订单与退款通道尚未接入；当前可通过后台赠送套餐权益进行内测。
- 自定义域名绑定、通知渠道、文件预览和更细粒度的版本保留策略可在后续迭代中补充。

## Contributing and security

- Contributor workflow: [CONTRIBUTING.md](./CONTRIBUTING.md)
- Security reporting policy: [SECURITY.md](./SECURITY.md)
- Architecture reference: [docs/architecture.md](./docs/architecture.md)
- Instructions for AI coding agents: [AGENTS.md](./AGENTS.md)

## License

No open-source license has been selected yet. Choose and add a license before publishing the repository publicly; without one, others do not have permission to reuse, modify, or distribute the code.
