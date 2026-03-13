# Typst Editor

一个基于 Docker Compose 的 Typst 在线编辑器。当前结构已经按模块拆开，目标是让新机器在 `clone` 后直接构建运行，并为后续分布式部署保留清晰边界。

## 快速启动

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

如果已经构建完成，需要用新镜像重建并重启服务：

```bash
./compose-smart.sh -f compose.yaml -f compose.dev.yaml up -d --force-recreate
```

3. 访问服务

- Web: `http://localhost:3000`
- API: `http://localhost:8000`
- API Docs: `http://localhost:8000/docs`

## 模块划分

### 基础服务

- `apps/web`: React/Vite 前端
- `apps/api`: FastAPI 接口层
- `services/compiler`: Typst 编译服务
- `storage/projects`: 项目工作目录和生成文件

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

`.env.example` 里已经提供了这些入口：

- `TYPST_VERSION`: compiler 容器使用的 Typst 版本
- `VITE_API_URL`: 前端显式 API 地址
- `CORS_ALLOW_ORIGINS`: API 允许的来源
- `COMPILER_URL`: API 调用编译服务的地址
- `COMPILER_TIMEOUT_SECONDS`: 编译超时
- `WORKSPACE_DIR`: API 的工作目录

本地不填 `VITE_API_URL` 也能工作，前端会自动按当前访问主机推导 API 地址。

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
