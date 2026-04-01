# 数据库模型设计

## 1. 目标

本文档定义 Typst 协作写作平台第一阶段的数据模型，用于支撑以下能力：

- 用户与登录
- 工作区与团队成员管理
- 项目归属与项目成员权限
- 文件编辑
- 选区评论
- 修订历史
- 审计日志

当前设计目标是“支持逐步实现”，因此会优先保证：

- 可以兼容当前已有 `projects/files/tags` 能力
- 可以逐步把现有项目系统迁移到工作区模型
- 可以在后续继续扩展到实时协作

## 2. 设计原则

- 元数据以 PostgreSQL 为权威来源
- 文件系统只作为编译和预览工作目录，不作为权限和协作的唯一来源
- 工作区是组织容器，项目是具体协作容器
- 权限控制分为工作区级和项目级
- 评论必须与具体文件和选区锚点绑定
- 修订记录必须是不可变快照

## 3. 实体总览

### 身份与组织

- `users`
- `workspaces`
- `workspace_members`
- `workspace_invites`

### 项目与文件

- `projects`
- `project_members`
- `files`
- `tags`
- `project_tags`

### 修订与评论

- `revisions`
- `revision_entries`
- `comment_threads`
- `comments`

### 审计

- `activity_logs`

## 4. 表结构说明

## 4.1 users

用于存储平台用户。

核心字段：

- `id`
- `email`
- `password_hash`
- `display_name`
- `is_active`
- `created_at`
- `updated_at`

约束：

- `email` 全局唯一

说明：

- 第一阶段先用邮箱密码登录
- 后续如接入 OAuth / SSO，可在该表基础上扩展认证提供方表

## 4.2 workspaces

用于表示团队协作空间。

核心字段：

- `id`
- `name`
- `slug`
- `description`
- `owner_id`
- `created_at`
- `updated_at`

约束：

- `slug` 唯一

说明：

- 工作区是成员、项目、团队设置的归属层
- `owner_id` 指向工作区创建者或当前所有者

## 4.3 workspace_members

用于记录用户和工作区之间的成员关系。

核心字段：

- `id`
- `workspace_id`
- `user_id`
- `role`
- `status`
- `invited_by_id`
- `joined_at`
- `created_at`
- `updated_at`

约束：

- `(workspace_id, user_id)` 唯一

角色建议：

- `owner`
- `admin`
- `member`
- `viewer`

状态建议：

- `invited`
- `active`
- `suspended`

## 4.4 workspace_invites

用于记录工作区邀请流程。

核心字段：

- `id`
- `workspace_id`
- `email`
- `token`
- `role`
- `status`
- `invited_by_id`
- `expires_at`
- `accepted_at`
- `created_at`
- `updated_at`

状态建议：

- `pending`
- `accepted`
- `revoked`
- `expired`

说明：

- 第一阶段邀请通过邮件地址和 token 驱动即可
- 后续可扩展邀请链接和批量邀请

## 4.5 projects

用于表示某个具体文档协作项目。

核心字段：

- `id`
- `workspace_id`
- `created_by_id`
- `name`
- `description`
- `status`
- `created_at`
- `updated_at`

状态建议：

- `active`
- `archived`
- `trashed`

说明：

- 项目必须归属于工作区
- 现阶段为兼容旧数据，`workspace_id` 可以先允许为空，后续迁移后再收紧

## 4.6 project_members

用于记录项目级成员关系和角色。

核心字段：

- `id`
- `project_id`
- `user_id`
- `role`
- `status`
- `invited_by_id`
- `joined_at`
- `created_at`
- `updated_at`

约束：

- `(project_id, user_id)` 唯一

角色建议：

- `maintainer`
- `editor`
- `commenter`
- `viewer`

说明：

- 工作区成员不代表自动拥有项目编辑权限
- 项目级角色用于控制编辑、评论、导出等操作

## 4.7 files

用于存储项目内的文件与目录元数据，以及文本文件内容。

当前沿用现有表结构：

- `id`
- `project_id`
- `name`
- `path`
- `kind`
- `is_binary`
- `content`
- `created_at`
- `updated_at`

说明：

- 当前实现下文本文件内容仍放在 `content`
- 二进制文件由工作目录或外部存储承载
- 后续如引入对象存储，可扩展 `storage_key` 等字段

## 4.8 tags / project_tags

用于项目标签管理。

说明：

- 保留现有设计
- 属于辅助组织能力，不影响协作主链路

## 4.9 revisions

用于记录项目修订的检查点。

核心字段：

- `id`
- `project_id`
- `created_by_id`
- `kind`
- `label`
- `description`
- `created_at`

