from http.server import HTTPServer, BaseHTTPRequestHandler
import subprocess
import json
from pathlib import Path


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


def resolve_entrypoint(project_id, raw_path):
    project_dir = Path(f'/workspace/projects/{project_id}')
    normalized_raw = (raw_path or '').strip().replace('\\', '/')
    search_candidates = []

    if normalized_raw:
        prefix = f'/workspace/projects/{project_id}/'
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
            return candidate

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

    return sorted(typ_files, key=lambda path: (path.count('/'), path))[0]


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

        data = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        pid = data['project_id']
        entrypoint = resolve_entrypoint(pid, data.get('entrypoint') or 'main.typ')

        result = subprocess.run(
            ['typst', 'compile', f'/workspace/projects/{pid}/{entrypoint}'],
            capture_output=True, text=True, timeout=10
        )

        send_json(self, {
            'status': 'success' if result.returncode == 0 else 'error',
            'message': result.stdout if result.returncode == 0 else result.stderr
        })

HTTPServer(('0.0.0.0', 8001), Handler).serve_forever()
