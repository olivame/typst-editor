from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session
from pydantic import BaseModel
import models
from database import engine, get_db
import requests
import shutil
from settings import COMPILER_TIMEOUT_SECONDS, COMPILER_URL, CORS_ALLOW_ORIGINS, WORKSPACE_DIR

models.Base.metadata.create_all(bind=engine)

with engine.begin() as connection:
    inspector = inspect(connection)
    project_columns = {column["name"] for column in inspector.get_columns("projects")}
    if "status" not in project_columns:
        connection.execute(
            text("ALTER TABLE projects ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'active'")
        )

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOW_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

WORKSPACE_DIR.mkdir(parents=True, exist_ok=True)

class ProjectCreate(BaseModel):
    name: str

class FileUpdate(BaseModel):
    content: str


class ProjectStatusUpdate(BaseModel):
    status: str


def serialize_project(project: models.Project):
    return {
        "id": project.id,
        "name": project.name,
        "status": project.status,
        "created_at": project.created_at,
    }


def make_unique_project_name(db: Session, base_name: str):
    normalized_name = base_name.strip() or "Untitled Project"
    existing_names = {
        project_name
        for project_name, in db.query(models.Project.name).all()
    }

    if normalized_name not in existing_names:
        return normalized_name

    suffix = 2
    while True:
        candidate = f"{normalized_name} ({suffix})"
        if candidate not in existing_names:
            return candidate
        suffix += 1

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/projects")
def create_project(project: ProjectCreate, db: Session = Depends(get_db)):
    db_project = models.Project(name=project.name.strip(), status="active")
    db.add(db_project)
    db.commit()
    db.refresh(db_project)

    main_file = models.File(project_id=db_project.id, name="main.typ", content="= Hello Typst\n\nThis is a new document.")
    db.add(main_file)
    db.commit()

    return serialize_project(db_project)

@app.get("/projects")
def list_projects(db: Session = Depends(get_db)):
    projects = db.query(models.Project).order_by(models.Project.created_at.desc()).all()
    return [serialize_project(project) for project in projects]


@app.post("/projects/{project_id}/copy")
def copy_project(project_id: int, db: Session = Depends(get_db)):
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    copied_project = models.Project(
        name=make_unique_project_name(db, f"{project.name} Copy"),
        status="active",
    )
    db.add(copied_project)
    db.commit()
    db.refresh(copied_project)

    source_files = db.query(models.File).filter(models.File.project_id == project_id).all()
    for source_file in source_files:
        db.add(
            models.File(
                project_id=copied_project.id,
                name=source_file.name,
                content=source_file.content,
            )
        )
    db.commit()

    source_dir = WORKSPACE_DIR / str(project_id)
    copied_dir = WORKSPACE_DIR / str(copied_project.id)
    copied_dir.mkdir(parents=True, exist_ok=True)

    if source_dir.exists():
        for source_path in source_dir.iterdir():
            if source_path.is_file():
                shutil.copy2(source_path, copied_dir / source_path.name)

    return serialize_project(copied_project)


@app.patch("/projects/{project_id}/status")
def update_project_status(project_id: int, status_update: ProjectStatusUpdate, db: Session = Depends(get_db)):
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if status_update.status not in {"active", "archived", "trashed"}:
        raise HTTPException(status_code=400, detail="Invalid project status")

    project.status = status_update.status
    db.commit()
    db.refresh(project)

    return serialize_project(project)


@app.delete("/projects/{project_id}")
def delete_project(project_id: int, db: Session = Depends(get_db)):
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    db.delete(project)
    db.commit()

    project_dir = WORKSPACE_DIR / str(project_id)
    if project_dir.exists():
        shutil.rmtree(project_dir)

    return {"status": "success", "id": project_id}

@app.get("/projects/{project_id}/files")
def list_files(project_id: int, db: Session = Depends(get_db)):
    files = db.query(models.File).filter(models.File.project_id == project_id).all()
    return [{"id": f.id, "name": f.name, "project_id": f.project_id} for f in files]

@app.get("/files/{file_id}/content")
def get_file_content(file_id: int, db: Session = Depends(get_db)):
    file = db.query(models.File).filter(models.File.id == file_id).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    return {"id": file.id, "name": file.name, "content": file.content}

@app.put("/files/{file_id}/content")
def update_file_content(file_id: int, file_update: FileUpdate, db: Session = Depends(get_db)):
    file = db.query(models.File).filter(models.File.id == file_id).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    file.content = file_update.content
    db.commit()

    project_dir = WORKSPACE_DIR / str(file.project_id)
    project_dir.mkdir(parents=True, exist_ok=True)
    (project_dir / file.name).write_text(file.content, encoding='utf-8')

    return {"id": file.id, "name": file.name}

@app.post("/projects/{project_id}/compile")
def compile_project(project_id: int, db: Session = Depends(get_db)):
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    project_dir = WORKSPACE_DIR / str(project_id)
    project_dir.mkdir(parents=True, exist_ok=True)

    files = db.query(models.File).filter(models.File.project_id == project_id).all()
    for f in files:
        (project_dir / f.name).write_text(f.content, encoding='utf-8')

    try:
        res = requests.post(
            COMPILER_URL,
            json={'project_id': project_id},
            timeout=COMPILER_TIMEOUT_SECONDS,
        )
        data = res.json()
        return data
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/projects/{project_id}/pdf")
def get_pdf(project_id: int):
    pdf_path = WORKSPACE_DIR / str(project_id) / "main.pdf"
    if not pdf_path.exists():
        raise HTTPException(status_code=404, detail="PDF not found")
    return FileResponse(pdf_path, media_type="application/pdf")

@app.get("/projects/{project_id}/pdf/download")
def download_pdf(project_id: int):
    pdf_path = WORKSPACE_DIR / str(project_id) / "main.pdf"
    if not pdf_path.exists():
        raise HTTPException(status_code=404, detail="PDF not found")
    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        filename="main.pdf",
        content_disposition_type="attachment",
    )
