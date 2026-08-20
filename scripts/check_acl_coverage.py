#!/usr/bin/env python3
"""Fail when a persistent custom model has no explicit ACL declaration."""

import ast
import csv
import pathlib
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
ADDON = ROOT / 'addons' / 'school_management'


def declared_models():
    models = set()
    for path in (ADDON / 'models').glob('*.py'):
        tree = ast.parse(path.read_text(), filename=str(path))
        for class_node in (node for node in tree.body if isinstance(node, ast.ClassDef)):
            # AbstractModel helpers do not create database tables and therefore
            # have no ir.model.access record to audit.
            if any(
                    isinstance(base, ast.Attribute)
                    and isinstance(base.value, ast.Name)
                    and base.value.id == 'models'
                    and base.attr == 'AbstractModel'
                    for base in class_node.bases):
                continue
            for node in class_node.body:
                if not isinstance(node, ast.Assign):
                    continue
                if any(isinstance(target, ast.Name) and target.id == '_name'
                       for target in node.targets):
                    if isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
                        models.add(node.value.value)
    return models


def acl_models():
    result = set()
    with (ADDON / 'security' / 'ir.model.access.csv').open() as handle:
        for row in csv.DictReader(handle):
            external = row['model_id:id'].split('.')[-1]
            if external.startswith('model_'):
                result.add(external.removeprefix('model_').replace('_', '.'))
    return result


def main():
    custom = {model for model in declared_models() if model.startswith('school.')}
    missing = sorted(custom - acl_models())
    if missing:
        print('models without ACL declarations:', *missing, sep='\n- ', file=sys.stderr)
        return 1
    print('%s custom models have explicit ACL declarations' % len(custom))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
