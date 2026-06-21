# Typst 在线编辑器部署说明

## 环境要求

- Docker 20.10+
- Docker Compose 2.0+
- 至少 2GB 可用内存
- 至少 5GB 可用磁盘空间

## 部署模式

当前仓库建议区分三种运行方式：

### 1. 单机开发/验证

使用 `compose.yaml + compose.dev.yaml`，适合日常开发和快速验证。

```bash
cp .env.example .env
./compose-smart.sh -f compose.yaml -f compose.dev.yaml up --build
```

访问地址：

- Web: `http://localhost:3000`
- API: `http://localhost:8000`
- API Docs: `http://localhost:8000/docs`

### 2. 单机接近生产的验证

使用 `compose.yaml`，不挂源码卷，只验证镜像运行形态。

```bash
cp .env.example .env
docker compose --env-file .env -f compose.yaml up -d --build
```

这一模式仍然适合当前单机验证，但 `apps/web` 容器目前跑的是 Vite 服务，更适合当前阶段的验证入口，而不是最终生产网关。

### 3. 多机拆分部署

使用 `compose.distributed.yaml`。每台机器只启动自己的 profile，服务之间通过 IP + 端口通信，不依赖 Docker 内部服务发现，也不依赖共享项目目录。

```bash
cp .env.distributed.example .env
```

## 当前架构边界

### 服务划分

- `web`: React/Vite 前端，同时承担当前验证阶段的代理入口
- `api`: FastAPI 接口层，负责项目、文件、预览路由、协同路由
- `compiler`: Typst 编译服务，无状态
- `preview`: Tinymist 预览服务
- `realtime`: Yjs 协同编辑服务
- `db`: PostgreSQL

### 数据边界

- 数据库是权威数据源，项目文件、二进制上传和 PDF 产物都以 DB 中的数据为准
- `storage/projects` 或 `WORKSPACE_DIR` 只是 API 本地缓存，不是 correctness 依赖
- 多机部署时不要求共享盘；实例重建后可从数据库重新恢复工作快照

### 分片边界

- `preview` 以 `project_id` 为稳定分片键
- `realtime` 以 `fileId` 为稳定分片键
- 同一项目同一入口 `entrypoint` 在同一台 preview 节点上共享一个 Tinymist session
- preview session 仍然保存在实例内存中，不能跨节点迁移

## 单机部署

### 环境变量

基础启动：

```bash
cp .env.example .env
```

`.env.example` 已内置单机默认值：

- `DB_HOST=db`
- `API_HOST=api`
- `COMPILER_HOST=compiler`
- `PREVIEW_INTERNAL_HOST=preview`
- `REALTIME_INTERNAL_HOST=realtime`

### 启动命令

开发/验证：

```bash
./compose-smart.sh -f compose.yaml -f compose.dev.yaml up --build
```

镜像验证：

```bash
docker compose --env-file .env -f compose.yaml up -d --build
```

已构建后按新代码重启：

```bash
./compose-smart.sh -f compose.yaml -f compose.dev.yaml up -d --force-recreate
```

### 端口

- `WEB_PUBLISH_PORT`，默认 `3000`
- `API_PUBLISH_PORT`，默认 `8000`
- `COMPILER_PUBLISH_PORT`，默认 `8001`
- `PREVIEW_PUBLISH_PORT`，默认 `8002`
- `REALTIME_PUBLISH_PORT`，默认 `8003`
- `DB_PUBLISH_PORT`，默认 `5432`

### 单机模拟多机

`compose.yaml` 额外挂了 `service-ip-net`，可以给容器固定 IP：

- API: `172.30.0.10`
- Compiler: `172.30.0.11`
- Preview: `172.30.0.12`
- Realtime: `172.30.0.13`
- DB: `172.30.0.15`
- Web: `172.30.0.20`

如果要在单机上模拟跨机互调，可以把内部地址改成这些固定 IP，例如：

```env
COMPILER_HOST=172.30.0.11
PREVIEW_INTERNAL_HOST=172.30.0.12
REALTIME_INTERNAL_HOST=172.30.0.13
API_INTERNAL_HOST=172.30.0.10
```

