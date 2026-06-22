# Typst Editor
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/olivame/typst-editor)
一个基于 Docker Compose 的 Typst 在线编辑器。当前结构已经按模块拆开，目标是让新机器在 `clone` 后直接构建运行，并为后续分布式部署保留清晰边界。

## 快速启动

当前仓库提供两种最常用的运行方式：

- 单机开发/验证：`compose.yaml + compose.dev.yaml`
- 多机拆分部署：`compose.distributed.yaml`

### 单机开发/验证

1. 复制环境变量

```bash
cp .env.example .env
```

2. 构建并启动

```bash
./compose-smart.sh -f compose.yaml -f compose.dev.yaml up --build
```

如果只想先构建镜像：

```bash
./compose-smart.sh -f compose.yaml -f compose.dev.yaml build
```

如果已经构建完成，需要按新代码重建并重启：

```bash
./compose-smart.sh -f compose.yaml -f compose.dev.yaml up -d --force-recreate
```

3. 访问服务

- Web: `http://localhost:3000`
- API: `http://localhost:8000`
- API Docs: `http://localhost:8000/docs`

### 单机接近生产的验证方式

如果你想验证“不挂源码卷、只跑镜像”的形态，可以只使用基础编排：

```bash
cp .env.example .env
docker compose --env-file .env -f compose.yaml up -d --build
```

这一模式仍然适合当前项目的单机验证，但 `apps/web` 容器目前跑的是 Vite 服务，更适合作为现阶段验证入口，而不是最终生产网关形态。

## 模块划分

### 基础服务

- `apps/web`: React/Vite 前端与当前验证用入口代理
- `apps/api`: FastAPI 接口层和项目存储边界
- `services/compiler`: Typst 编译服务，通过 API 传入的项目快照工作
- `services/preview`: Tinymist 预览服务，通过 API 内部快照工作；同一项目同一入口会共享一个 Tinymist session
- `services/realtime`: Yjs 协同编辑服务，通过 API 内部接口 resolve/flush
- `storage/projects`: 单机/dev 本地缓存目录；项目文件、二进制上传和 PDF 产物的权威数据仍然在数据库中，磁盘不是 correctness 依赖

### 前端模块

- `src/config/api.js`: API 地址解析，支持跨机器访问和后续网关切换
- `src/services/projects.js`: 前端请求封装
- `src/components/PdfPreview.jsx`: 可控 PDF 渲染
- `src/components/EditorToolbar.jsx`: 编辑器工具栏
- `src/components/FileSidebar.jsx`: 文件列表

### 后端配置边界

- `apps/api/settings.py`: 数据库、编译服务、CORS、工作目录统一入口
- `apps/api/main.py`: API 编排
- `apps/api/database.py`: 数据库连接层

## 为分布式部署预留的配置

`.env.example` 里已经提供了这些入口，`.env.distributed.example` 给多机部署提供了按 IP 填写的模板。所有 `*_URL` 优先级最高；不填 URL 时会按 `*_SCHEME` + `*_HOST` + `*_PORT` 组装。

- 浏览器直连地址：`VITE_API_*`、`VITE_PREVIEW_*`、`VITE_REALTIME_*`。不设置时，非 localhost 访问会走 `/api`、`/preview`、`/realtime` 代理。
- Web dev proxy 目标：`API_PROXY_*`、`PREVIEW_PROXY_*`、`REALTIME_PROXY_*`。如果 Web 要代理多个 preview/realtime shard，再额外配置 `PREVIEW_PROXY_TARGETS`、`REALTIME_PROXY_TARGETS`。
- API 调 preview 内部接口：`PREVIEW_INTERNAL_URL` / `PREVIEW_INTERNAL_URLS`，或 `PREVIEW_INTERNAL_SCHEME` / `PREVIEW_INTERNAL_HOST` / `PREVIEW_INTERNAL_PORT`。
- API 给浏览器返回 preview shard 地址：`PREVIEW_BROWSER_URL` / `PREVIEW_BROWSER_URLS`，未配置时前端继续回退到 `VITE_PREVIEW_*` 或 `/preview`。
- API 调 realtime 内部接口：`REALTIME_INTERNAL_URL` / `REALTIME_INTERNAL_URLS`，或 `REALTIME_INTERNAL_SCHEME` / `REALTIME_INTERNAL_HOST` / `REALTIME_INTERNAL_PORT`。
- Preview/Realtime 调 API 内部接口：`API_INTERNAL_URL` 或 `API_INTERNAL_SCHEME` / `API_INTERNAL_HOST` / `API_INTERNAL_PORT`。
- Compose 宿主机发布端口：`WEB_PUBLISH_PORT`、`API_PUBLISH_PORT`、`PREVIEW_PUBLISH_PORT`、`REALTIME_PUBLISH_PORT`、`COMPILER_PUBLISH_PORT`。

