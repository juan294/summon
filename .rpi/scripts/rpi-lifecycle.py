#!/usr/bin/env python3
"""Offline ownership reconciliation and recoverable filesystem transactions.

Plans are reviewable data, never executable instructions: apply reconstructs the
plan from its explicit request and rejects any changed preimage or operation.
Only marked instruction blocks and exact owned files enter portable baselines.
Whole-file preimages (which may contain private project facts) stay under local/.
"""
import base64
import difflib
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import sys
import stat
import subprocess
import tempfile
import time
import uuid


class Conflict(ValueError):
    """A valid request needs reconciliation before it can mutate files."""
    fix = None  # A specific runnable repair, when the failure site knows one.


class MergeConflict(Conflict):
    """Both the owner and the template changed the same lines of an owned file."""


class UsageError(ValueError):
    """An invalid request whose exact repair is known at the failure site.

    `drop` = (option, values) the operator passed in error; the CLI turns it into
    the same command without them."""

    def __init__(self, reason, fix, drop=None):
        super().__init__(reason)
        self.fix, self.drop = fix, drop


class TargetSettingsError(ValueError):
    """Malformed owner settings need target repair, not source regeneration."""

    def __init__(self, path, reason):
        self.path = path
        super().__init__('invalid target settings ' + str(path) + ': ' + str(reason))


def has_direct_content(path):
    """Empty directory trees are inert; never follow or remove owner entries."""
    try:
        if path.is_symlink():
            return True
        if not path.exists():
            return False
        pending = [path]
        while pending:
            with os.scandir(pending.pop()) as entries:
                for entry in entries:
                    if not entry.is_dir(follow_symlinks=False):
                        return True
                    pending.append(entry.path)
        return False
    except OSError:
        return True  # Unreadable or non-directory roots cannot prove absence.


def encoded(data):
    return base64.b64encode(data).decode('ascii')


def decoded(data):
    return base64.b64decode(data, validate=True)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def serialized(value):
    return (json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False) + '\n').encode()


def bound_path(root, relative):
    """Lexical containment and no symlink parents, including bound roots."""
    root = Path(root).absolute()
    name = Path(relative)
    if not isinstance(relative, str) or not relative or name.is_absolute() or name.as_posix() != relative or '..' in name.parts:
        raise ValueError('noncanonical destination: ' + str(relative))
    path = root / name
    parents = [root, *root.parents]
    parent = path.parent
    while parent != root:
        parents.append(parent)
        parent = parent.parent
    for parent in parents:
        if parent.is_symlink():
            raise Conflict('symlink parent: ' + str(parent))
        if parent.exists() and not parent.is_dir():
            raise Conflict('non-directory parent: ' + str(parent))
    return path


def snapshot(path):
    if path.is_symlink():
        return {'kind': 'symlink', 'target': os.readlink(path)}
    if not path.exists():
        return {'kind': 'missing'}
    if not path.is_file():
        raise Conflict('not a regular file: ' + str(path))
    data = path.read_bytes()
    return {'kind': 'file', 'data': encoded(data), 'sha256': digest(data), 'mode': stat.S_IMODE(path.stat().st_mode)}


def file_node(data, mode=0o644):
    return {'kind': 'file', 'data': encoded(data), 'sha256': digest(data), 'mode': mode}


def node_bytes(node):
    return decoded(node['data']) if node['kind'] == 'file' else None


def validate_component_destination(root_id, destination):
    if not isinstance(destination, str) or not destination or Path(destination).is_absolute() or Path(destination).as_posix() != destination or '..' in Path(destination).parts:
        raise ValueError('owned component destination must be canonical and relative')
    if root_id == 'project' and (destination in ('.rpi', '.rpi/manifest.json', '.rpi/local', '.rpi/baselines') or destination.startswith(('.rpi/local/', '.rpi/baselines/'))):
        raise ValueError('component destination cannot claim internal installation state')


def load_state(state):
    path = bound_path(state, 'manifest.json')
    node = snapshot(path)
    if node['kind'] == 'missing':
        return None
    if node['kind'] != 'file':
        raise Conflict('state manifest must be a regular file')
    value = json.loads(node_bytes(node))
    if value.get('schema_version') != 1 or not isinstance(value.get('entries'), list):
        raise ValueError('invalid installation manifest schema')
    allowed_roots = {'project'} if value.get('scope') == 'project' else {'claude-user-skills', 'codex-user-skills'} if value.get('scope') == 'user' else set()
    root_ids = value.get('root_ids')
    if not isinstance(root_ids, list) or not root_ids or any(not isinstance(root_id, str) for root_id in root_ids) or set(root_ids) - allowed_roots or len(root_ids) != len(set(root_ids)):
        raise ValueError('installation root IDs must match the declared installation scope')
    seen = set()
    for entry in value['entries']:
        if entry.get('root_id') not in root_ids:
            raise ValueError('owned component refers to an undeclared installation root ID')
        validate_component_destination(entry['root_id'], entry.get('destination'))
        key = (entry['root_id'], entry['destination'], entry.get('block'), entry.get('config_record', {}).get('id'))
        if key in seen or entry.get('ownership') != 'cc-rpi' or not re.fullmatch('[0-9a-f]{64}', entry.get('base_hash', '')):
            raise ValueError('invalid or duplicate owned entry')
        consumers = entry.get('consumers')
        if 'consumers' in entry and (not isinstance(consumers, list) or not consumers or
                any(h not in ('claude', 'codex') for h in consumers) or
                len(consumers) != len(set(consumers)) or
                entry.get('adapter', {}).get('harness') not in consumers):
            raise ValueError('invalid component consumers')
        seen.add(key)
    return value


def source_identity(source, manifest):
    top = subprocess.run(['git', '-C', str(source), 'rev-parse', '--show-toplevel'], capture_output=True, text=True)
    exact_checkout = top.returncode == 0 and Path(top.stdout.strip()).resolve() == source.resolve()
    result = subprocess.run(['git', '-C', str(source), 'rev-parse', '--verify', 'HEAD'], capture_output=True, text=True) if exact_checkout else None
    return {'version': manifest['version'], 'revision': result.stdout.strip() if result is not None and result.returncode == 0 else 'packaged',
            'manifest_sha256': digest(serialized(manifest))}


def request_roots(request):
    scope = request['scope']
    target_input = Path(request['target']).absolute()
    if target_input.is_symlink():
        raise Conflict('installation target root cannot be a symlink')
    target = target_input.resolve()
    if scope == 'project':
        roots = {'project': str(target)}
        state = target / '.rpi'
    elif scope == 'user':
        if not request.get('state_root'):
            raise ValueError('user scope requires --state-root and explicit native skill roots')
        state_input = Path(request['state_root']).absolute()
        if state_input.is_symlink():
            raise Conflict('user state root cannot be a symlink')
        state = state_input.resolve()
        roots = {}
        for harness in ('claude', 'codex'):
            path = request.get(harness + '_skill_root')
            if not path:
                if harness in request['harnesses']:
                    raise ValueError('user scope requires --' + harness + '-skill-root')
                continue
            if Path(path).is_symlink():
                raise Conflict('native skill root cannot be a symlink')
            roots[harness + '-user-skills'] = str(Path(path).resolve())
    else:
        raise ValueError('unsupported installation scope')
    if state == Path('/') or any(Path(value) == Path('/') for value in roots.values()):
        raise ValueError('filesystem root cannot be an installation root')
    if scope == 'user':
        bound = [state, *map(Path, roots.values())]
        for index, first in enumerate(bound):
            for second in bound[index + 1:]:
                if first == second or first in second.parents or second in first.parents:
                    raise ValueError('user state and native skill roots must be disjoint')
    # Check even empty destinations without creating directories.
    bound_path(state, 'manifest.json')
    for path in roots.values():
        bound_path(path, '.rpi-root-probe')
    return roots, str(state)


def instruction_blocks(data):
    pattern = rb'<!-- rpi:([a-z0-9-]+):start -->\n.*?\n<!-- rpi:\1:end -->\n'
    blocks = {match[1].decode(): match[0] for match in re.finditer(pattern, data, re.S)}
    if not blocks:
        raise ValueError('rendered instructions contain no marked blocks')
    return blocks


def desired_entries(engine, source, manifest, request, domains):
    harnesses = request['harnesses']
    tree = engine.render_tree(source, harnesses, domains, include_runtime=False)
    desired = {}
    def add(component, harness, destination, data, block=None, mode=None):
        root_id = 'project' if request['scope'] == 'project' else harness + '-user-skills'
        validate_component_destination(root_id, destination)
        entry = {'component_id': component, 'root_id': root_id, 'destination': destination,
                 'ownership': 'cc-rpi', 'consumers': [harness],
                 'adapter': {'harness': harness, 'sha256': digest(serialized(engine.load_adapter(source, harness)))}, 'data': data}
        if mode is not None:
            entry['mode'] = mode  # In memory only: it never reaches the manifest.
        declaration = next((item for item in manifest['components'] if item['id'] == component), {})
        if declaration.get('capability'):
            entry['capability'] = True
        if block:
            entry['block'] = block
        key = (root_id, destination, block)
        if key in desired and desired[key]['data'] != data:
            raise ValueError('conflicting harness output: ' + destination)
        if key in desired:
            entry['consumers'] = sorted(set(desired[key]['consumers']) | set(entry['consumers']))
        desired[key] = entry
    for component in engine.selected_components(manifest, domains):
        if component['scope'] != request['scope'] or component.get('distribution_only'):
            continue
        for harness in harnesses:
            if harness not in component['harnesses']:
                continue
            kind = component['kind']
            if kind == 'skill':
                if request['route'] == 'plugin':
                    continue  # Native manager owns the immutable package, not this engine.
                prefix = harness + '/skills/' + component['name'] + '/'
                destination = (('.claude/skills/' if harness == 'claude' else '.agents/skills/')
                               if request['scope'] == 'project' else '') + component['name'] + '/'
                for name, data in tree.items():
                    if name.startswith(prefix):
                        add(component['id'], harness, destination + name[len(prefix):], data, mode=tree.modes.get(name))
            elif kind == 'rule':
                name = Path(component['source']).name
                add(component['id'], harness, '.rpi/rules/' + name, tree[harness + '/rules/' + name], mode=tree.modes.get(harness + '/rules/' + name))
                if harness == 'claude' and component['mapping']['mode'] == 'conditional':
                    add(component['id'], harness, '.claude/rules/' + name, tree[harness + '/rules/' + name], mode=tree.modes.get(harness + '/rules/' + name))
            elif kind in ('hook', 'resource'):
                destination = component['outputs'][harness]
                if kind == 'hook' and not destination.startswith('.'):
                    destination = '.' + harness + '/' + destination
                add(component['id'], harness, destination, tree[harness + '/' + component['outputs'][harness]],
                    mode=tree.modes.get(harness + '/' + component['outputs'][harness]))
            elif kind == 'config':
                continue  # Entry-level reconciliation owns native configuration below.
    if request['scope'] == 'project':
        harness = 'codex' if 'codex' in harnesses else 'claude'
        for block, data in instruction_blocks(tree[harness + '/AGENTS.md']).items():
            add('instruction:' + block, harness, 'AGENTS.md', data, block)
        if 'claude' in harnesses:
            add('instruction:claude-import', 'claude', 'CLAUDE.md',
                b'<!-- rpi:claude-import:start -->\n@AGENTS.md\n<!-- rpi:claude-import:end -->\n', 'claude-import')
    return desired


def extract_block(data, block):
    if data is None:
        return None
    start = ('<!-- rpi:' + block + ':start -->').encode()
    end = ('<!-- rpi:' + block + ':end -->').encode()
    if start not in data and end not in data:
        return None
    if data.count(start) != 1 or data.count(end) != 1:
        raise Conflict('duplicate or incomplete managed instruction markers: ' + block)
    begin = data.index(start)
    finish = data.index(end) + len(end)
    if finish <= begin:
        raise Conflict('reversed managed instruction markers: ' + block)
    if data[finish:finish + 1] == b'\n':
        finish += 1
    return data[begin:finish]


def merge_bytes(local, base, upstream):
    if any(b'\0' in data for data in (local, base, upstream)):
        raise Conflict('both local and upstream changed binary content')
    with tempfile.TemporaryDirectory(prefix='rpi-merge-') as directory:
        paths = [Path(directory) / name for name in ('local', 'base', 'upstream')]
        for path, content in zip(paths, (local, base, upstream)):
            path.write_bytes(content)
        result = subprocess.run(['git', 'merge-file', '-p', *map(str, paths)], capture_output=True)
    if result.returncode != 0:
        raise MergeConflict('both local and upstream changed overlapping content')
    return result.stdout


def historical_blob(source, revision, relative):
    if not revision or relative is None:
        return None
    mode = subprocess.run(['git', '-C', str(source), 'ls-tree', revision, '--', relative], capture_output=True, text=True)
    if not mode.stdout.startswith(('100644 blob ', '100755 blob ')):
        return None
    result = subprocess.run(['git', '-C', str(source), 'show', revision + ':' + relative], capture_output=True)
    return result.stdout if result.returncode == 0 else None


def legacy_source_path(manifest, proposed):
    """Known v1 direct installation copied declared source bytes unchanged."""
    component = next((c for c in manifest['components'] if c['id'] == proposed['component_id']), None)
    if component is None or proposed.get('block'):
        return None
    if component['kind'] in ('rule', 'hook', 'resource'):
        directory = {'rule': 'rules', 'hook': 'hooks', 'resource': 'scripts'}[component['kind']]
        expected = '.claude/' + directory + '/' + Path(component['source']).name
        return component['source'] if proposed['destination'] == expected else None
    if component['kind'] != 'skill' or component['category'] != 'domain':
        return None
    marker = '.claude/skills/' + component['name'] + '/'
    destination = proposed['destination']
    if not destination.startswith(marker):
        return None
    relative = destination.split(marker, 1)[1]
    if relative == 'SKILL.md':
        return component['source'] + '/SKILL.md'
    for resource in component['resources']:
        if isinstance(resource, str) and resource == relative:
            return component['source'] + '/' + resource
        if isinstance(resource, dict) and resource['destination'] == relative:
            return resource['source']
    return None


def reads_user_skills(root):
    """True when `root` is the user skills directory Claude Code reads (under CLAUDE_CONFIG_DIR or ~/.claude)."""
    try:
        return bool(root) and Path(root).resolve() == (Path(os.environ.get('CLAUDE_CONFIG_DIR') or Path.home() / '.claude') / 'skills').resolve()
    except (OSError, RuntimeError):
        return False


def plugin_settings_files(project_root):
    candidates = [Path(os.environ.get('CLAUDE_CONFIG_DIR') or Path.home() / '.claude') / 'settings.json']
    if project_root:
        candidates += [Path(project_root) / '.claude/settings.json', Path(project_root) / '.claude/settings.local.json']
    return candidates


def unreadable_plugin_settings(project_root):
    """Notices for Claude settings files that exist but cannot be parsed: an enabled cc-rpi plugin there cannot be detected."""
    notices = []
    for path in plugin_settings_files(project_root):
        if not path.is_file():
            continue
        text = ''
        try:
            text = path.read_text()
            value = json.loads(text)
            problem = None if isinstance(value, dict) else 'its top level is not a JSON object'
        except OSError as error:
            problem = 'it cannot be read (' + (error.strerror or str(error)) + ')'
        except UnicodeDecodeError:
            problem = 'it is not valid UTF-8 text'
        except ValueError as error:
            problem = 'it is empty' if not text.strip() else 'it is not valid JSON (' + str(error) + ')'
        if problem:
            notices.append({'plugin_settings': 'unreadable', 'path': str(path),
                            'reason': str(path) + ' is unusable because ' + problem + ', so this plan cannot tell whether the cc-rpi plugin is enabled there '
                                      'and a direct installation could register every skill twice',
                            'fix': 'make ' + str(path) + ' readable and valid JSON (Claude Code cannot use it either); then run the same plan command again. '
                                   'If you know the plugin is not enabled, the plan can be applied as it is'})
    return notices


