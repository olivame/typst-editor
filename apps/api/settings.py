import os
from pathlib import Path


def split_csv_env(name: str, default: str) -> list[str]:
    raw = os.getenv(name, default)
    return [item.strip() for item in raw.split(",") if item.strip()]


def build_service_url(prefix: str, default_host: str, default_port: str, default_scheme: str = "http") -> str:
    explicit_url = os.getenv(f"{prefix}_URL", "").strip()
    if explicit_url:
        return explicit_url.rstrip("/")

    scheme = os.getenv(f"{prefix}_SCHEME", default_scheme).strip() or default_scheme
    host = os.getenv(f"{prefix}_HOST", default_host).strip() or default_host
    port = os.getenv(f"{prefix}_PORT", default_port).strip()
    port_suffix = f":{port}" if port else ""
    return f"{scheme}://{host}{port_suffix}".rstrip("/")


DB_USER = os.getenv("DB_USER", "typst")
DB_PASSWORD = os.getenv("DB_PASSWORD", "typst_password")
DB_HOST = os.getenv("DB_HOST", "db")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "typst_editor")

DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

WORKSPACE_DIR = Path(os.getenv("WORKSPACE_DIR", "/workspace/projects"))
COMPILER_HOST = os.getenv("COMPILER_HOST", "compiler")
COMPILER_PORT = os.getenv("COMPILER_PORT", "8001")
COMPILER_URL = build_service_url("COMPILER", COMPILER_HOST, COMPILER_PORT)
COMPILER_TIMEOUT_SECONDS = float(os.getenv("COMPILER_TIMEOUT_SECONDS", "10"))
CORS_ALLOW_ORIGINS = split_csv_env("CORS_ALLOW_ORIGINS", "*")
REALTIME_HOST = os.getenv("REALTIME_HOST", "realtime")
REALTIME_PORT = os.getenv("REALTIME_PORT", "8003")
REALTIME_URL = build_service_url("REALTIME", REALTIME_HOST, REALTIME_PORT, "ws")
REALTIME_INTERNAL_URL = build_service_url("REALTIME_INTERNAL", REALTIME_HOST, REALTIME_PORT)
REALTIME_SECRET = os.getenv("REALTIME_SECRET", "change-this-realtime-secret")
PREVIEW_SECRET = os.getenv("PREVIEW_SECRET", "change-this-preview-secret")
