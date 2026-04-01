from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Table,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from database import Base

WORKSPACE_ROLES = ("owner", "admin", "member", "viewer")
PROJECT_ROLES = ("maintainer", "editor", "commenter", "viewer")
MEMBERSHIP_STATUSES = ("invited", "active", "suspended")
INVITE_STATUSES = ("pending", "accepted", "revoked", "expired")
PROJECT_STATUSES = ("active", "archived", "trashed")
REVISION_KINDS = ("manual", "autosave", "rollback")
COMMENT_THREAD_STATUSES = ("open", "resolved")

project_tags = Table(
    "project_tags",
    Base.metadata,
    Column("project_id", Integer, ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", Integer, ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), nullable=False, unique=True, index=True)
    password_hash = Column(String(255), nullable=False)
    display_name = Column(String(255), nullable=False)
    is_active = Column(Boolean, nullable=False, default=True)
    is_root = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    owned_workspaces = relationship(
        "Workspace",
        back_populates="owner",
        foreign_keys="Workspace.owner_id",
    )
    workspace_memberships = relationship(
        "WorkspaceMember",
        back_populates="user",
        foreign_keys="WorkspaceMember.user_id",
    )
    sent_workspace_invites = relationship(
        "WorkspaceInvite",
        back_populates="invited_by",
        foreign_keys="WorkspaceInvite.invited_by_id",
    )
    created_projects = relationship(
        "Project",
        back_populates="created_by",
        foreign_keys="Project.created_by_id",
    )
    project_memberships = relationship(
        "ProjectMember",
        back_populates="user",
        foreign_keys="ProjectMember.user_id",
    )
    created_revisions = relationship(
        "Revision",
        back_populates="created_by",
        foreign_keys="Revision.created_by_id",
    )
    created_comment_threads = relationship(
        "CommentThread",
        back_populates="created_by",
        foreign_keys="CommentThread.created_by_id",
    )
    resolved_comment_threads = relationship(
        "CommentThread",
        back_populates="resolved_by",
        foreign_keys="CommentThread.resolved_by_id",
    )
    comments = relationship(
        "Comment",
        back_populates="author",
        foreign_keys="Comment.author_id",
    )
    activity_logs = relationship(
        "ActivityLog",
        back_populates="actor",
        foreign_keys="ActivityLog.actor_id",
    )
    sessions = relationship(
        "UserSession",
        back_populates="user",
        foreign_keys="UserSession.user_id",
        cascade="all, delete-orphan",
    )


class Workspace(Base):
    __tablename__ = "workspaces"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    slug = Column(String(128), nullable=False, unique=True, index=True)
    description = Column(Text, nullable=False, default="")
    owner_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    owner = relationship(
        "User",
        back_populates="owned_workspaces",
        foreign_keys=[owner_id],
    )
    members = relationship("WorkspaceMember", back_populates="workspace", cascade="all, delete-orphan")
    invites = relationship("WorkspaceInvite", back_populates="workspace", cascade="all, delete-orphan")
    projects = relationship("Project", back_populates="workspace")
    activity_logs = relationship("ActivityLog", back_populates="workspace")


class WorkspaceMember(Base):
    __tablename__ = "workspace_members"
    __table_args__ = (
        UniqueConstraint("workspace_id", "user_id", name="uq_workspace_members_workspace_user"),
    )

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    role = Column(String(32), nullable=False, default="member")
    status = Column(String(32), nullable=False, default="active")
    invited_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    joined_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    workspace = relationship("Workspace", back_populates="members")
    user = relationship("User", back_populates="workspace_memberships", foreign_keys=[user_id])
    invited_by = relationship("User", foreign_keys=[invited_by_id])


class WorkspaceInvite(Base):
    __tablename__ = "workspace_invites"
    __table_args__ = (
        UniqueConstraint("workspace_id", "email", "status", name="uq_workspace_invites_workspace_email_status"),
    )

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    email = Column(String(255), nullable=False)
    token = Column(String(255), nullable=False, unique=True, index=True)
    role = Column(String(32), nullable=False, default="member")
    status = Column(String(32), nullable=False, default="pending")
    invited_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    expires_at = Column(DateTime, nullable=True)
    accepted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    workspace = relationship("Workspace", back_populates="invites")
    invited_by = relationship("User", back_populates="sent_workspace_invites", foreign_keys=[invited_by_id])


class UserSession(Base):
    __tablename__ = "user_sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash = Column(String(255), nullable=False, unique=True, index=True)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    last_used_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    user = relationship("User", back_populates="sessions", foreign_keys=[user_id])


class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id", ondelete="SET NULL"), nullable=True, index=True)
    created_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=False, default="")
    status = Column(String(32), nullable=False, default="active")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    workspace = relationship("Workspace", back_populates="projects")
    created_by = relationship("User", back_populates="created_projects", foreign_keys=[created_by_id])
    files = relationship("File", back_populates="project", cascade="all, delete-orphan")
    tags = relationship("Tag", secondary=project_tags, back_populates="projects")
    members = relationship("ProjectMember", back_populates="project", cascade="all, delete-orphan")
    revisions = relationship("Revision", back_populates="project", cascade="all, delete-orphan")
    comment_threads = relationship("CommentThread", back_populates="project", cascade="all, delete-orphan")
    activity_logs = relationship("ActivityLog", back_populates="project", cascade="all, delete-orphan")


class ProjectMember(Base):
    __tablename__ = "project_members"
    __table_args__ = (
        UniqueConstraint("project_id", "user_id", name="uq_project_members_project_user"),
    )

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    role = Column(String(32), nullable=False, default="editor")
    status = Column(String(32), nullable=False, default="active")
    invited_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    joined_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    project = relationship("Project", back_populates="members")
    user = relationship("User", back_populates="project_memberships", foreign_keys=[user_id])
    invited_by = relationship("User", foreign_keys=[invited_by_id])


class Tag(Base):
    __tablename__ = "tags"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(64), nullable=False, unique=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    projects = relationship("Project", secondary=project_tags, back_populates="tags")


class File(Base):
    __tablename__ = "files"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    path = Column(String(1024), nullable=False)
    kind = Column(String(16), nullable=False, default="file")
    is_binary = Column(Boolean, nullable=False, default=False)
    content = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    project = relationship("Project", back_populates="files")
    comment_threads = relationship("CommentThread", back_populates="file")


class Revision(Base):
    __tablename__ = "revisions"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    created_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    kind = Column(String(32), nullable=False, default="manual")
    label = Column(String(255), nullable=False, default="")
    description = Column(Text, nullable=False, default="")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    project = relationship("Project", back_populates="revisions")
    created_by = relationship("User", back_populates="created_revisions", foreign_keys=[created_by_id])
    entries = relationship("RevisionEntry", back_populates="revision", cascade="all, delete-orphan")


class RevisionEntry(Base):
    __tablename__ = "revision_entries"
    __table_args__ = (
        UniqueConstraint("revision_id", "path", name="uq_revision_entries_revision_path"),
    )

    id = Column(Integer, primary_key=True, index=True)
    revision_id = Column(Integer, ForeignKey("revisions.id", ondelete="CASCADE"), nullable=False, index=True)
    path = Column(String(1024), nullable=False)
    name = Column(String(255), nullable=False)
    kind = Column(String(16), nullable=False, default="file")
    is_binary = Column(Boolean, nullable=False, default=False)
    content = Column(Text, nullable=False, default="")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    revision = relationship("Revision", back_populates="entries")


class CommentThread(Base):
    __tablename__ = "comment_threads"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    file_id = Column(Integer, ForeignKey("files.id", ondelete="SET NULL"), nullable=True)
    created_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    resolved_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    status = Column(String(32), nullable=False, default="open")
    path = Column(String(1024), nullable=False)
    anchor_start = Column(Integer, nullable=False)
    anchor_end = Column(Integer, nullable=False)
    selected_text = Column(Text, nullable=False, default="")
    quote_text = Column(Text, nullable=False, default="")
    context_before = Column(Text, nullable=False, default="")
    context_after = Column(Text, nullable=False, default="")
    start_line = Column(Integer, nullable=True)
    start_column = Column(Integer, nullable=True)
    end_line = Column(Integer, nullable=True)
    end_column = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    resolved_at = Column(DateTime, nullable=True)

    project = relationship("Project", back_populates="comment_threads")
    file = relationship("File", back_populates="comment_threads")
    created_by = relationship("User", back_populates="created_comment_threads", foreign_keys=[created_by_id])
    resolved_by = relationship("User", back_populates="resolved_comment_threads", foreign_keys=[resolved_by_id])
    comments = relationship("Comment", back_populates="thread", cascade="all, delete-orphan")


class Comment(Base):
    __tablename__ = "comments"

    id = Column(Integer, primary_key=True, index=True)
    thread_id = Column(Integer, ForeignKey("comment_threads.id", ondelete="CASCADE"), nullable=False, index=True)
    author_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    body = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    thread = relationship("CommentThread", back_populates="comments")
    author = relationship("User", back_populates="comments", foreign_keys=[author_id])


class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=True, index=True)
    actor_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action = Column(String(64), nullable=False)
    target_type = Column(String(64), nullable=False)
    target_id = Column(String(128), nullable=False, default="")
    summary = Column(Text, nullable=False, default="")
    metadata_json = Column(Text, nullable=False, default="")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    workspace = relationship("Workspace", back_populates="activity_logs")
    project = relationship("Project", back_populates="activity_logs")
    actor = relationship("User", back_populates="activity_logs", foreign_keys=[actor_id])