def enabled_cc_rpi_plugins(project_root):
    """(settings file, plugin key) for each enabled cc-rpi plugin in Claude's user and project settings.

    Claude Code records plugins in the enabledPlugins object of settings.json as "name@marketplace": true or false
    (key shape seen in a real ~/.claude/settings.json). The user file is read from CLAUDE_CONFIG_DIR or ~/.claude;
    project scope is .claude/settings.json and .claude/settings.local.json."""
    found = []
    for path in plugin_settings_files(project_root):
        try:
            value = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        plugins = value.get('enabledPlugins') if isinstance(value, dict) else None
        if isinstance(plugins, dict):
            found += [(str(path), key) for key, enabled in plugins.items()
                      if enabled is True and isinstance(key, str) and key.split('@', 1)[0] == 'cc-rpi']
    return found


def duplicate_registration_conflict(found):
    path, key = found[0]
    return {'destination': path, 'reason': 'the cc-rpi Claude plugin is enabled (' + key + ' in ' + path + '), so a direct installation would register every skill twice',
            'fix': 'disable the plugin by setting "' + key + '": false under enabledPlugins in ' + path + ' (or remove that entry), or install through the plugin '
                   'instead by re-planning with --route plugin; then re-plan'}


# A saved copy never reuses a name: the process ID tells two runs in the same second apart.
UNIQUE_STAMP = '$(date +%Y%m%d-%H%M%S).$$'


def move_aside_command(state, roots, root_id, destination):
    """A shell line that keeps a path under local/saved-edits (a fresh time-stamped name; a directory or link moves whole)."""
    live = bound_path(roots[root_id], destination)
    saved = Path(state) / 'local/saved-edits/plan' / root_id / destination
    return ('mkdir -p -- ' + shlex.quote(str(saved.parent)) + ' && mv -- ' + shlex.quote(str(live)) + ' ' +
            shlex.quote(str(saved)) + '.' + UNIQUE_STAMP)


def materialize_command(state, roots, root_id, destination):
    """move_aside_command, then a regular copy of what a symbolic link pointed at, so the owner's content stays in place.

    The link itself is moved (never followed); the copy is made from the link's real target, which stays where it is."""
    live = bound_path(roots[root_id], destination)
    command = move_aside_command(state, roots, root_id, destination)
    real = os.path.realpath(live)
    if os.path.islink(live) and os.path.isfile(real):
        command += ' && cp -- ' + shlex.quote(real) + ' ' + shlex.quote(str(live))
    return command


def replace_link_command(link):
    """Move a symbolic link (or a file in the way of a directory) to a sibling name; a link to a directory is then
    replaced by a real directory holding a copy of what it pointed at. The link target itself is never changed."""
    link = str(link)
    command = 'mv -- ' + shlex.quote(link) + ' ' + shlex.quote(link) + '.saved.' + UNIQUE_STAMP
    real = os.path.realpath(link)
    if os.path.islink(link) and os.path.isdir(real):
        command += ' && cp -R -- ' + shlex.quote(real) + ' ' + shlex.quote(link)
    return command


def conflict_repair(reason, state, roots, root_id, destination, block):
    """The concrete repair for conflict classes that otherwise only say to inspect the plan, or {}."""
    if reason == 'destination exists without proven ownership':
        if block:
            return {'fix': 'the marked ' + block + ' block in ' + destination + ' is not recorded as installed here (for example a detach kept it): cut that block '
                           'out of the file and keep it elsewhere, or delete it if it is only a copy of the template'}
        command = move_aside_command(state, roots, root_id, destination)
        return {'fix': 'keep your version by moving it aside with ' + command + ' (the install then writes the template; merge your changes back from the saved copy)',
                'move_aside_command': command}
    if reason.startswith('modified direct registration competes with requested plugin route'):
        command = move_aside_command(state, roots, root_id, destination)
        return {'fix': 'either keep the direct route (re-plan with --route direct), or move your modified file aside with ' + command +
                       ' and re-plan with the plugin route (the direct copy is then removed)',
                'move_aside_command': command}
    if reason == 'unproven symlink destination; preserve entry and target' and state is not None and root_id in roots:
        command = move_aside_command(state, roots, root_id, destination)
        return {'fix': destination + ' is a symbolic link and the engine never follows or replaces one it does not own; move the link itself aside with ' +
                       command + ' (what it points at is not touched), then the template is written there; merge anything you need from the saved link',
                'move_aside_command': command}
    if reason.startswith('not a regular file: ') and state is not None and root_id in roots:
        command = move_aside_command(state, roots, root_id, destination)
        return {'fix': destination + ' is a directory or special file where cc-rpi owns a regular file; move it aside whole with ' + command +
                       ' (nothing inside it is deleted), then the template file is written there; move back whatever you still need',
                'move_aside_command': command}
    if reason == 'native configuration must be a regular file' and state is not None and root_id in roots:
        command = materialize_command(state, roots, root_id, destination)
        return {'fix': destination + ' is not a regular file; move it aside with ' + command +
                       ' (a symbolic link to a file is replaced by a regular copy of that file, so your settings stay in place), then re-plan',
                'move_aside_command': command}
    if reason.startswith(('symlink parent: ', 'non-directory parent: ')):
        link = reason.split(': ', 1)[1]
        real = os.path.realpath(link)
        command = replace_link_command(link)
        return {'fix': 'the engine never writes through a link: ' + link + (' is a symbolic link to ' + real if os.path.islink(link) else ' is not a directory') +
                       '; point --target at the project that really holds ' + (destination or 'the native directories') + ', or replace ' + link +
                       ' with a real directory (move the link away and copy in what you need) by running ' + command + ', then re-plan',
                'move_aside_command': command}
    return {}


def reconciliation_conflict(destination, reason, base, local, upstream):
    record = {'destination': destination, 'reason': reason}
    if local is None or upstream is None:
        return record
    record['hashes'] = {name: digest(data) if data is not None else None
                        for name, data in (('base', base), ('local', local), ('upstream', upstream))}
    if any(data is not None and b'\0' in data for data in (base, local, upstream)):
        record['diffs'] = {'binary': 'Binary content differs; review the hashed preimages in this local plan.'}
        return record
    def difference(before, after, first, second):
        return ''.join(difflib.unified_diff(before.decode('utf-8', errors='replace').splitlines(keepends=True),
                                           after.decode('utf-8', errors='replace').splitlines(keepends=True),
                                           fromfile=first, tofile=second))
    record['diffs'] = ({'local_to_upstream': difference(local, upstream, 'local', 'upstream')}
                       if base is None else
                       {'base_to_local': difference(base, local, 'base', 'local'),
                        'base_to_upstream': difference(base, upstream, 'base', 'upstream')})
    return record


