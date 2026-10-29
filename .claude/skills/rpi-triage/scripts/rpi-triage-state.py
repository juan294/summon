#!/usr/bin/env python3
"""Track report discovery and checkpoints without processing or publishing reports.

Hashes and dispositions supplement scan-start timestamps. They are operational
observations, never authorization or evidence that GitHub inventories succeeded.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shlex
import stat
import sys
import tempfile
import time

INVENTORIES = ('reports', 'agent_failures', 'code_scanning', 'dependabot_alerts',
               'secret_scanning', 'dependency_prs')
DISPOSITIONS = {'processed', 'failed', 'unprocessed'}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def bound(root, relative):
    if not isinstance(relative, str) or not relative:
        raise ValueError('report/state paths must be nonempty strings')
    path = Path(relative)
    if path.is_absolute() or '..' in path.parts or path.as_posix() != relative:
        raise ValueError('report/state paths must be canonical relative paths')
    current = root
    for index, part in enumerate(path.parts):
        current = current / part
        if current.is_symlink() or (index < len(path.parts) - 1 and current.exists() and not current.is_dir()):
            raise ValueError('symlink or non-directory in report/state path: ' + relative)
    return current


def load_state(root):
    path = bound(root, '.rpi/local/triage-state.json')
    raw = path.read_bytes() if path.exists() else None
    value = json.loads(raw) if raw is not None else {'schema_version': 1, 'root': str(root), 'checkpoint_ns': 0, 'records': {}}
    if (not isinstance(value, dict) or value.get('schema_version') != 1 or value.get('root') != str(root)
            or type(value.get('checkpoint_ns')) is not int or value['checkpoint_ns'] < 0
            or not isinstance(value.get('records'), dict)):
        raise ValueError('invalid or differently bound triage state')
    for name, record in value['records'].items():
        bound(root / 'docs/agents', name)
        if (not isinstance(record, dict) or record.get('disposition') not in DISPOSITIONS
                or type(record.get('mtime_ns')) is not int or record['mtime_ns'] < 0
                or not isinstance(record.get('sha256'), str) or len(record['sha256']) != 64
                or any(character not in '0123456789abcdef' for character in record['sha256'])):
            raise ValueError('invalid report disposition record')
    return value, digest(raw) if raw is not None else None


def observe(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as handle:
        before = os.fstat(handle.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise ValueError('report is not a regular file')
        data = handle.read()
        after = os.fstat(handle.fileno())
    if (before.st_mtime_ns, before.st_size) != (after.st_mtime_ns, after.st_size):
        raise ValueError('report changed during discovery')
    return {'sha256': digest(data), 'mtime_ns': after.st_mtime_ns}


def scan(root, only=None, now_ns=None):
    root = Path(root).resolve()
    started = time.time_ns() if now_ns is None else now_ns
    if type(started) is not int or started < 0:
        raise ValueError('scan-start timestamp must be a nonnegative integer')
    state, state_hash = load_state(root)
    reports = bound(root, 'docs/agents')
    issues, names = [], set()
    if only is not None:
        if not isinstance(only, list) or not only:
            raise ValueError('explicit report scope must be a nonempty list')
        for name in only:
            bound(reports, name)
            if not name.endswith('.md'):
                raise ValueError('explicit reports must be Markdown files')
            names.add(name)
    elif reports.exists():
        for directory, children, files in os.walk(reports, followlinks=False,
                onerror=lambda error: issues.append({'path': 'docs/agents', 'reason': 'report directory could not be enumerated'})):
            for name in list(children):
                path = Path(directory) / name
                if path.is_symlink():
                    issues.append({'path': path.relative_to(reports).as_posix(), 'reason': 'symlink directory not scanned'})
                    children.remove(name)
            names.update((Path(directory) / name).relative_to(reports).as_posix()
                         for name in files if name.endswith('-report.md'))
    if only is None:
        names.update(name for name in state['records'] if (reports / name).exists())
    inventory = {}
    for name in sorted(names):
        try:
            inventory[name] = observe(bound(reports, name))
        except (OSError, ValueError):
            issues.append({'path': name, 'reason': 'report unavailable, redirected or changed during discovery'})
    selected = [name for name, item in inventory.items()
                if only is not None or state['records'].get(name, {}).get('disposition') != 'processed'
                or state['records'][name]['sha256'] != item['sha256']
                or item['mtime_ns'] > state['records'][name]['mtime_ns']]
    missing = sorted(name for name, record in state['records'].items()
                     if record['disposition'] != 'processed' and name not in inventory
                     and (only is None or name in names))
    return {'schema_version': 1, 'root': str(root), 'scan_started_ns': started,
            'state_sha256': state_hash, 'full_scope': only is None, 'inventory': inventory,
            'selected': selected, 'missing_retry': missing, 'issues': issues}


def atomic(path, data):
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.triage-', delete=False) as handle:
        temporary = Path(handle.name)
        handle.write(data)
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def checkpoint(root, observation, outcomes, inventories, reported=False):
    root = Path(root).resolve()
    state, state_hash = load_state(root)
    if (not isinstance(observation, dict) or observation.get('schema_version') != 1
            or observation.get('root') != str(root) or observation.get('state_sha256') != state_hash):
        raise ValueError('stale or differently bound triage scan')
    if (type(observation.get('scan_started_ns')) is not int or observation['scan_started_ns'] < 0
            or type(observation.get('full_scope')) is not bool
            or not isinstance(observation.get('inventory'), dict)
            or not isinstance(observation.get('selected'), list)
            or not isinstance(observation.get('issues'), list)
            or not isinstance(observation.get('missing_retry'), list)
            or not isinstance(outcomes, dict) or not isinstance(inventories, dict)
            or type(reported) is not bool):
        raise ValueError('invalid triage scan or completion shape')
    selected = observation['selected']
    if len(set(selected)) != len(selected) or set(outcomes) - set(selected):
        raise ValueError('outcomes must belong to the exact selected report inventory')
    records = dict(state['records'])
    for name in selected:
        bound(root / 'docs/agents', name)
        item = observation['inventory'].get(name)
        disposition = outcomes.get(name, 'unprocessed')
        if (not isinstance(item, dict) or not isinstance(item.get('sha256'), str)
                or type(item.get('mtime_ns')) is not int or item['mtime_ns'] < 0
                or len(item['sha256']) != 64 or any(c not in '0123456789abcdef' for c in item['sha256'])
                or disposition not in DISPOSITIONS):
            raise ValueError('invalid scanned hash or outcome disposition')
        records[name] = {'sha256': item['sha256'], 'mtime_ns': item['mtime_ns'], 'disposition': disposition}
    advanced = (observation['full_scope'] and reported and not observation['issues']
                and not observation['missing_retry'] and set(inventories) == set(INVENTORIES)
                and all(value == 'complete' for value in inventories.values()))
    next_state = {**state, 'records': records,
                  'checkpoint_ns': observation['scan_started_ns'] if advanced else state['checkpoint_ns']}
    local = bound(root, '.rpi/local')
    destination = bound(root, '.rpi/local/triage-state.json')
    ignore = bound(root, '.rpi/local/.gitignore')
    marker = bound(root, 'docs/agents/.last-triage')
    if marker.exists() and not marker.is_file():
        raise ValueError('triage checkpoint marker must be a regular file')
    local.mkdir(parents=True, exist_ok=True)
    lock = bound(root, '.rpi/local/triage.lock')
    descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(descriptor)
    try:
        if load_state(root)[1] != state_hash:
            raise ValueError('stale triage scan: state changed during checkpoint')
        previous_ignore = ignore.read_bytes() if ignore.exists() else b''
        if b'*' not in previous_ignore.splitlines():
            atomic(ignore, previous_ignore + (b'\n' if previous_ignore else b'') + b'*\n')
        atomic(destination, (json.dumps(next_state, indent=2, sort_keys=True) + '\n').encode())
        if advanced:
            marker.parent.mkdir(parents=True, exist_ok=True)
            descriptor = os.open(marker, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
            try:
                os.utime(descriptor, ns=(observation['scan_started_ns'], observation['scan_started_ns']))
            finally:
                os.close(descriptor)
    finally:
        lock.unlink()
    return {'checkpoint_advanced': advanced, 'checkpoint_ns': next_state['checkpoint_ns'],
            'retry': sorted(name for name, record in records.items() if record['disposition'] != 'processed')}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=('scan', 'checkpoint'))
    parser.add_argument('--root', type=Path, default=Path.cwd())
    parser.add_argument('--report', action='append')
    parser.add_argument('--scan', type=Path)
    parser.add_argument('--completion', type=Path)
    args = parser.parse_args()
    try:
        if args.operation == 'scan':
            result = scan(args.root, args.report)
        else:
            if not args.scan or not args.completion:
                raise ValueError('checkpoint requires --scan and --completion JSON artifacts')
            completion = json.loads(args.completion.read_text())
            result = checkpoint(args.root, json.loads(args.scan.read_text()), completion['outcomes'],
                                completion['inventories'], completion.get('reported', False))
        print(json.dumps(result, sort_keys=True))
        return 0
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f'BLOCKED / WHY: {error} / FIX: preserve prior state, resolve the inventory or path conflict, then run '
              f'python3 {shlex.quote(str(Path(__file__).resolve()))} scan --root {shlex.quote(str(args.root))}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
