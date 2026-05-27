import base64
import binascii
import json
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path, PurePosixPath


def send_json(handler, payload, status=200):
    handler.send_response(status)
    handler.send_header('Content-Type', 'application/json')
    handler.end_headers()
    handler.wfile.write(json.dumps(payload).encode())


def list_available_fonts():
    result = subprocess.run(
        ['typst', 'fonts'],
        capture_output=True,
        text=True,
        timeout=10,
    )

    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or 'Failed to list fonts')

    return [
        line.strip()
        for line in result.stdout.splitlines()
        if line.strip()
    ]


def is_template_typ_path(path):
    parts = path.lower().split("/")
    filename = parts[-1] if parts else ''
    return filename == 'template.typ' or 'template' in parts or 'templates' in parts


def normalize_relative_path(raw_path):
    normalized = (raw_path or "").strip().replace("\\", "/")
    if not normalized:
        raise ValueError("Path is required")

    candidate = PurePosixPath(normalized)
    if candidate.is_absolute() or normalized.startswith("/") or ".." in candidate.parts:
        raise ValueError(f"Invalid path: {raw_path}")

    return candidate.as_posix()


def resolve_entrypoint(project_dir, raw_path):
    normalized_raw = (raw_path or '').strip().replace('\\', '/')
    search_candidates = []

    if normalized_raw:
        prefix = f'{project_dir.as_posix().rstrip("/")}/'
        if normalized_raw.startswith(prefix):
            normalized_raw = normalized_raw.split(prefix, 1)[1]
        search_candidates = [normalized_raw]
        if normalized_raw.startswith('/'):
            search_candidates.append(normalized_raw.lstrip('/'))

    typ_files = sorted(
        current.relative_to(project_dir).as_posix()
        for current in project_dir.rglob('*.typ')
        if current.is_file()
    )
    if not typ_files:
        return 'main.typ'

    for candidate in search_candidates:
        if candidate in typ_files:
            return normalize_relative_path(candidate)

        suffix_matches = [path for path in typ_files if path.endswith(f'/{candidate}')]
        if len(suffix_matches) == 1:
            return suffix_matches[0]

        basename_matches = [path for path in typ_files if Path(path).name == Path(candidate).name]
        if len(basename_matches) == 1:
            return basename_matches[0]

    direct_main = next((path for path in typ_files if path == 'main.typ'), None)
    if direct_main:
        return direct_main

    nested_main = sorted(
        [path for path in typ_files if path.endswith('/main.typ')],
        key=lambda path: (path.count('/'), path),
    )
    if nested_main:
        return nested_main[0]

    non_template_paths = sorted(
        [path for path in typ_files if not is_template_typ_path(path)],
        key=lambda path: (path.count('/'), path),
    )
    if non_template_paths:
        return non_template_paths[0]

    return sorted(typ_files, key=lambda path: (path.count('/'), path))[0]


def materialize_snapshot(project_dir, files):
    for entry in files:
        if not isinstance(entry, dict):
            raise ValueError('Invalid file entry')

        relative_path = normalize_relative_path(entry.get('path') or '')
        kind = entry.get('kind') or 'file'
        disk_path = project_dir / relative_path

        if kind == 'folder':
            disk_path.mkdir(parents=True, exist_ok=True)
            continue

        raw_content = entry.get('content_base64')
        if not isinstance(raw_content, str):
            raise ValueError(f'Missing content for "{relative_path}"')

        try:
            decoded_content = base64.b64decode(raw_content.encode('ascii'))
        except (ValueError, binascii.Error) as exc:
            raise ValueError(f'Invalid base64 content for "{relative_path}"') from exc

        disk_path.parent.mkdir(parents=True, exist_ok=True)
        disk_path.write_bytes(decoded_content)


def compile_snapshot(project_id, entrypoint, files):
    with tempfile.TemporaryDirectory(prefix=f'typst-project-{project_id}-') as temp_dir:
        project_dir = Path(temp_dir)
        materialize_snapshot(project_dir, files)
        resolved_entrypoint = resolve_entrypoint(project_dir, entrypoint or 'main.typ')
        output_relative_path = Path(resolved_entrypoint).with_suffix('.pdf')
        output_path = project_dir / output_relative_path

        result = subprocess.run(
            ['typst', 'compile', str(project_dir / resolved_entrypoint), str(output_path)],
            capture_output=True,
            text=True,
            timeout=10,
        )

        if result.returncode != 0:
            return {
                'status': 'error',
                'message': result.stderr or result.stdout or 'Compilation failed',
            }

        if not output_path.exists():
            return {
                'status': 'error',
                'message': 'Compiler did not produce a PDF artifact',
            }

        return {
            'status': 'success',
            'message': result.stdout or 'Compilation succeeded',
            'entrypoint': resolved_entrypoint,
            'output_path': output_relative_path.as_posix(),
            'pdf_base64': base64.b64encode(output_path.read_bytes()).decode('ascii'),
        }


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != '/fonts':
            send_json(self, {'detail': 'Not found'}, status=404)
            return

        try:
            send_json(self, {'fonts': list_available_fonts()})
        except Exception as exc:
            send_json(self, {'detail': str(exc)}, status=500)

    def do_POST(self):
        if self.path != '/':
            send_json(self, {'detail': 'Not found'}, status=404)
            return

        try:
            data = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            pid = int(data['project_id'])
            files = data.get('files')
            if not isinstance(files, list):
                raise ValueError('files must be a list')
            payload = compile_snapshot(pid, data.get('entrypoint') or 'main.typ', files)
            send_json(self, payload)
        except (KeyError, TypeError, ValueError) as exc:
            send_json(self, {'detail': str(exc)}, status=400)
        except subprocess.TimeoutExpired:
            send_json(self, {'status': 'error', 'message': 'Compilation timed out'})
        except Exception as exc:
            send_json(self, {'detail': str(exc)}, status=500)

HTTPServer(('0.0.0.0', 8001), Handler).serve_forever()