修订类型建议：

- `manual`
- `autosave`
- `rollback`

说明：

- 一次修订对应一个逻辑检查点
- 修订本身不直接存储所有文件内容，具体文件快照放在 `revision_entries`

## 4.10 revision_entries

用于记录某次修订中涉及到的文件快照。

核心字段：

- `id`
- `revision_id`
- `path`
- `name`
- `kind`
- `is_binary`
- `content`
- `created_at`

约束：

- `(revision_id, path)` 唯一

说明：

- 第一阶段以“文本快照”方式存储修订内容
- 后续可优化为增量存储或对象存储快照

## 4.11 comment_threads

用于表示一条评论线程。线程必须绑定到具体文件及选区锚点，而不是聊天室消息。

核心字段：

- `id`
- `project_id`
- `file_id`
- `created_by_id`
- `resolved_by_id`
- `status`
- `path`
- `anchor_start`
- `anchor_end`
- `selected_text`
- `quote_text`
- `context_before`
- `context_after`
- `start_line`
- `start_column`
- `end_line`
- `end_column`
- `created_at`
- `updated_at`
- `resolved_at`

状态建议：

- `open`
- `resolved`

设计说明：

- `path`：评论发生时对应的文件路径快照
- `anchor_start / anchor_end`：评论锚定的字符区间
- `selected_text`：当时选中的原始文本
- `quote_text`：可用于评论展示的引用文本
- `context_before / context_after`：用于文本变化后重新定位上下文
- `line/column`：便于前端和预览侧定位

这一层的核心原则是：

- 评论是“挂在文本上的”
- 评论不是“项目聊天室里的自由消息”

## 4.12 comments

用于记录评论线程中的消息。

核心字段：

- `id`
- `thread_id`
- `author_id`
- `body`
- `created_at`
- `updated_at`

说明：

- 一条线程下可以有多条评论消息
- 第一条消息通常是发起评论时写入

## 4.13 activity_logs

用于记录重要操作的审计日志。

核心字段：

- `id`
- `workspace_id`
- `project_id`
- `actor_id`
- `action`
- `target_type`
- `target_id`
- `summary`
- `metadata_json`
- `created_at`

说明：

- `metadata_json` 先用文本存储 JSON
- 后续可换成 PostgreSQL `JSONB`

建议记录的动作包括：

- 创建/删除/归档项目
- 邀请成员、加入工作区、移除成员、角色变更
- 创建/删除/重命名文件
- 创建修订、执行回滚
- 发起导出

## 5. 核心关系

主要关系如下：

- 一个 `user` 可以拥有多个 `workspace`
- 一个 `workspace` 有多个 `workspace_member`
- 一个 `workspace` 有多个 `project`
- 一个 `project` 有多个 `project_member`
- 一个 `project` 有多个 `file`
- 一个 `project` 有多个 `revision`
- 一个 `revision` 有多个 `revision_entry`
- 一个 `project` 有多个 `comment_thread`
- 一个 `comment_thread` 有多个 `comment`

## 6. 权限映射建议

### 工作区级

- `owner`：工作区完全控制
- `admin`：工作区日常管理
- `member`：可参与工作区内被授权的项目
- `viewer`：只读访问

### 项目级

- `maintainer`：管理项目成员与设置
- `editor`：编辑文件、创建修订、导出
- `commenter`：发表评论与回复
- `viewer`：只读查看

## 7. 第一阶段兼容策略

为了兼容当前已有系统，建议采用以下策略：

- 保留现有 `projects/files/tags/project_tags` 表
- 给 `projects` 增加 `workspace_id`、`created_by_id`、`description`
- 新表通过 `Base.metadata.create_all` 创建
- 旧项目先允许 `workspace_id` 为空
- 在后续迁移脚本中补默认工作区并回填旧项目归属

## 8. 后续演进建议

后续可以继续扩展这些方向：

- `presence_sessions`：在线状态和活跃文件状态
- `document_locks`：文件级软锁
- `deployment_targets`：文档发布与部署目标
- `export_jobs`：异步导出任务
- `api_tokens`：自动化访问
- `auth_identities`：第三方认证绑定

## 9. 当前代码映射

当前已在 `apps/api/models.py` 中加入的核心模型包括：

- `User`
- `Workspace`
- `WorkspaceMember`
- `WorkspaceInvite`
- `Project`
- `ProjectMember`
- `File`
- `Revision`
- `RevisionEntry`
- `CommentThread`
- `Comment`
- `ActivityLog`

这一步是“先把领域模型落地”，还没有完成完整接口实现。