单机不填 `VITE_*_HOST` 也能工作，前端会自动按当前访问主机推导地址。多机部署时直接写各服务机器的 IP，例如：

```env
VITE_API_HOST=10.0.0.10
VITE_PREVIEW_HOST=10.0.0.12
VITE_REALTIME_HOST=10.0.0.13
COMPILER_HOST=10.0.0.11
REALTIME_INTERNAL_HOST=10.0.0.13
API_INTERNAL_HOST=10.0.0.10
```

如果走 HTTPS/WSS 或网关路径，直接设置完整 `VITE_API_URL`、`VITE_PREVIEW_URL`、`VITE_REALTIME_URL` 即可。`*_PORT` 表示服务访问端口；如果只是改 Docker 暴露到宿主机的端口，用 `*_PUBLISH_PORT`。

### 单机模拟多机

当前 compose 会额外挂载 `service-ip-net`，给服务分配固定容器 IP：

- API: `172.30.0.10:8000`
- Compiler: `172.30.0.11:8001`
- Preview: `172.30.0.12:8002`
- Realtime: `172.30.0.13:8003`

在一台机器上模拟多机时，可以让服务间地址指向这些固定 IP，例如：

```env
COMPILER_HOST=172.30.0.11
REALTIME_INTERNAL_HOST=172.30.0.13
API_INTERNAL_HOST=172.30.0.10
```

浏览器如果只开放 Web 端口，可以不设置 `VITE_*_HOST`，让前端走 `/api`、`/preview`、`/realtime`，再把 `API_PROXY_HOST=172.30.0.10`、`PREVIEW_PROXY_HOST=172.30.0.12`、`REALTIME_PROXY_HOST=172.30.0.13`。不要用本机公网 IP 模拟容器间互调，云主机通常没有把公网 IP 绑定到网卡，容器回打公网 IP 可能超时。

### 多机部署方式

多机部署使用 `compose.distributed.yaml`。它不声明 Docker 内部服务依赖，也不挂载共享项目目录；每台机器只启动自己的 profile，服务之间通过 `.env` 中的 IP+端口访问。

推荐先按这个拓扑落地：

- 公网：只暴露 `web`
- 内网：`api`、`preview`、`realtime`、`compiler`、`db`
- 浏览器：统一访问 `web`
- `web`：反向代理 `/api`、`/preview`、`/realtime`

1. 在每台机器复制并填写同一份环境变量：

```bash
cp .env.distributed.example .env
```

2. 在 DB 机器启动数据库：

```bash
docker compose --env-file .env -f compose.distributed.yaml --profile db up -d --build db
```

3. 在各服务机器分别启动对应服务：

```bash
docker compose --env-file .env -f compose.distributed.yaml --profile compiler up -d --build compiler
docker compose --env-file .env -f compose.distributed.yaml --profile api up -d --build api
docker compose --env-file .env -f compose.distributed.yaml --profile preview up -d --build preview
docker compose --env-file .env -f compose.distributed.yaml --profile realtime up -d --build realtime
docker compose --env-file .env -f compose.distributed.yaml --profile web up -d --build web
```

