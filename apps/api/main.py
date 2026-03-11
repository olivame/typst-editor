import json
import shutil
from pathlib import Path, PurePosixPath

import requests
from fastapi import Depends, FastAPI, File as FastAPIFile, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

import models
from database import engine, get_db
from settings import COMPILER_TIMEOUT_SECONDS, COMPILER_URL, CORS_ALLOW_ORIGINS, WORKSPACE_DIR


DEFAULT_MAIN_CONTENT = '= Hello Typst\n\nThis is a new document.'
TEXT_ENTRY_KIND = 'file'
FOLDER_ENTRY_KIND = 'folder'
ALLOWED_PROJECT_STATUSES = {'active', 'archived', 'trashed'}

models.Base.metadata.create_all(bind=engine)

with engine.begin() as connection:
    inspector = inspect(connection)

    project_columns = {column['name'] for column in inspector.get_columns('projects')}
    if 'status' not in project_columns:
        connection.execute(
            text("ALTER TABLE projects ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'active'")
        )

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

    refreshed_file_columns = {column['name'] for column in inspect(connection).get_columns('files')}
    if 'path' in refreshed_file_columns:
        connection.execute(text("UPDATE files SET path = name WHERE path IS NULL OR path = ''"))
    if 'kind' in refreshed_file_columns:
        connection.execute(text("UPDATE files SET kind = 'file' WHERE kind IS NULL OR kind = ''"))
    if 'is_binary' in refreshed_file_columns:
        connection.execute(text("UPDATE files SET is_binary = FALSE WHERE is_binary IS NULL"))

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


class FileCreate(BaseModel):
    path: str


class FolderCreate(BaseModel):
    path: str


class FileUpdate(BaseModel):
    content: str


class ProjectStatusUpdate(BaseModel):
    status: str


def serialize_project(project: models.Project):
    return {
        'id': project.id,
        'name': project.name,
        'status': project.status,
        'created_at': project.created_at,
    }


def serialize_entry(entry: models.File):
    return {
        'id': entry.id,
        'name': entry.name,
        'path': entry.path,
        'kind': entry.kind,
        'is_binary': entry.is_binary,
        'project_id': entry.project_id,
    }


def search_project_entries(entries: list[models.File], query: str):
    normalized_query = query.strip().lower()
    if not normalized_query:
        return []

    results = []
    for entry in entries:
        if entry.kind != TEXT_ENTRY_KIND or entry.is_binary:
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


def get_project_or_404(db: Session, project_id: int):
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail='Project not found')
    return project


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


def get_project_entries_map(db: Session, project_id: int):
    entries = db.query(models.File).filter(models.File.project_id == project_id).all()
    return {entry.path: entry for entry in entries}


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

    for entry in sorted(entries, key=lambda current: (current.path.count('/'), current.path)):
        disk_path = get_entry_disk_path(project_id, entry.path)

        if entry.kind == FOLDER_ENTRY_KIND:
            disk_path.mkdir(parents=True, exist_ok=True)
            continue

        disk_path.parent.mkdir(parents=True, exist_ok=True)
        if entry.is_binary:
            continue

        disk_path.write_text(entry.content or '', encoding='utf-8')


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

    disk_path = get_entry_disk_path(project_id, relative_path)
    disk_path.parent.mkdir(parents=True, exist_ok=True)
    disk_path.write_text(content, encoding='utf-8')

    return entry


@app.get('/health')
def health():
    return {'status': 'ok'}


@app.post('/projects')
def create_project(project: ProjectCreate, db: Session = Depends(get_db)):
    db_project = models.Project(name=project.name.strip(), status='active')
    db.add(db_project)
    db.commit()
    db.refresh(db_project)

    get_project_dir(db_project.id).mkdir(parents=True, exist_ok=True)
    create_text_file_entry(db, db_project.id, 'main.typ', DEFAULT_MAIN_CONTENT)

    return serialize_project(db_project)


@app.get('/projects')
def list_projects(db: Session = Depends(get_db)):
    projects = db.query(models.Project).order_by(models.Project.created_at.desc()).all()
    return [serialize_project(project) for project in projects]


@app.post('/projects/{project_id}/copy')
def copy_project(project_id: int, db: Session = Depends(get_db)):
    project = get_project_or_404(db, project_id)

    copied_project = models.Project(
        name=make_unique_project_name(db, f'{project.name} Copy'),
        status='active',
    )
    db.add(copied_project)
    db.commit()
    db.refresh(copied_project)

    source_entries = db.query(models.File).filter(models.File.project_id == project_id).all()
    for source_entry in source_entries:
        db.add(
            models.File(
                project_id=copied_project.id,
                name=source_entry.name,
                path=source_entry.path,
                kind=source_entry.kind,
                is_binary=source_entry.is_binary,
                content=source_entry.content,
            )
        )
    db.commit()

    source_dir = get_project_dir(project_id)
    copied_dir = get_project_dir(copied_project.id)
    copied_dir.mkdir(parents=True, exist_ok=True)

    if source_dir.exists():
        shutil.copytree(source_dir, copied_dir, dirs_exist_ok=True)
    else:
        copied_entries = db.query(models.File).filter(models.File.project_id == copied_project.id).all()
        sync_project_workspace(copied_project.id, copied_entries)

    return serialize_project(copied_project)


