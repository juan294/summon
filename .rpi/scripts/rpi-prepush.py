#!/usr/bin/env python3
"""Opt-in Git pre-push gate binding integration and release refs to local evidence.

Git runs this with the remote name and URL as arguments and one stdin line per
ref it is about to update: "<local ref> <local sha> <remote ref> <remote sha>".
Git has already expanded --all, --tags, globs, remote.<name>.push, push.default
and aliases, so the gate sees the exact refs and commits being published.

A branch update is gated when the pushing checkout's .rpi/policy.json, the one
committed in the pushed commit, or the one committed in the remote commit it
replaces (when that object is local) sets "require_verification_receipt": true;
the stricter wins, so a worktree on a pre-opt-in branch cannot publish an
opted-in integration branch and a commit cannot opt itself out unverified. A
version tag follows only the policy committed in the tagged commit and in the
tag's replaced remote target, so tags from before opt-in stay publishable.
Otherwise the hook exits 0. A gated update of
refs/heads/<integration_branch> or of a version tag requires a clean tree
(ignoring .rpi/local/) and a passing .rpi/local/verification.json for the pushed
commit; deleting the integration branch is refused. Any unexpected error in an
opted-in project fails closed. This validates local evidence, not user
authorization.
"""
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys

# Evaluation must not modify the verified candidate through sibling imports.
sys.dont_write_bytecode = True

ZERO = re.compile(r'0+')
# A version tag, as the pre-action hook (rpi-policy.py) defines it; a test keeps the two patterns identical. Three shapes: v1, v1.0,
# V3.0.0-rc.1 (a v and numbers); 2.0, 1.2.3 (numbers with at least one dot); release-v1, release-1.0.0 (a word and one of those).
# A bare number or word-number (1, issue-42, fix-123, feature-2, release-1) is a branch name, not a version. Every quantifier is
# possessive and the suffix cannot start with a digit or a dot, so matching is linear: nothing backtracks.
VERSION_TAG = re.compile(r'(?:[A-Za-z][A-Za-z0-9]*+[-_])?(?:[vV]\d++(?:\.\d++)*+|\d++(?:\.\d++)++)(?:[-+_A-Za-z][-+._0-9A-Za-z]*+)?')
PYTHON = re.compile(r'python(?:3(?:\.\d+)?)?')
POLICY_KEYS = {'schema_version', 'integration_branch', 'production_branches', 'remote',
               'require_verification_receipt', 'verification_checks', 'verification_command'}
INTERPRETER = ('python', 'implementation', 'executable', 'packages')  # Packages belong to the interpreter.
REPAIR = ('bash "$RPI_SOURCE/scripts/install.sh" --check --target "$(git rev-parse --show-toplevel)" '
          '(RPI_SOURCE is your verified cc-rpi checkout), then apply a reviewed update')


class Blocked(ValueError):
    def __init__(self, reason, fix):
        super().__init__(reason)
        self.fix = fix


def fail(reason, fix):
    raise Blocked(reason, fix)


def unique_object(pairs):
    output = {}
    for key, value in pairs:
        if key in output:
            raise ValueError('duplicate JSON field: ' + key)
        output[key] = value
    return output


def read_json(data):
    def invalid(value):
        raise ValueError('nonfinite JSON value: ' + value)
    return json.loads(data, object_pairs_hook=unique_object, parse_constant=invalid)


_GIT_CACHE = {}


def git(root, *arguments, text=True):
    """Git's stdout, or None when Git or the repository state is unavailable.

    Answers are cached for this hook run: refs that name the same commit share their lookups, so the cost
    grows with the number of distinct commits, not with the number of pushed refs."""
    key = (str(root), arguments, text)
    if key not in _GIT_CACHE:
        try:
            result = subprocess.run(['git', '-C', str(root), *arguments], capture_output=True, text=text)
            _GIT_CACHE[key] = None if result.returncode != 0 else (result.stdout.strip() if text else result.stdout)
        except OSError:
            _GIT_CACHE[key] = None
    return _GIT_CACHE[key]