4. 网络暴露建议：

- 最稳妥：浏览器只访问 `web`
- `api/preview/realtime/compiler/db` 只开放内网端口
- `preview` 不要直接裸暴露公网端口；它应该被 `web` 或受控网关代理

如果浏览器只访问 `web`，可以不设置 `VITE_*_HOST`，而是让 `web` 代理到内网服务：

```env
API_PROXY_HOST=10.0.0.10
PREVIEW_PROXY_HOST=10.0.0.12
REALTIME_PROXY_HOST=10.0.0.13
```

如果要让 `web` 代理多个 preview/realtime shard，则不要只填单个 `PREVIEW_PROXY_HOST` / `REALTIME_PROXY_HOST`，而是直接填内部可达 URL 列表：

```env
PREVIEW_PROXY_TARGETS=http://10.0.0.12:8002,http://10.0.0.16:8002
REALTIME_PROXY_TARGETS=ws://10.0.0.13:8003,ws://10.0.0.14:8003
```

当前项目里的 `web` 会按下面的规则稳定代理：

- `/preview/sessions/{project_id}/...`：按 `project_id` 选 preview shard
- `/realtime/...?...fileId=`：按 `fileId` 选 realtime shard

当前横向扩容边界：

- `api` 已经不需要共享盘，可以多实例共用同一个 DB
- `compiler` 无状态，可以放到负载均衡后面
- `realtime` 可以用 `REALTIME_BROWSER_URLS` + `REALTIME_INTERNAL_URLS` 做按文件稳定分片
- `preview` 可以用 `PREVIEW_BROWSER_URLS` + `PREVIEW_INTERNAL_URLS` 做按项目稳定分片
- 同一项目同一 entrypoint 在同一 preview 节点上会共享一个 Tinymist session
- `preview` session 仍然只保存在实例内存里，不支持跨节点迁移，所以同一个 `project_id` 必须稳定落到同一节点

Preview 多实例分片时，两组 URL 必须一一对应，顺序必须稳定，而且 `PREVIEW_BROWSER_URLS` 必须是浏览器可直连的地址。例如：

```env
PREVIEW_BROWSER_URLS=http://10.0.0.12:8002,http://10.0.0.16:8002
PREVIEW_INTERNAL_URLS=http://10.0.0.12:8002,http://10.0.0.16:8002
```

Realtime 多实例分片时，两组 URL 也必须一一对应，顺序必须稳定。例如：

```env
REALTIME_BROWSER_URLS=ws://10.0.0.13:8003,ws://10.0.0.14:8003
REALTIME_INTERNAL_URLS=http://10.0.0.13:8003,http://10.0.0.14:8003
```

## 复现标准

如果要在另一台机器上稳定复现，建议只依赖这条命令：

```bash
./compose-smart.sh -f compose.yaml -f compose.dev.yaml up --build
```

不要依赖宿主机手动安装 Node/Python 依赖；依赖锁文件和 Dockerfile 已经纳入项目。

## 智能换源

仓库根目录提供了 `./compose-smart.sh`：

- `DOCKER_SOURCE_MODE=auto` 时，会根据宿主机时区和 locale 自动判断是否启用国内镜像参数
- 国内模式下会自动切换 Docker Hub、npm、PyPI 和 Debian apt
- 海外或默认环境会继续使用官方源

如果自动判断不符合预期，可以手动覆盖：

```bash
DOCKER_SOURCE_MODE=cn ./compose-smart.sh up -d --build
DOCKER_SOURCE_MODE=global ./compose-smart.sh up -d --build
./compose-smart.sh --print-env
```

## 常用命令

开发环境构建：

```bash
./compose-smart.sh -f compose.yaml -f compose.dev.yaml build
```

开发环境构建并启动：

```bash
./compose-smart.sh -f compose.yaml -f compose.dev.yaml up --build
```

构建后按新镜像重建并重启：

```bash
./compose-smart.sh -f compose.yaml -f compose.dev.yaml up -d --force-recreate
```
