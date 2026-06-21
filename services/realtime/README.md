# Realtime Service

这个目录承载文件级实时协作服务，当前阶段已经支持同一文件的多人文本同步和落盘 flush。

## 目标边界

- WebSocket 路径：`/collaboration`
- 房间粒度：`project:{project_id}:file:{file_id}`
- 鉴权来源：现有 Bearer token
- API 负责权限判断与文件元数据
- realtime 负责房间、awareness、Yjs 状态和 flush 调度

## 本阶段约定的接口

### 客户端会话入口

- `GET /files/{file_id}/realtime-session`
  - 由 API 返回 `room_key`、`realtime_url`、当前用户信息和编辑权限

### realtime 内部解析

- `POST /internal/realtime/resolve-file-room`
  - Header:
    - `Authorization: Bearer <token>`
    - `X-Realtime-Secret: <secret>`
  - 用于在 WebSocket 握手阶段解析文件房间和权限

### realtime 内部 flush

- `POST /internal/realtime/flush-file`
  - Header:
    - `X-Realtime-Secret: <secret>`
  - Body:
    - `file_id`
    - `content`
    - `updated_by_id`
  - 用于把共享文档最新内容落回数据库和工作目录

### realtime 内部房间重置

- `POST /internal/realtime/reset-room`
  - Header:
    - `X-Realtime-Secret: <secret>`
  - Body:
    - `file_id`
  - 用于版本恢复后关闭并销毁指定文件的内存房间，客户端会重新连接并从数据库内容初始化

## 当前状态

当前 `server.js` 已经实现：

- 基于 Yjs sync protocol 的房间同步
- 文件级 room：`project:{project_id}:file:{file_id}`
- 握手阶段通过 API 解析 `file_id + Bearer token`
- 文档变更后的 debounce flush
- 房间无人时的 disconnect flush 和空闲清理
- 版本恢复后的房间 reset，避免旧 Yjs 状态覆盖恢复内容

当前还没有实现：

- 持久化的 Yjs update 日志
- 修订历史
- presence UI
- 评论和远端光标渲染