def project_policy(root):
    """The checkout's validated policy, or None when it does not opt in."""
    path = root / '.rpi/policy.json'
    if path.is_symlink():
        fail('Project policy .rpi/policy.json must be a regular file.',
             'Replace the .rpi/policy.json symlink with the reviewed regular file.')
    if not path.exists():
        return None
    try:
        data = path.read_bytes()
    except OSError as error:
        fail('Project policy .rpi/policy.json cannot be read (' + type(error).__name__ + ').',
             'Make .rpi/policy.json a readable regular file, or remove it.')
    return validated_policy(data, '.rpi/policy.json')


def committed_policy(root, commit):
    """The validated policy committed in a pushed commit, or None when that commit does not opt in."""
    where = 'the .rpi/policy.json committed in ' + commit[:12]
    entry = git(root, 'ls-tree', commit, '--', '.rpi/policy.json')
    if not entry:
        return None
    if not entry.startswith('100'):
        fail('Project policy ' + where + ' must be a regular file.',
             'Commit .rpi/policy.json as the reviewed regular file, then push again.')
    data = git(root, 'cat-file', 'blob', commit + ':.rpi/policy.json', text=False)
    if data is None:
        fail('Project policy ' + where + ' cannot be read.', 'Push a commit whose objects are complete in this clone.')
    return validated_policy(data, where)


def validated_policy(data, where):
    """The opted-in policy with a bare integration branch name, or None when it does not opt in."""
    try:
        value = read_json(data.decode('utf-8'))
    except ValueError as error:
        fail('Project policy ' + where + ' is not valid JSON (' + str(error) + ').',
             'Fix the JSON syntax; save it as UTF-8 without a byte-order mark.')
    if not isinstance(value, dict) or value.get('schema_version') != 1 or set(value) - POLICY_KEYS:
        fail('Invalid project policy in ' + where + '.',
             'Use schema_version 1 and only these keys: ' + ', '.join(sorted(POLICY_KEYS)) + '.')
    if type(value.get('require_verification_receipt', False)) is not bool:
        fail('In ' + where + ', require_verification_receipt must be true or false.',
             'Set "require_verification_receipt": true to gate integration publication, or remove the key.')
    if not value.get('require_verification_receipt'):
        return None
    branch = value.get('integration_branch')
    branch = branch.removeprefix('refs/heads/') if isinstance(branch, str) else None  # As rpi-policy.py resolves it.
    if not branch:
        fail('The receipt gate needs one declared integration_branch in ' + where + '.',
             'Declare "integration_branch": "main" (or the actual branch).')
    if 'remote' in value and (not isinstance(value['remote'], str) or not value['remote']):
        fail('In ' + where + ', remote must be one remote name.', 'Declare "remote": "origin" (or the actual remote), or remove the key.')
    verification_contract(value)
    return dict(value, integration_branch=branch)


def verification_contract(policy):
    checks, command = policy.get('verification_checks'), policy.get('verification_command')
    if not isinstance(command, list) or not command or any(not isinstance(arg, str) or not arg for arg in command):
        fail('The project verification command is missing or malformed.',
             'Declare verification_command as the local runner argv in .rpi/policy.json.')
    if not isinstance(checks, list) or not checks:
        fail('The project verification inventory is missing.',
             'Declare every required local gate in .rpi/policy.json verification_checks.')
    names = set()
    for check in checks:
        if (not isinstance(check, dict) or set(check) != {'name', 'argv'} or not isinstance(check['name'], str) or
                not check['name'] or check['name'] in names or not isinstance(check['argv'], list) or not check['argv'] or
                any(not isinstance(arg, str) or not arg for arg in check['argv'])):
            fail('The project verification inventory must contain unique names and literal argv arrays.',
                 'Review .rpi/policy.json verification_checks against the complete local CI selection.')
        names.add(check['name'])
    if PYTHON.fullmatch(os.path.basename(command[0])):  # The receipt binds the verifying interpreter: print this hook's.
        command = [sys.executable, *command[1:]]
    return checks, shlex.join(command)


