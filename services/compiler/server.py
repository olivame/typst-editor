from http.server import HTTPServer, BaseHTTPRequestHandler
import subprocess
import json

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        data = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        pid = data['project_id']

        result = subprocess.run(
            ['typst', 'compile', f'/workspace/projects/{pid}/main.typ'],
            capture_output=True, text=True, timeout=10
        )

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({
            'status': 'success' if result.returncode == 0 else 'error',
            'message': result.stdout if result.returncode == 0 else result.stderr
        }).encode())

HTTPServer(('0.0.0.0', 8001), Handler).serve_forever()