def make_plan(engine, request):
    source = Path(request['source']).resolve()
    manifest = engine.load_manifest(source)
    roots, state = request_roots(request)
    revision = request.get('legacy_base')
    if revision:
        if not re.fullmatch('[0-9a-f]{40}|[0-9a-f]{64}', revision):
            raise UsageError('--legacy-base must be a full immutable commit ID, not ' + repr(revision),
                             'pass the full ID that ' + shlex.join(['git', '-C', str(source), 'rev-parse', '--verify', revision + '^{commit}']) +
                             ' prints')
        top = subprocess.run(['git', '-C', str(source), 'rev-parse', '--show-toplevel'], capture_output=True, text=True)
        kind = subprocess.run(['git', '-C', str(source), 'cat-file', '-t', revision], capture_output=True, text=True)
        if top.returncode != 0 or Path(top.stdout.strip()).resolve() != source or kind.returncode != 0 or kind.stdout.strip() != 'commit':
            raise UsageError('--legacy-base ' + revision + ' is not a commit available in the --source checkout ' + str(source),
                             'pass --source the cc-rpi Git checkout root that contains that commit (fetch it there first), '
                             'or choose a commit that ' + shlex.join(['git', '-C', str(source), 'log', '--format=%H']) + ' lists')
    configuration = engine.load_sibling('rpi-config')
    if request['scope'] == 'project':
        settings = bound_path(roots['project'], '.claude/settings.json')
        try:
            settings_node = snapshot(settings)
            if settings_node['kind'] not in ('file', 'missing'):
                raise Conflict('settings must be a regular JSON file')
        except Conflict as error:
            command = materialize_command(state, roots, 'project', '.claude/settings.json')
            error.fix = ('.claude/settings.json is ' + ('a symbolic link' if settings.is_symlink() else 'not a regular file') + ' and the engine never writes through one; move it aside with ' +
                         command + (' (a symbolic link to a file is replaced by a regular copy of that file, so your settings stay in place)' if settings.is_symlink() else
                                    ' (nothing inside it is deleted)'))
            error.replan = True  # The command line that creates the next plan is appended where the output path is known.
            error.command = command
            raise
        if settings_node['kind'] == 'file':
            try:
                if not isinstance(json.loads(node_bytes(settings_node), object_pairs_hook=configuration.unique_object, parse_constant=configuration.invalid_constant), dict):
                    raise ValueError('settings root must be an object')
            except ValueError as error:
                raise TargetSettingsError(settings, error) from error
    previous = load_state(state)
    if previous and (previous.get('scope') != request['scope'] or previous.get('root_ids') != sorted(roots)):
        raise UsageError('this request uses scope ' + request['scope'] + ' with roots ' + ', '.join(sorted(roots)) +
                         '; the installation at ' + str(state) + ' records scope ' + str(previous.get('scope')) +
                         ' with roots ' + ', '.join(map(str, previous.get('root_ids') or [])),
                         'rerun with --scope ' + str(previous.get('scope')) + ' and that installation\'s roots, '
                         'or inspect ' + str(Path(state) / 'manifest.json') + ' if it was edited by hand')
    moved = moved_journals(state)
    if moved:  # The documented rebind step would strand this transaction, so it is never offered here.
        error = Conflict('the project was moved while a transaction was unfinished: ' + str(moved[-1][0]))
        error.fix = move_back_fix(state, moved)
        raise error
    # Local root binding is separate from the portable ownership manifest.
    binding_path = bound_path(state, 'local/root-binding.json')
    binding = snapshot(binding_path)
    if previous and binding['kind'] != 'missing' and node_bytes(binding) != serialized(roots):
        error = Conflict('installation roots differ from the recorded local binding ' +
                         node_bytes(binding).decode('utf-8', errors='replace').strip().replace('\n', ' ') +
                         '; the installation was moved or renamed, or the requested roots differ')
        # The ignored binding only ties local recovery journals to their roots.
        # Journals record absolute roots, so old-location journals stay refused.
        error.fix = ('if this installation was moved or renamed on purpose, rebind it with ' +
                     shlex.join(['rm', str(binding_path)]) + ', then create a new plan (the next apply records '
                     'the new roots; journals from the old location cannot roll back here); otherwise pass the '
                     'recorded roots shown in this message')
        raise error
    interrupted, recovery, kind = interrupted_status(state)
    if interrupted:
        error = Conflict(('locked by a running lifecycle operation; wait for it to finish and run again: ' if kind == 'active' else
                          'interrupted transaction must be rolled back before planning: ') + str(interrupted[-1]))
        error.fix = recovery
        raise error
    defaults = [c['name'] for c in manifest['components'] if c.get('category') == 'domain' and c['selection'] == 'default']
    installations = dict((previous or {}).get('installations', {}))
    if previous and not installations:
        installations = {h: {'route': previous['route'], 'domains': previous['domains']}
                         for h in previous['harnesses']}
    routes, domains_by_harness = {}, {}
    available = {c['name'] for c in manifest['components'] if c.get('category') == 'domain'}
    unknown = sorted(set(request.get('domains') or []) - available)
    if unknown:
        raise UsageError('--domain names no domain in this source: ' + ', '.join(unknown) +
                         ' (available: ' + (', '.join(sorted(available)) or 'none') + ')',
                         'drop ' + ' '.join('--domain ' + name for name in unknown), drop=('--domain', unknown))
    for harness in request['harnesses']:
        installed = installations.get(harness, {})
        routes[harness] = request.get('route') or installed.get('route', 'direct')
        domains_by_harness[harness] = (request['domains'] if request.get('domains') is not None
                                      else installed.get('domains', defaults))
        if routes[harness] not in ('direct', 'plugin') or set(domains_by_harness[harness]) - available:
            raise ValueError('invalid persisted route or unknown selected domains for ' + harness)
    domains = sorted({name for selection in domains_by_harness.values() for name in selection})
    remaining_harnesses = sorted(set(installations) - set(request['harnesses']))
    desired = {}
    if request['action'] != 'detach':
        for harness in request['harnesses']:
            selected_request = {**request, 'harnesses': [harness], 'route': routes[harness]}
            for key, entry in desired_entries(engine, source, manifest, selected_request, domains_by_harness[harness]).items():
                if key in desired:
                    if desired[key]['data'] != entry['data']:
                        raise ValueError('conflicting harness output: ' + entry['destination'])
                    entry['consumers'] = sorted(set(desired[key]['consumers']) | set(entry['consumers']))
                desired[key] = entry
    old = {(e['root_id'], e['destination'], e.get('block')): e for e in previous['entries'] if 'config_record' not in e} if previous else {}
    # Older receipts attributed shared files to the last rendered adapter. Exact
    # remaining output keys recover those consumers without a path-prefix guess.
    legacy_remaining = {}
    if remaining_harnesses and any('consumers' not in entry for entry in old.values()):
        for harness in remaining_harnesses:
            selected = installations[harness]
            remaining_request = {**request, 'harnesses': [harness], 'route': selected['route']}
            for key in desired_entries(engine, source, manifest, remaining_request, selected['domains']):
                legacy_remaining.setdefault(key, set()).add(harness)
    authorized = set(request.get('allow_capabilities', []))
    capability_ids = {c['id'] for c in manifest['components'] if c.get('capability')}
    conflicts, retained, operations, baselines, next_entries = [], [], [], {}, []
    guard_notices = []
    if (request['action'] != 'detach' and 'claude' in request['harnesses'] and routes.get('claude') == 'direct' and
            (request['scope'] == 'project' or reads_user_skills(roots.get('claude-user-skills')))):
        # Project scope, and user scope when the root is the directory Claude reads: the plugin exports the skills to every project, so
        # ~/.claude/skills would register them twice too. A custom skill root is not read by Claude, so it cannot register anything.
        plugins = enabled_cc_rpi_plugins(roots.get('project'))
        if plugins:
            conflicts.append(duplicate_registration_conflict(plugins))
        else:
            guard_notices = unreadable_plugin_settings(roots.get('project'))
    file_changes = {}
    observations = {}
    source_provenance = source_identity(source, manifest)
    identity = dict(source_provenance)
    identity['rendered_sha256'] = digest(serialized({str(key): digest(value['data']) for key, value in sorted(desired.items(), key=lambda item: str(item[0]))}))

    def observe(root_id, destination):
        key = (root_id, destination)
        if root_id not in roots and root_id != 'state':
            raise ValueError('unbound root ID: ' + root_id)
        if key not in observations:
            observations[key] = snapshot(bound_path(state if root_id == 'state' else roots[root_id], destination))
        return observations[key]

    if request['scope'] == 'project' and request['action'] != 'detach':
        agents_node = observe('project', 'AGENTS.md')
        agents_bytes = node_bytes(agents_node)
        if agents_bytes:
            rewritten = re.sub(rb'(?m)^@(?:\./)?CLAUDE\.md[ \t]*\r?\n?', b'', agents_bytes)
            if rewritten != agents_bytes:
                # Preserve the imported knowledge for Codex after reversing the
                # import. The original Claude-specific document remains intact.
                imported = node_bytes(observe('project', 'CLAUDE.md')) or b''
                imported = re.sub(rb'(?m)^@(?:\./)?AGENTS\.md[ \t]*\r?\n?', b'', imported)
                file_changes[('project', 'AGENTS.md')] = rewritten + (b'\n' + imported if imported.strip() else b'')
                retained.append({'destination': 'AGENTS.md', 'reason': 'reversed legacy import; preserved imported project knowledge'})

    for key in sorted(set(old) | set(desired), key=lambda key: tuple(part or '' for part in key)):
        root_id, destination, block = key
        prior, proposed = old.get(key), desired.get(key)
        prior_consumers = (set(prior.get('consumers', [prior['adapter']['harness']])) |
                           legacy_remaining.get(key, set())) if prior else set()
        surviving_consumers = prior_consumers & set(remaining_harnesses)
        if prior and proposed is None and surviving_consumers:
            retained_entry = dict(prior)
            retained_entry['consumers'] = sorted(surviving_consumers)
            if retained_entry['adapter']['harness'] not in surviving_consumers:
                harness = retained_entry['consumers'][0]
                retained_entry['adapter'] = {'harness': harness, 'sha256': digest(serialized(engine.load_adapter(source, harness)))}
            next_entries.append(retained_entry)
            continue
        if prior and proposed is None and prior.get('adapter', {}).get('harness') not in request['harnesses']:
            next_entries.append(prior)
            continue
        base = local = upstream = None
        try:
            current = observe(root_id, destination)
            if current['kind'] == 'symlink':
                if prior and prior.get('node_kind') == 'symlink':
                    stored = node_bytes(observe('state', 'baselines/' + prior['base_hash']))
                    if stored is None or digest(stored) != prior['base_hash']:
                        raise Conflict('missing symlink ownership baseline')
                    if encoded(current['target'].encode()) == encoded(stored) and proposed is None:
                        file_changes[(root_id, destination)] = None
                        continue
                if request['action'] == 'detach' and prior:
                    retained.append({'destination': destination, 'reason': 'modified symlink retained; target never traversed'})
                    continue
                raise Conflict('unproven symlink destination; preserve entry and target')
            local_file = node_bytes(current)
            local = extract_block(local_file, block) if block else local_file
            upstream = proposed['data'] if proposed else None
            reconstructed = None
            if prior is None and proposed and local is not None:
                reconstructed = historical_blob(source, revision, legacy_source_path(manifest, proposed))
                if reconstructed is not None and reconstructed == local:
                    prior = {'base_hash': digest(reconstructed)}
                    baselines[digest(reconstructed)] = reconstructed
                else:
                    base = reconstructed
                    reconstructed = None
            if prior:
                baseline = observe('state', 'baselines/' + prior['base_hash']) if reconstructed is None else file_node(reconstructed)
                base = node_bytes(baseline)
                if base is None or digest(base) != prior['base_hash']:
                    raise Conflict('missing or damaged recoverable baseline')
            if not prior:
                if block == 'claude-import' and local is None and local_file and re.search(rb'^@(?:\./)?AGENTS\.md\s*$', local_file, re.M):
                    retained.append({'destination': destination, 'reason': 'existing project-owned shared import retained'})
                    continue
                if local is not None:
                    raise Conflict('destination exists without proven ownership')
                result = upstream
            elif proposed is None:
                if local is None:
                    continue  # Already gone (for example moved aside by the printed repair): only the ownership record is dropped.
                if local != base:
                    if proposed is None and prior['component_id'].startswith('skill:') and routes.get(prior['adapter']['harness']) == 'plugin' and request['action'] != 'detach':
                        raise Conflict('modified direct registration competes with requested plugin route')
                    retained.append({'destination': destination, 'reason': 'modified owned content retained on removal'})
                    continue
                if block == 'claude-import':
                    agents = node_bytes(observe(root_id, 'AGENTS.md')) or b''
                    for other in old.values():
                        if other['destination'] == 'AGENTS.md' and other.get('block'):
                            existing = extract_block(agents, other['block'])
                            if existing:
                                agents = agents.replace(existing, b'', 1)
                    if agents.strip():
                        retained.append({'destination': destination, 'reason': 'shared import retained for project knowledge'})
                        continue
                result = None
            elif local is None:
                result = upstream  # Same-version damage is repaired, never reported healthy.
            elif local == base or local == upstream:
                result = upstream
            elif upstream == base:
                result = local
                retained.append({'destination': destination, 'reason': 'local-only customization retained'})
            else:
                result = merge_bytes(local, base, upstream)
            capability = (proposed or {}).get('capability') or (prior or {}).get('capability') or (proposed or prior).get('component_id') in capability_ids
            cid = (proposed or prior).get('component_id')
            if capability and (result != local or proposed and (not prior or upstream != base)) and cid not in authorized and request['action'] != 'detach':
                raise Conflict('native capability file addition/change/removal requires --allow-capabilities ' + cid)
            if proposed:
                entry = {k: v for k, v in proposed.items() if k not in ('data', 'mode')}
                entry['consumers'] = sorted(set(entry['consumers']) | surviving_consumers)
                harness = entry['consumers'][0]
                entry['adapter'] = {'harness': harness, 'sha256': digest(serialized(engine.load_adapter(source, harness)))}
                if capability:
                    entry['capability'] = True
                byte_source = (prior['source'] if prior and prior.get('base_hash') == digest(upstream)
                               and prior.get('component_id') == entry['component_id'] and prior.get('source')
                               else {**identity, 'rendered_sha256': digest(upstream)})
                entry.update({'base_hash': digest(upstream), 'source': byte_source,
                              'status': 'clean' if result == upstream else 'local-only'})
                baselines[digest(upstream)] = upstream
                next_entries.append(entry)
            if result != local:
                physical_key = (root_id, destination)
                working = file_changes.get(physical_key, local_file)
                if block:
                    working = working or b''
                    if local is not None:
                        working = working.replace(local, result or b'', 1)
                    elif result is not None:
                        working += (b'\n' if working and not working.endswith(b'\n') else b'') + result
                    result_file = working or None
                else:
                    result_file = result
                file_changes[physical_key] = result_file
        except (Conflict, OSError) as error:
            record = reconciliation_conflict(destination, str(error), base, local, upstream)
            owner = proposed or prior or {}
            cid = owner.get('component_id')
            if cid:
                record['component_id'] = cid
            flag = cid if cid and (owner.get('capability') or cid in capability_ids) else None
            if flag and str(error).startswith('native capability file'):
                record['allow_capabilities'] = flag
            if isinstance(error, MergeConflict):
                record.update(merge_repair(state, roots, root_id, destination, block, prior, flag))
            else:
                record.update(conflict_repair(str(error), state, roots, root_id, destination, block))
            conflicts.append(record)

    # Legacy command names are only candidates. An immutable local source commit
    # plus exact historical bytes is the sole automatic retirement authority.
    if request['scope'] == 'project' and request['action'] != 'detach':
        if 'plugin' in routes.values():
            for component in engine.selected_components(manifest, domains):
                if component['kind'] != 'skill' or component['scope'] != request['scope']:
                    continue
                for harness in request['harnesses']:
                    if routes[harness] != 'plugin':
                        continue
                    destination = ('.claude/skills/' if harness == 'claude' else '.agents/skills/') + component['name']
                    direct = bound_path(roots['project'], destination)
                    if not any(e['destination'].startswith(destination + '/') for e in old.values()) and has_direct_content(direct):
                        command = move_aside_command(state, roots, 'project', destination)
                        conflicts.append({'destination': destination, 'reason': 'unknown direct registration competes with requested plugin route',
                                          'fix': 'either keep a direct installation (re-plan with --route direct), or move the unmanaged skill aside with ' + command +
                                                 ' and re-plan with the plugin route',
                                          'move_aside_command': command})
        for component in manifest['components']:
            for destination in component.get('former_paths', []):
                if any(e['destination'].startswith(destination + '/') for e in next_entries):
                    continue
                try:
                    legacy_path = bound_path(roots['project'], destination)
                    if legacy_path.is_dir() and not legacy_path.is_symlink():
                        if not any(e['destination'].startswith(destination + '/') for e in next_entries):
                            retained.append({'destination': destination, 'reason': 'unproven legacy directory retained'})
                        continue
                    node = observe('project', destination)
                    if node['kind'] == 'missing':
                        continue
                    historical = None
                    if revision and destination.startswith('.claude/commands/'):
                        path = 'templates/commands/' + Path(destination).name
                        historical = historical_blob(source, revision, path)
                    if historical is not None and node_bytes(node) == historical:
                        baselines[digest(historical)] = historical
                        file_changes[('project', destination)] = None
                    else:
                        retained.append({'destination': destination, 'reason': 'legacy alias has no exact immutable ownership baseline'})
                except Conflict as error:
                    conflicts.append({'destination': destination, 'reason': str(error)})
        for pattern in ('.Codex/commands/*.md', '.codex/skills/source-command-*/SKILL.md'):
            for candidate in Path(roots['project']).glob(pattern):
                retained.append({'destination': str(candidate.relative_to(roots['project'])), 'reason': 'unproven partial import retained'})

    configuration = engine.load_sibling('rpi-config')
    config_groups = {}
    selected_configs = [c for c in engine.selected_components(manifest, domains)
                        if c['kind'] == 'config' and not c.get('distribution_only') and c['scope'] == request['scope']]
    selected_capabilities = {c['id'] for c in engine.selected_components(manifest, domains)
                             if c.get('capability') and c['scope'] == request['scope'] and set(c['harnesses']) & set(request['harnesses'])}
    selectable = ({c['id'] for c in selected_configs if set(c['harnesses']) & set(request['harnesses'])} | selected_capabilities |
                  {e['component_id'] for e in (previous or {}).get('entries', []) if 'config_record' in e or e.get('capability')})
    if authorized - selectable:
        unselected = sorted(authorized - selectable)
        raise UsageError('--allow-capabilities names a component this request does not install: ' + ', '.join(unselected) +
                         ' (selectable for ' + '/'.join(request['harnesses']) + ': ' + (', '.join(sorted(selectable)) or 'none') + ')',
                         'drop ' + ' '.join('--allow-capabilities ' + cid for cid in unselected),
                         drop=('--allow-capabilities', unselected))
    for entry in (previous or {}).get('entries', []):
        if 'config_record' not in entry:
            continue
        if entry['adapter']['harness'] not in request['harnesses']:
            next_entries.append(entry)
            continue
        key = (entry['root_id'], entry['destination'], entry['component_id'], entry['adapter']['harness'])
        config_groups.setdefault(key, {'previous': [], 'desired': []})['previous'].append(entry)
    if request['action'] != 'detach':
        for component in selected_configs:
            declaration = json.loads(engine.safe_path(source, component['source']).read_bytes(), object_pairs_hook=configuration.unique_object, parse_constant=configuration.invalid_constant)
            if not isinstance(declaration, dict) or declaration.get('schema_version') != 1 or set(declaration) != {'schema_version', 'entries'}:
                raise ValueError('configuration source requires schema_version and exact entries')
            configuration.validate_records(declaration['entries'])
            for harness in request['harnesses']:
                if harness not in component['harnesses']:
                    continue
                if request['scope'] != 'project':
                    raise ValueError('user configuration requires a distinct explicitly bound native config root')
                destination = component['destinations'][harness]
                validate_component_destination('project', destination)
                bound_path(roots['project'], destination)
                key = ('project', destination, component['id'], harness)
                config_groups.setdefault(key, {'previous': [], 'desired': []})['desired'] = declaration['entries']
    for (root_id, destination, cid, harness), group in sorted(config_groups.items()):
        try:
            previous_records = []
            for entry in group['previous']:
                base = node_bytes(observe('state', 'baselines/' + entry['base_hash']))
                if base is None or digest(base) != entry['base_hash'] or base != serialized(entry['config_record']):
                    raise Conflict('missing or changed exact configuration baseline')
                previous_records.append(entry['config_record'])
            current = observe(root_id, destination)
            if current['kind'] not in ('file', 'missing'):
                raise Conflict('native configuration must be a regular file')
            local = file_changes.get((root_id, destination), node_bytes(current))
            # What the install itself created is recorded on its entries; only that is ever pruned or deleted again.
            made = {entry['config_record']['id']: (entry.get('created') or {}).get('containers', []) for entry in group['previous']}
            file_created = any((entry.get('created') or {}).get('file') for entry in (previous or {}).get('entries', [])
                               if 'config_record' in entry and (entry['root_id'], entry['destination']) == (root_id, destination))
            result = configuration.reconcile(local, previous_records, group['desired'], cid in authorized, allow_removal=request['action'] == 'detach',
                                             created=made, file_created=file_created)
            conflicts.extend(entry_conflict(item, destination, cid) for item in result['conflicts'])
            retained.extend({'destination': destination, 'reason': item['reason'] + ' (' + entry_label(item) + ')',
                             'component_id': cid, 'record_id': item['id'], 'value': item['value'],
                             **({'in_effect': False} if item.get('in_effect') is False else {})}
                            for item in result['retained'])
            if result['content'] != local:
                file_changes[(root_id, destination)] = result['content']
            for record in result['entries']:
                base = serialized(record)
                baselines[digest(base)] = base
                prior = next((entry for entry in group['previous'] if entry['config_record']['id'] == record['id']), None)
                kept = prior.get('created') if prior else None  # An entry already owned keeps what it recorded (nothing, for an older installation).
                if prior is None:  # Added by this plan: the containers its addition created, and whether the file was missing.
                    kept = {key: value for key, value in (('file', True if file_created or current['kind'] == 'missing' else None),
                                                          ('containers', result['created'].get(record['id']) or None)) if value}
                next_entries.append({'root_id': root_id, 'destination': destination, 'component_id': cid,
                    'ownership': 'cc-rpi', 'adapter': {'harness': harness, 'sha256': digest(serialized(engine.load_adapter(source, harness)))},
                    'config_record': record, 'base_hash': digest(base),
                    'source': {**identity, 'rendered_sha256': digest(base)}, 'status': 'entry-owned', **({'created': kept} if kept else {})})
        except Conflict as error:
            conflicts.append({'destination': destination, 'reason': str(error)})

    # An owned whole file is 0644, or 0755 when its source is executable, whatever the umask or an earlier chmod. A mode-only
    # difference (an owner chmod, or a source whose executable bit changed with the same bytes) is therefore drift too.
    owned_files = {key[:2]: (0o755 if entry.get('mode') and entry['mode'] & 0o100 else 0o644)
                   for key, entry in desired.items() if not key[2]}
    if not conflicts:
        for (root_id, destination), wanted in sorted(owned_files.items()):
            current = observations.get((root_id, destination))
            if current and current['kind'] == 'file' and (root_id, destination) not in file_changes and current['mode'] != wanted:
                file_changes[(root_id, destination)] = node_bytes(current)
    for (root_id, destination), data in sorted(file_changes.items()):
        before = observations[(root_id, destination)]
        wanted = next((entry['mode'] for key, entry in desired.items() if key[:2] == (root_id, destination) and entry.get('mode')), 0o644)
        mode = owned_files.get((root_id, destination), before.get('mode', wanted))
        after = file_node(data, mode) if data is not None else {'kind': 'missing'}
        if before != after:
            operations.append({'root_id': root_id, 'destination': destination, 'before': before, 'after': after})
    for name, data in sorted(baselines.items()):
        path = bound_path(state, 'baselines/' + name)
        before = snapshot(path)
        after = file_node(data)
        if before['kind'] != 'missing' and node_bytes(before) != data:
            conflicts.append({'destination': 'baselines/' + name, 'reason': 'baseline hash collision or damaged baseline'})
        elif before['kind'] == 'missing':
            operations.append({'root_id': 'state', 'destination': 'baselines/' + name, 'before': before, 'after': after})
    for harness in request['harnesses']:
        if request['action'] == 'detach':
            installations.pop(harness, None)
        else:
            installations[harness] = {'route': routes[harness], 'domains': sorted(domains_by_harness[harness]),
                                      'source': source_provenance}
            if routes[harness] == 'plugin':
                package = engine.render_tree(source, [harness], domains_by_harness[harness], include_runtime=False)
                package_source = {**identity, 'rendered_sha256': digest(serialized({
                    name: digest(data) for name, data in sorted(package.items())}))}
                installations[harness]['expected_package'] = {'name': 'cc-rpi', 'version': manifest['version'],
                    'source': package_source, 'adapter': digest(serialized(engine.load_adapter(source, harness)))}
                installations[harness]['native_discovery'] = 'unverified; verify through the native manager without editing its cache'
    route_summary = {selection['route'] for selection in installations.values()}
    next_manifest = {'schema_version': 1, 'scope': request['scope'], 'root_ids': sorted(roots),
                     'harnesses': sorted(installations), 'installations': installations,
                     'route': next(iter(route_summary)) if len(route_summary) == 1 else 'mixed' if route_summary else 'detached',
                     'domains': sorted({name for selection in installations.values() for name in selection['domains']}),
                     'entries': sorted(next_entries, key=lambda e: (e['root_id'], e['destination'], e.get('block', ''), e.get('config_record', {}).get('id', '')))}
    if previous is None and request['action'] == 'detach':
        next_manifest = None
    before = snapshot(bound_path(state, 'manifest.json'))
    after = file_node(serialized(next_manifest)) if next_manifest else {'kind': 'missing'}
    if node_bytes(before) != node_bytes(after):
        operations.append({'root_id': 'state', 'destination': 'manifest.json', 'before': before, 'after': after})
    conflicts.extend(unwritable_conflicts(roots, state, operations))
    notices = guard_notices + receipt_gate_notices(request, roots, operations, previous, manifest['version'])
    return {'schema_version': 1, 'request': request, 'roots': roots, 'state_root': state,
            'source': identity, 'status': 'conflict' if conflicts else 'ready' if operations else 'noop',
            'operations': operations, 'conflicts': conflicts, 'retained': retained, **({'notices': notices} if notices else {}),
            'observations': [{'root_id': root, 'destination': name, 'node': node} for (root, name), node in sorted(observations.items())]}