def exact_verifier():
    """The verifier run by this hook's own interpreter, the only one whose receipt this gate accepts."""
    return shlex.join([sys.executable, '.rpi/scripts/rpi-verify.py'])


def hook_environment():
    """The caller's environment without the exec-path entry Git prepends to PATH for hooks."""
    environ, prefix = dict(os.environ), os.environ.get('GIT_EXEC_PATH')
    entries = environ.get('PATH', '').split(os.pathsep)
    if prefix and entries and entries[0] and os.path.realpath(entries[0]) == os.path.realpath(prefix):
        environ['PATH'] = os.pathsep.join(entries[1:])
    return environ


def interpreter(runtime):
    return str(runtime.get('executable')) + ' (Python ' + str(runtime.get('python')) + ')'


def settings(environ):
    """The locale, timezone and Python settings whose digest the runtime identity records."""
    return ', '.join(name + '=' + environ[name] for name in sorted(environ) if name.startswith('LC_') or name in (
        'LANG', 'LANGUAGE', 'TZ', 'PYTHONUTF8', 'PYTHONIOENCODING', 'PYTHONCOERCECLOCALE', 'PYTHONHASHSEED')) or 'none set'


def changed_keys(recorded, current, prefix=''):
    keys = []
    for key in sorted(set(recorded) | set(current)):
        before, after = recorded.get(key), current.get(key)
        if before == after:
            continue
        if isinstance(before, dict) and isinstance(after, dict) and key in ('executables', 'packages'):
            keys += changed_keys(before, after, key + '.')
        else:
            keys.append(prefix + key)
    return keys


def stale(report, environment, runner):
    recorded = report.get('environment') if isinstance(report, dict) else None
    if isinstance(recorded, dict) and recorded != environment:
        changed = {key for key in set(recorded) | set(environment) if recorded.get(key) != environment.get(key)}
        if changed & {'python', 'executable'}:
            scope = 'differs only in its Python interpreter' if changed <= set(INTERPRETER) else 'differs, including its Python interpreter'
            fail('The verification receipt runtime ' + scope + ': verified with ' + interpreter(recorded) +
                 ', this gate runs ' + interpreter(environment) + '.',
                 'Run exactly ' + exact_verifier() + ' from the repository root in the shell that runs git push, then push again.')
        keys = changed_keys(recorded, environment)
        if keys == ['executables.python3']:
            def found(runtime):
                entry = (runtime.get('executables') or {}).get('python3')
                return str(entry.get('path')) if isinstance(entry, dict) else 'none'
            fail('The verification receipt runtime differs only in the python3 first on PATH: verified with ' +
                 found(recorded) + ', this gate sees ' + found(environment) + '.',
                 'Run exactly ' + exact_verifier() + ' in the shell that runs git push (the same PATH), then push again.')
        if changed == {'execution_settings_sha256'}:
            fail('The verification receipt runtime differs only in its locale, timezone or Python settings; '
                 'this gate runs with ' + settings(hook_environment()) + '.',
                 'Run ' + runner + ' with the same LANG, LC_*, TZ and PYTHON* settings as git push, or push with the settings verification used.')
        fail('The verification receipt runtime differs in: ' + ', '.join(keys) + '.',
             'Run ' + runner + ' in the environment that runs git push; changed tools, packages, platform, '
             'locale, timezone or Python settings require a fresh run.')
    fail('Local verification does not attest this exact complete candidate.',
         'Run ' + runner + '; custom, stale, partial or failed reports do not attest the candidate, and changed '
         'locale, timezone or Python settings require a fresh run.')


LIST_NAMES = 20


def printable(name):
    """A path as one unambiguous token: plain names stay as they are, names with control characters,
    commas or double quotes are shown JSON-quoted (so \n, \t and \" are visible and never raw)."""
    if any(ord(char) < 32 or char == '\x7f' for char in name) or any(char in name for char in ',"\\'):
        return json.dumps(name, ensure_ascii=False)
    return name


