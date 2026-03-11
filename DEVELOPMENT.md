# Typst 在线编辑器 - 开发进度

## 项目概述
基于 Docker Compose 的 Typst 在线编辑器，支持项目管理、文件编辑、实时编译和 PDF 预览。

## 技术栈
- **前端**: React (Vite)
- **后端**: FastAPI + SQLAlchemy
- **数据库**: PostgreSQL 16
- **编译服务**: Typst 0.14.2 + Python HTTP Server
- **容器化**: Docker Compose

## 已完成功能

### Phase 1: 基础架构 ✅
- [x] PostgreSQL 数据库配置
- [x] 项目和文件数据模型
- [x] REST API 端点
  - 项目 CRUD
  - 文件 CRUD
  - 文件内容读写
- [x] React 前端界面
  - 项目列表
  - 文件树侧边栏
  - 代码编辑器

### Phase 2: 编译服务 ✅
- [x] 独立编译服务容器
- [x] HTTP 接口 (端口 8001)
- [x] Typst CLI 集成
- [x] 共享卷挂载 (`./storage/projects`)
- [x] 编译结果返回

### Phase 3: PDF 预览 ✅
- [x] 三栏布局 (文件树 | 编辑器 | 预览)
- [x] PDF 实时预览
- [x] PDF 下载功能
- [x] 编译状态提示

### Phase 4: 字体支持 ✅
- [x] 中文字体 (Noto Sans/Serif CJK)
- [x] 英文字体 (Liberation 系列)
- [x] fontconfig 配置
- [x] 字体缓存构建

## 版本兼容性

### Typst 版本选择
- **当前版本**: v0.14.2
- **原因**: 与本地开发环境保持一致，减少本地/容器编译差异
- **决策**: 优先保证容器与开发机的 Typst 行为一致
- **配置入口**: `.env` / `compose.yaml` 中的 `TYPST_VERSION`

## 架构设计

### 服务通信
```
Web (3000) <-> API (8000) <-> Compiler (8001)
                  |
                  v
              PostgreSQL (5432)
```

### 数据流
1. 用户编辑文件 → API 保存到数据库和磁盘
2. 用户点击编译 → API 调用 Compiler HTTP 接口
3. Compiler 执行 `typst compile` → 生成 PDF
4. API 返回 PDF 路径 → 前端显示预览

## 已解决问题

### 1. Typst 安装脚本 404
- **问题**: 社区安装脚本失效
- **解决**: 直接从 GitHub Releases 下载二进制

### 2. 字体持久化失败
- **问题**: `apt-get autoremove` 删除了字体包
- **解决**: 分离字体安装和工具清理步骤

### 3. Typst 无法识别系统字体
- **问题**: 字体文件存在但 Typst 看不到
- **解决**: 安装 fontconfig 并运行 `fc-cache -fv`

### 4. 容器未使用新镜像
- **问题**: `docker compose restart` 不会更新镜像
- **解决**: 使用 `docker compose up -d` 重新创建容器

## 目录结构
```
typst-editor/
├── apps/
│   ├── api/          # FastAPI 后端
│   └── web/          # React 前端
├── services/
│   └── compiler/     # Typst 编译服务
├── storage/
│   └── projects/     # 项目文件存储
├── compose.yaml      # Docker Compose 配置
└── .env             # 环境变量
```

## 下一步计划
- [ ] 多文件项目支持
- [ ] 语法高亮
- [ ] 错误提示优化
- [ ] 用户认证
- [ ] 协作编辑
