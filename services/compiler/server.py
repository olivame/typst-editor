from http.server import HTTPServer, BaseHTTPRequestHandler
import subprocess
import json


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

        result = subprocess.run(
            ['typst', 'compile', f'/workspace/projects/{pid}/main.typ'],
            capture_output=True, text=True, timeout=10
        )

        send_json(self, {
            'status': 'success' if result.returncode == 0 else 'error',
            'message': result.stdout if result.returncode == 0 else result.stderr
        })

HTTPServer(('0.0.0.0', 8001), Handler).serve_forever()
