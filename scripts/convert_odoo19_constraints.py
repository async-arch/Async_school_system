#!/usr/bin/env python3
"""One-time mechanical conversion of legacy _sql_constraints declarations."""

import ast
import pathlib


ROOT = pathlib.Path(__file__).resolve().parents[1] / 'addons' / 'school_management' / 'models'


for path in ROOT.glob('*.py'):
    source = path.read_text()
    tree = ast.parse(source)
    replacements = []
    lines = source.splitlines(keepends=True)
    offsets = [0]
    for line in lines:
        offsets.append(offsets[-1] + len(line))
    for node in ast.walk(tree):
        if not isinstance(node, ast.Assign) or len(node.targets) != 1:
            continue
        target = node.targets[0]
        if not isinstance(target, ast.Name) or target.id != '_sql_constraints':
            continue
        values = ast.literal_eval(node.value)
        indent = ' ' * node.col_offset
        declarations = []
        for name, sql, message in values:
            declarations.append(
                f'{indent}_{name} = models.Constraint(\n'
                f'{indent}    {sql!r},\n'
                f'{indent}    {message!r},\n'
                f'{indent})\n'
            )
        start = offsets[node.lineno - 1] + node.col_offset
        end = offsets[node.end_lineno - 1] + node.end_col_offset
        replacements.append((start, end, ''.join(declarations).rstrip()))
    for start, end, replacement in reversed(replacements):
        source = source[:start] + replacement + source[end:]
    if replacements:
        path.write_text(source)