如果浏览器只访问 Web，可以保留 `VITE_*_HOST` 为空，让前端走 `/api`、`/preview`、`/realtime`，再把代理目标指向固定 IP：

```env
API_PROXY_HOST=172.30.0.10
PREVIEW_PROXY_HOST=172.30.0.12
REALTIME_PROXY_HOST=172.30.0.13
```

不要用云主机公网 IP 模拟容器间回环访问。很多云主机不会把公网 IP 绑定到容器可达网卡，容器回打公网地址会超时。

## 多机部署

### 推荐拓扑

- 公网：只暴露 `web`
- 内网：`api`、`compiler`、`preview`、`realtime`、`db`
- 浏览器：统一访问 `web`
- `web`：代理 `/api`、`/preview`、`/realtime`

这也是当前最稳妥的部署方式。`preview` 不适合直接裸暴露为公网服务。

### 环境变量

每台机器复制同一份 `.env.distributed.example` 为 `.env`，并填入真实内网 IP：

```bash
cp .env.distributed.example .env
```

关键约束：

- 所有机器上的 `DB_*`、`REALTIME_SECRET`、`PREVIEW_SECRET` 必须保持一致
- `*_HOST` 填服务所在机器的内网 IP
- `*_PUBLISH_PORT` 表示发布到宿主机的端口
- `*_URL` 优先级最高；不填时才按 `*_SCHEME + *_HOST + *_PORT` 组装

### 分角色启动

在数据库机器：

```bash
docker compose --env-file .env -f compose.distributed.yaml --profile db up -d --build db
```

在编译服务机器：

```bash
docker compose --env-file .env -f compose.distributed.yaml --profile compiler up -d --build compiler
```

在 API 机器：

```bash
docker compose --env-file .env -f compose.distributed.yaml --profile api up -d --build api
```

在 Preview 机器：

```bash
docker compose --env-file .env -f compose.distributed.yaml --profile preview up -d --build preview
```

在 Realtime 机器：

```bash
docker compose --env-file .env -f compose.distributed.yaml --profile realtime up -d --build realtime
```

在 Web 机器：

```bash
docker compose --env-file .env -f compose.distributed.yaml --profile web up -d --build web
```

### 浏览器访问模式

#### 模式 A：浏览器只访问 Web

推荐优先使用这一模式。浏览器不直接连接 API、preview、realtime，而是由 Web 代理：

```env
VITE_API_HOST=
VITE_PREVIEW_HOST=
VITE_REALTIME_HOST=
API_PROXY_HOST=10.0.0.10
PREVIEW_PROXY_HOST=10.0.0.12
REALTIME_PROXY_HOST=10.0.0.13
```

#### 模式 B：浏览器直连各服务

如果已经有统一网关，或者你明确要让浏览器直接连后端服务，则填写：

```env
VITE_API_SCHEME=http
VITE_API_HOST=10.0.0.10
VITE_API_PORT=8000
VITE_PREVIEW_SCHEME=http
VITE_PREVIEW_HOST=10.0.0.12
VITE_PREVIEW_PORT=8002
VITE_REALTIME_SCHEME=ws
VITE_REALTIME_HOST=10.0.0.13
VITE_REALTIME_PORT=8003
```

## 分片与路由

### Preview 分片

如果有多个 preview 节点，配置：

```env
PREVIEW_BROWSER_URLS=http://10.0.0.12:8002,http://10.0.0.16:8002
PREVIEW_INTERNAL_URLS=http://10.0.0.12:8002,http://10.0.0.16:8002
```

规则：

- 两组列表必须一一对应
- 顺序必须稳定
- 同一个 `project_id` 必须稳定命中同一节点
- `PREVIEW_BROWSER_URLS` 必须是浏览器可访问地址；如果浏览器只访问 `web`，这里也可以填 `web` 可代理到的地址

如果 `web` 需要代理多个 preview shard，可配置：