def hidden_changes(root):
    """Tracked paths whose file on disk differs from the index although git status cannot show it: those flagged
    skip-worktree or assume-unchanged. A flagged path that is absent (a sparse checkout) or equal to the commit is fine.

    Presence is checked before anything is asked of git, and one listing of the index answers for every present path (a
    pathspec would read a[1].txt as a glob and also match a1.txt)."""
    flagged = git(root, 'ls-files', '-v', '-z', text=False)
    if not flagged:
        return []
    names = [entry[2:] for entry in flagged.split(b'\0') if entry[:1] == b'S' or entry[:1].islower() and entry[:1].isalpha()]
    present = [name for name in names if (root / os.fsdecode(name)).is_symlink() or (root / os.fsdecode(name)).is_file()]
    if not present:
        return []
    staged = git(root, 'ls-files', '-s', '-z', text=False) or b''
    blobs = {}
    for entry in staged.split(b'\0'):
        fields, _, name = entry.partition(b'\t')
        parts = fields.split()
        if len(parts) == 3 and parts[2] == b'0':
            blobs[name] = parts[1].decode()
    hidden = []
    for name in present:
        path, blob = root / os.fsdecode(name), blobs.get(name)
        if blob is None:
            continue
        if path.is_symlink():
            matches = git(root, 'cat-file', 'blob', blob, text=False) == os.fsencode(os.readlink(path))
        else:
            matches = git(root, 'hash-object', '--', os.fsdecode(path)) == blob
        if not matches:
            hidden.append(os.fsdecode(name))
    return hidden


def verified_candidate(root, policy):
    """The commit that exact local evidence attests for this clean candidate."""
    import importlib.util
    expected, runner = verification_contract(policy)
    # NUL-separated and unstripped: the first status column is a significant space, and names stay unquoted.
    dirty = git(root, 'status', '--porcelain', '-z', '--no-renames', '--untracked-files=normal', '--', '.', ':(exclude).rpi/local', text=False)
    if dirty is None or dirty:  # Local evidence is never part of the candidate (see rpi-candidate.py).
        names = [entry[3:].decode('utf-8', 'replace') for entry in (dirty or b'').split(b'\0') if entry]
        listed = ', '.join(printable(name) for name in names[:LIST_NAMES]) or 'git status failed'
        if len(names) > LIST_NAMES:
            listed += ', and ' + str(len(names) - LIST_NAMES) + ' more'
        count = (str(len(names)) + (' changed path: ' if len(names) == 1 else ' changed paths: ')) if names else ''
        fail('Publication requires a clean completed integration candidate (' + count + listed + ').',
             'Commit or remove those changes (git status --short lists every path), then run ' + runner)
    hidden = hidden_changes(root)
    if hidden:
        listed = ', '.join(printable(name) for name in hidden[:LIST_NAMES]) + (', and ' + str(len(hidden) - LIST_NAMES) + ' more' if len(hidden) > LIST_NAMES else '')
        clear = 'git update-index --no-skip-worktree -- %s && git update-index --no-assume-unchanged -- %s'
        fix = ('Make the changes visible, then commit or revert them and run ' + runner + ': ' +
               (clear % ((' '.join(shlex.quote(name) for name in hidden),) * 2) if len(hidden) <= LIST_NAMES else
                "git ls-files -v | grep '^[a-zS]' lists the flagged paths; clear each with " + clear % ('PATH', 'PATH')) +
               '; git status --short shows them afterwards.')
        fail('The verification receipt covers the files on disk, but ' + str(len(hidden)) + (' path differs' if len(hidden) == 1 else ' paths differ') +
             ' from the pushed commit while marked skip-worktree or assume-unchanged, which hides the change from git status (' + listed + ').', fix)
    path = root / '.rpi/local/verification.json'
    if path.is_symlink() or not path.is_file():
        fail('Exact-candidate local verification evidence is missing.', 'Run ' + runner + ' in the completed integration checkout.')
    try:
        report = read_json(path.read_text())
    except ValueError:
        report = None
    helper = Path(__file__).resolve().with_name('rpi-candidate.py')
    if not helper.is_file():
        fail('The shared candidate identity helper is missing.', 'Reinstall the declared RPI policy resources (rpi-candidate.py).')
    spec = importlib.util.spec_from_file_location('rpi_prepush_candidate', helper)
    candidate = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(candidate)
    actual, environment = candidate.identity(root), candidate.environment(hook_environment())
    checks = report.get('checks') if isinstance(report, dict) else None
    if (not isinstance(report, dict) or report.get('schema_version') != 1 or report.get('suite') != 'ci-equivalent' or
            report.get('passed') is not True or report.get('identity_unchanged') is not True or
            report.get('environment_unchanged') is not True or report.get('identity') != actual or
            report.get('identity_after') != actual or not isinstance(checks, list) or len(checks) != len(expected) or
            any(not isinstance(item, dict) or type(item.get('exit_code')) is not int or item['exit_code'] != 0 for item in checks) or
            [{key: item.get(key) for key in ('name', 'argv')} for item in checks] != expected):
        stale(None, environment, runner)
    if report.get('environment') != environment or report.get('environment_after') != environment:
        stale(report, environment, runner)
    return actual['commit']


