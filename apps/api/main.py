import json
import mimetypes
import shutil
import base64
import binascii
import contextlib
import hashlib
import hmac
import os
import secrets
import tempfile
from pathlib import Path, PurePosixPath
from urllib.parse import quote
from datetime import datetime, timedelta, timezone

import requests
from fastapi import Depends, FastAPI, File as FastAPIFile, Form, Header, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

import models
from database import engine, get_db
from settings import (
    COMPILER_TIMEOUT_SECONDS,
    COMPILER_URL,
    CORS_ALLOW_ORIGINS,
    PREVIEW_BROWSER_URLS,
    PREVIEW_INTERNAL_URLS,
    PREVIEW_SECRET,
    REALTIME_BROWSER_URLS,
    REALTIME_INTERNAL_URLS,
    REALTIME_SECRET,
    WORKSPACE_DIR,
)


DEFAULT_MAIN_CONTENT = '= Hello Typst\n\nThis is a new document.'
TEXT_ENTRY_KIND = 'file'
FOLDER_ENTRY_KIND = 'folder'
ALLOWED_PROJECT_STATUSES = {'active', 'archived', 'trashed'}
SESSION_TTL_DAYS = 30
BINARY_FILE_EXTENSIONS = {
    '.avif', '.bmp', '.gif', '.ico', '.jpeg', '.jpg', '.png', '.svg', '.tif', '.tiff', '.webp',
    '.aac', '.flac', '.m4a', '.mp3', '.ogg', '.wav',
    '.avi', '.m4v', '.mov', '.mp4', '.ogv', '.webm',
    '.eot', '.otf', '.ttf', '.woff', '.woff2',
    '.pdf',
    '.7z', '.gz', '.rar', '.tar', '.tgz', '.zip',
}
BINARY_MEDIA_TYPES = {
    'application/gzip',
    'application/octet-stream',
    'application/pdf',
    'application/x-7z-compressed',
    'application/x-rar-compressed',
    'application/x-tar',
    'application/zip',
}
BINARY_MEDIA_TYPE_PREFIXES = ('audio/', 'font/', 'image/', 'video/')
ROOT_ADMIN_EMAILS = {
    current.strip().lower()
    for current in os.getenv('ROOT_ADMIN_EMAILS', '').split(',')
    if current.strip()
}

models.Base.metadata.create_all(bind=engine)

with engine.begin() as connection:
    inspector = inspect(connection)

    user_columns = {column['name'] for column in inspector.get_columns('users')} if 'users' in inspector.get_table_names() else set()
    if 'is_root' not in user_columns and 'users' in inspector.get_table_names():
        connection.execute(
            text("ALTER TABLE users ADD COLUMN is_root BOOLEAN NOT NULL DEFAULT FALSE")
        )
    if 'users' in inspector.get_table_names():
        connection.execute(
            text(
                """
                UPDATE users
                SET is_root = TRUE
                WHERE id = (
                    SELECT id
                    FROM users
                    ORDER BY created_at ASC NULLS FIRST, id ASC
                    LIMIT 1
                )
                AND NOT EXISTS (
                    SELECT 1 FROM users WHERE is_root = TRUE
                )
                """
            )
        )

    project_columns = {column['name'] for column in inspector.get_columns('projects')}
    if 'status' not in project_columns:
        connection.execute(
            text("ALTER TABLE projects ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'active'")
        )
    if 'workspace_id' not in project_columns:
        connection.execute(text("ALTER TABLE projects ADD COLUMN workspace_id INTEGER"))
    if 'created_by_id' not in project_columns:
        connection.execute(text("ALTER TABLE projects ADD COLUMN created_by_id INTEGER"))
    if 'description' not in project_columns:
        connection.execute(text("ALTER TABLE projects ADD COLUMN description TEXT NOT NULL DEFAULT ''"))

    file_columns = {column['name'] for column in inspector.get_columns('files')}
    if 'path' not in file_columns:
        connection.execute(text("ALTER TABLE files ADD COLUMN path VARCHAR(1024)"))
    if 'kind' not in file_columns:
        connection.execute(
            text("ALTER TABLE files ADD COLUMN kind VARCHAR(16) NOT NULL DEFAULT 'file'")
        )
    if 'is_binary' not in file_columns:
        connection.execute(
            text("ALTER TABLE files ADD COLUMN is_binary BOOLEAN NOT NULL DEFAULT FALSE")
        )
    if 'content_revision' not in file_columns:
        connection.execute(
            text("ALTER TABLE files ADD COLUMN content_revision INTEGER NOT NULL DEFAULT 0")
        )
    if 'realtime_state' not in file_columns:
        connection.execute(
            text("ALTER TABLE files ADD COLUMN realtime_state TEXT NOT NULL DEFAULT ''")
        )

    refreshed_file_columns = {column['name'] for column in inspect(connection).get_columns('files')}
    if 'path' in refreshed_file_columns:
        connection.execute(text("UPDATE files SET path = name WHERE path IS NULL OR path = ''"))
    if 'kind' in refreshed_file_columns:
        connection.execute(text("UPDATE files SET kind = 'file' WHERE kind IS NULL OR kind = ''"))
    if 'is_binary' in refreshed_file_columns:
        connection.execute(text("UPDATE files SET is_binary = FALSE WHERE is_binary IS NULL"))
    if 'content_revision' in refreshed_file_columns:
        connection.execute(text("UPDATE files SET content_revision = 0 WHERE content_revision IS NULL"))
    if 'realtime_state' in refreshed_file_columns:
        connection.execute(text("UPDATE files SET realtime_state = '' WHERE realtime_state IS NULL"))

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOW_ORIGINS,
    allow_methods=['*'],
    allow_headers=['*'],
)

WORKSPACE_DIR.mkdir(parents=True, exist_ok=True)


class ProjectCreate(BaseModel):
    name: str
    description: str = ''


class ProjectMemberCreateRequest(BaseModel):
    user_id: int | None = None
    email: str | None = None
    role: str = 'editor'


class ProjectMemberUpdateRequest(BaseModel):
    role: str


class UserRegisterRequest(BaseModel):
    email: str
    password: str
    display_name: str


class UserLoginRequest(BaseModel):
    email: str
    password: str


class FileCreate(BaseModel):
    path: str


class FolderCreate(BaseModel):
    path: str


class FileUpdate(BaseModel):
    content: str
    content_revision: int | None = None


class ProjectStatusUpdate(BaseModel):
    status: str


class FilePathUpdate(BaseModel):
    path: str


class TagCreate(BaseModel):
    name: str


class ProjectTagsUpdate(BaseModel):
    tag_ids: list[int]


class ProjectCompileRequest(BaseModel):
    entrypoint: str = ''


class PreviewSnapshotRequest(BaseModel):
    project_id: int
    known_revision: str = ''


class RealtimeRoomResolveRequest(BaseModel):
    file_id: int


class RealtimeFlushFileRequest(BaseModel):
    file_id: int
    content: str
    state_base64: str = ''
    content_revision: int | None = None
    updated_by_id: int | None = None


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def normalize_media_type(value: str | None):
    return (value or '').split(';', 1)[0].strip().lower()


def should_treat_file_as_binary(relative_path: str, media_type: str | None = None):
    suffix = PurePosixPath(relative_path or '').suffix.lower()
    if suffix in BINARY_FILE_EXTENSIONS:
        return True

    guessed_media_type, _ = mimetypes.guess_type(relative_path or '')
    normalized_media_type = normalize_media_type(media_type or guessed_media_type)
    return normalized_media_type in BINARY_MEDIA_TYPES or normalized_media_type.startswith(BINARY_MEDIA_TYPE_PREFIXES)


def is_binary_entry(entry: models.File):
    return bool(
        entry.kind == TEXT_ENTRY_KIND
        and (entry.is_binary or should_treat_file_as_binary(entry.path))
    )


def normalize_email(email: str):
    normalized = (email or '').strip().lower()
    if not normalized or '@' not in normalized:
        raise HTTPException(status_code=400, detail='Invalid email')
    return normalized


def is_root_admin(user: models.User | None):
    if user is None:
        return False
    if bool(getattr(user, 'is_root', False)):
        return True
    return normalize_email(user.email) in ROOT_ADMIN_EMAILS


def normalize_display_name(value: str):
    normalized = (value or '').strip()
    if not normalized:
        raise HTTPException(status_code=400, detail='Display name is required')
    if len(normalized) > 255:
        raise HTTPException(status_code=400, detail='Display name is too long')
    return normalized


def normalize_project_role(role: str):
    normalized = (role or '').strip().lower()
    if normalized not in models.PROJECT_ROLES:
        raise HTTPException(status_code=400, detail='Invalid project role')
    return normalized


