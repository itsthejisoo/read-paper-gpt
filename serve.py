#!/usr/bin/env python3
import argparse
import http.client
import json
import os
import posixpath
import re
import socket
import sys
import threading
import urllib.parse
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

VERSION = '1.2.0'
PROXY_PREFIX = '/__rpt/openai'
HEALTH_PATH = '/__rpt/health'
UPSTREAM = os.environ.get('RPT_UPSTREAM') or 'https://api.openai.com'
CONNECT_TIMEOUT = 15
UPSTREAM_TIMEOUT = 600
LOOPBACK = ('127.0.0.1', '::1', 'localhost')
FORWARD_HEADERS = ('Authorization', 'Content-Type', 'Accept')
DROP_HEADERS = {'connection', 'keep-alive', 'transfer-encoding', 'content-length',
                'alt-svc', 'set-cookie', 'strict-transport-security'}
NOT_FOUND = {'error': {'message': '중계 경로가 아닙니다.', 'code': 'proxy_not_found'}}
UPSTREAM_DOWN = {'error': {'message': 'OpenAI 서버에 연결하지 못했습니다.', 'code': 'proxy_upstream'}}
LENGTH_REQUIRED = {'error': {'message': '요청 본문에는 Content-Length 가 필요합니다.', 'code': 'proxy_length_required'}}
MISDIRECTED = {'error': {'message': '루프백 주소(127.0.0.1, localhost)로만 접속할 수 있습니다.', 'code': 'proxy_misdirected'}}


# Upstream path for a relay request, or None if it leaves /v1/.
def relay_target(path):
    if not path.startswith(PROXY_PREFIX + '/'):
        return None
    target = path[len(PROXY_PREFIX):]
    decoded = urllib.parse.unquote(target)
    if '..' in decoded.split('/') or not posixpath.normpath(decoded).startswith('/v1/'):
        return None
    return target


