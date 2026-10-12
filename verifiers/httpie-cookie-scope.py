"""External real-CLI acceptance; synthetic loopback cookies, never credentials."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlencode, urlsplit

BINARY = str(Path(sys.argv.pop(1)).resolve())
WORKSPACE = str(Path(sys.argv.pop(1)).resolve())


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        route = urlsplit(self.path)
        params = parse_qs(route.query, keep_blank_values=True)
        body = json.dumps({'cookie': self.headers.get('Cookie', '')}).encode()
        redirect = params.get('redirect', [None])[0]
        self.send_response(302 if redirect else 200)
        if route.path.endswith('/set') or route.path.endswith('/expire'):
            expired = route.path.endswith('/expire')
            names = params.get('name', ['same'])
            for name in names:
                cookie = name + ('=gone' if expired else '=value')
                if 'path' in params:
                    cookie += '; Path=' + params['path'][0]
                if 'domain' in params:
                    cookie += '; Domain=' + params['domain'][0]
                if expired:
                    cookie += '; Expires=Thu, 01 Jan 1970 00:00:00 GMT' if 'expires' in params else '; Max-Age=0'
                self.send_header('Set-Cookie', cookie)
        if redirect:
            self.send_header('Location', redirect)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass


class CookieScopeAcceptance(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        cls.worker = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.worker.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.worker.join()

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.session = Path(self.directory.name) / 'session.json'
        self.environment = {**os.environ, 'PYTHONPATH': WORKSPACE,
                            'HTTPIE_CONFIG_DIR': self.directory.name,
                            'HTTP_PROXY': '', 'HTTPS_PROXY': '', 'ALL_PROXY': '',
                            'NO_PROXY': '127.0.0.1,localhost'}

    def tearDown(self):
        self.directory.cleanup()

    def url(self, host, route, **params):
        return f'http://{host}:{self.server.server_port}{route}?' + urlencode(params, doseq=True)

    def call(self, host, route, readonly=False, follow=False, **params):
        args = [BINARY, '--ignore-stdin', '--body',
                ('--session-read-only=' if readonly else '--session=') + str(self.session)]
        if follow:
            args.append('--follow')
        args.append(self.url(host, route, **params))
        result = subprocess.run(args, env=self.environment, text=True, capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def cookies(self):
        return json.loads(self.session.read_text())['cookies']

    def set_both(self):
        self.call('127.0.0.1', '/set', path='/')
        self.call('localhost', '/set', path='/')
        self.assertEqual(len(self.cookies()), 2)

    def assert_other_host_survives(self):
        self.assertEqual(self.call('localhost', '/echo')['cookie'], 'same=value')
        self.assertEqual(self.call('127.0.0.1', '/echo')['cookie'], '')

    def test_host_only_max_age_scope(self):
        self.set_both()
        self.call('127.0.0.1', '/expire', path='/')
        self.assert_other_host_survives()

    def test_host_only_expires_scope(self):
        self.set_both()
        self.call('127.0.0.1', '/expire', path='/', expires='1')
        self.assert_other_host_survives()

    def test_explicit_domain_scope(self):
        self.call('127.0.0.1', '/set', path='/', domain='127.0.0.1')
        self.call('localhost', '/set', path='/')
        self.call('127.0.0.1', '/expire', path='/', domain='127.0.0.1')
        self.assert_other_host_survives()

    def test_explicit_domain_with_leading_dot(self):
        self.call('127.0.0.1', '/set', path='/', domain='.127.0.0.1')
        self.call('localhost', '/set', path='/')
        self.call('127.0.0.1', '/expire', path='/', domain='.127.0.0.1')
        self.assert_other_host_survives()

    def test_same_host_other_path_survives(self):
        self.call('127.0.0.1', '/a/set', path='/a')
        self.call('127.0.0.1', '/b/set', path='/b')
        self.call('127.0.0.1', '/a/expire', path='/a')
        self.assertEqual(self.call('127.0.0.1', '/b/echo')['cookie'], 'same=value')
        self.assertEqual(self.call('127.0.0.1', '/a/echo')['cookie'], '')

    def test_default_cookie_path_is_response_directory(self):
        self.call('127.0.0.1', '/a/set')
        self.call('127.0.0.1', '/set', path='/')
        self.call('127.0.0.1', '/a/expire')
        paths = {cookie['path'] for cookie in self.cookies()}
        self.assertEqual(paths, {'/'})
        self.assertEqual(self.call('127.0.0.1', '/echo')['cookie'], 'same=value')

    def test_invalid_domain_cannot_delete_cookie(self):
        self.set_both()
        self.call('127.0.0.1', '/expire', path='/', domain='unrelated.invalid')
        self.assertEqual(self.call('localhost', '/echo')['cookie'], 'same=value')
        self.assertEqual(self.call('127.0.0.1', '/echo')['cookie'], 'same=value')

    def test_multiple_set_cookie_fields_keep_other_host(self):
        self.set_both()
        self.call('127.0.0.1', '/set', name='second', path='/')
        self.call('127.0.0.1', '/expire', name=['same', 'second'], path='/')
        self.assert_other_host_survives()

    def test_redirect_keeps_per_response_source_scope(self):
        self.set_both()
        target = self.url('localhost', '/echo')
        result = self.call('127.0.0.1', '/expire', path='/', redirect=target, follow=True)
        self.assertEqual(result['cookie'], 'same=value')
        self.assert_other_host_survives()

    def test_read_only_session_bytes_unchanged(self):
        self.set_both()
        before = self.session.read_bytes()
        self.call('127.0.0.1', '/expire', path='/', readonly=True)
        self.assertEqual(self.session.read_bytes(), before)

    def test_legacy_session_layout_remains_readable(self):
        self.call('localhost', '/set', path='/')
        data = json.loads(self.session.read_text())
        cookie = data['cookies'][0]
        data['cookies'] = {'same': {k: v for k, v in cookie.items() if k != 'name'}}
        data['headers'] = {'X-Synthetic': 'fixture'}
        self.session.write_text(json.dumps(data))
        self.assertEqual(self.call('localhost', '/echo')['cookie'], 'same=value')

    def test_domainless_legacy_cookie_can_be_expired(self):
        self.call('127.0.0.1', '/set', path='/')
        data = json.loads(self.session.read_text())
        data['cookies'][0]['domain'] = None
        self.session.write_text(json.dumps(data))
        self.call('127.0.0.1', '/expire', path='/')
        self.assertEqual(self.call('127.0.0.1', '/echo')['cookie'], '')

    def test_invalid_domain_cannot_expire_domainless_legacy_cookie(self):
        self.call('127.0.0.1', '/set', path='/')
        data = json.loads(self.session.read_text())
        data['cookies'][0]['domain'] = None
        self.session.write_text(json.dumps(data))
        self.call('127.0.0.1', '/expire', path='/', domain='unrelated.invalid')
        self.assertEqual(self.call('127.0.0.1', '/echo')['cookie'], 'same=value')


if __name__ == '__main__':
    unittest.main(verbosity=2)
