#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

load_dotenv_defaults() {
  local env_file="$ROOT_DIR/.env"
  if [ ! -f "$env_file" ]; then
    return
  fi

  while IFS= read -r raw_line || [ -n "$raw_line" ]; do
    local line="${raw_line%$'\r'}"
    case "$line" in
      ''|\#*)
        continue
        ;;
      *=*)
        local key="${line%%=*}"
        local value="${line#*=}"
        if [ -z "${!key+x}" ]; then
          export "$key=$value"
        fi
        ;;
    esac
  done < "$env_file"
}

print_usage() {
  cat <<'EOF'
Usage:
  ./compose-smart.sh [docker compose args...]

Examples:
  ./compose-smart.sh -f compose.yaml -f compose.dev.yaml up --build
  ./compose-smart.sh up -d --build
  ./compose-smart.sh --print-env

Environment overrides:
  DOCKER_SOURCE_MODE=auto|cn|global
  POSTGRES_IMAGE=...
  NODE_BASE_IMAGE=...
  PYTHON311_BASE_IMAGE=...
  PYTHON312_BASE_IMAGE=...
  NPM_REGISTRY=...
  PIP_INDEX_URL=...
  PIP_TRUSTED_HOST=...
  APT_MIRROR=...
  TYPST_DOWNLOAD_URL=...
  TINYMIST_DOWNLOAD_URL=...
EOF
}

detect_cn_environment() {
  case "${TZ:-}" in
    Asia/Shanghai|Asia/Chongqing|Asia/Harbin|Asia/Urumqi|PRC|China)
      return 0
      ;;
  esac

  case "${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}" in
    zh_CN*|zh_Hans_CN*|zh_CN.UTF-8)
      return 0
      ;;
  esac

  if [ -L /etc/localtime ]; then
    local localtime_target
    localtime_target="$(readlink /etc/localtime || true)"
    case "$localtime_target" in
      */Asia/Shanghai|*/Asia/Chongqing|*/Asia/Harbin|*/Asia/Urumqi|*/PRC)
        return 0
        ;;
    esac
  fi

  if [ -f /etc/timezone ] && grep -Eq 'Asia/(Shanghai|Chongqing|Harbin|Urumqi)|PRC' /etc/timezone; then
    return 0
  fi

  return 1
}

apply_global_defaults() {
  export POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:16}"
  export NODE_BASE_IMAGE="${NODE_BASE_IMAGE:-node:22-alpine}"
  export PYTHON311_BASE_IMAGE="${PYTHON311_BASE_IMAGE:-python:3.11-slim}"
  export PYTHON312_BASE_IMAGE="${PYTHON312_BASE_IMAGE:-python:3.12-slim}"
  export NPM_REGISTRY="${NPM_REGISTRY:-}"
  export PIP_INDEX_URL="${PIP_INDEX_URL:-}"
  export PIP_TRUSTED_HOST="${PIP_TRUSTED_HOST:-}"
  export APT_MIRROR="${APT_MIRROR:-}"
  export TYPST_DOWNLOAD_URL="${TYPST_DOWNLOAD_URL:-https://github.com/typst/typst/releases/download/v0.14.2/typst-x86_64-unknown-linux-musl.tar.xz}"
  export TINYMIST_DOWNLOAD_URL="${TINYMIST_DOWNLOAD_URL:-https://github.com/Myriad-Dreamin/tinymist/releases/download/v0.14.8/tinymist-x86_64-unknown-linux-musl.tar.gz}"
}

apply_cn_defaults() {
  export POSTGRES_IMAGE="${POSTGRES_IMAGE:-docker.m.daocloud.io/library/postgres:16}"
  export NODE_BASE_IMAGE="${NODE_BASE_IMAGE:-docker.m.daocloud.io/library/node:22-alpine}"
  export PYTHON311_BASE_IMAGE="${PYTHON311_BASE_IMAGE:-docker.m.daocloud.io/library/python:3.11-slim}"
  export PYTHON312_BASE_IMAGE="${PYTHON312_BASE_IMAGE:-docker.m.daocloud.io/library/python:3.12-slim}"
  export NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"
  export PIP_INDEX_URL="${PIP_INDEX_URL:-https://pypi.tuna.tsinghua.edu.cn/simple}"
  export PIP_TRUSTED_HOST="${PIP_TRUSTED_HOST:-pypi.tuna.tsinghua.edu.cn}"
  export APT_MIRROR="${APT_MIRROR:-https://mirrors.tuna.tsinghua.edu.cn/debian}"
  export TYPST_DOWNLOAD_URL="${TYPST_DOWNLOAD_URL:-https://gitee.com/olivame/typst-file/releases/download/v0.01/typst-x86_64-unknown-linux-musl.tar.xz}"
  export TINYMIST_DOWNLOAD_URL="${TINYMIST_DOWNLOAD_URL:-https://gitee.com/olivame/typst-file/releases/download/v0.01/tinymist-x86_64-unknown-linux-musl.tar.gz}"
}

resolve_source_mode() {
  case "${DOCKER_SOURCE_MODE:-auto}" in
    cn|china)
      echo "cn"
      ;;
    global|official|overseas)
      echo "global"
      ;;
    auto)
      if detect_cn_environment; then
        echo "cn"
      else
        echo "global"
      fi
      ;;
    *)
      echo "Unsupported DOCKER_SOURCE_MODE: ${DOCKER_SOURCE_MODE}" >&2
      exit 1
      ;;
  esac
}

print_selected_env() {
  cat <<EOF
DOCKER_SOURCE_MODE=${SELECTED_SOURCE_MODE}
POSTGRES_IMAGE=${POSTGRES_IMAGE}
NODE_BASE_IMAGE=${NODE_BASE_IMAGE}
PYTHON311_BASE_IMAGE=${PYTHON311_BASE_IMAGE}
PYTHON312_BASE_IMAGE=${PYTHON312_BASE_IMAGE}
NPM_REGISTRY=${NPM_REGISTRY}
PIP_INDEX_URL=${PIP_INDEX_URL}
PIP_TRUSTED_HOST=${PIP_TRUSTED_HOST}
APT_MIRROR=${APT_MIRROR}
TYPST_DOWNLOAD_URL=${TYPST_DOWNLOAD_URL}
TINYMIST_DOWNLOAD_URL=${TINYMIST_DOWNLOAD_URL}
EOF
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  print_usage
  exit 0
fi

load_dotenv_defaults

SELECTED_SOURCE_MODE="$(resolve_source_mode)"
if [ "$SELECTED_SOURCE_MODE" = "cn" ]; then
  apply_cn_defaults
else
  apply_global_defaults
fi

if [ "${1:-}" = "--print-env" ]; then
  print_selected_env
  exit 0
fi

if [ "$#" -eq 0 ]; then
  print_usage
  exit 1
fi

echo "[compose-smart] source mode: ${SELECTED_SOURCE_MODE}" >&2
exec docker compose "$@"
