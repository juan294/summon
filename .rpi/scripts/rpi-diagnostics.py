#!/usr/bin/env python3
"""Read-only installation observations, never authorization or a repair operation.

No native caches, global profiles, instruction files or telemetry are written.
Native snapshots are caller-provided evidence with target/cwd/session/time binding;
this utility cannot authenticate a caller's capture. It does not scan rollouts.
"""
import argparse
from collections import deque
from datetime import datetime, timezone
import hashlib
import importlib.util
from itertools import islice
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

HARNESSES = ('claude', 'codex')


def sibling(name):
    # Importing a read-only helper must not create a source __pycache__ either.
    previous = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        spec = importlib.util.spec_from_file_location(name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        sys.dont_write_bytecode = previous


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read(path):
    try:
        return Path(path).read_bytes() if Path(path).is_file() else None
    except OSError:
        return None


def object_file(path, issues):
    data = read(path)
    if data is None:
        return {}
    try:
        value = json.loads(data)
        if not isinstance(value, dict):
            raise ValueError()
        return value
    except (ValueError, UnicodeError):
        issues.append({'path': str(path), 'status': 'malformed JSON object'})
        return {}


def client_version(harness):
    command = shutil.which(harness)
    if not command:
        return None
    try:
        result = subprocess.run([command, '--version'], capture_output=True, text=True, timeout=5)
        match = re.search(r'\b\d+\.\d+\.\d+(?:[-+][\w.-]+)?\b', result.stdout)
        return match[0] if result.returncode == 0 and match else None
    except (OSError, subprocess.TimeoutExpired):
        return None


def ancestors(root, cwd):
    return [root, *[root.joinpath(*cwd.relative_to(root).parts[:index])
                   for index in range(1, len(cwd.relative_to(root).parts) + 1)]]


def config_fields(paths, issues):
    """Parse only named top-level TOML records, including multiline arrays."""
    import tomllib
    result = {}
    for path in paths:
        if not path.is_file():
            continue
        try:
            with path.open() as stream:
                for line in stream:
                    if line.lstrip().startswith('['):
                        break
                    match = re.match(r'\s*(project_doc_max_bytes|project_doc_fallback_filenames)\s*=', line)
                    if not match:
                        continue
                    record = line
                    while True:
                        try:
                            value = tomllib.loads(record)[match[1]]
                            break
                        except tomllib.TOMLDecodeError:
                            if len(record) > 32768 or match[1] != 'project_doc_fallback_filenames':
                                raise ValueError()
                            following = next(stream, '')
                            if not following:
                                raise ValueError()
                            record += following
                    if match[1] == 'project_doc_max_bytes':
                        valid = type(value) is int and value > 0
                    else:
                        valid = isinstance(value, list) and all(isinstance(v, str) and v and Path(v).name == v and v not in ('.', '..') for v in value)
                    if not valid:
                        raise ValueError()
                    result[match[1]] = (value, str(path))
        except (OSError, UnicodeError, ValueError):
            issues.append({'path': str(path), 'status': 'unavailable instruction configuration'})
    return result


def records(value):
    return value if isinstance(value, list) else []


def instruction_file(path):
    data = read(path)
    return {'path': str(path), 'bytes': len(data), 'sha256': sha(data)} if data else None


def first_instruction(directory, names):
    for name in names:
        item = instruction_file(directory / name)
        if item:
            return item
    return None


def instructions(root, cwd, globals_by_harness, limit, issues):
    lineage = ancestors(root, cwd)
    globals_codex = [Path(p).expanduser().absolute() for p in globals_by_harness.get('codex', [])]
    config_paths = [p / 'config.toml' for p in globals_codex if p.is_dir()]
    config_paths += [p / '.codex/config.toml' for p in lineage]
    config = config_fields(config_paths, issues)
    default_names = ['AGENTS.override.md', 'AGENTS.md']
    names = default_names + config.get('project_doc_fallback_filenames', ([], ''))[0]
    selected = []
    for path in globals_codex:
        item = first_instruction(path, default_names) if path.is_dir() else instruction_file(path)
        if item:
            selected.append(item)
    for path in lineage:
        item = first_instruction(path, names)
        if item:
            selected.append(item)
    if limit is not None:
        if type(limit) is not int or limit <= 0:
            raise ValueError('instruction byte limit must be a positive integer')
        limit_source = 'explicit supplied effective limit; native provenance not verified'
    else:
        limit, limit_source = config.get('project_doc_max_bytes', (32768, 'assumed native default; unverified'))
    root_data = read(root / 'AGENTS.md') or b''
    managed = sum(len(m[0]) for m in re.finditer(rb'<!-- rpi:([a-z0-9-]+):start -->\n.*?\n<!-- rpi:\1:end -->(?:\n|$)', root_data, re.S))
    codex = {'files': selected, 'bytes': sum(item['bytes'] for item in selected),
             'limit_bytes': limit, 'limit_source': limit_source, 'managed_root_bytes': managed,
             'managed_root_limit': 8192, 'managed_root_over_limit': managed > 8192,
             'root_instruction_present': first_instruction(root, names) is not None,
             'scope': 'Codex native filename selection from explicit project root to cwd; no Markdown @ imports',
             'limitations': ['Runtime profile/CLI overrides require a supplied effective limit; configured values alone are not session observations.']}
    codex['over_limit'] = codex['bytes'] > limit
    starts = []
    allowed = [root]
    for value in globals_by_harness.get('claude', []):
        path = Path(value).expanduser().absolute()
        starts.append(path / 'CLAUDE.md' if path.is_dir() else path)
        allowed.append(path if path.is_dir() else path.parent)
    for directory in [*reversed(cwd.parents), cwd]:
        starts.extend([directory / 'CLAUDE.md', directory / '.claude/CLAUDE.md', directory / 'CLAUDE.local.md'])
    files, cycles, missing, external, depth_limited, visited = [], [], [], [], [], set()

    def visit(path, stack):
        path = path.resolve()
        if path in stack:
            cycles.append([str(p) for p in [*stack[stack.index(path):], path]])
            return
        if path in visited:
            return
        visited.add(path)
        data = read(path)
        if data is None:
            missing.append(str(path))
            return
        files.append({'path': str(path), 'bytes': len(data), 'sha256': sha(data)})
        fence = None
        for line in data.decode('utf-8', errors='replace').splitlines():
            marker = re.match(r'^\s*(`{3,}|~{3,})', line)
            if marker:
                token = marker[1]
                if fence is None:
                    fence = token
                elif token[0] == fence[0] and len(token) >= len(fence):
                    fence = None
                continue
            if fence:
                continue
            plain = re.sub(r'(`+).*?\1', '', line)
            for match in re.finditer(r'(?<![\w\\])@([^\s`<>]+)', plain):
                target = (path.parent / Path(match[1]).expanduser()).resolve()
                if len(stack) >= 4:
                    depth_limited.append(str(target))
                elif not any(target.is_relative_to(base.resolve()) for base in allowed):
                    external.append(str(target))
                elif len(visited) >= 1000:
                    external.append(str(target))
                else:
                    visit(target, [*stack, path])
    for path in starts:
        if path.is_file():
            visit(path, [])
    return {'codex': codex, 'claude': {'files': files, 'bytes': sum(f['bytes'] for f in files),
            'cycles': cycles, 'missing_imports': missing, 'uninspected_external_imports': external,
            'depth_limited_imports': depth_limited,
            'scope': 'Claude ancestor candidates and @ imports, up to four hops',
            'limitations': ['Native setting-sources, excludes, managed policy, rules and auto-memory are not resolved here.',
                            'External imports require native approval; uninspected imports are listed explicitly.']}}


def native_snapshot(native, root, cwd, now):
    evidence = {'status': 'unavailable', 'source': None, 'authority': 'provided native evidence; not authorization'}
    if not isinstance(native, dict):
        return {}, evidence
    evidence['source'] = native.get('source') if isinstance(native.get('source'), str) else None
    try:
        stamp = datetime.fromisoformat(native['observed_at'].replace('Z', '+00:00'))
        current = datetime.fromisoformat(now.replace('Z', '+00:00')) if now else datetime.now(timezone.utc)
        valid = (stamp.tzinfo is not None and 0 <= (current - stamp).total_seconds() <= 300
                 and Path(native['target']).resolve() == root and Path(native['cwd']).resolve() == cwd
                 and isinstance(native.get('session_id'), str) and bool(native['session_id'])
                 and isinstance(native.get('clients'), dict) and evidence['source'])
        if valid:
            evidence.update(status='provided', observed_at=native['observed_at'], session_id=native['session_id'])
            return native['clients'], evidence
    except (KeyError, TypeError, ValueError, AttributeError):
        pass
    return {}, evidence


def installation(root, source, issues):
    lifecycle = sibling('rpi-lifecycle')
    configuration = sibling('rpi-config')
    try:
        state = lifecycle.load_state(root / '.rpi')
        if state:
            for entry in state['entries']:
                if 'config_record' in entry:
                    configuration.validate_records([entry['config_record']])
                    if entry.get('adapter', {}).get('harness') not in HARNESSES:
                        raise ValueError('invalid configuration harness')
            selections = state.get('installations')
            if selections is None:
                selections = {h: {'route': state.get('route'), 'domains': state.get('domains', [])} for h in state.get('harnesses', [])}
                state['installations'] = selections
            if (not isinstance(selections, dict) or any(h not in HARNESSES or not isinstance(value, dict)
                    or value.get('route') not in ('direct', 'plugin') or not isinstance(value.get('domains'), list)
                    or any(not isinstance(domain, str) for domain in value['domains'])
                    or not isinstance(value.get('expected_package', {}), dict) for h, value in selections.items())):
                raise ValueError('invalid per-harness installation metadata')
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        issues.append({'path': str(root / '.rpi/manifest.json'), 'status': 'invalid installation manifest'})
        state = None
    result = {'status': 'installed' if state else 'untracked', 'drift': [], 'missing_resources': [],
              'source': 'unavailable', 'native_discovery': {h: 'unverified' for h in HARNESSES}}
    desired = {}
    desired_config = {}
    if source:
        try:
            engine = sibling('rpi-distribution')
            manifest = engine.load_manifest(source)
            for harness, selection in (state or {}).get('installations', {}).items():
                request = {'harnesses': [harness], 'scope': 'project', 'route': selection['route']}
                desired.update(lifecycle.desired_entries(engine, source, manifest, request, selection['domains']))
                for component in engine.selected_components(manifest, selection['domains']):
                    if (component['kind'] != 'config' or component.get('distribution_only')
                            or component['scope'] != 'project' or harness not in component['harnesses']):
                        continue
                    declaration = json.loads(engine.safe_path(source, component['source']).read_bytes(),
                        object_pairs_hook=configuration.unique_object, parse_constant=configuration.invalid_constant)
                    if (not isinstance(declaration, dict) or declaration.get('schema_version') != 1
                            or set(declaration) != {'schema_version', 'entries'}):
                        raise ValueError('invalid configuration declaration')
                    configuration.validate_records(declaration['entries'])
                    destination = component['destinations'][harness]
                    lifecycle.validate_component_destination('project', destination)
                    for record in declaration['entries']:
                        desired_config[(destination, component['id'], harness, record['id'])] = record
            result['source'] = {'status': 'inspected', 'version': manifest['version']}
        except (OSError, ValueError, KeyError, TypeError):
            result['source'] = {'status': 'invalid source or missing declared resources'}
            desired.clear()
            desired_config.clear()
    if not state:
        return {}, result
    source_inspected = isinstance(result['source'], dict) and result['source'].get('status') == 'inspected'
    documents = {}
    installed_config = set()
    for entry in state['entries']:
        if entry['root_id'] != 'project':
            continue
        if entry.get('config_record'):
            name = entry['destination']
            record = entry['config_record']
            key = (name, entry['component_id'], entry['adapter']['harness'], record['id'])
            installed_config.add(key)
            item = {'destination': name, 'component_id': entry['component_id'], 'record_id': record['id']}
            status = 'clean'
            try:
                path = lifecycle.bound_path(root, name)
                if name not in documents:
                    documents[name] = object_file(path, issues)
                configuration.validate_records([record])
                baseline = read(lifecycle.bound_path(root / '.rpi', 'baselines/' + entry['base_hash']))
                if baseline is None or sha(baseline) != entry['base_hash'] or baseline != lifecycle.serialized(record):
                    status = 'missing or damaged baseline'
                value = configuration.read(documents[name], record)
                count = sum(configuration.same(item, record['value']) for item in value) if record['mode'] == 'entry' and value is not configuration.MISSING else int(configuration.same(value, record['value']))
                if status == 'clean' and count != 1:
                    status = 'configuration-changed'
            except (OSError, ValueError, KeyError, TypeError):
                status = 'invalid owned configuration'
            if source_inspected:
                proposed = desired_config.get(key)
                if proposed is None:
                    item['upstream_removed'] = True
                    if status == 'clean':
                        status = 'source-removed'
                elif not configuration.same(proposed, record):
                    item['upstream_changed'] = True
                    if status == 'clean':
                        status = 'source-changed'
            if status != 'clean':
                result['drift'].append({**item, 'status': status})
            continue
        name = entry['destination']
        item = {'destination': name, 'status': 'clean'}
        try:
            path = lifecycle.bound_path(root, name)
            baseline = read(lifecycle.bound_path(root / '.rpi', 'baselines/' + entry['base_hash']))
            if baseline is None or sha(baseline) != entry['base_hash']:
                item['status'] = 'missing or damaged baseline'
            if path.is_symlink():
                data = os.readlink(path).encode() if entry.get('node_kind') == 'symlink' else None
                if data is None:
                    item['status'] = 'unproven symlink'
            else:
                data = read(path)
            if entry.get('block'):
                data = lifecycle.extract_block(data, entry['block'])
            if data is None and item['status'] == 'clean':
                item['status'] = 'missing'
            elif data is not None and sha(data) != entry['base_hash']:
                item['status'] = 'local-modified'
            proposed = desired.get(('project', name, entry.get('block')))
            if proposed and sha(proposed['data']) != entry['base_hash']:
                item['upstream_changed'] = True
                if item['status'] == 'clean':
                    item['status'] = 'source-changed'
            if source and isinstance(result['source'], dict) and result['source'].get('status') == 'inspected' and proposed is None:
                item['upstream_removed'] = True
                if item['status'] == 'clean':
                    item['status'] = 'source-removed'
            if item['status'] != 'clean':
                result['drift'].append(item)
            if data is None and (('/skills/' in name and not name.endswith('/SKILL.md')) or entry['component_id'].startswith(('resource:', 'hook:'))):
                result['missing_resources'].append(item)
        except (OSError, ValueError):
            result['drift'].append({'destination': name, 'status': 'unsupported path or markers'})
    installed_keys = {(e['root_id'], e['destination'], e.get('block')) for e in state['entries']}
    for key, proposed in desired.items():
        if key not in installed_keys:
            result['drift'].append({'destination': proposed['destination'], 'status': 'source-added'})
    for key in sorted(desired_config.keys() - installed_config):
        result['drift'].append({'destination': key[0], 'component_id': key[1], 'record_id': key[3],
                                'status': 'source-added', 'setup': 'separate explicit capability authorization required'})
    return state, result


def skill_paths(directory, recursive):
    """Codex 0.153.4 walk bounds; Claude retains immediate-child discovery."""
    if not recursive:
        try:
            return [child / 'SKILL.md' for child in sorted(directory.iterdir())
                    if child.is_dir() and (child / 'SKILL.md').is_file()], False
        except OSError:
            return [], True
    # Native walker counts root at depth 0 and processes files in depth-6 dirs.
    pending, seen, found = deque([(directory, 0)]), {directory.resolve()}, []
    directory_count, entry_count, limited = 1, 0, False
    while pending:
        current, depth = pending.popleft()
        try:
            remaining = 20000 - entry_count
            with os.scandir(current) as iterator:
                entries = list(islice(iterator, remaining + 1))
            if len(entries) > remaining:
                # Native sorts the whole directory first. Avoid unbounded
                # materialization and report this directory uninspected instead.
                return found, True
            for child in sorted(entries, key=lambda item: item.name):
                entry_count += 1  # Hidden and skipped symlink entries also count.
                path = Path(child.path)
                try:
                    is_link = child.is_symlink()
                    if is_link and not path.exists():
                        limited = True
                        continue
                    if child.is_dir():
                        if child.name.startswith('.') or depth >= 6:
                            continue
                        resolved = path.resolve()
                        if resolved in seen:
                            continue
                        seen.add(resolved)
                        if directory_count == 2000:
                            limited = True
                            continue
                        directory_count += 1
                        pending.append((path, depth + 1))
                    elif not is_link and child.is_file() and child.name == 'SKILL.md':
                        found.append(path)
                except (OSError, RuntimeError):
                    limited = True
        except OSError:
            limited = True
            continue
    return found, limited


def skills(root, state, native):
    expected, discovered, indexed, collisions, scan_issues = {}, {}, {}, [], []
    for harness in HARNESSES:
        directories = [root / ('.claude/skills' if harness == 'claude' else '.agents/skills')]
        if harness == 'codex':
            directories.append(root / '.codex/skills')
        selection = state.get('installations', {}).get(harness, {})
        expected[harness] = {'route': selection.get('route', 'untracked'),
                             'roots': [str(directories[0])] if selection.get('route') != 'plugin' else [],
                             'package': {k: v for k, v in selection.get('expected_package', {}).items() if k in ('name', 'version')}}
        supplied = native.get(harness, {})
        # Native root strings are observations, not instructions to crawl arbitrary paths.
        roots = supplied.get('skill_roots', []) if isinstance(supplied, dict) else []
        discovered[harness] = {'filesystem_roots': [str(p) for p in directories if p.is_dir()],
                               'native_roots': [p for p in records(roots) if isinstance(p, str)]}
        items = []
        for directory in directories:
            if directory.is_dir():
                candidates, limited = skill_paths(directory, harness == 'codex')
                if limited:
                    scan_issues.append({'path': str(directory), 'status': 'bounded scan incomplete'})
                for path in candidates:
                    data = read(path)
                    if data is None:
                        continue
                    match = re.search(rb'(?m)^name:\s*["\']?([a-z0-9-]+)["\']?\s*$', data)
                    name = match[1].decode() if match else path.parent.name
                    items.append((name, str(path)))
                    if selection.get('route') == 'plugin' and name.startswith('rpi-'):
                        collisions.append({'harness': harness, 'name': name, 'path': str(path)})
        for item in records(supplied.get('skills')) if isinstance(supplied, dict) else []:
            if isinstance(item, dict) and isinstance(item.get('name'), str) and isinstance(item.get('path'), str):
                items.append((item['name'].split(':')[-1], item['path']))
        for name, path in items:
            indexed.setdefault((harness, name), set()).add(path)
    duplicates = [{'harness': h, 'name': n, 'paths': sorted(p)} for (h, n), p in indexed.items() if len(p) > 1]
    legacy = sorted({str(p.relative_to(root)) for pattern in ('.claude/commands/*.md', '.Codex/commands/*.md', '.codex/skills/source-command-*/SKILL.md') for p in root.glob(pattern)})
    return {'expected': expected, 'discovered': discovered, 'duplicates': duplicates,
            'legacy_entries': legacy, 'route_collisions': collisions, 'scan_issues': scan_issues,
            'scope': 'filesystem candidates; Codex 0.153.4 depth 6, 2000 directories, 20000 entries per root; supplied native discovery is separate evidence'}


def hooks(root, native, issues):
    result = {h: [] for h in HARNESSES}
    for harness, relative in (('claude', '.claude/settings.json'), ('codex', '.codex/hooks.json')):
        path = root / relative
        settings = object_file(path, issues)
        # Exact e9dad45 v1 template values are recognizable, not ownership proof.
        permissions = settings.get('permissions')
        allowed = permissions.get('allow') if isinstance(permissions, dict) else None
        if harness == 'claude' and isinstance(allowed, list):
            for executable in ('git', 'gh'):
                if 'Bash(' + executable + ' *)' in allowed:
                    issues.append({'id': 'legacy-broad-' + executable + '-allow', 'path': str(path),
                        'status': 'potential legacy broad allow', 'ownership': 'unverified',
                        'action': 'preserve; review a separate native permission setup diff',
                        'authority': 'configuration observation; not authorization'})
        registry = settings.get('hooks', {})
        if isinstance(registry, dict):
            for event, groups in registry.items():
                if not isinstance(groups, list):
                    continue
                for group in groups:
                    if isinstance(group, dict):
                        result[harness].append({'registration': 'configured', 'event': event,
                            'source_path': str(path), 'trust': 'unverified', 'observed': False})
        supplied = native.get(harness, {})
        for item in records(supplied.get('hooks')) if isinstance(supplied, dict) else []:
            if not isinstance(item, dict):
                continue
            trust = item.get('trustStatus') if item.get('trustStatus') in ('managed', 'trusted', 'untrusted', 'modified') else 'unverified'
            current_hash = item.get('currentHash')
            valid_hash = isinstance(current_hash, str) and re.fullmatch(r'sha256:[0-9a-f]{64}', current_hash) is not None
            source_path = item.get('sourcePath') if isinstance(item.get('sourcePath'), str) else None
            fresh_source = False
            if (isinstance(source_path, str) and Path(source_path).is_absolute()
                    and Path(source_path).name in ('hooks.json', 'settings.json', 'settings.local.json')
                    and not Path(source_path).is_symlink()):
                data = read(Path(source_path))
                fresh_source = data is not None and sha(data) == item.get('source_sha256')
                if item.get('source_sha256') and not fresh_source:
                    trust = 'modified'
            observed = bool(item.get('enabled') is True and trust in ('managed', 'trusted')
                            and valid_hash and current_hash == item.get('observed_hash') and fresh_source)
            result[harness].append({'registration': 'native reported' if item.get('enabled') else 'disabled',
                'source_path': source_path, 'event': item.get('eventName') if isinstance(item.get('eventName'), str) else None, 'trust': trust,
                'hash_available': valid_hash, 'source_bytes_match': fresh_source, 'observed': observed})
    return result


def topology(root, issues):
    result = {'git': 'unavailable', 'branch': None, 'commit': None, 'working_tree': 'unavailable'}
    policy = object_file(root / '.rpi/policy.json', issues)
    branch = policy.get('integration_branch')
    production = policy.get('production_branches')
    valid_name = lambda value: isinstance(value, str) and bool(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_./-]*', value))
    result['integration_branch'] = branch if valid_name(branch) else None
    result['production_branches'] = [value for value in records(production) if valid_name(value)]
    result['topology_source'] = '.rpi/policy.json; declarative, not authorization' if policy else 'unavailable; branch names alone do not establish production'
    if not shutil.which('git'):
        return result
    for key, args in [('branch', ['branch', '--show-current']), ('commit', ['rev-parse', '--verify', 'HEAD']),
                      ('working_tree', ['status', '--porcelain'])]:
        try:
            process = subprocess.run(['git', '--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-C', str(root), *args], capture_output=True, text=True, timeout=5)
            if process.returncode == 0:
                result['git'] = 'available'
                result[key] = ('dirty' if process.stdout else 'clean') if key == 'working_tree' else process.stdout.strip() or 'unborn'
        except (OSError, subprocess.TimeoutExpired):
            pass
    return result


def diagnose(root, cwd=None, globals_by_harness=None, native=None, model=None, source=None,
             max_instruction_bytes=None, now=None):
    if sys.version_info < (3, 11):
        raise ValueError('diagnostics require Python 3.11+; use the verified project runtime')
    root = Path(root).resolve()
    cwd = Path(cwd).resolve() if cwd else root
    if not root.is_dir() or not cwd.is_dir() or not cwd.is_relative_to(root):
        raise ValueError('target and cwd must be existing directories with cwd inside target')
    if globals_by_harness is None:
        globals_by_harness = {'codex': [Path(os.environ.get('CODEX_HOME', Path.home() / '.codex'))],
                             'claude': [Path(os.environ.get('CLAUDE_CONFIG_DIR', Path.home() / '.claude'))]}
    issues = []
    clients, evidence = native_snapshot(native, root, cwd, now)
    state, installed = installation(root, Path(source).resolve() if source else None, issues)
    versions = {}
    models = {}
    model_helper = sibling('rpi-models')
    for harness in HARNESSES:
        supplied = clients.get(harness, {})
        version = supplied.get('version') if isinstance(supplied, dict) else None
        if not isinstance(version, str) or not re.fullmatch(r'\d+\.\d+\.\d+(?:[-+][\w.-]+)?', version):
            version = None
        versions[harness] = {'version': version or client_version(harness),
                              'source': 'provided native snapshot' if version else 'local --version probe'}
        models[harness] = model_helper.diagnose(harness, 'status', versions[harness]['version'] or 'unavailable',
            observation=supplied.get('model_observation') if isinstance(supplied, dict) else None,
            session_id=evidence.get('session_id'), now=now)
    effort = os.environ.get('CLAUDE_EFFORT')
    if effort in model_helper.supported_efforts('claude') and models['claude']['resolved_model_effort']['effort'] is None:
        models['claude']['resolved_model_effort'].update(effort=effort, status='process-observed',
            reason='current process effort only; native pane binding unavailable')
        models['claude']['evidence_source_client_version']['effort_source'] = 'diagnostic process CLAUDE_EFFORT'
        if models['claude']['evidence_source_client_version']['source'] is None:
            models['claude']['evidence_source_client_version']['source'] = 'diagnostic process CLAUDE_EFFORT'
    # Model request is accepted only as an explicit selection, never an observed identity.
    if model:
        for harness in HARNESSES:
            if isinstance(model.get(harness), dict):
                models[harness]['requested_model_effort_source'] = model_helper.select_profile(harness, 'status', explicit=model[harness])
    streams = [p for p in (root / '.rpi/local/contract-events.jsonl', root / '.claude/metrics/contract-events.jsonl') if p.is_file()]
    return {'schema_version': 1, 'read_only': True, 'harnesses': versions, 'native_evidence': evidence,
            'installation': installed, 'skills': skills(root, state, clients),
            'instructions': instructions(root, cwd, globals_by_harness, max_instruction_bytes, issues),
            'hooks': hooks(root, clients, issues), 'model': models, 'topology': topology(root, issues),
            'python_runtime': {'version': '.'.join(map(str, sys.version_info[:3])), 'supported': sys.version_info >= (3, 11)},
            'prerequisites': {tool: 'available' if shutil.which(tool) else 'missing' for tool in ('python3', 'git', 'gh', 'node', 'bash', 'uv')},
            'telemetry': {'status': 'present; coverage unverified' if streams else 'unobserved',
                          'streams': [str(p) for p in streams]}, 'config_issues': issues}


def cli(args):
    globals_by_harness = None
    if args.global_instruction:
        globals_by_harness = {h: [] for h in HARNESSES}
        for value in args.global_instruction:
            harness, separator, path = value.partition('=')
            if not separator or harness not in HARNESSES or not path:
                raise ValueError('--global-instruction requires claude=PATH or codex=PATH')
            globals_by_harness[harness].append(path)
    native = json.loads(args.native_observation.read_text()) if args.native_observation else None
    result = diagnose(args.target, args.cwd, globals_by_harness, native, source=args.source,
                      max_instruction_bytes=args.max_instruction_bytes)
    print(json.dumps(result, sort_keys=True))
    return 0


def add_arguments(parser):
    parser.add_argument('--cwd', type=Path)
    parser.add_argument('--native-observation', type=Path)
    parser.add_argument('--global-instruction', action='append', default=[])
    parser.add_argument('--max-instruction-bytes', type=int)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', type=Path, required=True)
    parser.add_argument('--source', type=Path)
    add_arguments(parser)
    try:
        return cli(parser.parse_args())
    except (OSError, ValueError, TypeError, KeyError):
        print('BLOCKED / WHY: invalid diagnostic inputs / FIX: run python3 templates/scripts/rpi-diagnostics.py --help', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
