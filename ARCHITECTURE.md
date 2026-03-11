# Architecture

## 当前边界

### `web`
- 负责项目列表、编辑器界面、PDF 预览。
- 通过 `src/services/projects.js` 调用 API。
- 预览不再依赖浏览器原生 PDF 查看器，而是由 `PdfPreview` 自渲染，方便后续独立演进。

### `api`
- 负责项目、文件、编译触发、PDF 分发。
- 不直接承担编译逻辑，只通过 `COMPILER_URL` 调用编译服务。
- 所有部署相关配置集中在 `settings.py`。

### `compiler`
- 负责执行 `typst compile`。
- 目前通过共享工作目录读取 `.typ` 并输出 `.pdf`。
- 后续如果拆成独立节点，只需要保证 API 和 compiler 能共享对象存储或文件卷语义。

## 当前请求链路

1. Web 调用 API 保存文件内容
2. API 将内容写入工作目录
3. Web 调用 API 触发编译
4. API 调用 compiler 服务
5. compiler 生成 PDF
6. Web 通过 API 读取 PDF 预览或下载

## 后续分布式演进建议

### 第一阶段
- 保持 Web / API / Compiler 三个边界不变
- 通过环境变量切换服务地址
- 用反向代理统一入口

### 第二阶段
- 把 `storage/projects` 从本地目录换成共享卷或对象存储
- API 只存元数据和任务状态
- Compiler 按任务拉取源文件并上传产物

### 第三阶段
- API 异步化编译请求
- 增加任务队列和状态查询接口
- Web 轮询或订阅编译结果