def hash_password(password: str):
    raw_password = password or ''
    if len(raw_password) < 8:
        raise HTTPException(status_code=400, detail='Password must be at least 8 characters')

    salt = secrets.token_bytes(16)
    derived = hashlib.pbkdf2_hmac('sha256', raw_password.encode('utf-8'), salt, 100_000)
    return f'pbkdf2_sha256$100000${base64.b64encode(salt).decode()}${base64.b64encode(derived).decode()}'


def verify_password(password: str, password_hash: str):
    try:
        algorithm, raw_iterations, raw_salt, raw_hash = password_hash.split('$', 3)
    except ValueError:
        return False

    if algorithm != 'pbkdf2_sha256':
        return False

    salt = base64.b64decode(raw_salt.encode())
    expected_hash = base64.b64decode(raw_hash.encode())
    derived = hashlib.pbkdf2_hmac('sha256', (password or '').encode('utf-8'), salt, int(raw_iterations))
    return hmac.compare_digest(derived, expected_hash)


def hash_session_token(token: str):
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


def build_auth_payload(user: models.User, token: str):
    return {
        'token': token,
        'user': serialize_user(user),
    }


def get_available_fonts_from_compiler():
    try:
        response = requests.get(
            f'{COMPILER_URL}/fonts',
            timeout=COMPILER_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    payload = response.json()
    fonts = payload.get('fonts')
    if not isinstance(fonts, list):
        raise HTTPException(status_code=502, detail='Compiler returned an invalid font list')

    return [str(font).strip() for font in fonts if str(font).strip()]


def serialize_project(project: models.Project):
    owner = project.created_by
    return {
        'id': project.id,
        'created_by_id': project.created_by_id,
        'created_by': {
            'id': owner.id,
            'email': owner.email,
            'display_name': owner.display_name,
        } if owner else None,
        'name': project.name,
        'status': project.status,
        'description': project.description,
        'created_at': project.created_at,
        'tags': [
            {
                'id': tag.id,
                'name': tag.name,
            }
            for tag in sorted(project.tags, key=lambda current_tag: current_tag.name.lower())
        ],
    }


def serialize_user(user: models.User):
    return {
        'id': user.id,
        'email': user.email,
        'display_name': user.display_name,
        'is_active': user.is_active,
        'is_root_admin': is_root_admin(user),
        'created_at': user.created_at,
    }


def serialize_project_member(member: models.ProjectMember):
    return {
        'id': member.id,
        'project_id': member.project_id,
        'user_id': member.user_id,
        'role': member.role,
        'status': member.status,
        'joined_at': member.joined_at,
        'created_at': member.created_at,
        'user': serialize_user(member.user) if member.user else None,
    }


def serialize_tag(tag: models.Tag):
    return {
        'id': tag.id,
        'name': tag.name,
    }


def serialize_entry(entry: models.File):
    effective_is_binary = is_binary_entry(entry)
    return {
        'id': entry.id,
        'name': entry.name,
        'path': entry.path,
        'kind': entry.kind,
        'is_binary': effective_is_binary,
        'content_revision': entry.content_revision or 0,
        'project_id': entry.project_id,
    }


def search_project_entries(entries: list[models.File], query: str):
    normalized_query = query.strip().lower()
    if not normalized_query:
        return []

    results = []
    for entry in entries:
        if entry.kind != TEXT_ENTRY_KIND or is_binary_entry(entry):
            continue

        lines = (entry.content or '').splitlines()
        for line_number, line in enumerate(lines, start=1):
            normalized_line = line.lower()
            start_index = normalized_line.find(normalized_query)
            if start_index == -1:
                continue

            results.append({
                'file_id': entry.id,
                'path': entry.path,
                'name': entry.name,
                'line_number': line_number,
                'line': line,
                'start': start_index,
                'end': start_index + len(normalized_query),
            })

    return results


def create_session(db: Session, user: models.User):
    raw_token = secrets.token_urlsafe(32)
    session = models.UserSession(
        user_id=user.id,
        token_hash=hash_session_token(raw_token),
        expires_at=utcnow() + timedelta(days=SESSION_TTL_DAYS),
        created_at=utcnow(),
        last_used_at=utcnow(),
    )
    db.add(session)
    db.commit()
    db.refresh(user)
    return build_auth_payload(user, raw_token)


def get_current_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    if not authorization:
        raise HTTPException(status_code=401, detail='Authentication required')

    scheme, _, token = authorization.partition(' ')
    if scheme.lower() != 'bearer' or not token.strip():
        raise HTTPException(status_code=401, detail='Invalid authorization header')

    token_hash = hash_session_token(token.strip())
    session = (
        db.query(models.UserSession)
        .filter(models.UserSession.token_hash == token_hash)
        .first()
    )
    if not session or session.expires_at < utcnow():
        raise HTTPException(status_code=401, detail='Session expired or invalid')

    user = db.query(models.User).filter(models.User.id == session.user_id).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail='User is inactive')

    session.last_used_at = utcnow()
    db.commit()
    return user


def get_optional_current_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    if not authorization:
        return None

    scheme, _, token = authorization.partition(' ')
    if scheme.lower() != 'bearer' or not token.strip():
        return None

    token_hash = hash_session_token(token.strip())
    session = (
        db.query(models.UserSession)
        .filter(models.UserSession.token_hash == token_hash)
        .first()
    )
    if not session or session.expires_at < utcnow():
        return None

    user = db.query(models.User).filter(models.User.id == session.user_id).first()
    if not user or not user.is_active:
        return None

    session.last_used_at = utcnow()
    db.commit()
    return user


def normalize_relative_path(raw_path: str):
    normalized = (raw_path or '').strip().replace('\\', '/')
    if not normalized:
        raise HTTPException(status_code=400, detail='Path is required')

    parts = PurePosixPath(normalized).parts
    if normalized.startswith('/') or any(part in {'', '.', '..'} for part in parts):
        raise HTTPException(status_code=400, detail='Invalid path')

    return str(PurePosixPath(*parts))


def normalize_parent_path(raw_path: str):
    if not raw_path or not raw_path.strip():
        return ''

    return normalize_relative_path(raw_path)


def normalize_entrypoint_path(raw_path: str):
    normalized = normalize_relative_path(raw_path or 'main.typ')
    if not normalized.endswith('.typ'):
        raise HTTPException(status_code=400, detail='Entrypoint must be a .typ file')
    return normalized


def is_template_typ_path(path: str):
    parts = path.lower().split('/')
    filename = parts[-1] if parts else ''
    return filename == 'template.typ' or 'template' in parts or 'templates' in parts


def resolve_project_entrypoint(entries: list[models.File], raw_path: str):
    typ_entries = [
        entry
        for entry in entries
        if entry.kind == TEXT_ENTRY_KIND and not is_binary_entry(entry) and entry.path.endswith('.typ')
    ]
    if not typ_entries:
        raise HTTPException(status_code=404, detail='No .typ entrypoint found in project')

    candidate_paths = [entry.path for entry in typ_entries]
    entry_by_path = {entry.path: entry for entry in typ_entries}

    normalized_raw = (raw_path or '').strip().replace('\\', '/')
    search_candidates = []
    if normalized_raw:
        if normalized_raw.startswith(f'/workspace/projects/{entries[0].project_id}/'):
            normalized_raw = normalized_raw.split(f'/workspace/projects/{entries[0].project_id}/', 1)[1]
        search_candidates = [normalized_raw]
        if normalized_raw.startswith('/'):
            search_candidates.append(normalized_raw.lstrip('/'))

    for candidate in search_candidates:
        if not candidate.endswith('.typ'):
            continue
        if candidate in entry_by_path:
            return entry_by_path[candidate]

        suffix_matches = [path for path in candidate_paths if path.endswith(f'/{candidate}')]
        if len(suffix_matches) == 1:
            return entry_by_path[suffix_matches[0]]

        basename_matches = [path for path in candidate_paths if Path(path).name == Path(candidate).name]
        if len(basename_matches) == 1:
            return entry_by_path[basename_matches[0]]

    preferred_names = ['main.typ']
    for preferred_name in preferred_names:
        direct_match = entry_by_path.get(preferred_name)
        if direct_match:
            return direct_match

        nested_matches = sorted(
            [path for path in candidate_paths if path.endswith(f'/{preferred_name}')],
            key=lambda path: (path.count('/'), path),
        )
        if nested_matches:
            return entry_by_path[nested_matches[0]]

    non_template_paths = sorted(
        [path for path in candidate_paths if not is_template_typ_path(path)],
        key=lambda path: (path.count('/'), path),
    )
    if non_template_paths:
        return entry_by_path[non_template_paths[0]]

    best_path = sorted(candidate_paths, key=lambda path: (path.count('/'), path))[0]
    return entry_by_path[best_path]


