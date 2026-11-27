"""AI 资产目录的本机只读服务。运行 python3 server.py --help 查看参数。"""
import argparse
import json
import threading
import webbrowser
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from inventory import Inventory

WEB = Path(__file__).parent / 'web'
ASSETS = {'/': ('index.html', 'text/html'), '/app.js': ('app.js', 'text/javascript'),
          '/style.css': ('style.css', 'text/css')}


def demo():
    items = []
    for index, (kind, title, desc, group, apps) in enumerate([
        ('skill','整理阅读笔记','把一周的阅读摘录整理成带主题和出处的笔记。','个人 Skill',['Codex','Claude']),
        ('memory','周报写作偏好','先列本周交付，再写下周计划。','长期记忆',['Claude']),
        ('mcp','example-calendar','查询虚构日历中的示例事件。','MCP 服务',['Codex']),
    ]):
        items.append(dict(id=str(index), kind=kind, title=title, description=desc,
                          sources=[dict(app=a, scope='虚构示例', path='示例来源', status='示例') for a in apps],
                          groups=[group], updated=0))
    return dict(items=items, warnings=[], scanned=datetime.now(timezone.utc).isoformat(), demo=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=17832, help='本地端口（默认 17832）')
    parser.add_argument('--project', type=Path, action='append', default=[], help='额外项目路径，可重复')
    parser.add_argument('--demo', action='store_true', help='只显示虚构示例')
    parser.add_argument('--open', action='store_true', help='启动后打开浏览器')
    args = parser.parse_args()
    lock = threading.Lock()
    files = {}
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def send(self, code, data, mime):
            self.send_response(code)
            self.send_header('Content-Type', mime + '; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options','nosniff')
            self.send_header('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'")
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            allowed = ('127.0.0.1:' + str(self.server.server_port), 'localhost:' + str(self.server.server_port))
            if self.headers.get('Host') not in allowed or self.headers.get('Sec-Fetch-Site') == 'cross-site' and self.headers.get('Sec-Fetch-Mode') != 'navigate':
                return self.send(403,b'Forbidden','text/plain')
            path = urlsplit(self.path).path
            if path in ASSETS:
                filename, mime = ASSETS[path]
                return self.send(200,(WEB/filename).read_bytes(),mime)
            if path == '/api/inventory':
                if args.demo:
                    result = demo()
                else:
                    with lock:
                        inv = Inventory(Path.home(), [p.expanduser().resolve() for p in args.project])
                        result = inv.scan()
                        files.clear()
                        files.update(inv.files)
                return self.send(200,json.dumps(result, ensure_ascii=False).encode(),'application/json')
            if path.startswith('/api/document/'):
                key = path.removeprefix('/api/document/')
                with lock:
                    file = files.get(key)
                if file and file.is_file():
                    try:
                        return self.send(200,file.read_bytes(),'text/plain')
                    except OSError:
                        pass
            if path == '/api/identity':
                return self.send(200,b'ai-inventory-demo' if args.demo else b'ai-inventory-local','text/plain')
            self.send(404,b'Not found','text/plain')

    server = ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    url = f'http://127.0.0.1:{server.server_port}/'
    print(f'本机看板已启动 {url}', flush=True)
    if args.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
