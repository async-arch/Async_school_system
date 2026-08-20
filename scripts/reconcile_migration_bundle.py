#!/usr/bin/env python3
"""Validate migration bundle hashes and compare source/import reconciliation."""

import argparse
import hashlib
import json
import pathlib
import sys


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('bundle', type=pathlib.Path)
    parser.add_argument('--import-totals', type=pathlib.Path)
    args = parser.parse_args()
    manifest = json.loads((args.bundle / 'manifest.json').read_text())
    errors = []
    for filename, expected in manifest['sha256'].items():
        actual = digest(args.bundle / filename)
        if actual != expected:
            errors.append('%s checksum differs' % filename)
    if args.import_totals:
        imported = json.loads(args.import_totals.read_text())
        for model, source_count in manifest['totals'].items():
            if imported.get(model) != source_count:
                errors.append('%s: source=%s imported=%s' % (
                    model, source_count, imported.get(model)))
    if errors:
        print('\n'.join(errors), file=sys.stderr)
        return 1
    print('bundle checksums and supplied reconciliation totals match')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
