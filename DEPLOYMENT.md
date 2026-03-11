# Typst 在线编辑器 - 部署说明

## 环境要求
- Docker 20.10+
- Docker Compose 2.0+
- 至少 2GB 可用内存
- 至少 5GB 可用磁盘空间

## 快速开始

### 1. 配置环境变量
创建 `.env` 文件：
```bash
DB_USER=typst
DB_PASSWORD=your_secure_password
DB_NAME=typst_editor
```

### 2. 启动服务
```bash
docker compose up -d
```

### 3. 访问应用
- 前端: http://localhost:3000
- API: http://localhost:8000
- API 文档: http://localhost:8000/docs

## 服务说明

### Web 服务 (端口 3000)
React 前端应用，提供编辑器界面。

### API 服务 (端口 8000)
FastAPI 后端，处理项目和文件管理。

**环境变量**:
- `DB_HOST`: 数据库主机 (默认: db)
- `DB_PORT`: 数据库端口 (默认: 5432)
- `DB_USER`: 数据库用户
- `DB_PASSWORD`: 数据库密码
- `DB_NAME`: 数据库名称

### Compiler 服务 (内部端口 8001)
Typst 编译服务，不对外暴露。

**已安装字体**:
- Noto Sans CJK (中文)
- Noto Serif CJK (中文衬线)
- Liberation Sans/Serif (英文)

### Database 服务 (端口 5432)
PostgreSQL 16 数据库。

## 数据持久化

### 数据库数据
存储在 Docker volume `db-data` 中。

### 项目文件
存储在 `./storage/projects/` 目录中。

**目录结构**:
```
storage/projects/
└── {project_id}/
    ├── main.typ
    ├── main.pdf
    └── ...
```

## 常用命令

### 查看日志
```bash
# 所有服务
docker compose logs -f

# 特定服务
docker compose logs -f api
docker compose logs -f compiler
```

### 重启服务
```bash
# 重启所有服务
docker compose restart

# 重启特定服务
docker compose restart compiler
```

### 停止服务
```bash
docker compose down
```

### 重建服务
```bash
# 重建并启动
docker compose up -d --build

# 重建特定服务
docker compose build compiler
docker compose up -d compiler
```

### 清理数据
```bash
# 停止并删除容器、网络
docker compose down

# 同时删除数据卷（警告：会删除所有数据）
docker compose down -v
```

## 使用 Typst

### 字体设置
在 `.typ` 文件开头添加：
```typst
#set text(font: ("Liberation Sans", "Noto Sans CJK SC"))
```

### 可用字体列表
- Liberation Sans/Serif/Mono
- Noto Sans CJK SC/TC/HK/JP/KR
- Noto Serif CJK SC/TC/HK/JP/KR
- Noto Sans Mono CJK SC/TC/HK/JP/KR

## 故障排查

### 编译失败
1. 检查 compiler 服务日志: `docker compose logs compiler`
2. 验证字体安装: `docker exec typst-editor-compiler-1 typst fonts`
3. 检查文件是否正确保存到 `storage/projects/{project_id}/`

### 数据库连接失败
1. 检查 `.env` 文件配置
2. 确认数据库服务运行: `docker compose ps db`
3. 查看 API 日志: `docker compose logs api`

### 前端无法访问 API
1. 检查 API 服务状态: `docker compose ps api`
2. 验证 CORS 配置
3. 检查浏览器控制台错误

### 容器无法启动
```bash
# 查看容器状态
docker compose ps

# 查看详细错误
docker compose logs

# 重建镜像
docker compose build --no-cache
docker compose up -d
```

## 性能优化

### 编译超时
编译服务默认超时 10 秒，可在 `apps/api/main.py` 中调整：
```python
res = requests.post('http://compiler:8001', json={'project_id': project_id}, timeout=30)
```

### 数据库连接池
默认配置适用于小规模使用，生产环境建议调整 `apps/api/database.py`。

## 安全建议
- 修改默认数据库密码
- 生产环境使用反向代理 (Nginx)
- 启用 HTTPS
- 限制 API 访问速率
- 定期备份数据库和项目文件

## 备份与恢复

### 备份数据库
```bash
docker exec typst-editor-db-1 pg_dump -U typst typst_editor > backup.sql
```

### 恢复数据库
```bash
cat backup.sql | docker exec -i typst-editor-db-1 psql -U typst typst_editor
```

### 备份项目文件
```bash
tar -czf projects-backup.tar.gz storage/projects/
```