class Server(ThreadingHTTPServer):
    def handle_error(self, request, client_address):
        if not isinstance(sys.exc_info()[1], (BrokenPipeError, ConnectionResetError)):
            super().handle_error(request, client_address)


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if not self.host_allowed():
            return
        if self.path.startswith('/__rpt/'):
            self.handle_rpt()
        else:
            super().do_GET()

    def do_HEAD(self):
        if not self.host_allowed():
            return
        if self.path.startswith('/__rpt/'):
            self.send_json(HTTPStatus.NOT_FOUND, NOT_FOUND)
        else:
            super().do_HEAD()

    def do_POST(self):
        if not self.host_allowed():
            return
        if self.path.startswith('/__rpt/'):
            self.handle_rpt()
        else:
            self.send_error(HTTPStatus.NOT_IMPLEMENTED, 'Unsupported method (%r)' % self.command)

    do_DELETE = do_POST

    def host_allowed(self):
        raw = (self.headers.get('Host') or '').strip().lower()
        if raw.startswith('['):
            host = raw[1:raw.find(']')]
        else:
            host = raw.rsplit(':', 1)[0] if raw.count(':') == 1 else raw
        if not raw or host in LOOPBACK:
            return True
        if self.path.startswith('/__rpt/'):
            self.send_json(HTTPStatus.MISDIRECTED_REQUEST, MISDIRECTED)
        else:
            self.send_error(HTTPStatus.MISDIRECTED_REQUEST)
        return False

    def log_message(self, fmt, *args):
        super().log_message(fmt, *(re.sub(r'\?\S*', '', a) if isinstance(a, str) else a for a in args))

    def send_json(self, status, obj):
        data = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(data)

    def handle_rpt(self):
        parts = urllib.parse.urlsplit(self.path)
        if parts.path == HEALTH_PATH and self.command == 'GET':
            self.send_json(HTTPStatus.OK, {'ok': True, 'proxy': True, 'version': VERSION})
            return
        target = relay_target(parts.path)
        if target is None:
            self.send_json(HTTPStatus.NOT_FOUND, NOT_FOUND)
            return
        self.relay(target + ('?' + parts.query if parts.query else ''))

    # Closes the upstream socket when the client disconnects.
    def watch_client(self, upstream_sock):
        try:
            while self.connection.recv(4096):
                pass
        except OSError:
            pass
        self.client_closed = True
        try:
            upstream_sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass

    def relay(self, target):
        if self.headers.get('Content-Length') is None and self.headers.get('Transfer-Encoding'):
            self.send_json(HTTPStatus.LENGTH_REQUIRED, LENGTH_REQUIRED)
            return
        try:
            length = int(self.headers.get('Content-Length') or 0)
        except ValueError:
            self.send_error(HTTPStatus.BAD_REQUEST)
            return
        body = self.rfile.read(length) if length > 0 else None
        headers = {'Accept-Encoding': 'identity', 'User-Agent': 'rpt-serve/' + VERSION}
        for name in FORWARD_HEADERS:
            value = self.headers.get(name)
            if value is not None:
                headers[name] = value
        up = urllib.parse.urlsplit(UPSTREAM)
        conn_cls = http.client.HTTPSConnection if up.scheme == 'https' else http.client.HTTPConnection
        conn = conn_cls(up.hostname, up.port, timeout=CONNECT_TIMEOUT)
        self.client_closed = False
        try:
            try:
                conn.connect()
                conn.sock.settimeout(UPSTREAM_TIMEOUT)
                threading.Thread(target=self.watch_client, args=(conn.sock,), daemon=True).start()
                conn.request(self.command, up.path.rstrip('/') + target, body=body, headers=headers)
                resp = conn.getresponse()
            except (OSError, http.client.HTTPException, ValueError) as e:
                if self.client_closed:
                    return
                self.log_message('중계 실패: %s', type(e).__name__)
                self.send_json(HTTPStatus.BAD_GATEWAY, UPSTREAM_DOWN)
                return
            self.log_request(resp.status)
            self.send_response_only(resp.status)
            for name, value in resp.getheaders():
                lower = name.lower()
                if lower not in DROP_HEADERS and not lower.startswith('access-control-'):
                    self.send_header(name, value)
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Accel-Buffering', 'no')
            self.end_headers()
            while True:
                chunk = resp.read1(8192)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
        except (OSError, http.client.HTTPException):
            pass
        finally:
            conn.close()


def main():
    ap = argparse.ArgumentParser(description='논문 함께 읽기 로컬 서버 (정적 파일 + ChatGPT 플랜 호출 중계)')
    ap.add_argument('--port', type=int, default=8000)
    ap.add_argument('--bind', default='127.0.0.1')
    ap.add_argument('--dir', default=os.path.dirname(os.path.abspath(__file__)))
    args = ap.parse_args()
    if args.bind not in LOOPBACK:
        print('--bind 는 127.0.0.1, ::1, localhost 만 허용합니다. 토큰이 지나는 서버이므로 외부 접속은 열지 않습니다.', file=sys.stderr)
        sys.exit(2)
    if not os.path.isdir(args.dir):
        print('--dir 폴더를 찾을 수 없습니다: %s' % args.dir, file=sys.stderr)
        sys.exit(2)
    Server.address_family = socket.AF_INET6 if ':' in args.bind else socket.AF_INET
    try:
        server = Server((args.bind, args.port), partial(Handler, directory=args.dir))
    except OSError as e:
        print('포트 %d 에 서버를 열 수 없습니다 (%s). --port 로 다른 포트를 지정하세요.' % (args.port, e.strerror or e), file=sys.stderr)
        sys.exit(1)
    host, port = server.server_address[:2]
    url = 'http://%s:%d' % ('[%s]' % host if ':' in host else host, port)
    print('논문 함께 읽기: %s 을 브라우저에서 여세요 (종료: Ctrl+C)' % url, flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