@app.patch('/projects/{project_id}/status')
def update_project_status(
    project_id: int,
    status_update: ProjectStatusUpdate,
    db: Session = Depends(get_db),
):
    project = get_project_or_404(db, project_id)

    if status_update.status not in ALLOWED_PROJECT_STATUSES:
        raise HTTPException(status_code=400, detail='Invalid project status')

    project.status = status_update.status
    db.commit()
    db.refresh(project)

    return serialize_project(project)


@app.delete('/projects/{project_id}')
def delete_project(project_id: int, db: Session = Depends(get_db)):
    project = get_project_or_404(db, project_id)

    db.delete(project)
    db.commit()

    project_dir = get_project_dir(project_id)
    if project_dir.exists():
        shutil.rmtree(project_dir)

    return {'status': 'success', 'id': project_id}


@app.get('/projects/{project_id}/files')
def list_files(project_id: int, db: Session = Depends(get_db)):
    get_project_or_404(db, project_id)
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
    db: Session = Depends(get_db),
):
    get_project_or_404(db, project_id)
    entries = db.query(models.File).filter(models.File.project_id == project_id).all()
    return search_project_entries(entries, q)


@app.post('/projects/{project_id}/files')
def create_file(project_id: int, payload: FileCreate, db: Session = Depends(get_db)):
    get_project_or_404(db, project_id)
    relative_path = normalize_relative_path(payload.path)
    entry = create_text_file_entry(db, project_id, relative_path, '')
    return serialize_entry(entry)


@app.post('/projects/{project_id}/folders')
def create_folder(project_id: int, payload: FolderCreate, db: Session = Depends(get_db)):
    get_project_or_404(db, project_id)
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

    get_entry_disk_path(project_id, relative_path).mkdir(parents=True, exist_ok=True)

    return serialize_entry(folder_entry)


@app.post('/projects/{project_id}/uploads')
def upload_files(
    project_id: int,
    files: list[UploadFile] = FastAPIFile(...),
    parent_path: str = Form(''),
    relative_paths: str = Form(''),
    db: Session = Depends(get_db),
):
    get_project_or_404(db, project_id)

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
        try:
            text_content = binary_content.decode('utf-8')
            is_binary = False
        except UnicodeDecodeError:
            text_content = ''
            is_binary = True

        disk_path = get_entry_disk_path(project_id, relative_path)
        disk_path.parent.mkdir(parents=True, exist_ok=True)
        disk_path.write_bytes(binary_content)

        entry = models.File(
            project_id=project_id,
            name=PurePosixPath(relative_path).name,
            path=relative_path,
            kind=TEXT_ENTRY_KIND,
            is_binary=is_binary,
            content=text_content,
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
def get_file_content(file_id: int, db: Session = Depends(get_db)):
    entry = get_entry_or_404(db, file_id)
    if entry.kind == FOLDER_ENTRY_KIND:
        raise HTTPException(status_code=400, detail='Folders do not have editable content')

    return {
        'id': entry.id,
        'name': entry.name,
        'path': entry.path,
        'kind': entry.kind,
        'is_binary': entry.is_binary,
        'content': '' if entry.is_binary else (entry.content or ''),
    }


@app.put('/files/{file_id}/content')
def update_file_content(file_id: int, file_update: FileUpdate, db: Session = Depends(get_db)):
    entry = get_entry_or_404(db, file_id)
    if entry.kind == FOLDER_ENTRY_KIND:
        raise HTTPException(status_code=400, detail='Folders do not have editable content')
    if entry.is_binary:
        raise HTTPException(status_code=400, detail='Binary files cannot be edited inline')

    entry.content = file_update.content
    db.commit()

    disk_path = get_entry_disk_path(entry.project_id, entry.path)
    disk_path.parent.mkdir(parents=True, exist_ok=True)
    disk_path.write_text(entry.content, encoding='utf-8')

    return serialize_entry(entry)


@app.post('/projects/{project_id}/compile')
def compile_project(project_id: int, db: Session = Depends(get_db)):
    get_project_or_404(db, project_id)

    entries = db.query(models.File).filter(models.File.project_id == project_id).all()
    sync_project_workspace(project_id, entries)

    try:
        response = requests.post(
            COMPILER_URL,
            json={'project_id': project_id},
            timeout=COMPILER_TIMEOUT_SECONDS,
        )
        return response.json()
    except Exception as exc:
        return {'status': 'error', 'message': str(exc)}


@app.get('/projects/{project_id}/pdf')
def get_pdf(project_id: int):
    pdf_path = get_project_dir(project_id) / 'main.pdf'
    if not pdf_path.exists():
        raise HTTPException(status_code=404, detail='PDF not found')
    return FileResponse(pdf_path, media_type='application/pdf')


@app.get('/projects/{project_id}/pdf/download')
def download_pdf(project_id: int, db: Session = Depends(get_db)):
    get_project_or_404(db, project_id)
    entries = db.query(models.File).filter(models.File.project_id == project_id).all()
    sync_project_workspace(project_id, entries)

    try:
        response = requests.post(
            COMPILER_URL,
            json={'project_id': project_id},
            timeout=COMPILER_TIMEOUT_SECONDS,
        )
        payload = response.json()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if payload.get('status') != 'success':
        raise HTTPException(status_code=400, detail=payload.get('message') or 'Failed to export PDF')

    pdf_path = get_project_dir(project_id) / 'main.pdf'
    if not pdf_path.exists():
        raise HTTPException(status_code=404, detail='PDF not found')
    return FileResponse(
        pdf_path,
        media_type='application/pdf',
        filename='main.pdf',
        content_disposition_type='attachment',
    )