def join_relative_path(parent_path: str, child_path: str):
    normalized_child = normalize_relative_path(child_path)
    normalized_parent = normalize_parent_path(parent_path)
    if not normalized_parent:
        return normalized_child

    return str(PurePosixPath(normalized_parent) / normalized_child)


def get_parent_path(relative_path: str):
    parent = PurePosixPath(relative_path).parent
    if str(parent) == '.':
        return ''
    return str(parent)


def get_project_dir(project_id: int):
    return WORKSPACE_DIR / str(project_id)


def get_entry_disk_path(project_id: int, relative_path: str):
    return get_project_dir(project_id) / Path(relative_path)


def write_text_file_atomically(path: Path, content: str):
    path.parent.mkdir(parents=True, exist_ok=True)

    fd, temp_path = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=path.parent,
    )
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temp_path)


def write_bytes_file_atomically(path: Path, content: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)

    fd, temp_path = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=path.parent,
    )
    try:
        with os.fdopen(fd, 'wb') as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temp_path)


def encode_binary_content(content: bytes):
    return base64.b64encode(content).decode('ascii')


def decode_binary_content(content: str, label: str, invalid_status_code: int = 500):
    try:
        return base64.b64decode((content or '').encode('ascii'), validate=True)
    except (ValueError, binascii.Error) as exc:
        raise HTTPException(
            status_code=invalid_status_code,
            detail=f'Invalid binary content for "{label}"',
        ) from exc


def cache_text_file(project_id: int, relative_path: str, content: str):
    with contextlib.suppress(OSError):
        write_text_file_atomically(get_entry_disk_path(project_id, relative_path), content)


def cache_binary_file(project_id: int, relative_path: str, content: bytes):
    with contextlib.suppress(OSError):
        write_bytes_file_atomically(get_entry_disk_path(project_id, relative_path), content)


def delete_cache_path(path: Path):
    with contextlib.suppress(OSError):
        if path.exists():
            if path.is_dir():
                shutil.rmtree(path)
            else:
                path.unlink()


def cache_project_workspace(project_id: int, entries: list[models.File]):
    with contextlib.suppress(OSError, HTTPException, shutil.Error):
        sync_project_workspace(project_id, entries)


def read_binary_entry_content(
    db: Session,
    project_id: int,
    entry: models.File,
    missing_status_code: int = 500,
):
    if entry.content:
        return decode_binary_content(entry.content, entry.path)

    disk_path = get_entry_disk_path(project_id, entry.path)
    if disk_path.exists() and disk_path.is_file():
        try:
            raw_content = disk_path.read_bytes()
        except OSError as exc:
            raise HTTPException(
                status_code=500,
                detail=f'Failed to read legacy binary cache: "{entry.path}"',
            ) from exc

        entry.content = encode_binary_content(raw_content)
        db.commit()
        db.refresh(entry)
        return raw_content

    raise HTTPException(
        status_code=missing_status_code,
        detail=f'Binary file content is unavailable: "{entry.path}"',
    )


def read_effective_binary_entry_content(
    db: Session,
    project_id: int,
    entry: models.File,
    missing_status_code: int = 500,
):
    if entry.is_binary:
        return read_binary_entry_content(db, project_id, entry, missing_status_code)

    disk_path = get_entry_disk_path(project_id, entry.path)
    if disk_path.exists() and disk_path.is_file():
        try:
            raw_content = disk_path.read_bytes()
        except OSError as exc:
            raise HTTPException(
                status_code=500,
                detail=f'Failed to read legacy binary cache: "{entry.path}"',
            ) from exc
    else:
        if not entry.content:
            raise HTTPException(
                status_code=missing_status_code,
                detail=f'Binary file content is unavailable: "{entry.path}"',
            )
        raw_content = (entry.content or '').encode('utf-8')

    entry.is_binary = True
    entry.content = encode_binary_content(raw_content)
    entry.realtime_state = ''
    db.commit()
    db.refresh(entry)
    return raw_content


def read_entry_content_bytes(
    db: Session,
    project_id: int,
    entry: models.File,
    missing_status_code: int = 500,
):
    if entry.kind == FOLDER_ENTRY_KIND:
        raise HTTPException(status_code=400, detail='Folders do not have file content')
    if is_binary_entry(entry):
        return read_effective_binary_entry_content(db, project_id, entry, missing_status_code)
    return (entry.content or '').encode('utf-8')


def build_content_disposition(filename: str, download: bool):
    disposition_type = 'attachment' if download else 'inline'
    safe_filename = (filename or 'download').replace('\\', '_').replace('"', '_')
    ascii_filename = safe_filename.encode('ascii', errors='ignore').decode('ascii') or 'download'
    encoded_filename = quote(safe_filename)
    return f'{disposition_type}; filename="{ascii_filename}"; filename*=UTF-8\'\'{encoded_filename}'


def build_bytes_response(
    content: bytes,
    filename: str,
    media_type: str,
    download: bool = False,
):
    return Response(
        content=content,
        media_type=media_type or 'application/octet-stream',
        headers={'Content-Disposition': build_content_disposition(filename, download)},
    )


def upsert_project_artifact(
    db: Session,
    project_id: int,
    relative_path: str,
    media_type: str,
    content: bytes,
):
    artifact = (
        db.query(models.ProjectArtifact)
        .filter(
            models.ProjectArtifact.project_id == project_id,
            models.ProjectArtifact.path == relative_path,
        )
        .first()
    )
    if artifact is None:
        artifact = models.ProjectArtifact(
            project_id=project_id,
            path=relative_path,
            media_type=media_type,
            content=encode_binary_content(content),
        )
        db.add(artifact)
    else:
        artifact.media_type = media_type
        artifact.content = encode_binary_content(content)

    db.commit()
    db.refresh(artifact)
    return artifact


def read_project_artifact_bytes(
    db: Session,
    project_id: int,
    relative_path: str,
    media_type: str = 'application/octet-stream',
):
    artifact = (
        db.query(models.ProjectArtifact)
        .filter(
            models.ProjectArtifact.project_id == project_id,
            models.ProjectArtifact.path == relative_path,
        )
        .first()
    )
    if artifact and artifact.content:
        return artifact, decode_binary_content(artifact.content, relative_path)

    disk_path = get_entry_disk_path(project_id, relative_path)
    if disk_path.exists() and disk_path.is_file():
        try:
            raw_content = disk_path.read_bytes()
        except OSError as exc:
            raise HTTPException(status_code=500, detail='Failed to read legacy artifact cache') from exc
        artifact = upsert_project_artifact(db, project_id, relative_path, media_type, raw_content)
        return artifact, raw_content

    raise HTTPException(status_code=404, detail='Artifact not found')


def hydrate_legacy_binary_entries_from_disk(db: Session):
    hydrated_count = 0
    entries = (
        db.query(models.File)
        .filter(
            models.File.kind == TEXT_ENTRY_KIND,
            models.File.is_binary.is_(True),
        )
        .all()
    )

    for entry in entries:
        if entry.content:
            continue

        disk_path = get_entry_disk_path(entry.project_id, entry.path)
        if not disk_path.exists() or not disk_path.is_file():
            continue

        try:
            entry.content = encode_binary_content(disk_path.read_bytes())
        except OSError:
            continue
        hydrated_count += 1

    if hydrated_count:
        db.commit()
        print(f'[api] hydrated {hydrated_count} legacy binary files into database storage')


def summarize_content(value: str, limit: int = 80):
    return (value or '').replace('\n', ' ').replace('\r', ' ')[:limit]


def choose_preview_endpoint_index(project_id: int):
    endpoint_count = max(len(PREVIEW_INTERNAL_URLS), 1)
    return (max(project_id, 1) - 1) % endpoint_count


def get_preview_browser_url(project_id: int):
    if not PREVIEW_BROWSER_URLS:
        return ''
    return PREVIEW_BROWSER_URLS[choose_preview_endpoint_index(project_id)]


def build_preview_internal_url(path: str, project_id: int):
    endpoint = PREVIEW_INTERNAL_URLS[choose_preview_endpoint_index(project_id)]
    return f"{endpoint.rstrip('/')}" + path


def build_preview_browser_url(path: str, project_id: int, *, query: dict[str, str] | None = None):
    endpoint = get_preview_browser_url(project_id)
    if not endpoint:
        return ''

    url = f"{endpoint.rstrip('/')}" + path
    if query:
        query_string = '&'.join(
            f"{quote(str(key), safe='')}={quote(str(value), safe='')}"
            for key, value in query.items()
        )
        if query_string:
            url = f"{url}?{query_string}"
    return url


def choose_realtime_endpoint_index(file_id: int):
    endpoint_count = max(len(REALTIME_INTERNAL_URLS), 1)
    return (max(file_id, 1) - 1) % endpoint_count