def unwritable_conflicts(roots, state, operations):
    """One conflict per directory the plan must write into that the current user cannot write: apply would fail halfway otherwise.

    The directory that is checked is the nearest one that exists, even above a root that does not exist yet. The installation
    state directory is checked too, since apply writes its lock, binding and journal there."""
    seen, found = set(), []
    wanted = []
    for operation in operations:
        root = Path(state if operation['root_id'] == 'state' else roots[operation['root_id']])
        try:
            wanted.append((root, bound_path(root, operation['destination']).parent))
        except Conflict:
            continue  # A link or file in the way is reported where it is found.
    if operations:
        wanted.append((Path(state), Path(state) / 'local'))
    for root, parent in wanted:
        parent = nearest_directory(parent)
        if parent in seen or not parent.is_dir() or os.access(parent, os.W_OK | os.X_OK):
            continue
        seen.add(parent)
        mode = format(stat.S_IMODE(parent.stat().st_mode), 'o')
        name = str(parent.relative_to(root)) if parent == root or root in parent.parents else str(parent)
        found.append({'destination': '.' if name == '.' else name,
                      'reason': 'not writable: ' + str(parent) + ' (mode ' + mode + ') and the plan writes into it',
                      'fix': 'make the directory writable with ' + shlex.join(['chmod', 'u+wx', str(parent)]) + ' (it is mode ' + mode + ' now; set it back after the apply if you want it read-only again)'})
    return found


GATE_DOC = 'https://github.com/juan294/cc-rpi/blob/main/docs/native-policy.md#optional-verification-receipt-gate'
# Verbatim from docs/native-policy.md (a test keeps them identical); adopters do not have that file.
PRE_PUSH_ENABLE = r'''hooks_common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
top=$(git rev-parse --show-toplevel 2>/dev/null)
if hooks=$(git config --type=path --get core.hooksPath 2>/dev/null); then hooks_set=1; else hooks="$hooks_common/hooks"; hooks_set=; fi
case $hooks in /*) ;; *) hooks="$top/$hooks" ;; esac
if [ -z "$hooks_common" ]; then
  echo "BLOCKED / WHY: the current directory is not inside a Git repository, so there is no hooks directory to write. / FIX: cd to the repository root of the integration checkout, then run this command again." >&2
  false
elif [ "$hooks_set" = 1 ] && [ -z "$(git config --type=path --get core.hooksPath)" ]; then
  echo "BLOCKED / WHY: core.hooksPath is set to an empty value, which Git reads as the working tree root: a hook written to the hooks directory would not run, and one written to the root would be an untracked file. / FIX: git config --unset core.hooksPath (to use the clone's hooks directory), or point it at a directory (git config core.hooksPath PATH), then run this command again." >&2
  false
elif [ -z "$top" ]; then
  echo "BLOCKED / WHY: this is a bare repository or the inside of a .git directory: it has no working tree, so there is no integration checkout whose receipt the gate could read, and a relative core.hooksPath has no root to resolve against. / FIX: cd to the repository root of the integration checkout, then run this command again." >&2
  false
elif [ -e "$hooks" ] && [ ! -d "$hooks" ]; then
  echo "BLOCKED / WHY: the hooks path $hooks (core.hooksPath, or the clone's hooks directory) exists and is not a directory. / FIX: point core.hooksPath at a directory (git config core.hooksPath PATH) or move that file away, then run this command again." >&2
  false
elif [ -L "$hooks/pre-push" ]; then
  if [ -f "$hooks/pre-push" ] && awk '/^[[:space:]]*#/ || /^[[:space:]]*(echo|printf|:)[[:space:]]/ { next } /^[[:space:]]*exit([[:space:]]|;|$)/ { stopped = 1 } /rpi-prepush\.py/ && stopped == 0 { found = 1 } END { exit found ? 0 : 1 }' "$hooks/pre-push"; then
    echo "$hooks/pre-push is a symbolic link to a hook that runs rpi-prepush.py; left unchanged. WARNING: if an earlier line can end the hook, or the hook drops the gate's exit status, the gate cannot refuse; check one refusal."
  else
    echo "BLOCKED / WHY: $hooks/pre-push is a symbolic link, and this command never writes through a link. / FIX: add this line to the hook the link points to, or replace the link with a regular file that contains it, before any command that reads standard input (replace python3.13 with any Python 3.11 or newer on PATH), then push again: python3.13 \"\$(git rev-parse --show-toplevel)/.rpi/scripts/rpi-prepush.py\" \"\$@\" || exit 1" >&2
    false
  fi
elif [ -e "$hooks/pre-push" ] && ! grep -q 'cc-rpi receipt gate wrapper' "$hooks/pre-push"; then
  if awk '/^[[:space:]]*#/ || /^[[:space:]]*(echo|printf|:)[[:space:]]/ { next } /^[[:space:]]*exit([[:space:]]|;|$)/ { stopped = 1 } /rpi-prepush\.py/ && stopped == 0 { found = 1 } END { exit found ? 0 : 1 }' "$hooks/pre-push"; then
    echo "$hooks/pre-push runs rpi-prepush.py; left unchanged. WARNING: if an earlier line can end the hook, or the hook drops the gate's exit status, the gate cannot refuse; check one refusal."
  else
    echo "BLOCKED / WHY: $hooks/pre-push already exists and does not run rpi-prepush.py (a comment, an echo or a line after an exit does not count), and this command never overwrites an existing hook. / FIX: add this line near the top of that hook, before any exit and before any command that reads standard input (replace python3.13 with any Python 3.11 or newer on PATH), then push again: python3.13 \"\$(git rev-parse --show-toplevel)/.rpi/scripts/rpi-prepush.py\" \"\$@\" || exit 1" >&2
    false
  fi
else
  find "$hooks" -maxdepth 1 -type f -name '.pre-push.[0-9]*' -exec sh -c 'for stale; do pid=${stale##*/.pre-push.}; case $pid in *[!0-9]*) continue ;; esac; kill -0 "$pid" 2>/dev/null && continue; command -v ps >/dev/null 2>&1 && ! ps -p "$pid" >/dev/null 2>&1 && rm -f "$stale"; done' sh {} + 2>/dev/null
  tmp="$hooks/.pre-push.$$"
  if mkdir -p "$hooks" 2>/dev/null && cat 2>/dev/null > "$tmp" <<'EOF'
#!/bin/sh
# cc-rpi receipt gate wrapper: written by the documented enable command; run it again to update.
top=$(git rev-parse --show-toplevel 2>/dev/null)
gate="$top/.rpi/scripts/rpi-prepush.py"
case $0 in /*) hook=$0 ;; *) hook=$PWD/$0 ;; esac
if [ -z "$top" ]; then
  echo "BLOCKED / WHY: this push runs in a repository without a working tree (a bare repository), so there is no .rpi/scripts/rpi-prepush.py receipt gate to run and no checkout to attest the pushed commit. / FIX: push from a working checkout of the integration branch; or, for this repository only, the owner pushes with git push --no-verify, or removes this hook: rm \"$hook\"" >&2
  exit 1
fi
if [ ! -f "$gate" ]; then
  echo "BLOCKED / WHY: this checkout has no .rpi/scripts/rpi-prepush.py receipt gate. / FIX: push from a checkout that contains it, such as the integration worktree; or restore it with a reviewed update (RPI_SOURCE is your cc-rpi checkout): bash \"\$RPI_SOURCE/scripts/install.sh\" --target \"$top\" --action update --output \"$top/.rpi/local/plans/restore.json\"; review it, then bash \"\$RPI_SOURCE/scripts/install.sh\" --apply \"$top/.rpi/local/plans/restore.json\"; or, if this project no longer opts in, remove this hook: rm \"$hook\"" >&2
  exit 1
fi
for python in python3.14 python3.13 python3.12 python3.11 python3; do
  command -v "$python" >/dev/null 2>&1 && break
  python=
done
if [ -z "$python" ] || ! "$python" -c 'import sys; sys.exit(sys.version_info < (3, 11))' 2>/dev/null; then
  echo "BLOCKED / WHY: the receipt gate needs Python 3.11 or newer; the first of python3.14, python3.13, python3.12, python3.11 and python3 on PATH is ${python:-missing}. / FIX: install Python 3.11 or newer so python3.11 (or newer) is on PATH (brew install python@3.13, or sudo apt-get install python3.11), then push again." >&2
  exit 1
fi
exec "$python" "$gate" "$@"
EOF
  then
    chmod +x "$tmp" 2>/dev/null && mv -f "$tmp" "$hooks/pre-push" 2>/dev/null || { rm -f "$tmp"; echo "BLOCKED / WHY: cannot write the receipt gate wrapper into $hooks. / FIX: make that directory writable by this user (ls -ld \"$hooks\"), then run this command again; an existing hook there was not changed." >&2; false; }
  else
    rm -f "$tmp" 2>/dev/null
    echo "BLOCKED / WHY: cannot write the receipt gate wrapper into $hooks. / FIX: make that directory writable by this user (ls -ld \"$hooks\"), then run this command again; an existing hook there was not changed." >&2
    false
  fi
fi'''
ENABLE_HINT = ('run the one-time command in enable_command from the integration checkout\'s repository root '
               '(documented at ' + GATE_DOC + ')')


def release(version):
    """(major, minor) of a recorded version; None when absent or unreadable."""
    try:
        return tuple(int(part) for part in str(version).split('.')[:2])
    except ValueError:
        return None


def pre_push_hook(root):
    """(path, state) of the pre-push hook Git would run for root; None without Git. Never writes .git."""
    try:
        process = subprocess.run(['git', '-C', str(root), 'rev-parse', '--git-path', 'hooks'],
                                 capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if process.returncode or not process.stdout.strip():
        return None
    path = (Path(root) / process.stdout.strip() / 'pre-push').resolve()
    try:
        invokes = path.is_file() and b'rpi-prepush.py' in path.read_bytes()
    except OSError:
        invokes = False
    if invokes and not os.access(path, os.X_OK):
        return str(path), 'not executable'  # Git skips it without running the gate.
    return str(path), 'present' if invokes else 'does not invoke rpi-prepush.py' if path.exists() else 'missing'


def receipt_gate_notices(request, roots, operations, previous=None, version=None):
    """Informational receipt-gate notices; they never change a plan's status."""
    if request['scope'] != 'project':
        return []
    root = roots['project']
    if request['action'] == 'detach':
        removes = any(op['root_id'] == 'project' and op['destination'] == '.rpi/scripts/rpi-prepush.py'
                      and op['after']['kind'] == 'missing' for op in operations)
        hook = pre_push_hook(root) if removes else None
        if not hook or hook[1] not in ('present', 'not executable'):
            return []
        return [{'pre_push_hook': hook[1], 'hook_path': hook[0],
                 'reason': 'this detach removes .rpi/scripts/rpi-prepush.py, which the pre-push hook invokes; later pushes would fail' +
                           (' once the hook is made executable' if hook[1] == 'not executable' else ''),
                 'fix': 'after applying, remove ' + hook[0] + ' (or its rpi-prepush.py line); the engine never modifies .git'}]
    if request['action'] != 'update':
        return []
    try:
        node = snapshot(bound_path(root, '.rpi/policy.json'))
        policy = json.loads(node_bytes(node)) if node['kind'] == 'file' else None
    except (Conflict, OSError, ValueError):
        policy = None
    if isinstance(policy, dict) and policy.get('require_verification_receipt') is True:
        hook = pre_push_hook(root)
        notice = {'receipt_gate': 'on', 'pre_push_hook': hook[1] if hook else 'unavailable; not a Git work tree'}
        if hook:
            notice['hook_path'] = hook[0]
        if notice['pre_push_hook'] == 'not executable':
            notice['fix'] = ('Git ignores a pre-push hook without the execute bit, so pushes are not gated; run ' +
                             shlex.join(['chmod', '+x', hook[0]]))
        elif notice['pre_push_hook'] != 'present':
            notice.update(fix='.rpi/policy.json requires a verification receipt, but no pre-push hook runs '
                              '.rpi/scripts/rpi-prepush.py; ' + ENABLE_HINT, enable_command=PRE_PUSH_ENABLE)
        return [notice]
    opt_in = ('add "require_verification_receipt": true to .rpi/policy.json and enable the Git pre-push hook that runs '
              '.rpi/scripts/rpi-prepush.py: ' + ENABLE_HINT)
    if isinstance(policy, dict) and ('verification_checks' in policy or 'verification_command' in policy):
        return [{'receipt_gate': 'off', 'enable_command': PRE_PUSH_ENABLE,
                 'reason': '.rpi/policy.json declares verification evidence but not require_verification_receipt; '
                           'the v2.0 pre-action hook blocked integration pushes without a passing receipt, and '
                           'from v2.1 that push gate is opt-in, so pushes are no longer gated',
                 'fix': 'to keep the push gate, ' + opt_in + '; to accept an ungated push, no action is needed'}]
    recorded = sorted({str(selection.get('source', {}).get('version') or 'unrecorded') for selection in
                       (previous or {}).get('installations', {}).values() if isinstance(selection, dict)}) or ['unrecorded']
    older = [value for value in recorded if (release(value) or (0, 0)) < (2, 1)]
    if previous and older and (release(version) or (0, 0)) >= (2, 1):
        return [{'receipt_gate': 'off', 'recorded_version': ', '.join(older), 'enable_command': PRE_PUSH_ENABLE,
                 'reason': 'this installation was recorded at cc-rpi ' + ', '.join(older) + '; from v2.1 the pre-action '
                           'hook no longer asks for or blocks ordinary git push, gh pr or gh workflow run commands, '
                           'so after this update pushes are not gated unless the project opts in',
                 'fix': 'no action is needed to accept ungated pushes; to require a passing verification receipt before '
                        'integration-branch and version-tag pushes, declare verification_checks and verification_command, ' +
                        opt_in}]
    return []


def status_bookkeeping_only(plan):
    """True when the only pending write relabels owned entries clean/local-only.

    A deliberate owner customization is retained and reported, not action-needed;
    the next real update records the label with its other changes."""
    operations = plan.get('operations') or []
    if plan.get('conflicts') or [(op['root_id'], op['destination']) for op in operations] != [('state', 'manifest.json')]:
        return False
    def unlabeled(node):
        value = json.loads(node_bytes(node) or b'null')
        for entry in (value or {}).get('entries', []):
            entry.pop('status', None)
        return value
    before, after = unlabeled(operations[0]['before']), unlabeled(operations[0]['after'])
    return before is not None and before == after


def atomic_node(path, node):
    if node['kind'] == 'missing':
        if path.exists() or path.is_symlink():
            path.unlink()
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix='.rpi-write-', dir=path.parent)
    try:
        if node['kind'] == 'file':
            data = decoded(node['data'])
            if digest(data) != node['sha256']:
                raise ValueError('node payload hash mismatch')
            with os.fdopen(descriptor, 'wb') as stream:
                descriptor = None
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            os.chmod(temporary, node['mode'])
        elif node['kind'] == 'symlink':
            os.close(descriptor)
            descriptor = None
            os.unlink(temporary)
            os.symlink(node['target'], temporary)
        else:
            raise ValueError('unsupported transaction node kind')
        os.replace(temporary, path)
    finally:
        if descriptor is not None:
            os.close(descriptor)
        if os.path.lexists(temporary):
            os.unlink(temporary)