def is_integration_ref(remote_ref, policy):
    """Is `remote_ref` the integration branch? Compared without case: on a case-insensitive remote refs/heads/Main is main."""
    return remote_ref.casefold() == ('refs/heads/' + policy['integration_branch']).casefold()


def gated_updates(root, checkout, lines):
    """(remote ref, pushed commit, policy) triples that need the receipt; deleting an integration branch is refused.

    A branch update is gated by the checkout's policy or the policy committed in
    the pushed or the replaced remote commit, whichever opts in; a version tag
    only by the policies committed in its tagged and replaced commits.
    """
    updates = []
    for line in lines:
        if not line.strip():
            continue
        fields = line.split()
        if len(fields) != 4:
            fail('Unexpected pre-push input line: ' + line.strip()[:120], 'Run the hook only as Git\'s pre-push hook.')
        _, local_sha, remote_ref, remote_sha = fields
        deleted = ZERO.fullmatch(local_sha) is not None
        tag = remote_ref.startswith('refs/tags/') and VERSION_TAG.fullmatch(remote_ref[len('refs/tags/'):])
        if not (remote_ref.startswith('refs/heads/') or tag) or (deleted and tag):
            continue
        commit = None if deleted else git(root, 'rev-parse', '--verify', '--quiet', local_sha + '^{commit}')
        # The replaced remote commit counts only when its objects are local (fetched).
        replaced = None if ZERO.fullmatch(remote_sha) else git(root, 'rev-parse', '--verify', '--quiet', remote_sha + '^{commit}')
        policies = [policy for policy in ([] if tag else [checkout]) +
                    [committed_policy(root, sha) for sha in (commit, replaced) if sha] if policy]
        for policy in policies:
            if is_integration_ref(remote_ref, policy) and deleted:
                fail('Deleting the integration branch (' + policy['integration_branch'] + ') removes the published history.',
                     'Delete only working branches; if it is truly intended, the owner runs the exact command without this hook.')
        gate = next((policy for policy in policies if tag or is_integration_ref(remote_ref, policy)), None)
        if deleted or gate is None:
            continue
        if commit is None:
            fail('The pushed object for ' + remote_ref + ' is not a local commit.', 'Push a ref that names a local commit.')
        opting_out = not tag and committed_policy(root, commit) is None  # The pushed commit turns the gate off.
        updates.append((remote_ref, commit, gate, opting_out))
    return updates


def bare_repository(lines, cwd):
    """A bare repository has no checkout, so no receipt can attest a push from it: a gated update is refused, the rest passes."""
    git_dir = git(cwd, 'rev-parse', '--absolute-git-dir')
    if git_dir is None:
        return  # Not a repository: nothing to gate.
    updates = gated_updates(Path(git_dir), None, lines)
    if updates:
        refs = ', '.join(update[0] for update in updates[:LIST_NAMES])
        fail('The receipt gate cannot attest a push from a bare repository (' + refs + '): there is no checkout whose verification '
             'receipt could cover the pushed commit.',
             'Push from a working checkout of the integration branch after running its verifier there; or, when this bare '
             'repository must publish without the gate, the owner pushes with git push --no-verify.')


