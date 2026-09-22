#!/usr/bin/env python3
"""Structural validator for the Prisma schema.

The Prisma engine binaries cannot be downloaded in this sandbox, so this script
performs the checks that catch the realistic authoring mistakes in a large
schema: missing back-relations, mismatched relation names, unknown field or
model references, and block attributes that point at fields which do not exist.
"""
import re, sys, collections

src = open('prisma/schema.prisma').read()
src = re.sub(r'//.*', '', src)

models, enums = {}, set()
for m in re.finditer(r'\benum\s+(\w+)\s*\{', src):
    enums.add(m.group(1))

for m in re.finditer(r'\bmodel\s+(\w+)\s*\{(.*?)\n\}', src, re.S):
    models[m.group(1)] = m.group(2)

scalars = {'String','Int','BigInt','Float','Decimal','Boolean','DateTime','Json','Bytes'}
errors, warnings = [], []
fields = collections.defaultdict(dict)   # model -> field -> (type, optional, list, attrs)
relations = []                           # (model, field, target, relname, fks, refs)
block_attrs = collections.defaultdict(list)

for model, body in models.items():
    for raw in body.split('\n'):
        line = raw.strip()
        if not line:
            continue
        if line.startswith('@@'):
            block_attrs[model].append(line)
            continue
        m = re.match(r'(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$', line)
        if not m:
            errors.append(f'{model}: cannot parse line -> {line}')
            continue
        name, ftype, is_list, is_opt, attrs = m.groups()
        fields[model][name] = (ftype, bool(is_opt), bool(is_list), attrs)
        if ftype in scalars or ftype in enums:
            continue
        if ftype not in models:
            errors.append(f'{model}.{name}: unknown type "{ftype}"')
            continue
        rel = re.search(r'@relation\(([^)]*)\)', attrs)
        relname, fks, refs = None, [], []
        if rel:
            inner = rel.group(1)
            q = re.match(r'\s*"([^"]+)"', inner)
            if q:
                relname = q.group(1)
            f = re.search(r'fields:\s*\[([^\]]*)\]', inner)
            r = re.search(r'references:\s*\[([^\]]*)\]', inner)
            if f: fks = [x.strip() for x in f.group(1).split(',') if x.strip()]
            if r: refs = [x.strip() for x in r.group(1).split(',') if x.strip()]
        relations.append((model, name, ftype, relname, fks, refs, bool(is_list)))

# 1. every relation has exactly one matching counterpart
by_pair = collections.defaultdict(list)
for model, name, target, relname, fks, refs, is_list in relations:
    key = tuple(sorted([model, target])) + (relname or '',)
    by_pair[key].append((model, name, target, relname, fks, is_list))

for key, sides in by_pair.items():
    a, b, relname = key
    if a == b:
        if len(sides) != 2:
            errors.append(f'self-relation on {a} (name="{relname}") has {len(sides)} side(s), needs exactly 2')
        continue
    owners = {s[0] for s in sides}
    if owners != {a, b}:
        missing = ({a, b} - owners).pop()
        src_model, src_field = sides[0][0], sides[0][1]
        errors.append(f'{src_model}.{src_field} -> {missing}: missing back-relation on {missing}'
                      + (f' (relation "{relname}")' if relname else ''))
    if len(sides) > 2:
        errors.append(f'ambiguous relation between {a} and {b} (name="{relname}"): {len(sides)} fields')
    withfk = [s for s in sides if s[4]]
    if len(sides) == 2 and len(withfk) != 1:
        errors.append(f'relation {a} <-> {b} (name="{relname}") must have exactly one side '
                      f'holding fields:/references:, found {len(withfk)}')

# 2. foreign key + reference columns exist
for model, name, target, relname, fks, refs, is_list in relations:
    for fk in fks:
        if fk not in fields[model]:
            errors.append(f'{model}.{name}: @relation fields references unknown column "{fk}"')
    for ref in refs:
        if ref not in fields[target]:
            errors.append(f'{model}.{name}: @relation references unknown column "{target}.{ref}"')
    for fk in fks:
        if fk in fields[model] and fields[model][fk][2]:
            errors.append(f'{model}.{fk}: foreign key column may not be a list')

# 3. block attribute columns exist and unique/index targets are sane
for model, attrs in block_attrs.items():
    for attr in attrs:
        for cols in re.findall(r'\[([^\]]*)\]', attr):
            for col in [c.strip() for c in cols.split(',') if c.strip()]:
                col = col.split('(')[0]
                if col not in fields[model]:
                    errors.append(f'{model}: {attr.split("(")[0]} references unknown field "{col}"')

# 4. every model has an id or composite id
for model in models:
    has_id = any('@id' in f[3] for f in fields[model].values())
    has_block_id = any(a.startswith('@@id') for a in block_attrs[model])
    if not (has_id or has_block_id):
        errors.append(f'{model}: no primary key')

# 5. tenant-scoped tables should index institutionId
for model in models:
    if 'institutionId' in fields[model]:
        idx = ' '.join(block_attrs[model])
        if 'institutionId' not in idx and not any(
                'institutionId' in a for a in block_attrs[model]):
            warnings.append(f'{model}: has institutionId but no index/unique starting with it')

print(f'models: {len(models)}   enums: {len(enums)}   '
      f'fields: {sum(len(v) for v in fields.values())}   relations: {len(relations)}')
for w in warnings:
    print('WARN  ' + w)
for e in errors:
    print('ERROR ' + e)
print('OK' if not errors else f'{len(errors)} error(s)')
sys.exit(1 if errors else 0)