def operation_path(plan, operation):
    root_id = operation['root_id']
    if root_id == 'state':
        destination = operation['destination']
        if destination != 'manifest.json' and not re.fullmatch(r'baselines/[0-9a-f]{64}', destination):
            raise ValueError('unrecognized portable state destination')
        root = plan['state_root']
    else:
        root = plan['roots'][root_id]
    return bound_path(root, operation['destination'])


# Plan fields that never invalidate a saved plan: a hook edit after planning, and the identifier a plan file gets when saved.
INFORMATIONAL_KEYS = ("notices", "plan_id")


def plan_identity(value):
    """The plan_id field, present only when the plan carries one (journal, receipt and plan share this shape)."""
    return {'plan_id': value['plan_id']} if value.get('plan_id') else {}


def validate_plan(engine, plan):
    if plan.get('schema_version') != 1 or not isinstance(plan.get('request'), dict):
        raise ValueError('invalid plan schema')
    # Reconstruct all authority from the explicitly bound request. Untrusted plan
    # operations cannot introduce ownership, permissions or arbitrary destinations.
    fresh = make_plan(engine, plan['request'])
    plan_id = plan.get('plan_id')
    if plan_id is not None and not (isinstance(plan_id, str) and re.fullmatch('[0-9a-f]{32}', plan_id)):
        raise ValueError('invalid plan identifier')
    informational = lambda value: {key: item for key, item in value.items() if key not in INFORMATIONAL_KEYS}
    if informational(fresh) != informational(plan):  # A hook edit after planning never invalidates it.
        raise Conflict('plan changed or source/installation preimages changed; create a new plan')
    if plan.get('status') == 'conflict':
        raise Conflict('unresolved plan conflicts')
    for operation in plan['operations']:
        operation_path(plan, operation)


LOCK_BUSY = ('installation actively locked; wait for the other lifecycle operation to finish, then run check and '
             'create a new plan if one is still needed')


def unsafe_lock(path, what):
    """The lock file cannot be used as one; the repair is to set it aside once no operation holds it."""
    error = Conflict(what)
    error.fix = ('first make sure no lifecycle operation is running on this installation (' + shlex.join(['ps', '-axo', 'pid,command']) +
                 ' lists rpi-distribution.py processes), then set the lock file aside with ' +
                 'mv -- ' + shlex.quote(str(path)) + ' ' + shlex.quote(str(path) + '.saved.') + UNIQUE_STAMP +
                 ' (its content is kept), and run the same command again: the engine creates a new empty lock')
    return error


def nearest_directory(path):
    """The closest existing directory at or above `path`."""
    path = Path(path)
    while not path.exists() and path != path.parent:
        path = path.parent
    return path


def lock_open_conflict(path, error):
    """The lock could not be opened: repair what actually stands in the way (the lock path itself, or a directory that is not writable)."""
    why = error.strerror or str(error)
    if path.is_symlink() or path.is_dir():
        return unsafe_lock(path, 'the installation lock ' + str(path) + ' is ' + ('a symbolic link' if path.is_symlink() else 'a directory') +
                           ' and cannot be opened as a lock file (' + why + ')')
    directory = nearest_directory(path.parent)
    conflict = Conflict('the installation lock ' + str(path) + ' cannot be created (' + why + ')')
    if directory.is_dir() and not os.access(directory, os.W_OK | os.X_OK):
        mode = format(stat.S_IMODE(directory.stat().st_mode), 'o')
        conflict.fix = ('the directory ' + str(directory) + ' (mode ' + mode + ') is not writable by this user; make it writable with ' +
                        shlex.join(['chmod', 'u+wx', str(directory)]) + ' (set it back after the apply if you want it read-only), then run the same command again; ' +
                        'no lock file exists, so there is nothing to move aside')
    else:
        conflict.fix = ('clear the condition named above on ' + str(directory) + ' (a full disk, a read-only file system or a file in the way), '
                        'then run the same command again; no lock file exists, so there is nothing to move aside')
    return conflict


def acquire_lock(state):
    try:
        import fcntl
    except ImportError as error:
        raise ValueError('lifecycle mutation requires POSIX advisory locks; use the tested macOS or Linux runtime') from error
    if not hasattr(os, 'O_NOFOLLOW'):
        raise ValueError('lifecycle mutation requires safe no-follow file opens; use the tested macOS or Linux runtime')
    try:
        path = bound_path(state, 'local/lock')
    except Conflict as error:
        if error.fix is None and str(error).startswith(('symlink parent: ', 'non-directory parent: ')):
            error.fix = conflict_repair(str(error), None, {}, None, '', None)['fix'] + '; then run the same command again'
        raise
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        descriptor = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    except OSError as error:
        raise lock_open_conflict(path, error) from error
    try:
        node = os.fstat(descriptor)
        if not stat.S_ISREG(node.st_mode) or node.st_nlink != 1 or node.st_size:
            raise unsafe_lock(path, 'legacy or unsafe installation lock: ' + str(path) + ' is not an empty regular file with a single link; it is '
                                    'preserved, and a lock left by an older version holds that version\'s process ID')
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise Conflict(LOCK_BUSY) from error
        current = os.stat(path, follow_symlinks=False)
        if (current.st_dev, current.st_ino) != (node.st_dev, node.st_ino) or current.st_nlink != 1 or current.st_size:
            raise Conflict('installation lock changed during acquisition; preserve state and inspect concurrent writers')
        # Keep this inode: unlinking it would let a new opener bypass a waiter.
        # The kernel releases the held descriptor even after SIGKILL.
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def already_applied(plan):
    """(journal path, newer work followed) when a completed journal recorded this very plan.

    The match is the plan's own identifier, written into the journal at apply time, together with
    the operations the receipt recorded. Plans and journals without an identifier never claim it:
    identical operations do not make a plan the same plan."""
    try:
        plan_id = plan.get('plan_id')
        if not plan_id or not plan.get('operations'):
            return None
        wanted = digest(serialized(plan['operations']))
        ordered = journals(plan['state_root'], bound=True)
        for index in range(len(ordered) - 1, -1, -1):
            _, status, path = ordered[index]
            receipt = json.loads(path.with_name('receipt.json').read_bytes()) if status == 'complete' else {}
            if receipt.get('plan_id') == plan_id and receipt.get('operations_sha256') == wanted:
                return path, any(later in ('applying', 'complete') for _, later, _ in ordered[index + 1:])
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        pass
    return None


def healthy_now(engine, request):
    """True when check would report this installation healthy (a detach: nothing left to remove)."""
    try:
        current = make_plan(engine, {**request, 'action': request['action'] if request['action'] == 'detach' else 'update'})
    except (Conflict, OSError, ValueError):
        return False
    return current['status'] == 'noop' or (current['status'] == 'ready' and status_bookkeeping_only(current))


def validate_unapplied_plan(engine, plan):
    """validate_plan, but a plan the installation already recorded says so instead of 'create a new plan'.

    Returns {'status': 'already-applied', ...} when the plan was applied and the installation is healthy now (a no-op,
    exit 0, like a repeated detach); drift after the apply keeps the conflict."""
    try:
        validate_plan(engine, plan)
    except Conflict as error:
        applied = already_applied(plan) if str(error).startswith('plan changed') else None
        if applied is None:
            if str(error).startswith('plan changed') and plan.get('operations') and healthy_now(engine, plan['request']):
                # A sibling plan made from the same state (or another transaction) already brought the installation to what this request
                # asks for. The plan stays refused (it may also have been edited), but 'create a new plan' would be wrong advice.
                stale = Conflict('plan changed or source/installation preimages changed since it was made; the installation is healthy now (check finds nothing '
                                 'to do), so this plan is stale and needs no replacement')
                stale.fix = ('nothing needs applying: confirm with ' + replan_command(plan['request'], [], None, 'check') +
                             ', and create a new plan only for a different change')
                raise stale from error
            raise
        journal, followed = applied
        if healthy_now(engine, plan['request']):
            return {'status': 'already-applied', 'journal': str(journal), 'transaction': journal.parent.name}
        reason = ('this plan was already applied by transaction journal ' + str(journal) + ' (status complete)' +
                  ('; later transactions have since changed the installation' if followed else '') +
                  '; run check to see the current state of the installation')
        conflict = Conflict(reason)
        conflict.fix = ('this plan needs no further apply; to see whether the installation has drifted since, run ' +
                        replan_command(plan['request'], [], None, 'check') +
                        ', and create a new plan only if it reports action-needed')
        raise conflict from error


def planned_directories(plan):
    """Directories this plan's writes will create (they do not exist yet), deepest first."""
    found = set()
    for operation in plan['operations']:
        if operation['after']['kind'] == 'missing':
            continue
        root = Path(plan['state_root'] if operation['root_id'] == 'state' else plan['roots'][operation['root_id']])
        parent = (root / operation['destination']).parent
        while parent != root and root in parent.parents and not parent.exists():
            found.add(str(parent))
            parent = parent.parent
    return sorted(found, key=lambda name: (-len(Path(name).parts), name))


def remove_created_directories(roots, candidates):
    """rmdir each engine-created directory that is empty now, deepest first; a directory with any content stays."""
    bases = [Path(root) for root in roots]
    for name in sorted({name for name in candidates if isinstance(name, str)}, key=lambda name: (-len(Path(name).parts), name)):
        path = Path(name)
        if path.is_symlink() or not any(base in path.parents for base in bases):
            continue
        try:
            path.rmdir()
        except OSError:
            continue


def apply_plan(engine, plan, fail_after=None, fail_after_rename=None):
    done = validate_unapplied_plan(engine, plan)
    if done:
        return done
    if plan['status'] == 'noop':
        return {'status': 'noop'}
    try:
        lock = acquire_lock(plan['state_root'])
    except Conflict as error:
        if str(error) == LOCK_BUSY:
            error.fix = ('wait for the other lifecycle operation to finish, then run ' + replan_command(plan['request'], [], None, 'check') +
                         '; create a new plan only if it reports action-needed')
        raise
    try:
        validate_plan(engine, plan)
        binding_path = bound_path(plan['state_root'], 'local/root-binding.json')
        binding = serialized(plan['roots'])
        atomic_node(binding_path, file_node(binding, 0o600))
        ignore = bound_path(plan['state_root'], 'local/.gitignore')
        if not ignore.exists():
            atomic_node(ignore, file_node(b'*\n', 0o600))
        transaction = uuid.uuid4().hex
        journal_path = bound_path(plan['state_root'], 'local/transactions/' + transaction + '/journal.json')
        # Apply order lets rollback refuse an older journal once newer work exists.
        sequence = 1 + max((item[0] for item in journals(plan['state_root'])), default=0)
        journal = {'schema_version': 1, 'transaction': transaction, 'status': 'applying',
                   'roots': plan['roots'], 'state_root': plan['state_root'],
                   'operations': plan['operations'], 'completed': 0, 'pending': None,
                   'scope': plan['request']['scope'], 'sequence': sequence, **plan_identity(plan)}
        created = planned_directories(plan)
        if created:
            journal['created_directories'] = created
        receipt = {'roots': plan['roots'], 'state_root': plan['state_root'], 'sequence': sequence,
                   'scope': plan['request']['scope'], 'operations_sha256': digest(serialized(plan['operations'])),
                   **plan_identity(plan)}
        atomic_node(journal_path.with_name('receipt.json'), file_node(serialized(receipt), 0o600))
        atomic_node(journal_path, file_node(serialized(journal), 0o600))
        try:
            apply_operations(plan, journal, journal_path, fail_after, fail_after_rename)
        except (Conflict, OSError, ValueError) as error:
            error.fix = ('the transaction stopped after ' + str(journal['completed']) + ' of ' + str(len(plan['operations'])) +
                         ' operations; undo it exactly with ' + engine_command('rollback', '--journal', journal_path) +
                         ', then create a new plan')
            raise
        journal['status'] = 'complete'
        atomic_node(journal_path, file_node(serialized(journal), 0o600))
        if plan['request']['action'] == 'detach':  # Directories an earlier install created and nothing uses now.
            earlier = [name for _, _, path in journals(plan['state_root']) if path != journal_path
                       for name in (json.loads(path.read_bytes()).get('created_directories') or [])]
            removed = [(Path(plan['state_root'] if op['root_id'] == 'state' else plan['roots'][op['root_id']]) / op['destination']).parent
                       for op in plan['operations'] if op['after']['kind'] == 'missing']
            ancestors = {str(parent) for start in removed for parent in [start, *start.parents]}
            remove_created_directories([plan['state_root'], *plan['roots'].values()], ancestors & set(earlier))
        atomic_node(bound_path(plan['state_root'], 'local/root-binding.json'), file_node(serialized(plan['roots']), 0o600))
        atomic_node(bound_path(plan['state_root'], 'local/source-receipt.json'), file_node(serialized(plan['request']), 0o600))
        return {'status': 'applied', 'journal': str(journal_path)}
    finally:
        os.close(lock)