def get_realtime_browser_url(file_id: int):
    if not REALTIME_BROWSER_URLS:
        return ''
    return REALTIME_BROWSER_URLS[choose_realtime_endpoint_index(file_id)]


def build_realtime_internal_url(path: str, file_id: int):
    endpoint = REALTIME_INTERNAL_URLS[choose_realtime_endpoint_index(file_id)]
    return f"{endpoint.rstrip('/')}{path}"


def get_project_or_404(db: Session, project_id: int):
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail='Project not found')
    return project


def get_project_membership(
    db: Session,
    project_id: int,
    user_id: int,
    *,
    active_only: bool = True,
):
    query = (
        db.query(models.ProjectMember)
        .filter(
            models.ProjectMember.project_id == project_id,
            models.ProjectMember.user_id == user_id,
        )
    )
    if active_only:
        query = query.filter(models.ProjectMember.status == 'active')
    return query.first()


def get_project_membership_or_404(db: Session, project_id: int, user_id: int):
    membership = get_project_membership(db, project_id, user_id)
    if not membership:
        raise HTTPException(status_code=403, detail='Project access denied')
    return membership


def require_project_role(membership: models.ProjectMember, allowed_roles: set[str]):
    if membership.role not in allowed_roles:
        raise HTTPException(status_code=403, detail='Insufficient project permissions')


def is_shared_project(project: models.Project):
    return project.created_by_id is None


def ensure_project_access(
    db: Session,
    project: models.Project,
    current_user: models.User | None,
    allowed_roles: set[str] | None = None,
):
    if is_root_admin(current_user):
        return None

    if current_user is None:
        raise HTTPException(status_code=401, detail='Authentication required')

    if is_shared_project(project):
        if not allowed_roles:
            return None

        shared_roles = {'editor', 'commenter', 'viewer'}
        if allowed_roles.isdisjoint(shared_roles):
            raise HTTPException(status_code=403, detail='Shared project requires a maintainer')
        return None

    membership = get_project_membership(db, project.id, current_user.id)
    if membership is None:
        raise HTTPException(status_code=403, detail='Project access denied')

    if allowed_roles:
        require_project_role(membership, allowed_roles)

    return membership


def ensure_project_membership(db: Session, project: models.Project):
    if project.created_by_id is None:
        return

    existing_membership = get_project_membership(
        db,
        project.id,
        project.created_by_id,
        active_only=False,
    )
    if existing_membership:
        if existing_membership.status != 'active':
            existing_membership.status = 'active'
        existing_membership.joined_at = existing_membership.joined_at or utcnow()
        existing_membership.role = 'maintainer'
        db.commit()
        return

    db.add(
        models.ProjectMember(
            project_id=project.id,
            user_id=project.created_by_id,
            role='maintainer',
            status='active',
            invited_by_id=project.created_by_id,
            joined_at=utcnow(),
        )
    )
    db.commit()


with Session(engine) as db:
    legacy_projects = db.query(models.Project).filter(models.Project.created_by_id.is_not(None)).all()
    for legacy_project in legacy_projects:
        ensure_project_membership(db, legacy_project)
    hydrate_legacy_binary_entries_from_disk(db)


def get_entry_or_404(db: Session, file_id: int):
    entry = db.query(models.File).filter(models.File.id == file_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail='File not found')
    return entry


def make_unique_project_name(db: Session, base_name: str):
    normalized_name = base_name.strip() or 'Untitled Project'
    existing_names = {
        project_name
        for project_name, in db.query(models.Project.name).all()
    }

    if normalized_name not in existing_names:
        return normalized_name

    suffix = 2
    while True:
        candidate = f'{normalized_name} ({suffix})'
        if candidate not in existing_names:
            return candidate
        suffix += 1


def normalize_tag_name(raw_name: str):
    normalized = (raw_name or '').strip()
    if not normalized:
        raise HTTPException(status_code=400, detail='Tag name is required')
    if len(normalized) > 64:
        raise HTTPException(status_code=400, detail='Tag name must be 64 characters or fewer')
    return normalized


def get_project_entries_map(db: Session, project_id: int):
    entries = db.query(models.File).filter(models.File.project_id == project_id).all()
    return {entry.path: entry for entry in entries}


def list_descendant_entries(db: Session, project_id: int, relative_path: str):
    return (
        db.query(models.File)
        .filter(
            models.File.project_id == project_id,
            models.File.path.startswith(f'{relative_path}/'),
        )
        .order_by(models.File.path.asc())
        .all()
    )


def ensure_parent_folders(
    db: Session,
    project_id: int,
    parent_path: str,
    entries_by_path: dict[str, models.File],
):
    if not parent_path:
        return

    parts = PurePosixPath(parent_path).parts
    for index in range(len(parts)):
        folder_path = str(PurePosixPath(*parts[: index + 1]))
        existing_entry = entries_by_path.get(folder_path)
        if existing_entry:
            if existing_entry.kind != FOLDER_ENTRY_KIND:
                raise HTTPException(
                    status_code=409,
                    detail=f'Path conflict: "{folder_path}" is not a folder',
                )
            continue

        folder_entry = models.File(
            project_id=project_id,
            name=PurePosixPath(folder_path).name,
            path=folder_path,
            kind=FOLDER_ENTRY_KIND,
            is_binary=False,
            content='',
        )
        db.add(folder_entry)
        db.flush()
        entries_by_path[folder_path] = folder_entry


def ensure_entry_path_available(
    path: str,
    entries_by_path: dict[str, models.File],
):
    if path in entries_by_path:
        raise HTTPException(status_code=409, detail=f'Path already exists: "{path}"')


def sync_project_workspace(project_id: int, entries: list[models.File]):
    project_dir = get_project_dir(project_id)
    project_dir.mkdir(parents=True, exist_ok=True)
    expected_files: set[str] = set()
    expected_dirs: set[str] = set()

    for entry in entries:
        relative_path = str(PurePosixPath(entry.path))
        parent_parts = PurePosixPath(relative_path).parent.parts
        for index in range(len(parent_parts)):
            expected_dirs.add(str(PurePosixPath(*parent_parts[: index + 1])))

        if entry.kind == FOLDER_ENTRY_KIND:
            expected_dirs.add(relative_path)
        else:
            expected_files.add(relative_path)

    for disk_path in sorted(project_dir.rglob('*'), key=lambda current: len(current.parts), reverse=True):
        relative_path = disk_path.relative_to(project_dir).as_posix()
        if disk_path.is_file():
            if relative_path in expected_files or relative_path.endswith('.pdf'):
                continue
            disk_path.unlink()
            continue

        if relative_path in expected_dirs:
            continue

        with contextlib.suppress(OSError):
            disk_path.rmdir()

    for entry in sorted(entries, key=lambda current: (current.path.count('/'), current.path)):
        disk_path = get_entry_disk_path(project_id, entry.path)

        if entry.kind == FOLDER_ENTRY_KIND:
            disk_path.mkdir(parents=True, exist_ok=True)
            continue

        disk_path.parent.mkdir(parents=True, exist_ok=True)
        if is_binary_entry(entry):
            if entry.content:
                if entry.is_binary:
                    try:
                        raw_content = decode_binary_content(entry.content, entry.path)
                    except HTTPException:
                        continue
                else:
                    raw_content = entry.content.encode('utf-8')
                write_bytes_file_atomically(disk_path, raw_content)
            continue

        write_text_file_atomically(disk_path, entry.content or '')


def create_text_file_entry(
    db: Session,
    project_id: int,
    relative_path: str,
    content: str,
):
    entries_by_path = get_project_entries_map(db, project_id)
    ensure_entry_path_available(relative_path, entries_by_path)
    ensure_parent_folders(db, project_id, get_parent_path(relative_path), entries_by_path)

    entry = models.File(
        project_id=project_id,
        name=PurePosixPath(relative_path).name,
        path=relative_path,
        kind=TEXT_ENTRY_KIND,
        is_binary=False,
        content=content,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)

    cache_text_file(project_id, relative_path, content)

    return entry


def ensure_disk_entry(project_id: int, entry: models.File):
    disk_path = get_entry_disk_path(project_id, entry.path)
    if disk_path.exists():
        return disk_path

    if entry.kind == FOLDER_ENTRY_KIND:
        disk_path.mkdir(parents=True, exist_ok=True)
        return disk_path

    disk_path.parent.mkdir(parents=True, exist_ok=True)
    if is_binary_entry(entry):
        if entry.content:
            raw_content = (
                decode_binary_content(entry.content, entry.path)
                if entry.is_binary
                else entry.content.encode('utf-8')
            )
            write_bytes_file_atomically(disk_path, raw_content)
    else:
        write_text_file_atomically(disk_path, entry.content or '')

    return disk_path


