import os
from pathlib import Path


def split_csv_env(name: str, default: str) -> list[str]:
    raw = os.getenv(name, default)
    return [item.strip() for item in raw.split(",") if item.strip()]


DB_USER = os.getenv("DB_USER", "typst")
DB_PASSWORD = os.getenv("DB_PASSWORD", "typst_password")
DB_HOST = os.getenv("DB_HOST", "db")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "typst_editor")

DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

WORKSPACE_DIR = Path(os.getenv("WORKSPACE_DIR", "/workspace/projects"))
COMPILER_URL = os.getenv("COMPILER_URL", "http://compiler:8001")
COMPILER_TIMEOUT_SECONDS = float(os.getenv("COMPILER_TIMEOUT_SECONDS", "10"))
CORS_ALLOW_ORIGINS = split_csv_env("CORS_ALLOW_ORIGINS", "*")
