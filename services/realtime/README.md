# Realtime Service

这个目录先提供实时协作服务的部署骨架和接口边界，当前阶段还不承载真正的多人同步。

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

## 当前状态

当前 `server.js` 只是占位服务：

- `/health` 可用
- `/collaboration` 会建立连接后返回 placeholder 消息并主动关闭

下一阶段再把它替换成真正的 Yjs/WebSocket 房间服务。