def build_compiler_workspace_snapshot(db: Session, project_id: int, entries: list[models.File]):
    snapshot_entries: list[dict[str, str]] = []

    for entry in sorted(entries, key=lambda current: (current.path.count('/'), current.path)):
        relative_path = str(PurePosixPath(entry.path))

        if entry.kind == FOLDER_ENTRY_KIND:
            snapshot_entries.append({
                'path': relative_path,
                'kind': FOLDER_ENTRY_KIND,
            })
            continue

        raw_content = read_entry_content_bytes(db, project_id, entry)
        snapshot_entries.append({
            'path': relative_path,
            'kind': TEXT_ENTRY_KIND,
            'content_base64': encode_binary_content(raw_content),
        })

    return snapshot_entries


def update_snapshot_digest(digest, value: str):
    digest.update(str(value).encode('utf-8', errors='ignore'))
    digest.update(b'\0')


def build_project_snapshot_revision(db: Session, project_id: int, entries: list[models.File]):
    digest = hashlib.sha1()
    for entry in sorted(entries, key=lambda current: (current.path.count('/'), current.path)):
        relative_path = str(PurePosixPath(entry.path))
        update_snapshot_digest(digest, relative_path)
        update_snapshot_digest(digest, entry.kind)
        update_snapshot_digest(digest, 'binary' if is_binary_entry(entry) else 'text')

        if entry.kind == FOLDER_ENTRY_KIND:
            continue

        raw_content = read_entry_content_bytes(db, project_id, entry)
        digest.update(hashlib.sha1(raw_content).hexdigest().encode('ascii'))
        digest.update(b'\0')
    return digest.hexdigest()


def compile_project_snapshot(db: Session, project_id: int, entrypoint: str, entries: list[models.File]):
    try:
        response = requests.post(
            COMPILER_URL,
            json={
                'protocol_version': 2,
                'project_id': project_id,
                'entrypoint': entrypoint,
                'files': build_compiler_workspace_snapshot(db, project_id, entries),
            },
            timeout=COMPILER_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        payload = response.json()
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=502, detail='Compiler returned invalid JSON') from exc

    if payload.get('status') == 'success':
        pdf_base64 = payload.get('pdf_base64')
        if not isinstance(pdf_base64, str) or not pdf_base64:
            raise HTTPException(status_code=502, detail='Compiler response did not include PDF content')

        pdf_content = decode_binary_content(pdf_base64, 'compiler PDF', invalid_status_code=502)
        raw_output_path = payload.get('output_path') or Path(entrypoint).with_suffix('.pdf').as_posix()
        try:
            pdf_relative_path = normalize_relative_path(str(raw_output_path))
        except HTTPException as exc:
            raise HTTPException(status_code=502, detail='Compiler returned an invalid PDF output path') from exc
        upsert_project_artifact(db, project_id, pdf_relative_path, 'application/pdf', pdf_content)
        cache_binary_file(project_id, pdf_relative_path, pdf_content)

    return {
        key: value
        for key, value in payload.items()
        if key != 'pdf_base64'
    }


def flush_realtime_room(file_id: int):
    try:
        response = requests.post(
            build_realtime_internal_url('/internal/realtime/flush-room', file_id),
            json={'file_id': file_id},
            headers={'X-Realtime-Secret': REALTIME_SECRET},
            timeout=5,
        )
        if response.status_code == 409:
            raise HTTPException(status_code=409, detail=response.text or 'Realtime room content is stale')
        response.raise_for_status()
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    try:
        payload = response.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail='Realtime service returned invalid JSON') from exc

    if not isinstance(payload, dict):
        raise HTTPException(status_code=502, detail='Realtime service returned an invalid flush payload')

    return payload


def build_file_room_key(project_id: int, file_id: int):
    return f'project:{project_id}:file:{file_id}'


def can_edit_project_file(
    db: Session,
    project: models.Project,
    current_user: models.User | None,
):
    try:
        ensure_project_access(db, project, current_user, {'maintainer', 'editor'})
        return True
    except HTTPException as exc:
        if exc.status_code in {401, 403}:
            return False
        raise


def require_preview_secret(x_preview_secret: str | None = Header(default=None)):
    if not x_preview_secret or x_preview_secret != PREVIEW_SECRET:
        raise HTTPException(status_code=401, detail='Invalid preview secret')


def require_realtime_secret(x_realtime_secret: str | None = Header(default=None)):
    if not x_realtime_secret or x_realtime_secret != REALTIME_SECRET:
        raise HTTPException(status_code=401, detail='Invalid realtime secret')


def serialize_realtime_session(
    db: Session,
    entry: models.File,
    current_user: models.User,
):
    ensure_project_access(db, entry.project, current_user)
    effective_is_binary = is_binary_entry(entry)

    return {
        'protocol_version': 1,
        'room_key': build_file_room_key(entry.project_id, entry.id),
        'realtime_url': get_realtime_browser_url(entry.id),
        'file': {
            'id': entry.id,
            'project_id': entry.project_id,
            'path': entry.path,
            'name': entry.name,
            'kind': entry.kind,
            'is_binary': effective_is_binary,
            'content_revision': entry.content_revision or 0,
            'content': '' if effective_is_binary else (entry.content or ''),
            'realtime_state': '' if effective_is_binary else (entry.realtime_state or ''),
            'updated_at': entry.updated_at,
        },
        'user': serialize_user(current_user),
        'permissions': {
            'can_edit': can_edit_project_file(db, entry.project, current_user),
        },
    }


@app.get('/health')
def health():
    return {'status': 'ok'}


@app.post('/auth/register')
def register_user(payload: UserRegisterRequest, db: Session = Depends(get_db)):
    normalized_email = normalize_email(payload.email)
    existing_user = db.query(models.User).filter(models.User.email == normalized_email).first()
    if existing_user:
        raise HTTPException(status_code=409, detail='Email already exists')

    user = models.User(
        email=normalized_email,
        password_hash=hash_password(payload.password),
        display_name=normalize_display_name(payload.display_name),
        is_active=True,
        is_root=db.query(models.User).count() == 0,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return create_session(db, user)


@app.post('/auth/login')
def login_user(payload: UserLoginRequest, db: Session = Depends(get_db)):
    normalized_email = normalize_email(payload.email)
    user = db.query(models.User).filter(models.User.email == normalized_email).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail='Invalid credentials')
    if not user.is_active:
        raise HTTPException(status_code=403, detail='User is inactive')

    return create_session(db, user)


@app.post('/auth/logout')
def logout_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    if not authorization:
        raise HTTPException(status_code=401, detail='Authentication required')

    scheme, _, token = authorization.partition(' ')
    if scheme.lower() != 'bearer' or not token.strip():
        raise HTTPException(status_code=401, detail='Invalid authorization header')

    session = (
        db.query(models.UserSession)
        .filter(models.UserSession.token_hash == hash_session_token(token.strip()))
        .first()
    )
    if session:
        db.delete(session)
        db.commit()

    return {'status': 'success'}


@app.get('/auth/me')
def get_me(current_user: models.User = Depends(get_current_user)):
    return {'user': serialize_user(current_user)}