def apply_operations(plan, journal, journal_path, fail_after, fail_after_rename):
    written = {}
    for operation in plan['operations']:
        if operation['root_id'] == 'state' and operation['destination'] == 'manifest.json':
            for observation in plan['observations']:
                key = (observation['root_id'], observation['destination'])
                expected = written.get(key, observation['node'])
                if snapshot(operation_path(plan, observation)) != expected:
                    raise Conflict('preimage changed before manifest commit: ' + observation['destination'])
        path = operation_path(plan, operation)
        if snapshot(path) != operation['before']:
            raise Conflict('preimage changed during transaction: ' + operation['destination'])
        journal['pending'] = journal['completed']
        atomic_node(journal_path, file_node(serialized(journal), 0o600))
        atomic_node(path, operation['after'])
        if fail_after_rename == journal['completed'] + 1:
            raise Conflict('simulated interruption after rename; rollback journal ' + str(journal_path))
        written[(operation['root_id'], operation['destination'])] = operation['after']
        journal['completed'] += 1
        journal['pending'] = None
        atomic_node(journal_path, file_node(serialized(journal), 0o600))
        if fail_after == journal['completed']:
            raise Conflict('simulated interruption; rollback journal ' + str(journal_path))


def rollback(journal_path):
    journal_path = Path(journal_path).absolute()
    if journal_path.is_symlink():
        raise ValueError('journal cannot be a symlink')
    journal_path = journal_path.resolve()
    if not journal_path.is_file():
        raise ValueError('journal is not an existing regular file: ' + str(journal_path))
    journal_node = snapshot(journal_path)
    journal = json.loads(node_bytes(journal_node))
    if (not isinstance(journal, dict) or journal.get('schema_version') != 1 or
            not isinstance(journal.get('transaction'), str) or
            not re.fullmatch('[0-9a-f]{32}', journal['transaction'])):
        raise ValueError('invalid transaction journal')
    sequence = journal.get('sequence', 0)  # Journals before apply ordering carry none.
    if 'sequence' in journal and (type(sequence) is not int or sequence < 1):
        raise ValueError('invalid transaction sequence')
    operations, completed, pending = journal.get('operations'), journal.get('completed'), journal.get('pending')
    if (not isinstance(operations, list) or type(completed) is not int or
            not 0 <= completed <= len(operations) or
            journal.get('status') not in ('applying', 'complete', 'rolled-back')):
        raise ValueError('invalid recovery progress')
    if pending is not None and (type(pending) is not int or pending != completed or not 0 <= pending < len(operations)):
        raise ValueError('invalid pending journal operation')
    if journal['status'] == 'complete' and (completed != len(operations) or pending is not None):
        raise ValueError('completed journal has inconsistent recovery progress')
    expected = bound_path(journal['state_root'], 'local/transactions/' + journal['transaction'] + '/journal.json')
    if expected != journal_path:
        if journal.get('scope') == 'project' and len(journal_path.parents) > 4 and journal_path.parents[3].name == '.rpi':
            error = Conflict('this journal was recorded for the project at ' + str(Path(journal['state_root']).parent) +
                             ' but it is at ' + str(journal_path.parents[4]))
            error.fix = ('move the project back to the recorded path, then undo the transaction there: ' +
                         shlex.join(['mv', '--', str(journal_path.parents[4]), str(Path(journal['state_root']).parent)]) + ' && ' +
                         engine_command('rollback', '--journal', expected) +
                         ' (if the recorded path is occupied, move that out of the way first)')
            raise error
        raise ValueError('journal does not match its bound state root')
    binding_path = bound_path(journal['state_root'], 'local/root-binding.json')
    binding_node = snapshot(binding_path)
    binding = node_bytes(binding_node)
    # A project-scope journal is also checked against its own location below, so a missing binding (removed by the old
    # rebind hint, then the project moved back) must not make the transaction impossible to undo.
    if binding != serialized(journal['roots']) and not (binding is None and journal.get('scope') == 'project'):
        raise Conflict('journal roots differ from recorded installation bindings')
    if journal.get('scope') == 'project' and journal['roots'] != {'project': str(Path(journal['state_root']).parent)}:
        raise ValueError('project journal root must be the parent of its .rpi state')
    if journal.get('scope') == 'project' and Path(journal['state_root']).name != '.rpi':
        raise ValueError('project journal state must be named .rpi')
    receipt_path = journal_path.with_name('receipt.json')
    receipt_node = snapshot(receipt_path)
    receipt = json.loads(node_bytes(receipt_node))
    expected_receipt = {'roots': journal['roots'], 'state_root': journal['state_root'],
                        'scope': journal['scope'], 'operations_sha256': digest(serialized(journal['operations'])),
                        **plan_identity(journal),
                        **({'sequence': sequence} if 'sequence' in journal else {})}
    if receipt != expected_receipt:
        raise Conflict('transaction journal changed from its recovery receipt')
    for operation in journal['operations']:
        try:
            operation_path(journal, operation)
        except Conflict as error:
            if error.fix is None and str(error).startswith(('symlink parent: ', 'non-directory parent: ')):
                error.fix = ('rollback never writes through a link or into a non-directory; make ' + str(error).split(': ', 1)[1] +
                             ' the real directory it was when the transaction ran (move whatever replaced it aside and keep your content), then run ' +
                             engine_command('rollback', '--journal', journal_path))
            raise
        for node in (operation['before'], operation['after']):
            if node['kind'] == 'file':
                if digest(decoded(node['data'])) != node['sha256'] or not 0 <= node['mode'] <= 0o777:
                    raise ValueError('invalid recovery node hash or mode')
            elif node['kind'] not in ('missing', 'symlink'):
                raise ValueError('invalid recovery node kind')
    if journal.get('status') == 'rolled-back':
        return {'status': 'noop'}
    try:
        lock = acquire_lock(journal['state_root'])
    except Conflict as error:
        if str(error) == LOCK_BUSY:
            error.fix = ('wait for the other lifecycle operation to finish (a running apply or rollback holds the installation lock), then run this '
                         'rollback again; it changes nothing when the journal is already rolled back: ' + engine_command('rollback', '--journal', journal_path))
        raise
    try:
        for path, validated in ((journal_path, journal_node), (receipt_path, receipt_node), (binding_path, binding_node)):
            if snapshot(path) != validated:
                raise Conflict('recovery inputs changed before lock acquisition; reread the journal and retry rollback')
        # A stale journal's postimages can match again (install, detach, install);
        # undoing it would silently remove newer work, so only the latest applies.
        ordered = journals(journal['state_root'])
        position = next((index for index, item in enumerate(ordered) if item[2] == journal_path), -1)
        # Journals written before sequencing (pre-2.1) carry no sequence; the file order
        # (modification time) is then the only evidence of what came later.
        newer = [path for index, (order, status, path) in enumerate(ordered)
                 if (order > sequence if 'sequence' in journal else index > position)
                 and status in ('applying', 'complete') and path != journal_path]
        if newer:
            error = Conflict('journal is not the most recent applied transaction for ' + journal['state_root'] +
                             '; newer transaction ' + str(newer[-1]))
            error.fix = ('keep this journal; undo newer transactions first, newest first, starting with ' +
                         engine_command('rollback', '--journal', newer[-1]))
            raise error
        completed = list(enumerate(journal['operations'][:journal['completed']]))
        if journal.get('pending') is not None:
            pending = journal['operations'][journal['pending']]
            actual = live_node(operation_path(journal, pending))
            if actual == pending['after']:
                completed.append((journal['pending'], pending))
            elif actual != pending['before']:
                raise newer_work_conflict(journal, journal_path, [(journal['pending'], pending)],
                                          'interrupted operation has a newer unrecognized preimage: ' + pending['destination'])
        newer_work = [(index, operation) for index, operation in completed
                      if live_node(operation_path(journal, operation)) not in (operation['before'], operation['after'])]
        if newer_work:
            raise newer_work_conflict(journal, journal_path, newer_work, 'postimage changed; rollback would overwrite newer work: ' +
                                      ', '.join(operation['destination'] for _, operation in newer_work))
        # From here the installation is changed one file at a time. The marker lets check and plan tell a rollback that was
        # cut off (finish it) from a finished apply, and tell a running rollback (wait) from both.
        journal['rollback_in_progress'] = True
        atomic_node(journal_path, file_node(serialized(journal), 0o600))
        for index, operation in reversed(completed):
            if live_node(operation_path(journal, operation)) == operation['before']:
                continue
            if live_node(operation_path(journal, operation)) != operation['after']:
                raise newer_work_conflict(journal, journal_path, [(index, operation)],
                                          'postimage changed during rollback: ' + operation['destination'])
            atomic_node(operation_path(journal, operation), operation['before'])
        created = journal.get('created_directories')
        if isinstance(created, list):  # Only directories this transaction created, and only while empty.
            remove_created_directories([journal['state_root'], *journal['roots'].values()], created)
        # The status is written last: a rollback cut off before this point still carries its marker, so check names it and a rerun
        # finishes the directory cleanup (it was written first once, and a kill between the two left the directories for good).
        journal['status'] = 'rolled-back'
        journal.pop('rollback_in_progress', None)
        atomic_node(journal_path, file_node(serialized(journal), 0o600))
        return {'status': 'rolled-back'}
    finally:
        os.close(lock)


def live_node(path):
    """snapshot(path), or an unrecognized node (never equal to a recorded one) for a directory or special file."""
    try:
        return snapshot(path)
    except Conflict:
        return {'kind': 'unrecognized'}


# Runs outside the engine, from the printed fix. When the path already holds the recorded preimage it
# does nothing. Otherwise it moves whatever is there (a file, a symlink or a directory, never following
# a link) to a fresh numbered name, then writes the recorded preimage to a uniquely named temporary entry
# in the same directory and renames it over the path; the temporary entry never survives a failure.
def path_signature(path):
    """One comparable token for what is at a path: missing, a link target, a file's hash and mode, or other."""
    path = str(path)
    if not os.path.lexists(path):
        return 'missing'
    if os.path.islink(path):
        return 'symlink:' + os.readlink(path)
    if os.path.isfile(path):
        with open(path, 'rb') as handle:
            return 'file:' + hashlib.sha256(handle.read()).hexdigest() + ':' + format(stat.S_IMODE(os.stat(path).st_mode), 'o')
    return 'other'


def node_signature(node):
    if node['kind'] == 'file':
        return 'file:' + node['sha256'] + ':' + format(node['mode'], 'o')
    return 'symlink:' + node['target'] if node['kind'] == 'symlink' else 'missing'


# Runs outside the engine, from the printed fix. It only touches a path while the path still has the state the
# conflict reported (its signature at print time); a path that already holds the recorded preimage, or has
# changed since, is left alone, and a journal that is already rolled back is refused. Otherwise it moves whatever
# is there (a file, a symlink or a directory, never following a link) to a fresh numbered name, then writes the
# recorded preimage to a uniquely named temporary entry in the same directory and renames it over the path; the
# temporary entry never survives a failure.
RESTORE_PREIMAGE = r"""
import base64, hashlib, json, os, secrets, shutil, stat, sys, tempfile
document = json.load(open(sys.argv[1]))
operations = document['operations']
if document.get('status') == 'rolled-back':
    sys.exit('this journal is already rolled back, so nothing is restored; run the rollback command again only if it reports a new conflict')

def signature(path):
    if not os.path.lexists(path):
        return 'missing'
    if os.path.islink(path):
        return 'symlink:' + os.readlink(path)
    if os.path.isfile(path):
        with open(path, 'rb') as handle:
            return 'file:' + hashlib.sha256(handle.read()).hexdigest() + ':' + format(stat.S_IMODE(os.stat(path).st_mode), 'o')
    return 'other'

def restore(index, live, saved, expected):
    node = operations[int(index)]['before']
    parent = os.path.dirname(live)
    if os.path.realpath(parent) != parent:
        sys.exit('refusing to restore through a symlinked parent directory: ' + parent)
    wanted = ('file:' + node['sha256'] + ':' + format(node['mode'], 'o') if node['kind'] == 'file'
              else 'symlink:' + node['target'] if node['kind'] == 'symlink' else 'missing')
    now = signature(live)
    if now == wanted:
        return
    if now != expected:
        print('noop: ' + live + ' changed after the conflict was reported; run the rollback command again for a fresh fix')
        return
    if os.path.lexists(live):
        target, number = saved, 0
        while os.path.lexists(target):
            number += 1
            target = saved + '.' + str(number)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        shutil.move(live, target)
        print('kept your edit of ' + live + ' as ' + target)
    temporary = None
    try:
        if node['kind'] == 'file':
            os.makedirs(parent, exist_ok=True)
            descriptor, temporary = tempfile.mkstemp(dir=parent, prefix='.rpi-restore-')
            with os.fdopen(descriptor, 'wb') as handle:
                handle.write(base64.b64decode(node['data']))
            os.chmod(temporary, node['mode'])
        elif node['kind'] == 'symlink':
            os.makedirs(parent, exist_ok=True)
            while True:
                temporary = os.path.join(parent, '.rpi-restore-' + secrets.token_hex(8))
                try:
                    os.symlink(node['target'], temporary)
                    break
                except FileExistsError:
                    continue
        if temporary:
            os.replace(temporary, live)
            temporary = None
    finally:
        if temporary and os.path.lexists(temporary):
            os.unlink(temporary)

# Arguments after the journal are (operation index, live path, saved path, signature at print time) groups;
# the first failure stops everything.
rest = sys.argv[2:]
for position in range(0, len(rest), 4):
    restore(*rest[position:position + 4])
"""


def newer_work_conflict(journal, journal_path, blocked, reason):
    """A rollback refused because an owner changed files after the transaction wrote them.

    The fix is one runnable command line. For each path it moves the owner's version (a file,
    a link or a directory, never followed) to a fresh name under the installation's ignored
    local state, puts the recorded preimage back without writing through anything, and
    re-runs the rollback. Nothing is written by the refusal itself."""
    saved = Path(journal['state_root']) / 'local/saved-edits' / journal['transaction'] / time.strftime('%Y%m%d-%H%M%S')
    arguments = [argument for index, operation in blocked
                 for argument in (str(index), str(operation_path(journal, operation)),
                                  str(saved / operation['root_id'] / operation['destination']),
                                  path_signature(operation_path(journal, operation)))]
    steps = [shlex.join([sys.executable, '-c', RESTORE_PREIMAGE, str(journal_path), *arguments])]
    names = ', '.join(operation['destination'] for _, operation in blocked)
    error = Conflict(reason)
    error.fix = ('your newer version of ' + names + ' would be overwritten and nothing was changed; the command line at the end of this message moves it to ' +
                 str(saved) + ' (a number is added when that name is taken), restores the installed content so the rollback can proceed, then re-runs it; ' +
                 'it only touches a path that is still as reported here, and it refuses once this journal is rolled back; run: ' +
                 ' && '.join(steps + [engine_command('rollback', '--journal', journal_path)]))
    return error


