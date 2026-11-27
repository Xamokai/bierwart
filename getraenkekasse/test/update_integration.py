"""Integration test against a local HTTPS Git remote. Run with Python 3 on Linux."""
import contextlib
import http.client
import http.server
import io
import json
import os
from pathlib import Path
import shutil
import socket
import ssl
import subprocess
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request

APP = Path(__file__).resolve().parents[1]

def run(*args, cwd=None):
    return subprocess.check_output(args, cwd=cwd, stderr=subprocess.STDOUT, text=True).strip()

class GitHTTP(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def serve(self):
        route = urllib.parse.urlsplit(self.path)
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        env = dict(os.environ, GIT_PROJECT_ROOT=str(self.server.projects), GIT_HTTP_EXPORT_ALL='1',
                   REQUEST_METHOD=self.command, PATH_INFO=route.path, QUERY_STRING=route.query,
                   CONTENT_TYPE=self.headers.get('Content-Type', ''), CONTENT_LENGTH=str(len(body)),
                   REMOTE_ADDR='127.0.0.1', HTTP_GIT_PROTOCOL=self.headers.get('Git-Protocol',''))
        result = subprocess.run(['git', 'http-backend'], input=body, capture_output=True, env=env, check=True)
        head, _, data = result.stdout.partition(b'\r\n\r\n')
        headers = http.client.parse_headers(io.BytesIO(head+b'\r\n\r\n'))
        self.send_response(int(headers.get('Status', '200 OK').split()[0]))
        for name,value in headers.items():
            if name.lower() != 'status':
                self.send_header(name,value)
        if not headers.get('Content-Length'):
            self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    do_GET = serve
    do_POST = serve

class ReleaseUpdates(unittest.TestCase):
    def test_signed_switches(self):
        with tempfile.TemporaryDirectory() as tmp, contextlib.ExitStack() as resources:
            work=Path(tmp)
            app=work/'app'
            def skip_local(directory, names):
                if Path(directory)==APP:
                    return {'node_modules','.bierwart','config.json','data','assets'}
                return {'local-signers'}
            shutil.copytree(APP,app,ignore=skip_local)
            (app/'node_modules').symlink_to(APP/'node_modules',target_is_directory=True)
            run('node','update-manager/init.js',cwd=app)
            with socket.socket() as sock, socket.socket() as secure_sock:
                sock.bind(('127.0.0.1',0)); port=sock.getsockname()[1]
                secure_sock.bind(('127.0.0.1',0)); secure_port=secure_sock.getsockname()[1]
            http_base='http://127.0.0.1:'+str(port)
            https_base='https://127.0.0.1:'+str(secure_port)
            pin='831624'
            def api(endpoint,body=None,admin=pin,base=https_base):
                data=None if body is None else json.dumps(body).encode()
                req=urllib.request.Request(base+endpoint,data=data,headers={'Content-Type':'application/json','X-Admin-Pin':admin,'Origin':base})
                with urllib.request.urlopen(req,timeout=10,context=client_tls) as response:
                    raw=response.read().decode()
                    return json.loads(raw) if raw and response.headers.get_content_type()=='application/json' else raw
            def status():
                return api('/updates/api/status')
            def settled():
                for _ in range(400):
                    result=status()
                    if not result['busy']:
                        return result
                    time.sleep(.05)
                self.fail('Update operation timed out')
            def action(name,body):
                api('/updates/api/'+name,body); return settled()
            def remote(tag):
                info=next(v for v in status()['available'] if v['tag']==tag)
                return action('install',dict(source='repo',repo=info['repo'],id=info['oid']))
            key=work/'key'
            run('ssh-keygen','-q','-t','ed25519','-N','','-f',str(key))
            (app/'update-manager/local-signers').write_text('test '+key.with_suffix('.pub').read_text())
            cert=work/'cert.pem'
            run('openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=bw.uhaus',
                '-addext','subjectAltName=DNS:bw.uhaus,IP:127.0.0.1','-keyout',str(work/'tls.key'),'-out',str(cert))
            client_tls=ssl.create_default_context(cafile=str(cert))
            config=app/'config.json'
            cfg=json.loads(config.read_text())
            cfg['https']={'port':secure_port,'hostname':'bw.uhaus','certFile':'../cert.pem','keyFile':'../tls.key'}
            config.write_text(json.dumps(cfg))
            projects=work/'repos'; projects.mkdir()
            repo=projects/'bierwart.git'
            run('git','init','-q',str(repo))
            def git(*args): return run('git',*args,cwd=repo)
            git('config','user.name','Test');git('config','user.email','test@example.invalid')
            git('config','gpg.format','ssh');git('config','user.signingkey',str(key))
            src=repo/'getraenkekasse'
            shutil.copytree(APP,src,ignore=shutil.ignore_patterns('node_modules','data','assets','defaults','config.json','.bierwart','update-manager'))
            def tag(version,broken=False,signed=True):
                pkg=json.loads((src/'package.json').read_text());pkg['version']=version
                (src/'package.json').write_text(json.dumps(pkg))
                if broken:
                    (src/'server.js').write_text("require('fs').writeFileSync('data/db.json','{}');process.exit(1);")
                git('add','.');git('commit','-qm',version)
                git('tag','-s' if signed else '-a','v'+version,'-m',version)
            tag('1.10.1');tag('1.11.2');tag('1.11.3',broken=True);tag('1.11.4',signed=False)
            server=http.server.ThreadingHTTPServer(('127.0.0.1',0),GitHTTP); server.projects=projects
            tls=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);tls.load_cert_chain(cert,work/'tls.key')
            server.socket=tls.wrap_socket(server.socket,server_side=True)
            threading.Thread(target=server.serve_forever,daemon=True).start()
            resources.callback(server.server_close);resources.callback(server.shutdown)
            repos='https://127.0.0.1:'+str(server.server_port)
            repo_url=repos+'/bierwart.git'
            log=resources.enter_context((work/'server.log').open('w+'))
            proc=None
            def stop():
                if proc and proc.poll() is None:
                    proc.terminate();proc.wait(timeout=15)
            resources.callback(stop)
            def start():
                nonlocal proc
                proc=subprocess.Popen(['node','update-manager/manager.js'],cwd=app,stdout=log,stderr=log,
                    env=dict(os.environ,BW_HOST='127.0.0.1',BW_PORT=str(port),BW_ADMIN_PIN=pin,GIT_SSL_CAINFO=str(cert),NO_PROXY='127.0.0.1,localhost',no_proxy='127.0.0.1,localhost'))
                for _ in range(180):
                    try:
                        if settled()['online']: return
                    except (OSError,ValueError): pass
                    if proc.poll() is not None: break
                    time.sleep(.05)
                self.fail((work/'server.log').read_text())
            start()
            self.assertIn('Software-Updates',api('/updates/'))
            self.assertEqual(api('/api/products',base=http_base),api('/api/products'))
            self.assertIn('Verwaltung',api('/admin.html'))
            # One real hostname-verified TLS request, without depending on LAN DNS.
            with socket.create_connection(('127.0.0.1',secure_port),timeout=5) as connection:
                with client_tls.wrap_socket(connection,server_hostname='bw.uhaus') as secure:
                    secure.sendall(f'GET /strichliste.html HTTP/1.1\r\nHost: bw.uhaus:{secure_port}\r\nConnection: close\r\n\r\n'.encode())
                    reply=http.client.HTTPResponse(secure)
                    reply.begin()
                    self.assertEqual(reply.status,200)
                    self.assertIn(b'Strichliste',reply.read())
            with self.assertRaises(urllib.error.HTTPError) as forbidden: api('/updates/api/repo',{'repo':repo_url},admin='wrong')
            self.assertEqual(forbidden.exception.code,401)
            with self.assertRaises(urllib.error.HTTPError): action('repo',{'repo':'file:///tmp/repository'})
            action('repo',{'repo':repo_url})
            discovery=action('check',{})
            if discovery['job']['phase']=='error':
                diag=subprocess.run(['git','ls-remote','--tags','--',repo_url],capture_output=True,text=True,env=dict(os.environ,GIT_SSL_CAINFO=str(cert),no_proxy='127.0.0.1',NO_PROXY='127.0.0.1'))
                self.fail(str(discovery['job'])+' '+diag.stderr)
            self.assertEqual([v['tag'] for v in discovery['available']],['v1.11.4','v1.11.3','v1.11.2','v1.10.1'])
            self.assertIn('SSH',remote('v1.11.4')['job']['message'])
            member=api('/api/accounts',{'name':'Testkonto','surname':'Test'})
            first=remote('v1.11.2');self.assertEqual(first['job']['phase'],'done',first)
            api('/api/admin/deposit',{'accountId':member['id'],'amount':17.25})
            def balance():
                return next(a for a in api('/api/admin/accounts') if a['id']==member['id'])['balance']
            self.assertEqual(balance(),17.25)
            self.assertEqual(api('/api/admin/accounts',base=http_base),api('/api/admin/accounts'))
            receipt=app/'assets/receipts/beleg.txt';receipt.write_text('Beleg')
            lower=remote('v1.10.1');self.assertEqual(lower['job']['phase'],'done',lower)
            self.assertEqual(balance(),17.25);self.assertEqual(receipt.read_text(),'Beleg')
            broken=remote('v1.11.3')
            self.assertEqual(broken['active'],lower['active'])
            self.assertTrue(broken['online']);self.assertEqual(broken['job']['phase'],'error')
            self.assertEqual(balance(),17.25);self.assertEqual(receipt.read_text(),'Beleg')
            alternate=repos+'/anderes.git'
            self.assertEqual(action('repo',{'repo':alternate})['available'],[])
            self.assertEqual(action('check',{})['job']['phase'],'error')
            local=action('install',dict(source='local',id=first['active']))
            self.assertEqual(local['job']['phase'],'done',local);self.assertEqual(balance(),17.25)
            stop();start()
            self.assertEqual(status()['repo'],alternate);self.assertEqual(status()['active'],first['active'])
            self.assertEqual(balance(),17.25)
            # Simulate an abrupt stop after the backup and before committing a switch.
            stop()
            storage=app/'.bierwart'; state=json.loads((storage/'state.json').read_text())
            last=(storage/'backups'/state['activation']); saved=storage/'backups/stand-recovery'
            shutil.copytree(last,saved)
            (storage/'pending.json').write_text(json.dumps(dict(previous=state['active'],target='initial',backup=saved.name)))
            (app/'data/db.json').write_text('{}')
            (app/'config.json').unlink()
            start();self.assertEqual(balance(),17.25)
            self.assertFalse((storage/'pending.json').exists())

if __name__=='__main__':
    unittest.main()
