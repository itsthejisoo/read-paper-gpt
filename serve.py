#!/usr/bin/env python3
# 논문 함께 읽기 로컬 서버: 정적 파일을 제공하고 ChatGPT 플랜 호출(/__rpt/openai/v1/...)을
# 같은 주소에서 api.openai.com 으로 중계해 브라우저의 CORS 차단을 피한다.
# 토큰은 요청 헤더를 그대로 전달할 뿐 저장하거나 로그에 남기지 않는다.
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
# 연결 단계만 짧게 제한한다: 응답 없는 주소(IPv6 경로 불량 등)에서 요청마다 OS의 SYN 제한 시간만큼 멈추지 않게
CONNECT_TIMEOUT = 15
UPSTREAM_TIMEOUT = 600
LOOPBACK = ('127.0.0.1', '::1', 'localhost')
FORWARD_HEADERS = ('Authorization', 'Content-Type', 'Accept')
# 본문은 그대로 전달하므로 content-encoding 은 남긴다 (상위 서버가 identity 요청을 무시해도 브라우저가 풀 수 있게)
DROP_HEADERS = {'connection', 'keep-alive', 'transfer-encoding', 'content-length',
                'alt-svc', 'set-cookie', 'strict-transport-security'}
NOT_FOUND = {'error': {'message': '중계 경로가 아닙니다.', 'code': 'proxy_not_found'}}
UPSTREAM_DOWN = {'error': {'message': 'OpenAI 서버에 연결하지 못했습니다.', 'code': 'proxy_upstream'}}
LENGTH_REQUIRED = {'error': {'message': '요청 본문에는 Content-Length 가 필요합니다.', 'code': 'proxy_length_required'}}
MISDIRECTED = {'error': {'message': '루프백 주소(127.0.0.1, localhost)로만 접속할 수 있습니다.', 'code': 'proxy_misdirected'}}


def relay_target(path):
    # 접두사 뒤의 경로가 정규화 후에도 /v1/ 아래여야 중계한다 (.. 등으로 벗어나면 거부)
    if not path.startswith(PROXY_PREFIX + '/'):
        return None
    target = path[len(PROXY_PREFIX):]
    decoded = urllib.parse.unquote(target)
    if '..' in decoded.split('/') or not posixpath.normpath(decoded).startswith('/v1/'):
        return None
    return target


class Server(ThreadingHTTPServer):
    def handle_error(self, request, client_address):
        # 클라이언트가 응답 전에 끊은 요청(탭 닫기, 새로 고침)은 역추적을 찍지 않는다
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
        # DNS 리바인딩으로 다른 도메인이 127.0.0.1을 가리켜도 중계를 쓰지 못하게 루프백 Host 만 받는다 (Host 가 없는 HTTP/1.0 요청은 허용)
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
        # 콜백 코드 등 쿼리 문자열은 로그에 남기지 않는다 (헤더 값은 어디서도 기록하지 않음)
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

    def watch_client(self, upstream_sock):
        # HTTP/1.0 응답 중 클라이언트는 더 보낼 것이 없으므로 수신이 끝나면 연결이 끊긴 것이다
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
        # 본문은 Content-Length 로만 읽는다. chunked 요청을 빈 본문으로 넘기면 상위 서버의 엉뚱한 400 이 되므로 411 로 알린다
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
                # 클라이언트가 끊으면 업스트림 소켓을 닫아 OpenAI 쪽 요청도 함께 취소한다
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
            # 클라이언트가 끊었거나 업스트림 스트림이 중단된 경우: 아래에서 업스트림 연결을 닫는다
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