@app.get('/projects/{project_id}/members')
def list_project_members(
    project_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = get_project_or_404(db, project_id)
    ensure_project_access(db, project, current_user)
    members = (
        db.query(models.ProjectMember)
        .filter(models.ProjectMember.project_id == project_id)
        .order_by(models.ProjectMember.created_at.asc())
        .all()
    )
    return [serialize_project_member(member) for member in members]


@app.post('/projects/{project_id}/members')
def add_project_member(
    project_id: int,
    payload: ProjectMemberCreateRequest,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = get_project_or_404(db, project_id)
    requester_membership = ensure_project_access(db, project, current_user, {'maintainer'})
    role = normalize_project_role(payload.role)

    if payload.user_id is not None:
        user = db.query(models.User).filter(models.User.id == payload.user_id).first()
    elif payload.email:
        normalized_email = normalize_email(payload.email)
        user = db.query(models.User).filter(models.User.email == normalized_email).first()
    else:
        raise HTTPException(status_code=400, detail='user_id or email is required')

    if not user:
        raise HTTPException(status_code=404, detail='User not found')

    membership = get_project_membership(db, project_id, user.id, active_only=False)
    if membership:
        membership.role = role
        membership.status = 'active'
        membership.joined_at = membership.joined_at or utcnow()
        membership.invited_by_id = requester_membership.user_id if requester_membership else current_user.id
    else:
        membership = models.ProjectMember(
            project_id=project_id,
            user_id=user.id,
            role=role,
            status='active',
            invited_by_id=requester_membership.user_id if requester_membership else current_user.id,
            joined_at=utcnow(),
        )
        db.add(membership)

    db.commit()
    db.refresh(membership)
    return serialize_project_member(membership)


@app.patch('/projects/{project_id}/members/{member_id}')
def update_project_member(
    project_id: int,
    member_id: int,
    payload: ProjectMemberUpdateRequest,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = get_project_or_404(db, project_id)
    ensure_project_access(db, project, current_user, {'maintainer'})
    membership = (
        db.query(models.ProjectMember)
        .filter(
            models.ProjectMember.project_id == project_id,
            models.ProjectMember.id == member_id,
        )
        .first()
    )
    if not membership:
        raise HTTPException(status_code=404, detail='Project member not found')

    membership.role = normalize_project_role(payload.role)
    db.commit()
    db.refresh(membership)
    return serialize_project_member(membership)


@app.delete('/projects/{project_id}/members/{member_id}')
def delete_project_member(
    project_id: int,
    member_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = get_project_or_404(db, project_id)
    ensure_project_access(db, project, current_user, {'maintainer'})
    membership = (
        db.query(models.ProjectMember)
        .filter(
            models.ProjectMember.project_id == project_id,
            models.ProjectMember.id == member_id,
        )
        .first()
    )
    if not membership:
        raise HTTPException(status_code=404, detail='Project member not found')
    if not is_root_admin(current_user) and membership.user_id == current_user.id:
        raise HTTPException(status_code=400, detail='Maintainer cannot remove themselves')

    db.delete(membership)
    db.commit()
    return {'status': 'success', 'id': member_id}


@app.post('/projects')
def create_project(
    project: ProjectCreate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db_project = models.Project(
        name=project.name.strip(),
        status='active',
        created_by_id=current_user.id,
        description=(project.description or '').strip(),
    )
    db.add(db_project)
    db.flush()
    db.add(
        models.ProjectMember(
            project_id=db_project.id,
            user_id=current_user.id,
            role='maintainer',
            status='active',
            invited_by_id=current_user.id,
            joined_at=utcnow(),
        )
    )
    db.commit()
    db.refresh(db_project)

    get_project_dir(db_project.id).mkdir(parents=True, exist_ok=True)
    create_text_file_entry(db, db_project.id, 'main.typ', DEFAULT_MAIN_CONTENT)

    return serialize_project(db_project)


@app.get('/projects')
def list_projects(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    projects = db.query(models.Project).order_by(models.Project.created_at.desc()).all()

    if is_root_admin(current_user):
        return [serialize_project(project) for project in projects]

    visible_projects = []
    for project in projects:
        if is_shared_project(project):
            visible_projects.append(project)
            continue

        project_membership = get_project_membership(db, project.id, current_user.id)
        if project_membership:
            visible_projects.append(project)

    return [serialize_project(project) for project in visible_projects]


@app.get('/tags')
def list_tags(db: Session = Depends(get_db)):
    tags = db.query(models.Tag).order_by(models.Tag.name.asc()).all()
    return [serialize_tag(tag) for tag in tags]


@app.post('/tags')
def create_tag(payload: TagCreate, db: Session = Depends(get_db)):
    normalized_name = normalize_tag_name(payload.name)
    existing_tag = db.query(models.Tag).filter(models.Tag.name == normalized_name).first()
    if existing_tag:
        raise HTTPException(status_code=409, detail='Tag already exists')

    tag = models.Tag(name=normalized_name)
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return serialize_tag(tag)


@app.delete('/tags/{tag_id}')
def delete_tag(tag_id: int, db: Session = Depends(get_db)):
    tag = db.query(models.Tag).filter(models.Tag.id == tag_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail='Tag not found')

    tag.projects = []
    db.delete(tag)
    db.commit()
    return {'status': 'success', 'id': tag_id}


@app.post('/projects/{project_id}/copy')
def copy_project(
    project_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = get_project_or_404(db, project_id)
    ensure_project_access(db, project, current_user, {'maintainer', 'editor'})

    copied_project = models.Project(
        name=make_unique_project_name(db, f'{project.name} Copy'),
        status='active',
        created_by_id=current_user.id,
        description=project.description,
    )
    db.add(copied_project)
    copied_project.tags = list(project.tags)
    db.flush()
    db.add(
        models.ProjectMember(
            project_id=copied_project.id,
            user_id=current_user.id,
            role='maintainer',
            status='active',
            invited_by_id=current_user.id,
            joined_at=utcnow(),
        )
    )
    db.commit()
    db.refresh(copied_project)

    source_entries = db.query(models.File).filter(models.File.project_id == project_id).all()
    for source_entry in source_entries:
        copied_is_binary = is_binary_entry(source_entry)
        copied_content = source_entry.content
        if copied_is_binary:
            copied_content = encode_binary_content(read_entry_content_bytes(db, project_id, source_entry))

        db.add(
            models.File(
                project_id=copied_project.id,
                name=source_entry.name,
                path=source_entry.path,
                kind=source_entry.kind,
                is_binary=copied_is_binary,
                content=copied_content,
            )
        )
    db.commit()

    copied_entries = db.query(models.File).filter(models.File.project_id == copied_project.id).all()
    cache_project_workspace(copied_project.id, copied_entries)

    return serialize_project(copied_project)


@app.patch('/projects/{project_id}/status')
def update_project_status(
    project_id: int,
    status_update: ProjectStatusUpdate,
    current_user: models.User | None = Depends(get_optional_current_user),
    db: Session = Depends(get_db),
):
    project = get_project_or_404(db, project_id)
    ensure_project_access(db, project, current_user, {'maintainer'})

    if status_update.status not in ALLOWED_PROJECT_STATUSES:
        raise HTTPException(status_code=400, detail='Invalid project status')

    project.status = status_update.status
    db.commit()
    db.refresh(project)

    return serialize_project(project)


@app.patch('/projects/{project_id}/tags')
def update_project_tags(
    project_id: int,
    payload: ProjectTagsUpdate,
    current_user: models.User | None = Depends(get_optional_current_user),
    db: Session = Depends(get_db),
):
    project = get_project_or_404(db, project_id)
    ensure_project_access(db, project, current_user, {'maintainer', 'editor'})
    tag_ids = list(dict.fromkeys(payload.tag_ids or []))
    tags = []
    if tag_ids:
        tags = db.query(models.Tag).filter(models.Tag.id.in_(tag_ids)).all()
        if len(tags) != len(tag_ids):
            raise HTTPException(status_code=404, detail='One or more tags were not found')

    project.tags = sorted(tags, key=lambda tag: tag.name.lower())
    db.commit()
    db.refresh(project)
    return serialize_project(project)


@app.delete('/projects/{project_id}')
def delete_project(
    project_id: int,
    current_user: models.User | None = Depends(get_optional_current_user),
    db: Session = Depends(get_db),
):
    project = get_project_or_404(db, project_id)
    ensure_project_access(db, project, current_user, {'maintainer'})

    project.tags = []
    db.delete(project)
    db.commit()

    delete_cache_path(get_project_dir(project_id))

    return {'status': 'success', 'id': project_id}


@app.get('/projects/{project_id}/files')
def list_files(
    project_id: int,
    current_user: models.User | None = Depends(get_optional_current_user),
    db: Session = Depends(get_db),
):
    project = get_project_or_404(db, project_id)
    ensure_project_access(db, project, current_user)
    entries = (
        db.query(models.File)
        .filter(models.File.project_id == project_id)
        .order_by(models.File.path.asc())
        .all()
    )
    return [serialize_entry(entry) for entry in entries]


@app.get('/projects/{project_id}/search')
def search_project_files(
    project_id: int,
    q: str = Query('', alias='q'),
    current_user: models.User | None = Depends(get_optional_current_user),
    db: Session = Depends(get_db),
):
    project = get_project_or_404(db, project_id)
    ensure_project_access(db, project, current_user)
    entries = db.query(models.File).filter(models.File.project_id == project_id).all()
    return search_project_entries(entries, q)


@app.post('/projects/{project_id}/files')
def create_file(
    project_id: int,
    payload: FileCreate,
    current_user: models.User | None = Depends(get_optional_current_user),
    db: Session = Depends(get_db),
):
    project = get_project_or_404(db, project_id)
    ensure_project_access(db, project, current_user, {'maintainer', 'editor'})
    relative_path = normalize_relative_path(payload.path)
    entry = create_text_file_entry(db, project_id, relative_path, '')
    return serialize_entry(entry)


@app.post('/projects/{project_id}/folders')
def create_folder(
    project_id: int,
    payload: FolderCreate,
    current_user: models.User | None = Depends(get_optional_current_user),
    db: Session = Depends(get_db),
):
    project = get_project_or_404(db, project_id)
    ensure_project_access(db, project, current_user, {'maintainer', 'editor'})
    relative_path = normalize_relative_path(payload.path)

    entries_by_path = get_project_entries_map(db, project_id)
    ensure_entry_path_available(relative_path, entries_by_path)
    ensure_parent_folders(db, project_id, get_parent_path(relative_path), entries_by_path)

    folder_entry = models.File(
        project_id=project_id,
        name=PurePosixPath(relative_path).name,
        path=relative_path,
        kind=FOLDER_ENTRY_KIND,
        is_binary=False,
        content='',
    )
    db.add(folder_entry)
    db.commit()
    db.refresh(folder_entry)

    with contextlib.suppress(OSError):
        get_entry_disk_path(project_id, relative_path).mkdir(parents=True, exist_ok=True)

    return serialize_entry(folder_entry)


@app.post('/projects/{project_id}/uploads')
def upload_files(
    project_id: int,
    files: list[UploadFile] = FastAPIFile(...),
    parent_path: str = Form(''),
    relative_paths: str = Form(''),
    current_user: models.User | None = Depends(get_optional_current_user),
    db: Session = Depends(get_db),
):
    project = get_project_or_404(db, project_id)
    ensure_project_access(db, project, current_user, {'maintainer', 'editor'})

    normalized_parent = normalize_parent_path(parent_path)
    provided_relative_paths = []
    if relative_paths:
        try:
            provided_relative_paths = json.loads(relative_paths)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400, detail='Invalid relative_paths payload') from exc

        if not isinstance(provided_relative_paths, list) or any(
            not isinstance(item, str) for item in provided_relative_paths
        ):
            raise HTTPException(status_code=400, detail='Invalid relative_paths payload')

        if len(provided_relative_paths) != len(files):
            raise HTTPException(status_code=400, detail='relative_paths count mismatch')

    entries_by_path = get_project_entries_map(db, project_id)
    created_entries: list[models.File] = []

    for index, uploaded_file in enumerate(files):
        source_relative_path = (
            provided_relative_paths[index]
            if provided_relative_paths
            else uploaded_file.filename or ''
        )
        relative_path = join_relative_path(normalized_parent, source_relative_path)
        ensure_entry_path_available(relative_path, entries_by_path)
        ensure_parent_folders(db, project_id, get_parent_path(relative_path), entries_by_path)

        binary_content = uploaded_file.file.read()
        is_binary = should_treat_file_as_binary(relative_path, uploaded_file.content_type)
        if is_binary:
            text_content = ''
        else:
            try:
                text_content = binary_content.decode('utf-8')
            except UnicodeDecodeError:
                text_content = ''
                is_binary = True

        stored_content = encode_binary_content(binary_content) if is_binary else text_content
        cache_binary_file(project_id, relative_path, binary_content)

        entry = models.File(
            project_id=project_id,
            name=PurePosixPath(relative_path).name,
            path=relative_path,
            kind=TEXT_ENTRY_KIND,
            is_binary=is_binary,
            content=stored_content,
        )
        db.add(entry)
        db.flush()
        entries_by_path[relative_path] = entry
        created_entries.append(entry)

    db.commit()
    for entry in created_entries:
        db.refresh(entry)

    return [serialize_entry(entry) for entry in created_entries]


@app.get('/files/{file_id}/content')
def get_file_content(
    file_id: int,
    current_user: models.User | None = Depends(get_optional_current_user),
    db: Session = Depends(get_db),
):
    entry = get_entry_or_404(db, file_id)
    ensure_project_access(db, entry.project, current_user)
    if entry.kind == FOLDER_ENTRY_KIND:
        raise HTTPException(status_code=400, detail='Folders do not have editable content')

    effective_is_binary = is_binary_entry(entry)
    return {
        'id': entry.id,
        'name': entry.name,
        'path': entry.path,
        'kind': entry.kind,
        'is_binary': effective_is_binary,
        'content_revision': entry.content_revision or 0,
        'content': '' if effective_is_binary else (entry.content or ''),
    }


@app.get('/projects/{project_id}/preview-session')
def get_project_preview_session(
    project_id: int,
    entrypoint: str = Query('main.typ'),
    client_id: str = Query('default'),
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = get_project_or_404(db, project_id)
    ensure_project_access(db, project, current_user)

    try:
        response = requests.get(
            build_preview_internal_url(f'/sessions/{project_id}/status', project_id),
            params={
                'entrypoint': entrypoint or 'main.typ',
                'client_id': client_id or 'default',
            },
            timeout=15,
        )
        response.raise_for_status()
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    try:
        payload = response.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail='Preview service returned invalid JSON') from exc

    if not isinstance(payload, dict):
        raise HTTPException(status_code=502, detail='Preview service returned an invalid session payload')

    resolved_entrypoint = str(payload.get('entrypoint') or entrypoint or 'main.typ')
    resolved_client_id = str(payload.get('client_id') or client_id or 'default')
    query = {
        'entrypoint': resolved_entrypoint,
        'client_id': resolved_client_id,
    }

    return {
        'protocol_version': 1,
        'project_id': project_id,
        'entrypoint': resolved_entrypoint,
        'client_id': resolved_client_id,
        'instance_id': payload.get('instance_id', 0),
        'status': payload.get('status', {'kind': 'Idle'}),
        'outline': payload.get('outline', []),
        'preview_base_url': get_preview_browser_url(project_id),
        'preview_url': build_preview_browser_url(f'/sessions/{project_id}/data', project_id, query=query),
        'status_url': build_preview_browser_url(f'/sessions/{project_id}/status', project_id, query=query),
        'view_url': build_preview_browser_url(f'/sessions/{project_id}/view', project_id, query=query),
        'ws_url': build_preview_browser_url(f'/sessions/{project_id}/ws', project_id, query=query),
        'events_url': build_preview_browser_url(f'/sessions/{project_id}/events', project_id, query=query),
    }


@app.get('/files/{file_id}/realtime-session')
def get_file_realtime_session(
    file_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    entry = get_entry_or_404(db, file_id)
    if entry.kind == FOLDER_ENTRY_KIND:
        raise HTTPException(status_code=400, detail='Folders do not have realtime sessions')
    if is_binary_entry(entry):
        raise HTTPException(status_code=400, detail='Binary files do not have realtime sessions')

    return serialize_realtime_session(db, entry, current_user)


@app.post('/files/{file_id}/realtime-flush')
def force_flush_file_realtime_state(
    file_id: int,
    current_user: models.User | None = Depends(get_optional_current_user),
    db: Session = Depends(get_db),
):
    entry = get_entry_or_404(db, file_id)
    ensure_project_access(db, entry.project, current_user, {'maintainer', 'editor'})
    if entry.kind == FOLDER_ENTRY_KIND:
        raise HTTPException(status_code=400, detail='Folders do not have editable content')
    if is_binary_entry(entry):
        raise HTTPException(status_code=400, detail='Binary files do not have realtime state')

    flush_payload = flush_realtime_room(entry.id)
    db.refresh(entry)

    return {
        'status': flush_payload.get('status', 'idle'),
        'file': {
            'id': entry.id,
            'path': entry.path,
            'content': entry.content or '',
            'content_revision': entry.content_revision or 0,
            'updated_at': entry.updated_at,
        },
    }


@app.put('/files/{file_id}/content')
def update_file_content(
    file_id: int,
    file_update: FileUpdate,
    current_user: models.User | None = Depends(get_optional_current_user),
    db: Session = Depends(get_db),
):
    entry = get_entry_or_404(db, file_id)
    ensure_project_access(db, entry.project, current_user, {'maintainer', 'editor'})
    if entry.kind == FOLDER_ENTRY_KIND:
        raise HTTPException(status_code=400, detail='Folders do not have editable content')
    if is_binary_entry(entry):
        raise HTTPException(status_code=400, detail='Binary files cannot be edited inline')

    current_revision = entry.content_revision or 0
    if file_update.content_revision is not None and file_update.content_revision != current_revision:
        raise HTTPException(status_code=409, detail='File content changed; reload before saving')

    print(
        f"[api] put-content file={entry.id} path={entry.path} len={len(file_update.content or '')} "
        f"preview={summarize_content(file_update.content)}"
    )
    entry.content = file_update.content
    entry.content_revision = current_revision + 1
    entry.realtime_state = ''
    db.commit()

    cache_text_file(entry.project_id, entry.path, entry.content)

    return serialize_entry(entry)


@app.patch('/files/{file_id}')
def rename_file_entry(
    file_id: int,
    payload: FilePathUpdate,
    current_user: models.User | None = Depends(get_optional_current_user),
    db: Session = Depends(get_db),
):
    entry = get_entry_or_404(db, file_id)
    ensure_project_access(db, entry.project, current_user, {'maintainer', 'editor'})
    next_path = normalize_relative_path(payload.path)
    old_path = entry.path
    project_id = entry.project_id

    if next_path == old_path:
        return serialize_entry(entry)

    if entry.kind == FOLDER_ENTRY_KIND and (
        next_path == old_path
        or next_path.startswith(f'{old_path}/')
    ):
        raise HTTPException(status_code=400, detail='Folder cannot be moved into itself')

    affected_entries = [entry]
    if entry.kind == FOLDER_ENTRY_KIND:
        affected_entries.extend(list_descendant_entries(db, entry.project_id, old_path))

    affected_paths = {current.path for current in affected_entries}
    entries_by_path = get_project_entries_map(db, entry.project_id)

    for current_entry in affected_entries:
        entries_by_path.pop(current_entry.path, None)

    ensure_parent_folders(db, entry.project_id, get_parent_path(next_path), entries_by_path)

    remapped_paths = {}
    for current_entry in affected_entries:
        suffix = current_entry.path[len(old_path):]
        mapped_path = f'{next_path}{suffix}' if suffix else next_path
        if mapped_path in entries_by_path or mapped_path in remapped_paths.values():
            raise HTTPException(status_code=409, detail=f'Path already exists: "{mapped_path}"')
        remapped_paths[current_entry.id] = mapped_path

    source_path = get_entry_disk_path(project_id, old_path)
    destination_path = get_entry_disk_path(project_id, next_path)

    for current_entry in affected_entries:
        current_entry.path = remapped_paths[current_entry.id]
        current_entry.name = PurePosixPath(current_entry.path).name

    db.commit()

    with contextlib.suppress(OSError, shutil.Error):
        if source_path.exists():
            destination_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(source_path), str(destination_path))
    cache_project_workspace(
        project_id,
        db.query(models.File).filter(models.File.project_id == project_id).all(),
    )
    db.refresh(entry)

    return serialize_entry(entry)


@app.delete('/files/{file_id}')
def delete_file_entry(
    file_id: int,
    current_user: models.User | None = Depends(get_optional_current_user),
    db: Session = Depends(get_db),
):
    entry = get_entry_or_404(db, file_id)
    ensure_project_access(db, entry.project, current_user, {'maintainer', 'editor'})
    project_id = entry.project_id
    disk_path = get_entry_disk_path(project_id, entry.path)

    if entry.kind == FOLDER_ENTRY_KIND:
        affected_entries = [entry, *list_descendant_entries(db, project_id, entry.path)]
        for current_entry in affected_entries:
            db.delete(current_entry)
    else:
        db.delete(entry)

    db.commit()
    cache_project_workspace(
        project_id,
        db.query(models.File).filter(models.File.project_id == project_id).all(),
    )
    delete_cache_path(disk_path)

    return {'status': 'success', 'id': file_id}


@app.get('/files/{file_id}/raw')
def get_file_raw(
    file_id: int,
    download: bool = Query(False),
    current_user: models.User | None = Depends(get_optional_current_user),
    db: Session = Depends(get_db),
):
    entry = get_entry_or_404(db, file_id)
    ensure_project_access(db, entry.project, current_user)
    if entry.kind == FOLDER_ENTRY_KIND:
        raise HTTPException(status_code=400, detail='Folders do not have raw content')

    raw_content = read_entry_content_bytes(db, entry.project_id, entry, missing_status_code=404)
    media_type, _ = mimetypes.guess_type(entry.path)
    return build_bytes_response(
        raw_content,
        entry.name,
        media_type or 'application/octet-stream',
        download=download,
    )


@app.post('/internal/preview/project-snapshot')
def get_preview_project_snapshot(
    payload: PreviewSnapshotRequest,
    _: None = Depends(require_preview_secret),
    db: Session = Depends(get_db),
):
    get_project_or_404(db, payload.project_id)
    entries = db.query(models.File).filter(models.File.project_id == payload.project_id).all()
    revision = build_project_snapshot_revision(db, payload.project_id, entries)

    if payload.known_revision and payload.known_revision == revision:
        return {
            'protocol_version': 1,
            'project_id': payload.project_id,
            'revision': revision,
            'unchanged': True,
        }

    snapshot_entries = build_compiler_workspace_snapshot(db, payload.project_id, entries)
    return {
        'protocol_version': 1,
        'project_id': payload.project_id,
        'revision': revision,
        'unchanged': False,
        'files': snapshot_entries,
    }


@app.post('/internal/realtime/resolve-file-room')
def resolve_realtime_file_room(
    payload: RealtimeRoomResolveRequest,
    current_user: models.User = Depends(get_current_user),
    _: None = Depends(require_realtime_secret),
    db: Session = Depends(get_db),
):
    entry = get_entry_or_404(db, payload.file_id)
    if entry.kind == FOLDER_ENTRY_KIND:
        raise HTTPException(status_code=400, detail='Folders do not have realtime rooms')
    if is_binary_entry(entry):
        raise HTTPException(status_code=400, detail='Binary files do not have realtime rooms')

    return serialize_realtime_session(db, entry, current_user)


@app.post('/internal/realtime/flush-file')
def flush_realtime_file(
    payload: RealtimeFlushFileRequest,
    _: None = Depends(require_realtime_secret),
    db: Session = Depends(get_db),
):
    entry = get_entry_or_404(db, payload.file_id)
    if entry.kind == FOLDER_ENTRY_KIND:
        raise HTTPException(status_code=400, detail='Folders do not have editable content')
    if is_binary_entry(entry):
        raise HTTPException(status_code=400, detail='Binary files cannot be flushed as text')

    current_revision = entry.content_revision or 0
    if payload.content_revision is not None and payload.content_revision != current_revision:
        raise HTTPException(status_code=409, detail='File content changed outside this realtime room')

    print(
        f"[api] flush-content file={entry.id} path={entry.path} len={len(payload.content or '')} "
        f"preview={summarize_content(payload.content)}"
    )
    entry.content = payload.content
    entry.content_revision = current_revision + 1
    entry.realtime_state = payload.state_base64 or ''
    db.commit()
    db.refresh(entry)

    cache_text_file(entry.project_id, entry.path, entry.content)

    return {
        'status': 'flushed',
        'file_id': entry.id,
        'project_id': entry.project_id,
        'path': entry.path,
        'updated_by_id': payload.updated_by_id,
        'content_revision': entry.content_revision or 0,
        'updated_at': entry.updated_at,
    }


@app.post('/projects/{project_id}/compile')
def compile_project(
    project_id: int,
    payload: ProjectCompileRequest,
    current_user: models.User | None = Depends(get_optional_current_user),
    db: Session = Depends(get_db),
):
    project = get_project_or_404(db, project_id)
    ensure_project_access(db, project, current_user, {'maintainer', 'editor', 'commenter', 'viewer'})

    entries = db.query(models.File).filter(models.File.project_id == project_id).all()
    entry = resolve_project_entrypoint(entries, payload.entrypoint)
    entrypoint = entry.path

    return compile_project_snapshot(db, project_id, entrypoint, entries)


@app.get('/fonts')
def list_available_fonts():
    return {'fonts': get_available_fonts_from_compiler()}


@app.get('/projects/{project_id}/pdf')
def get_pdf(
    project_id: int,
    entrypoint: str = Query('main.typ'),
    current_user: models.User | None = Depends(get_optional_current_user),
    db: Session = Depends(get_db),
):
    project = get_project_or_404(db, project_id)
    ensure_project_access(db, project, current_user)
    entries = db.query(models.File).filter(models.File.project_id == project_id).all()
    entry = resolve_project_entrypoint(entries, entrypoint)
    pdf_relative_path = Path(entry.path).with_suffix('.pdf').as_posix()
    artifact, raw_content = read_project_artifact_bytes(db, project_id, pdf_relative_path, 'application/pdf')
    return build_bytes_response(
        raw_content,
        Path(artifact.path).name,
        artifact.media_type or 'application/pdf',
    )


@app.get('/projects/{project_id}/pdf/download')
def download_pdf(
    project_id: int,
    entrypoint: str = Query('main.typ'),
    current_user: models.User | None = Depends(get_optional_current_user),
    db: Session = Depends(get_db),
):
    project = get_project_or_404(db, project_id)
    ensure_project_access(db, project, current_user, {'maintainer', 'editor'})
    entries = db.query(models.File).filter(models.File.project_id == project_id).all()
    entry = resolve_project_entrypoint(entries, entrypoint)
    normalized_entrypoint = entry.path

    payload = compile_project_snapshot(db, project_id, normalized_entrypoint, entries)

    if payload.get('status') != 'success':
        raise HTTPException(status_code=400, detail=payload.get('message') or 'Failed to export PDF')

    pdf_relative_path = Path(normalized_entrypoint).with_suffix('.pdf').as_posix()
    artifact, raw_content = read_project_artifact_bytes(db, project_id, pdf_relative_path, 'application/pdf')
    return build_bytes_response(
        raw_content,
        Path(artifact.path).name,
        artifact.media_type or 'application/pdf',
        download=True,
    )