def evaluate(argv, lines, cwd):
    top = git(cwd, 'rev-parse', '--show-toplevel')
    if top is None:
        return bare_repository(lines, cwd)
    root = Path(top).resolve()
    checkout = project_policy(root)
    if checkout is not None and len(argv) != 2:
        fail('The pre-push gate expects the remote name and URL as its two arguments.', 'Install it as the repository pre-push hook.')
    updates = gated_updates(root, checkout, lines)
    if not updates:
        return
    if len(argv) != 2:
        fail('The pre-push gate expects the remote name and URL as its two arguments.', 'Install it as the repository pre-push hook.')
    try:
        check_updates(root, checkout, updates, argv)
    except Blocked as error:
        if any(update[3] for update in updates):  # Without this exit the verifier's own refusal would loop.
            error.fix += (' This push turns the receipt gate off (the pushed commit no longer sets '
                          '"require_verification_receipt": true). To turn it off, keep .rpi/policy.json with '
                          '"require_verification_receipt": false, commit, run the verifier and push that verified commit; '
                          'or the owner pushes once with git push --no-verify.')
        raise


def check_updates(root, checkout, updates, argv):
    # The receipt attests this checkout, so only an identical committed policy can pass with it.
    policy = checkout or updates[0][2]
    runner = verification_contract(policy)[1]
    try:
        verified = verified_candidate(root, policy)
    except Blocked:
        raise
    except Exception as error:  # The opted-in gate must not fail open.
        fail('Receipt verification failed (' + type(error).__name__ + ').',
             'Check the installation with ' + REPAIR + '; then run ' + runner + '.')
    for remote_ref, commit, gate, _ in updates:
        if commit == verified:
            continue
        if remote_ref.startswith('refs/tags/'):
            name = remote_ref[len('refs/tags/'):]
            fix = ('Verify the tagged commit: git switch --detach ' + name + ', run ' + runner +
                   ', then push the tag: git push ' + shlex.quote(argv[0]) + ' ' + remote_ref + '.')
        else:  # Never repeat the refused push: publish the verified HEAD, or verify the pushed commit first.
            branch, remote = gate['integration_branch'], shlex.quote(argv[0])
            if git(root, 'rev-parse', '--verify', '--quiet', 'refs/heads/' + branch + '^{commit}') == commit:
                other = 'git switch ' + branch + ', run ' + runner + ', then git push ' + remote + ' ' + branch
            else:
                other = ('git switch --detach ' + commit + ', run ' + runner + ', then git push ' + remote + ' ' +
                         commit + ':refs/heads/' + branch)
            if verified == git(root, 'rev-parse', 'HEAD'):
                fix = ('Publish the verified HEAD: git push ' + remote + ' HEAD:refs/heads/' + branch +
                       ' (if Git rejects it as non-fast-forward, integrate first: git pull --rebase ' + remote + ' ' +
                       branch + ', run ' + runner + ', then push again); or, to publish ' + commit[:12] + ': ' + other + '.')
            else:
                fix = 'To publish ' + commit[:12] + ': ' + other + '.'
        fail('The pushed ' + remote_ref + ' (' + commit[:12] + ') differs from the verified candidate commit (' + str(verified)[:12] + ').', fix)


def main(argv):
    try:
        lines = [] if sys.stdin is None else sys.stdin.read().splitlines()
        evaluate(argv, lines, Path.cwd())
        return 0
    except Blocked as error:
        print('BLOCKED / WHY: ' + str(error) + ' / FIX: ' + error.fix, file=sys.stderr)
    except Exception as error:  # Only an opted-in project installs this hook: fail closed.
        print('BLOCKED / WHY: the pre-push gate failed (' + type(error).__name__ + ': ' + str(error)[:200] + '). / FIX: '
              'check the installation with ' + REPAIR + '.', file=sys.stderr)
    return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
