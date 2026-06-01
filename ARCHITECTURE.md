# Architecture

## 当前边界

### `web`
- 负责项目列表、编辑器界面、Tinymist 预览入口。
- 通过 `src/services/projects.js` 调用 API、Preview 和 Realtime。

### `api`
- 负责项目、文件、编译触发、PDF 分发和内部项目快照。
- 不直接承担编译或预览逻辑，只通过快照协议服务 compiler / preview。
- 当前仍是项目文件的权威存储边界，所有部署相关配置集中在 `settings.py`。

### `compiler`
- 负责执行 `typst compile`。
- 当前由 API 发送项目快照，compiler 在临时目录编译后把 PDF 返回给 API。
- 这一层已经不依赖共享工作目录，后续可以单独扩缩容或替换为队列 worker。

### `preview`
- 负责 Tinymist preview 会话、预览代理、光标同步和 outline/diagnostics。
- 当前通过内部密钥向 API 按 revision 条件拉项目快照，在本地临时目录启动 tinymist。
- 这一层已经不依赖共享工作目录，可以和 API 分开部署。

### `realtime`
- 负责 Yjs 协同房间、连接广播和内容 flush。
- 当前通过内部密钥解析文件房间并把内容和 Yjs state flush 回 API。

## 当前请求链路

1. Web 连接 realtime 编辑文件，或调用 API 做文件管理
2. realtime 将文本和 Yjs state flush 回 API
3. Web 请求 preview session/status/data
4. preview 通过内部接口向 API 拉项目快照
5. preview 在临时目录启动 tinymist 并代理预览数据
6. Web 导出 PDF 时调用 API
7. API 打包项目快照并调用 compiler
8. compiler 在临时目录生成 PDF 并回传给 API
9. API 将 PDF 写回工作目录并分发下载

## 后续分布式演进建议

### 第一阶段
- Web / API / Compiler / Preview / Realtime 已经形成独立服务边界
- Compiler 和 Preview 都通过 API 快照协议工作，不需要项目共享卷
- 通过环境变量切换服务地址，用反向代理统一入口

### 第二阶段
- 把 API 侧 `storage/projects` 从本地目录换成对象存储或共享存储适配层
- API 保持元数据和快照出口，二进制文件从存储层读取
- 继续把 API 侧快照读取接入存储适配层，减少对本地 `storage/projects` 的直接依赖

### 第三阶段
- API 异步化编译请求
- 增加任务队列和状态查询接口
- Web 轮询或订阅编译结果