```env
PREVIEW_PROXY_TARGETS=http://10.0.0.12:8002,http://10.0.0.16:8002
```

当前 `web` 会按 `/preview/sessions/{project_id}/...` 中的 `project_id` 稳定选 shard。

### Realtime 分片

如果有多个 realtime 节点，配置：

```env
REALTIME_BROWSER_URLS=ws://10.0.0.13:8003,ws://10.0.0.14:8003
REALTIME_INTERNAL_URLS=http://10.0.0.13:8003,http://10.0.0.14:8003
```

规则：

- 两组列表必须一一对应
- 顺序必须稳定
- 同一个 `fileId` 必须稳定命中同一节点

如果 `web` 需要代理多个 realtime shard，可配置：

```env
REALTIME_PROXY_TARGETS=ws://10.0.0.13:8003,ws://10.0.0.14:8003
```

当前 `web` 会按请求里的 `fileId` 稳定选 shard。

## 当前扩容边界

- `api` 可以多实例，只要共用同一个 DB
- `compiler` 无状态，适合放到负载均衡后面
- `realtime` 已支持按文件稳定分片，但不是任意节点都能接同一个文件
- `preview` 已支持按项目稳定分片，并且同一项目同一入口共享一个 Tinymist session
- `preview` session 仍在实例内存中，因此同一个 `project_id` 不能跨节点迁移
- shard 列表目前仍然通过静态环境变量配置，不是自动服务发现
- `web` 当前仍是 Vite 入口，更适合现阶段验证，不是最终生产级统一网关

## 日志与排查

### 单机

查看所有服务日志：

```bash
docker compose -f compose.yaml -f compose.dev.yaml logs -f
```

查看特定服务：

```bash
docker compose -f compose.yaml -f compose.dev.yaml logs -f api
docker compose -f compose.yaml -f compose.dev.yaml logs -f preview
docker compose -f compose.yaml -f compose.dev.yaml logs -f realtime
```

### 多机

在对应机器查看对应 profile：

```bash
docker compose --env-file .env -f compose.distributed.yaml ps
docker compose --env-file .env -f compose.distributed.yaml logs -f api
docker compose --env-file .env -f compose.distributed.yaml logs -f preview
docker compose --env-file .env -f compose.distributed.yaml logs -f realtime
```

### 常见问题

#### 浏览器访问慢或卡在 Loading session

- 先检查浏览器最终访问的是 `web`、还是直连 `preview`
- 检查 `VITE_*` 和 `*_PROXY_*` 是否混用了错误地址
- 如果是单机模拟多机，优先用固定容器 IP，不要用宿主机公网 IP 回环

#### Preview 一直重试

- 检查 `PREVIEW_INTERNAL_URL` 或 `PREVIEW_INTERNAL_HOST` 是否能从 API 机器访问
- 检查 `PREVIEW_SECRET` 是否和 API 配置一致
- 检查 `PREVIEW_BROWSER_URLS` 与 `PREVIEW_INTERNAL_URLS` 顺序是否一致

#### 协同连接不上

- 检查 `REALTIME_SECRET` 是否一致
- 检查 `REALTIME_BROWSER_URLS` 与 `REALTIME_INTERNAL_URLS` 是否一一对应
- 检查 WebSocket 代理是否允许升级连接

#### 数据恢复预期不一致

- `storage/projects` 只是缓存，不应再把它当作权威存储排查
- 需要优先检查数据库中的项目快照、上传产物和 PDF 记录

## 智能换源

仓库根目录的 `./compose-smart.sh` 会按宿主机环境自动切换镜像源：

- `DOCKER_SOURCE_MODE=auto`
- `DOCKER_SOURCE_MODE=cn`
- `DOCKER_SOURCE_MODE=global`

常用命令：

```bash
./compose-smart.sh --print-env
DOCKER_SOURCE_MODE=cn ./compose-smart.sh -f compose.yaml -f compose.dev.yaml up -d --build
DOCKER_SOURCE_MODE=global ./compose-smart.sh -f compose.yaml -f compose.dev.yaml up -d --build
```