def compact(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def entry_label(item):
    """Record id plus its public template value(s): previous -> desired."""
    values = [compact(item[key]) for key in ('value', 'previous', 'desired') if key in item]
    return 'entry ' + item['id'] + ': ' + ' -> '.join(values) if values else 'entry ' + item['id']


def entry_conflict_reason(item, component_id):
    """Name the native entry, its value and the exact repair for a configuration conflict."""
    return entry_conflict(item, '', component_id)['reason']


def entry_conflict(item, destination, component_id):
    """A configuration conflict record; `allow_capabilities` marks a flag-only repair."""
    reason = item['reason'] + ' (' + entry_label(item) + ')'
    record = {'destination': destination, 'component_id': component_id, 'record_id': item['id'],
              **{k: item[k] for k in ('previous', 'desired', 'current') if k in item}}
    replan = 'then re-plan with --allow-capabilities ' + component_id
    if 'setup or detach scope' in item['reason'] or 'explicit setup scope' in item['reason']:
        reason += '; confirm the value shown in this message, ' + replan
        record['allow_capabilities'] = component_id
    elif 'both changed' in item['reason']:
        current = ('; your current value ' + compact(item['current'])) if 'current' in item else ''
        record['fix'] = ('replace your edited entry with the new value ' + compact(item['desired']) +
                         ' or restore the previous value ' + compact(item['previous']) + ', ' + replan)
        record['allow_capabilities'] = component_id
        reason += current + '; ' + record['fix']
    record['reason'] = reason
    return record


def merge_repair(state, roots, root_id, destination, block, prior, flag):
    """Exact repairs for overlapping owner and template edits of one owned file or block."""
    replan = 'then re-plan' + (' with --allow-capabilities ' + flag if flag else '')
    upstream = ('make ' + (('the marked ' + block + ' block in ') if block else '') + destination +
                " match the upstream version shown in this plan's diffs.base_to_upstream")
    after = ('; re-add your customization after applying and later updates keep it as a local customization'
             ' (a hand merge of both edits still overlaps)')
    baseline = bound_path(state, 'baselines/' + prior['base_hash'])
    if block:
        live = bound_path(roots[root_id], destination)
        saved = Path(state) / 'local/saved-edits/plan' / root_id / destination
        copy = ('mkdir -p -- ' + shlex.quote(str(saved.parent)) + ' && cp -p -- ' + shlex.quote(str(live)) + ' ' + shlex.quote(str(saved)) +
                '.' + UNIQUE_STAMP)
        return {'fix': 'first keep your version of ' + destination + ' with ' + copy + '; then ' + upstream + ', or replace that block with the previous bytes in ' +
                       str(baseline) + ', ' + replan + after, 'save_command': copy}
    live = bound_path(roots[root_id], destination)
    saved = Path(state) / 'local/saved-edits/plan' / root_id / destination
    command = ('mkdir -p -- ' + shlex.quote(str(saved.parent)) + ' && cp -p -- ' + shlex.quote(str(live)) + ' ' + shlex.quote(str(saved)) +
               '.' + UNIQUE_STAMP + ' && ' + shlex.join(['cp', str(baseline), str(live)]))
    return {'fix': upstream + ', or restore the previous version with ' + command + ' (your edited file is first copied under ' +
                   str(saved.parent) + ', so nothing is lost), ' + replan + after,
            'restore_command': command}


def engine_command(*parts):
    return shlex.join([sys.executable, str(Path(__file__).with_name('rpi-distribution.py')), *map(str, parts)])


def journals(state_root, bound=False):
    """(apply order, status, path) of readable journals, oldest first; never raises.

    `bound` keeps only journals recorded for this state root: a moved or copied
    installation's old journals name other roots and can never roll back here."""
    found = []
    try:
        directory = bound_path(state_root, 'local/transactions')
        paths = sorted(directory.glob('*/journal.json')) if directory.is_dir() else []
        for path in paths:
            try:
                value = json.loads(path.read_bytes()) if not path.is_symlink() else None
                order = value.get('sequence', 0) if isinstance(value, dict) else None
                if bound and type(order) is int and value.get('state_root') != str(Path(state_root).resolve()):
                    continue
                if type(order) is int:
                    found.append((order, value.get('status'), path.resolve(), path.stat().st_mtime_ns))
            except (OSError, ValueError):
                continue
    except (OSError, ValueError):
        return []
    return [item[:3] for item in sorted(found, key=lambda item: (item[0], item[3], str(item[2])))]


def lock_is_held(state_root):
    """True while a live process holds the installation lock. The lock file is only opened if it exists."""
    try:
        import fcntl
        descriptor = os.open(bound_path(state_root, 'local/lock'), os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except (ImportError, OSError, ValueError, Conflict):
        return False
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        return True
    except OSError:
        return False
    finally:
        os.close(descriptor)  # Closing releases a lock this check just took.
    return False


def moved_journals(state_root):
    """(journal, recorded state root) of unfinished journals that were written for another location of this project."""
    found = []
    try:
        here = str(Path(state_root).resolve())
        directory = bound_path(state_root, 'local/transactions')
        for path in sorted(directory.glob('*/journal.json')) if directory.is_dir() else []:
            try:
                value = json.loads(path.read_bytes()) if not path.is_symlink() else None
            except (OSError, ValueError):
                continue
            if (isinstance(value, dict) and value.get('status') == 'applying' and isinstance(value.get('state_root'), str)
                    and value['state_root'] != here):
                found.append((path.resolve(), value['state_root']))
    except (OSError, ValueError, Conflict):
        return []
    return found


def move_back_fix(state_root, moved):
    path, recorded = moved[-1]
    here = Path(state_root).resolve()
    recorded_journal = Path(recorded) / path.relative_to(here)
    return ('this project was moved while a transaction recorded at ' + str(Path(recorded).parent) + ' was unfinished; '
            'move it back to the recorded path and undo the transaction there: ' +
            shlex.join(['mv', '--', str(here.parent), str(Path(recorded).parent)]) + ' && ' +
            engine_command('rollback', '--journal', recorded_journal) +
            ' (if the recorded path is occupied, move that out of the way first; removing root-binding.json to rebind would '
            'strand the transaction, so it is not offered while one is unfinished), then create a new plan')


def rollback_marked(path):
    """True when the journal records a rollback that began and did not finish."""
    try:
        value = json.loads(Path(path).read_bytes())
        return isinstance(value, dict) and value.get('rollback_in_progress') is True and value.get('status') != 'rolled-back'
    except (OSError, ValueError):
        return False


def interrupted_status(state_root):
    """(unfinished journals, how to clear them, kind) with kind 'rollback', 'active' (a live operation holds
    the lock: wait, never roll back) or 'moved' (the project was moved: move it back first).

    A journal is unfinished while its apply stopped before completing or a rollback of it began and did not finish."""
    ordered = [(status, path) for _, status, path in journals(state_root, bound=True) if status in ('applying', 'complete')]
    cut_rollback = {path for status, path in ordered if rollback_marked(path)}
    first = next((index for index, (status, path) in enumerate(ordered) if status == 'applying' or path in cut_rollback), None)
    if first is None:
        moved = moved_journals(state_root)
        if moved:
            return [path for path, _ in moved], move_back_fix(state_root, moved), 'moved'
        return [], None, None
    paths = [path for status, path in ordered if status == 'applying' or path in cut_rollback]
    if lock_is_held(state_root):
        if cut_rollback & set(paths):
            return paths, ('a running rollback holds the lock on this installation and is undoing a transaction; wait for it to finish and run '
                           'the command again. Do not start another rollback or an apply while it runs'), 'active'
        return paths, ('a running lifecycle operation holds the lock on this installation; wait for it to finish and run '
                       'the command again. Do not roll back while it runs: a transaction that completes is healthy'), 'active'
    chain = ' && '.join(engine_command('rollback', '--journal', path) for _, path in reversed(ordered[first:]))
    cut = ordered[first][1] in cut_rollback
    lead = (('a rollback stopped before completing, so the installation is partly rolled back; finish it with ' if first == len(ordered) - 1 else
             'a rollback stopped before completing and newer transactions followed it; undo them newest first, finishing with ') if cut else
            'an apply stopped before completing; undo it exactly with ' if first == len(ordered) - 1 else
            'an apply stopped before completing and newer transactions followed it; undo them newest first with ')
    return paths, lead + chain + ', then create a new plan', 'rollback'


def replan_command(request, flags, output, command='plan'):
    """The same explicit plan request with the named capability flags and a new output.

    `command='check'` names the read-only check of that request instead (no action, no output)."""
    harnesses = request['harnesses']
    parts = [command, '--source', request['source'], '--target', request['target'],
             '--harness', harnesses[0] if len(harnesses) == 1 else 'both']
    if command == 'plan':
        parts += ['--action', request['action']]
    if request.get('route'):
        parts += ['--route', request['route']]
    for domain in request.get('domains') or []:
        parts += ['--domain', domain]
    if request['scope'] == 'user':
        parts += ['--scope', 'user']
        for option in ('state_root', 'claude_skill_root', 'codex_skill_root'):
            if request.get(option):
                parts += ['--' + option.replace('_', '-'), request[option]]
    if request.get('legacy_base'):
        parts += ['--legacy-base', request['legacy_base']]
    for flag in flags:
        parts += ['--allow-capabilities', flag]
    return engine_command(*parts, *(['--output', output] if command == 'plan' else []))


def default_conflict_fix(item):
    """The repair for a conflict whose class names none itself: what to inspect or restore, never an empty hint."""
    reason = item.get('reason', '')
    if reason.startswith(('duplicate or incomplete managed instruction markers', 'reversed managed instruction markers')):
        return ('repair the <!-- rpi:NAME:start --> and <!-- rpi:NAME:end --> comments so each block has exactly one start line followed by one end line, '
                'or delete the whole block (a new plan restores it)')
    if 'baseline' in reason:
        return ('the recorded template copy under .rpi/baselines is missing or damaged; restore .rpi/baselines from version control or a backup of '
                'this project, then re-plan')
    return 'inspect ' + (item.get('destination') or 'the installation') + ' and the diffs saved with the plan; no automatic repair is known for this conflict'


REPAIRS_SHOWN = 10


def conflict_fix(request, conflicts, saved, output):
    """A top-level repair that lists the flag or edit each conflict needs; None only without conflicts.

    Every conflict contributes its own repair, so one class without a specific command never hides the others. Beyond
    REPAIRS_SHOWN conflicts the line keeps one repair per class (the kind of conflict) and counts the rest, which have the
    same repairs in the plan file and in check."""
    if not conflicts:
        return None
    flags = sorted({item['allow_capabilities'] for item in conflicts if 'allow_capabilities' in item} |
                   set(request.get('allow_capabilities') or []))
    listed = [item for item in conflicts if 'fix' in item or 'allow_capabilities' not in item]
    shown = listed
    if len(listed) > REPAIRS_SHOWN:
        kind = lambda item: item.get('reason', '').split(':', 1)[0][:80]
        first = {}
        for item in listed:
            first.setdefault(kind(item), item)
        chosen = [id(item) for item in first.values()]
        for item in listed:
            if len(chosen) >= max(REPAIRS_SHOWN, len(first)):
                break
            if id(item) not in chosen:
                chosen.append(id(item))
        shown = [item for item in listed if id(item) in chosen]
    edits = '; '.join(item['destination'] + ' (' + item.get('component_id', 'owned content') + '): ' + (item['fix'] if 'fix' in item else default_conflict_fix(item))
                      for item in shown)
    if len(shown) < len(listed):
        edits += ('; and ' + str(len(listed) - len(shown)) + ' more conflicts of the kinds above, each with its own repair in ' +
                  (str(saved) if saved else 'the plan file a plan --output saves, and in check'))
    return (('review the conflicts and diffs saved in ' + str(saved) if saved else
             'review the conflicts listed here (a plan --output saves their diffs)') +
            ('; ' + edits if edits else '') + '; then create a new plan with ' + replan_command(request, flags, output))


def next_plan_output(state_root, action, saved):
    """A new plan path: the saved plan's name with its time stamp replaced, never stacked."""
    stamp = time.strftime('%Y%m%d-%H%M%S')
    if saved:
        stem = re.sub(r'(?:-\d{8}-\d{6}(?:-\d+)?)+$', '', saved.stem)
        candidate, number = saved.with_name(stem + '-' + stamp + saved.suffix), 1
        while candidate == saved or candidate.exists():
            number += 1
            candidate = saved.with_name(stem + '-' + stamp + '-' + str(number) + saved.suffix)
        return candidate
    return Path(state_root) / 'local/plans' / (action + '-' + stamp + '.json')


def journal_fix(args):
    """The next step after an unusable --journal argument, or a missing one.

    A command is printed only for a transaction that is unfinished (an apply or rollback that stopped) or for the journal inside a
    directory the owner named. A typo never turns into a rollback of an unrelated, completed transaction: it gets the listing and check."""
    state = None
    given = getattr(args, 'journal', None)
    if getattr(args, 'target', None):
        state = Path(args.target).absolute().resolve() / '.rpi'
    elif given:
        # <state>/local/transactions/<transaction>/journal.json, recognized by its shape (any other path says nothing about a state root)
        parts = Path(given).absolute().resolve().parts
        if len(parts) > 5 and parts[-1] == 'journal.json' and parts[-3] == 'transactions' and parts[-4] == 'local':
            state = Path(*parts[:-4])
        elif len(parts) > 4 and parts[-2] == 'transactions' and parts[-3] == 'local':
            state = Path(*parts[:-3])  # The transaction directory itself, or a path inside the folder.
        elif len(parts) > 3 and parts[-1] == 'transactions' and parts[-2] == 'local':
            state = Path(*parts[:-2])  # The transactions folder itself.
    if state is None:
        state = Path.cwd().resolve() / '.rpi'
    if given and (Path(given) / 'journal.json').is_file():
        return 'pass the journal file inside that directory: ' + engine_command('rollback', '--journal', (Path(given) / 'journal.json').absolute())
    try:
        unfinished, recovery, _ = interrupted_status(state)
    except (OSError, ValueError, Conflict):
        unfinished, recovery = [], None
    if unfinished and recovery:
        return recovery
    if (Path(state) / 'local/transactions').is_dir():
        listing = 'ls -d ' + shlex.quote(str(state) + '/local/transactions/') + '*/journal.json'
        return ('no unfinished transaction was found in ' + str(state) + ', so there is nothing to recover; pass the path of the journal.json you mean '
                '(they are recorded as ' + str(state / 'local/transactions') + '/<transaction>/journal.json; list them with ' + listing +
                '), or run check from the project root to see whether the installation needs anything')
    return ('pass the journal.json path printed by the interrupted apply, which is recorded under PROJECT/.rpi/local/transactions/<transaction>/journal.json; '
            'from the project root, list the candidates with: ls -d .rpi/local/transactions/*/journal.json')


def recorded_detached(request):
    """The installation manifest when it records a detach (route detached), else None."""
    try:
        recorded = load_state(request_roots(request)[1])
    except (Conflict, OSError, TypeError, ValueError):
        return None
    return recorded if recorded and recorded.get('route') == 'detached' else None


def detached_check(request, recorded):
    """check of a project whose manifest records a detach.

    A completed detach leaves owner files and baselines and no installed harness: that
    is the requested end state, not drift. A manifest that says detached but still lists
    owned entries or installations is a half-finished detach and stays action-needed."""
    stamp = time.strftime('%Y%m%d-%H%M%S')
    plans = Path(request_roots(request)[1]) / 'local/plans'
    result = {'schema_version': 1, 'request': request, 'operations': [], 'conflicts': [], 'retained': []}
    leftovers = len(recorded.get('entries') or []) + len(recorded.get('installations') or {})
    if leftovers:
        output = plans / ('detach-' + stamp + '.json')
        return {**result, 'status': 'action-needed',
                'conflicts': [{'destination': '', 'reason': 'the manifest records route detached but still lists ' + str(leftovers) +
                               ' owned entries or installations; a detach was left half finished'}],
                'detach_fix': ('finish the detach: create the plan with ' + replan_command({**request, 'action': 'detach'}, [], output) +
                               ', review it, then apply it with ' + engine_command('apply', '--plan', output))}
    output = plans / ('install-' + stamp + '.json')
    return {**result, 'status': 'detached',
            'note': ('this project was detached from cc-rpi: no harness is installed and nothing is owed. Owner content that detach '
                     'retained and the portable baselines under .rpi/baselines remain. To install again, create a reviewable plan with ' +
                     replan_command({**request, 'action': 'install'}, [], output) + ', review it, then apply it; retained owner files that differ from the template appear in that plan as conflicts to reconcile')}


def recorded_harness(args):
    """An update or detach keeps the installation's recorded harnesses unless one is named."""
    if args.harness is not None:
        return args.harness
    if args.command == 'check' or args.action in ('update', 'detach'):
        try:
            base = Path(args.state_root) if args.scope == 'user' and args.state_root else Path(args.target)
            state = base.absolute().resolve() / ('' if args.scope == 'user' and args.state_root else '.rpi')
            recorded = (load_state(state) or {}).get('harnesses') or []
        except (Conflict, OSError, TypeError, ValueError):
            recorded = []
        if len(recorded) == 1:
            return recorded[0]
    return 'both'


def blocked_hint(args, reason, fix=None):
    if fix is None and getattr(args, 'target', None) and Path(args.target).absolute().is_symlink():
        real = Path(args.target).absolute().resolve()
        fix = ('the target ' + str(args.target) + ' is a symbolic link to ' + str(real) + ' and the engine never writes through a link; '
               'run the same command against the real path: ' + rerun(drop=('--target', (str(args.target),)), add=('--target', real)))
    if fix is None:
        target, source, harness = getattr(args, 'target', None), getattr(args, 'source', None), getattr(args, 'harness', None) or 'both'
        if not target:
            try:  # Apply and rollback name their installation inside the plan or journal.
                if getattr(args, 'plan', None):
                    request = json.loads(Path(args.plan).read_text())['request']
                    target, source = request['target'], request['source']
                    harness = request['harnesses'][0] if len(request['harnesses']) == 1 else 'both'
                elif getattr(args, 'journal', None):
                    target = json.loads(Path(args.journal).read_text())['roots']['project']
            except (OSError, ValueError, KeyError, TypeError, IndexError):
                target = None
        if target:
            fix = ('Inspect the local plan/journal conflicts, preserve newer project work, then run ' +
                   engine_command('check', '--source', source, '--target', target, '--harness', harness))
        else:
            fix = 'Inspect the local plan/journal conflicts and preserve newer project work; ' + journal_fix(args)
    print('BLOCKED / WHY: ' + reason + ' / FIX: ' + fix, file=sys.stderr)
    return fix


def rerun(drop=(), add=()):
    """This invocation without the named (option, values) and with extra arguments."""
    option, values = drop or (None, ())
    arguments, kept = sys.argv[1:], []
    index = 0
    while index < len(arguments):
        name, _, inline = arguments[index].partition('=')
        if option and name.startswith('--') and len(name) > 2 and option.startswith(name):
            value = inline if inline else arguments[index + 1] if index + 1 < len(arguments) else None
            if value in values:
                index += 1 if inline else 2
                continue
        kept.append(arguments[index])
        index += 1
    return engine_command(*kept, *add)


def plan_first(args, reason):
    """Apply without a usable plan: the newest saved plan nearby, or how to create one."""
    target = Path(getattr(args, 'target', None) or Path.cwd()).absolute()
    saved = sorted((path for path in (target / '.rpi/local/plans').glob('*.json') if path.is_file() and path != args.plan),
                   key=lambda path: path.stat().st_mtime_ns) if (target / '.rpi/local/plans').is_dir() else []
    output = target / '.rpi/local/plans' / ('update-' + time.strftime('%Y%m%d-%H%M%S') + '.json')
    try:  # An existing installation is updated with its recorded harnesses, never widened.
        recorded = load_state(target.resolve() / '.rpi')
    except (Conflict, OSError, TypeError, ValueError):
        recorded = None
    harnesses = (recorded or {}).get('harnesses') or []
    scope = (['--action', 'update'] + (['--harness', harnesses[0]] if len(harnesses) == 1 else [])) if recorded else []
    create = ('create a new plan with ' + engine_command('plan', '--source', args.source.absolute(), '--target', target,
                                                         *scope, '--output', output) +
              ' (from the project root it installs into), review it, then run ' + engine_command('apply', '--plan', output))
    if saved:
        create = 'apply the newest saved plan with ' + engine_command('apply', '--plan', saved[-1].resolve()) + '; or ' + create
    return UsageError(reason, create)


def argparse_copy(args):
    import argparse
    return argparse.Namespace(**vars(args))


def internal_site(error):
    """file:line in function of the innermost frame of an error, or an empty string."""
    import traceback
    try:
        frame = traceback.extract_tb(error.__traceback__)[-1]
        return Path(frame.filename).name + ':' + str(frame.lineno) + ' in ' + frame.name
    except (IndexError, AttributeError):
        return ''


def operation_reason(error):
    """The WHY of an adopter-side failure that has no specific message: the operating system's own words, or for an error the
    engine did not expect (a missing key, a wrong type) its kind and where it was raised."""
    if isinstance(error, (KeyError, TypeError)):
        return ('unexpected ' + type(error).__name__ + ' ' + (repr(error.args[0]) if error.args else '') + ' at ' + (internal_site(error) or 'an unknown place') +
                ': an input did not have the expected shape')
    if isinstance(error, OSError):
        return (error.strerror or str(error)) + (': ' + str(error.filename) if getattr(error, 'filename', None) else '')
    return str(error)


def operation_fix(args, error, engine=None):
    """The repair for an adopter-side failure with no specific one: which input to replace or which condition to clear.

    A source that does not load is the validate command's business; every other failure names the plan, journal or project."""
    if getattr(error, 'fix', None):
        return error.fix
    if engine is not None and args.command in ('plan', 'check') and getattr(args, 'source', None):
        try:
            engine.load_manifest(Path(args.source).resolve())
        except (OSError, ValueError, KeyError, TypeError):
            return ('--source must be a cc-rpi checkout whose templates/distribution.json and declared sources are valid; point it at the real checkout or run ' +
                    shlex.join([sys.executable, str(Path(__file__).with_name('rpi-distribution.py')), 'validate', '--source', str(Path(args.source).resolve())]))
    if args.command == 'apply':
        named = argparse_copy(args)
        try:  # The plan's own request names the project and the source it was made for.
            request = json.loads(Path(args.plan).read_text())['request']
            named.target, named.source = Path(request['target']), Path(request['source'])
        except (OSError, ValueError, KeyError, TypeError):
            pass
        return plan_first(named, '').fix + ('; if the plan was not edited this is a defect in the engine: print the full traceback and report it with: RPI_TRACEBACK=1 ' + rerun()
                                            if isinstance(error, (KeyError, TypeError)) else '')
    if args.command == 'rollback':
        return journal_fix(args)
    again = 'then run the same command again: ' + rerun()
    if isinstance(error, (KeyError, TypeError)):
        return ('if an input file was edited by hand, replace it; otherwise this is a defect in the engine: rerun the same command with RPI_TRACEBACK=1 '
                'to print the full traceback and report it with that output: RPI_TRACEBACK=1 ' + rerun())
    if isinstance(error, OSError):
        return ('clear the condition named above (a permission, a file or directory in the way, a missing path or a full disk) on the path it names, ' + again)
    return 'correct the input named above, ' + again


def cli(engine, args):
    pending_fix = None
    if args.command == 'detach':
        args.command, args.action = 'plan', 'detach'
    if args.command == 'apply':
        if not args.plan:
            raise plan_first(args, 'apply requires --plan with the path a plan --output saved')
        try:
            plan = json.loads(args.plan.read_text())
        except OSError as error:
            raise plan_first(args, 'cannot read plan ' + str(args.plan) + ': ' + (error.strerror or str(error))) from error
        except ValueError as error:
            raise plan_first(args, 'plan ' + str(args.plan) + ' is not plan JSON: ' + str(error)) from error
        if not isinstance(plan, dict) or plan.get('schema_version') != 1 or not isinstance(plan.get('request'), dict):
            raise plan_first(args, 'plan ' + str(args.plan) + ' is not a schema_version 1 plan with a request')
        try:
            result = apply_plan(engine, plan, args.fail_after, args.fail_after_rename)
        except Conflict as error:
            if error.fix is None and str(error).startswith(('symlink parent: ', 'non-directory parent: ')):
                # Something replaced a directory of the installation after the plan was made: set it aside, then the same apply continues.
                error.fix = conflict_repair(str(error), None, {}, None, '', None)['fix'] + '; then run the same apply again: ' + rerun()
            raise
    elif args.command == 'rollback':
        if not args.journal:
            raise UsageError('rollback requires --journal', journal_fix(args))
        try:
            result = rollback(args.journal)
        except Conflict:
            raise
        except (ValueError, TypeError) as error:
            raise UsageError('unusable rollback journal ' + str(args.journal) + ': ' + str(error), journal_fix(args)) from error
    else:
        if args.scope == 'user':
            args.state_root = args.state_root or Path.home() / '.config/cc-rpi/installations/user'
            args.claude_skill_root = args.claude_skill_root or Path.home() / '.claude/skills'
            args.codex_skill_root = args.codex_skill_root or Path.home() / '.agents/skills'
        if not args.target:
            if args.scope == 'user' and args.state_root:
                args.target = args.state_root
            else:
                raise UsageError('project lifecycle operations require an explicit --target',
                                 'name the project root; to use the current directory, rerun ' +
                                 rerun(add=('--target', Path.cwd().absolute())))
        args.harness = recorded_harness(args)
        request = {'source': str(args.source.absolute()), 'target': str(args.target.absolute()),
                   'harnesses': list(engine.HARNESSES) if args.harness == 'both' else [args.harness],
                   'domains': args.domain, 'scope': args.scope, 'route': args.route,
                   'action': 'update' if args.command == 'check' else args.action,
                   'legacy_base': args.legacy_base, 'allow_capabilities': args.allow_capabilities,
                   'state_root': str(args.state_root.absolute()) if args.state_root else None,
                   'claude_skill_root': str(args.claude_skill_root.absolute()) if args.claude_skill_root else None,
                   'codex_skill_root': str(args.codex_skill_root.absolute()) if args.codex_skill_root else None}
        replan_after = False
        try:
            recorded = recorded_detached(request) if args.command == 'check' else None
            result = detached_check(request, recorded) if recorded else make_plan(engine, request)
        except UsageError as error:
            if error.drop:
                error.fix += '; rerun ' + rerun(drop=error.drop)
            raise
        except Conflict as error:
            if not error.fix and str(error).startswith(('symlink parent: ', 'non-directory parent: ')):
                repair = conflict_repair(str(error), None, {}, None, '', None)
                error.fix, error.command = repair['fix'], repair['move_aside_command']
                error.replan = True
            pending_fix = error.fix
            replan_after = getattr(error, 'replan', False)
            result = {'schema_version': 1, 'request': request, 'status': 'conflict', 'operations': [],
                      'conflicts': [{'destination': '', 'reason': str(error), **({'fix': error.fix} if error.fix else {}),
                                     **({'repair_command': error.command} if getattr(error, 'command', None) else {})}],
                      'retained': []}
        saved = None
        if args.command == 'plan':
            if not args.output:
                stamp = time.strftime('%Y%m%d-%H%M%S')
                raise UsageError('plan requires an explicit --output for the reviewable plan',
                                 'save it under the ignored local plans directory; rerun ' + rerun(add=(
                                     '--output', Path(request_roots(request)[1]) / 'local/plans' / (request['action'] + '-' + stamp + '.json'))))
            output = args.output.parent.resolve() / args.output.name
            bound_path(output.parent, output.name)
            if output.exists() or output.is_symlink():
                raise UsageError('plan output already exists: ' + str(output),
                                 'choose a new --output path; the existing review artifact is kept unchanged')
            try:
                _, state_root = request_roots(request)
            except Conflict as error:  # A link in the way of the state root: the plan is still saved, with the repair in it.
                if not str(error).startswith(('symlink parent: ', 'non-directory parent: ')):
                    raise
                state_root = None
            local = Path(state_root or output.parent) / 'local'
            if state_root and output.resolve().is_relative_to(local.resolve()):
                ignore = bound_path(state_root, 'local/.gitignore')
                original_ignore = node_bytes(snapshot(ignore)) or b''
                if b'*' not in original_ignore.splitlines():
                    atomic_node(ignore, file_node(original_ignore + (b'\n' if original_ignore else b'') + b'*\n', 0o600))
            result['plan_id'] = uuid.uuid4().hex  # Names this plan file in the journal that applies it.
            atomic_node(output, file_node(serialized(result), 0o600))
            saved = output
        else:
            if result['status'] == 'ready' and status_bookkeeping_only(result):
                result['status'], result['operations'] = 'noop', []  # Retained customization is healthy.
            if result['status'] != 'detached':
                result['status'] = 'healthy' if result['status'] == 'noop' else 'action-needed'
        try:
            state_root = request_roots(request)[1]
            interrupted, recovery, kind = interrupted_status(state_root)
        except (Conflict, OSError, ValueError):
            state_root, interrupted, recovery, kind = None, [], None, None
        if interrupted:
            result['interrupted_transactions'] = [str(path) for path in interrupted]
            if kind == 'active':
                result['active_operation'] = 'a running lifecycle operation holds the installation lock'
            if result['status'] in ('healthy', 'detached'):
                result['status'] = 'action-needed'
                result.pop('note', None)
            pending_fix = recovery
        elif result.get('detach_fix'):
            pending_fix = result.pop('detach_fix')
        if pending_fix is None and state_root:
            fix_request = request
            if args.command == 'check':  # Nothing installed (a fresh project, or an install that was rolled back) needs an install, not an update.
                try:
                    installed = load_state(state_root) is not None
                except (Conflict, OSError, ValueError):
                    installed = True
                fix_request = request if installed else {**request, 'action': 'install'}
            output = next_plan_output(state_root, fix_request['action'], saved)
            pending_fix = conflict_fix(fix_request, result.get('conflicts', []), saved, output)
            if pending_fix is None and args.command == 'check' and result['status'] == 'action-needed' and not result.get('conflicts'):
                pending_fix = ('review the pending operations listed here; create the ' + fix_request['action'] + ' plan with ' +
                               replan_command(fix_request, sorted(request.get('allow_capabilities') or []), output) +
                               ', review it, then apply it with ' + engine_command('apply', '--plan', output))
        if replan_after and pending_fix and not interrupted:
            fallback = request['state_root'] if request['scope'] == 'user' and request.get('state_root') else str(Path(request['target']) / '.rpi')
            pending_fix += '; then create a new plan with ' + replan_command(request, sorted(request.get('allow_capabilities') or []),
                                                                             next_plan_output(state_root or fallback, request['action'], saved))
    summary = {key: value for key, value in result.items() if key not in ('observations', 'operations', 'request', 'roots')}
    if 'conflicts' in summary:
        summary['conflicts'] = [{key: value for key, value in item.items() if key != 'diffs'} for item in summary['conflicts']]
    not_in_effect = [{key: item[key] for key in ('component_id', 'destination', 'record_id', 'value')}
                     for item in result.get('retained', []) if item.get('in_effect') is False]
    if not_in_effect:  # A removed owned boundary is the owner's choice, but never silent.
        summary['owned_entries_not_in_effect'] = not_in_effect
    if 'operations' in result:
        summary['operations'] = [{'root_id': op['root_id'], 'destination': op['destination']} for op in result['operations']]
    if result['status'] in ('conflict', 'action-needed'):
        summary['fix'] = blocked_hint(args, 'installation needs reconciliation; inspect the saved local plan before applying',
                                      pending_fix)
    print(json.dumps(summary, sort_keys=True))
    return 2 if result['status'] in ('conflict', 'action-needed') else 0
