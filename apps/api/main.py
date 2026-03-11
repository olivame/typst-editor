from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
import models
from database import engine, get_db
import requests
from settings import COMPILER_TIMEOUT_SECONDS, COMPILER_URL, CORS_ALLOW_ORIGINS, WORKSPACE_DIR

models.Base.metadata.create_all(bind=engine)

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

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/projects")
def create_project(project: ProjectCreate, db: Session = Depends(get_db)):
    db_project = models.Project(name=project.name)
    db.add(db_project)
    db.commit()
    db.refresh(db_project)

    main_file = models.File(project_id=db_project.id, name="main.typ", content="= Hello Typst\n\nThis is a new document.")
    db.add(main_file)
    db.commit()

    return {"id": db_project.id, "name": db_project.name}

@app.get("/projects")
def list_projects(db: Session = Depends(get_db)):
    projects = db.query(models.Project).all()
    return [{"id": p.id, "name": p.name, "created_at": p.created_at} for p in projects]

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
