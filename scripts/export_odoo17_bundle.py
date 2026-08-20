#!/usr/bin/env python3
"""Export a deterministic, checksummed Odoo 17 migration bundle over JSON-RPC.

Credentials are read from environment variables so the command never embeds
secrets. The exporter is read-only and safe to run against a frozen snapshot.
"""

import argparse
import hashlib
import json
import os
import pathlib
import urllib.request


MODELS = [
    'school.academic.year', 'school.term', 'school.section', 'school.campus',
    'school.room', 'school.class', 'school.subject', 'school.grade.subject',
    'school.staff', 'school.staff.responsibility', 'school.teacher',
    'school.teacher.assignment', 'school.student', 'school.student.guardian',
    'school.enrollment', 'school.student.subject', 'school.attendance',
    'school.assessment', 'school.mark', 'school.program',
    'school.class.schedule', 'school.announcement', 'ir.attachment', 'mail.message',
]


class OdooRpc:
    def __init__(self, url, database, login, password):
        self.url = url.rstrip('/') + '/jsonrpc'
        self.database = database
        self.login = login
        self.password = password
        self.uid = self.call('common', 'login', database, login, password)
        if not self.uid:
            raise RuntimeError('Odoo authentication failed')

    def call(self, service, method, *args):
        body = json.dumps({
            'jsonrpc': '2.0', 'method': 'call', 'id': 1,
            'params': {'service': service, 'method': method, 'args': args},
        }).encode()
        request = urllib.request.Request(
            self.url, body, {'Content-Type': 'application/json'})
        with urllib.request.urlopen(request, timeout=120) as response:
            payload = json.load(response)
        if payload.get('error'):
            raise RuntimeError(payload['error'])
        return payload['result']

    def execute(self, model, method, *args):
        return self.call(
            'object', 'execute_kw', self.database, self.uid, self.password,
            model, method, list(args[:-1]), args[-1] if args and isinstance(args[-1], dict) else {},
        )


def stable_hash(path):
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('output', type=pathlib.Path)
    parser.add_argument('--batch-size', type=int, default=500)
    args = parser.parse_args()
    required = ['ODOO17_URL', 'ODOO17_DB', 'ODOO17_LOGIN', 'ODOO17_PASSWORD']
    missing = [name for name in required if not os.environ.get(name)]
    if missing:
        parser.error('missing environment variables: %s' % ', '.join(missing))
    rpc = OdooRpc(*(os.environ[name] for name in required))
    args.output.mkdir(parents=True, exist_ok=False)
    totals = {}
    files = {}
    for model in MODELS:
        model_path = args.output / ('%s.jsonl' % model.replace('.', '_'))
        offset = 0
        count = 0
        with model_path.open('w', encoding='utf-8') as handle:
            while True:
                rows = rpc.execute(model, 'search_read', [], {
                    'fields': [], 'offset': offset, 'limit': args.batch_size,
                    'order': 'id', 'context': {'active_test': False},
                })
                if not rows:
                    break
                for row in rows:
                    handle.write(json.dumps({
                        'legacy_key': '%s,%s' % (model, row['id']),
                        'values': row,
                    }, sort_keys=True, default=str) + '\n')
                offset += len(rows)
                count += len(rows)
        totals[model] = count
        files[model_path.name] = stable_hash(model_path)
    manifest = {'source_version': '17.0', 'totals': totals, 'sha256': files}
    manifest_path = args.output / 'manifest.json'
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + '\n')
    print(manifest_path)


if __name__ == '__main__':
    main()
