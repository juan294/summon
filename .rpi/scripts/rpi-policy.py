#!/usr/bin/env python3
"""Supplemental denylist for clearly destructive remote operations.

Shell text is parsed, never executed. Exit 0 emits no native decision: the
client's permission rules, mode and user decide everything else, including
ordinary pushes, pull requests and workflow dispatch. Exit 2 blocks only a
positively identified destructive operation. Shell text the parser cannot
classify passes through; this is not a shell security boundary. The opt-in
verification receipt gate is a Git pre-push hook (rpi-prepush.py), because only
Git knows exactly which refs a push publishes.
"""
import sys

if sys.version_info < (3, 11):
    print('RPI POLICY SKIPPED: the policy adapter requires Python 3.11 or newer. FIX: uv python install 3.13; '
          'launch the client through uv run --python 3.13 so its hooks use the supported runtime.', file=sys.stderr)
    sys.exit(0)

# This runs before every shell command: modules only some paths need are
# imported where they are used.
import json  # noqa: E402
import os  # noqa: E402
from pathlib import Path  # noqa: E402
import re  # noqa: E402
import shlex  # noqa: E402
import time  # noqa: E402

POLICY_WORD = re.compile(r'\b(?:git|gh|vercel|vc)\b')
# Quote, escape and expansion characters can split a command name the shell still resolves (g\it, gi"t", g\<newline>it).
SPLITTING = re.compile(r'[\\\'"$\n]')
# Unquoted brace characters are kept apart from quoted ones until brace expansion has run.
OPEN_BRACE, COMMA, CLOSE_BRACE = '\ue000', '\ue001', '\ue002'
MAX_BRACE_WORDS = 1024
# Wall-clock bound for one hook invocation; a command that needs more is blocked, not passed.
BUDGET_SECONDS = float(os.environ.get('RPI_POLICY_BUDGET_SECONDS', '10'))
_DEADLINE = None
# git push long options (git push --git-completion-helper, git 2.56); the hook never runs git push to ask.
PUSH_LONG_OPTIONS = {'--verbose', '--quiet', '--repo', '--all', '--branches', '--mirror', '--delete', '--tags', '--dry-run',
                     '--porcelain', '--force', '--force-with-lease', '--force-if-includes', '--recurse-submodules',
                     '--receive-pack', '--exec', '--set-upstream', '--progress', '--prune', '--no-verify', '--follow-tags',
                     '--signed', '--atomic', '--push-option', '--ipv4', '--ipv6', '--verify'}
PUSH_LONG_OPTIONS |= {'--no-' + name[2:] for name in set(PUSH_LONG_OPTIONS) if not name.startswith('--no-')}
CODE_CONSUMERS = {'bash', 'sh', 'zsh', 'dash', 'ksh', 'eval', 'source', '.', 'xargs'}
SHELL_KEYWORDS = {'{', '}', '!', 'if', 'then', 'else', 'elif', 'do', 'while', 'until'}
ASSIGNMENT = re.compile(r'[A-Za-z_][A-Za-z0-9_]*=.*')
REDIRECTION = re.compile(r'(?:\d*|&)(?:>>?|<)&?(.*)')
# Wrapper -> its options that take a separate value.
WRAPPERS = {'env': {'-u', '--unset', '-C', '--chdir'}, 'command': set(), 'builtin': set(), 'exec': {'-a'},
            'doas': {'-u', '-C'},
            'sudo': {'-u', '-g', '-C', '-h', '-p', '-U', '-r', '-t'}, 'time': set(), 'nohup': set(),
            'nice': {'-n'}, 'timeout': {'-k', '--kill-after', '-s', '--signal'},
            'stdbuf': {'-i', '-o', '-e'}, 'caffeinate': {'-t', '-w'},
            'xargs': {'-n', '-I', '-L', '-P', '-d', '-E', '-s', '-a', '--max-args', '--max-procs', '--delimiter'}}
SHELLS = ('bash', 'sh', 'zsh', 'dash', 'ksh')
NPX_VALUE_OPTIONS = {'-p', '--package', '-c', '--call', '--filter', '-C', '--dir'}
# Vercel CLI subcommands; any other first word is a path to deploy.
VERCEL_SUBCOMMANDS = {'alias', 'aliases', 'api', 'bisect', 'blob', 'build', 'buy', 'cache', 'certs', 'cert', 'deploy',
                      'dev', 'dns', 'domains', 'domain', 'env', 'flags', 'git', 'guidance', 'help', 'httpstat', 'init',
                      'inspect', 'install', 'i', 'integration', 'integration-resource', 'link', 'list', 'ls', 'login',
                      'logout', 'logs', 'mcp', 'microfrontends', 'open', 'project', 'projects', 'promote', 'pull',
                      'redeploy', 'remove', 'rm', 'rollback', 'rolling-release', 'switch', 'target', 'targets',
                      'teams', 'team', 'telemetry', 'upgrade', 'whoami'}
VERCEL_VALUE_OPTIONS = {'--token', '-t', '--scope', '-S', '--team', '-T', '--cwd', '-A', '--local-config',
                        '-Q', '--global-config', '--target', '-e', '--env', '-b', '--build-env', '-m', '--meta',
                        '--regions', '--archive'}
LITERAL_TEXT = {'echo', 'printf', 'cat', 'rg', 'grep'}
PROTECTED = ('main', 'master', 'develop')
DYNAMIC = '__RPI_DYNAMIC__'
POLICY_KEYS = {'schema_version', 'integration_branch', 'production_branches', 'remote',
               'require_verification_receipt', 'verification_checks', 'verification_command'}
PUSH_VALUE_OPTIONS = {'-o', '--push-option', '--repo', '--receive-pack', '--exec'}
# Shell options whose next word is a value. Every other long option (--norc, --posix, --login ...) is a flag.
SHELL_VALUE_OPTIONS = {'-o', '+o', '-O', '+O', '--rcfile', '--init-file'}
# Git ignores an alias that has the name of a builtin; these are the builtins when `git --list-cmds=builtins` is unavailable.
GIT_BUILTINS = {'add', 'am', 'apply', 'archive', 'bisect', 'blame', 'branch', 'bundle', 'checkout', 'cherry', 'cherry-pick',
                'clean', 'clone', 'commit', 'config', 'describe', 'diff', 'fetch', 'format-patch', 'gc', 'grep', 'init', 'log',
                'ls-files', 'ls-remote', 'ls-tree', 'merge', 'mv', 'notes', 'pull', 'push', 'range-diff', 'rebase', 'reflog',
                'remote', 'reset', 'restore', 'revert', 'rm', 'shortlog', 'show', 'stash', 'status', 'submodule', 'switch',
                'tag', 'worktree'}
GIT_VALUE_OPTIONS = {'-c', '--git-dir', '--work-tree', '--namespace', '--config-env'}


class Blocked(ValueError):
    def __init__(self, reason, fix, rule):
        super().__init__(reason)
        self.fix, self.rule = fix, rule


class Unclassifiable(Exception):
    """Shell text the parser cannot read; it passes to native permissions."""


def fail(reason, fix, rule):
    raise Blocked(reason, fix, rule)


def fail_broad_push():
    fail('This push rewrites or deletes remote refs beyond the named branch.',
         'Push explicit refs instead: git push REMOTE BRANCH.', 'destructive-push')


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


def git(cwd, *arguments):
    """Return Git's stdout, or None when Git or the repository state is unavailable.

    Answers are cached for this hook invocation: nothing is executed while the command is judged, so the
    repository cannot change between two lookups, and a long command pays for each distinct lookup once."""
    key = (str(cwd), arguments)
    if key not in _GIT_CACHE:
        import subprocess
        try:
            result = subprocess.run(['git', '-C', str(cwd), *arguments], capture_output=True, text=True)
            _GIT_CACHE[key] = result.stdout.strip() if result.returncode == 0 else None
        except OSError:
            _GIT_CACHE[key] = None
    return _GIT_CACHE[key]


def check_budget():
    if _DEADLINE is not None and time.monotonic() > _DEADLINE:
        fail('This command is too large to inspect within the hook time budget of ' + str(BUDGET_SECONDS).rstrip('0').rstrip('.') +
             ' seconds, so it cannot be shown to avoid a protected-branch rewrite.',
             'Split it into smaller commands.', 'policy-budget')


def repository(cwd):
    if cwd is None:
        return None
    top = git(cwd, 'rev-parse', '--show-toplevel')
    return Path(top).resolve() if top else None


def skip_options(args, takes_value):
    """Index of the first positional; an option for which takes_value holds consumes the next word."""
    index = 0
    while index < len(args) and args[index].startswith('-'):
        option = args[index]
        index += 1 + ('=' not in option and takes_value(option))
    return index


def project_policy(root):
    """Return the optional project policy; a present but invalid file is reported."""
    path = root / '.rpi/policy.json'
    if path.is_symlink():
        fail('Project policy .rpi/policy.json must be a regular file.',
             'Replace the .rpi/policy.json symlink with the reviewed regular file.', 'policy-file')
    if not path.exists():
        return {}
    try:
        value = read_json(path.read_text(encoding='utf-8'))
    except OSError as error:
        fail('Project policy .rpi/policy.json cannot be read (' + type(error).__name__ + ').',
             'Make .rpi/policy.json a readable regular file, or remove it.', 'policy-file')
    except ValueError as error:
        fail('Project policy .rpi/policy.json is not valid JSON (' + str(error) + ').',
             'Fix the JSON syntax; save it as UTF-8 without a byte-order mark.', 'policy-file')
    if not isinstance(value, dict) or value.get('schema_version') != 1 or set(value) - POLICY_KEYS:
        fail('Invalid project policy in .rpi/policy.json.',
             'Use schema_version 1 and only these keys: ' + ', '.join(sorted(POLICY_KEYS)) + '.', 'policy-file')
    if 'integration_branch' in value and (not isinstance(value['integration_branch'], str) or not value['integration_branch']):
        fail('In .rpi/policy.json, integration_branch must be one branch name.',
             'Declare "integration_branch": "main" (or the actual branch), or remove the key.', 'policy-file')
    branches = value.get('production_branches', [])
    if not isinstance(branches, list) or any(not isinstance(item, str) or not item for item in branches):
        fail('In .rpi/policy.json, production_branches must be a list of branch names.',
             'Declare production_branches as ["name", ...] or remove the key.', 'policy-file')
    return value


def branch_name(name):
    """A declared branch as a bare name: refs/heads/NAME and NAME are the same branch."""
    name = name.removeprefix('refs/')  # refs/heads/NAME, heads/NAME and NAME all name the branch (git's short-ref rules).
    return name.removeprefix('heads/')


def production_branches(policy):
    return {branch_name(name) for name in policy.get('production_branches', [])}


def integration_branch(root, policy):
    declared = policy.get('integration_branch')
    if isinstance(declared, str) and declared:
        return branch_name(declared)
    return next((name for name in PROTECTED if git(root, 'rev-parse', '--verify', '--quiet', 'refs/heads/' + name)), None)


def resolved_branch(ref, current):
    """Branch a push destination names, or None when it cannot be resolved."""
    if not ref or DYNAMIC in ref or '*' in ref:
        return None  # Unresolved or a glob that can match any branch.
    if ref in ('HEAD', '@'):
        return current
    return branch_name(ref)


def protected_branches(root, policy):
    return set(PROTECTED) | production_branches(policy) | {integration_branch(root, policy) if root else None}


def parse_refspec(spec, force, delete):
    """(source, destination, forced, removed) for one push refspec."""
    forced = force or spec.startswith('+')
    spec = spec.lstrip('+')
    if spec == ':':
        return None, '*', forced, False  # The matching push: every branch present on both sides.
    source, destination = spec.split(':', 1) if ':' in spec else (spec, spec)
    return source or None, destination, forced, delete or not source


def config_key(key):
    """Git config key with a case-insensitive section and variable and a case-sensitive subsection."""
    parts = key.split('.')
    return '.'.join([parts[0].lower(), *parts[1:-1], parts[-1].lower()]) if len(parts) > 1 else key


def configured_targets(root, remote, current, force, delete, overrides=None):
    """Destinations Git derives from configuration when a push names no refspec.

    `overrides` are the git -c settings of this command line: they append to a multi-valued
    remote.<name>.push and replace a single-valued setting."""
    overrides = overrides or {}

    def setting(key, default=None):
        return overrides[key][-1] if key in overrides else git(root, 'config', '--get', key) or default

    if root is None or current is None:
        return [(current, current, force, delete)]
    remote = remote or setting('branch.' + current + '.remote') or 'origin'
    key = config_key('remote.' + remote + '.push')
    specs = (git(root, 'config', '--get-all', key) or '').splitlines() + overrides.get(key, [])
    if specs:
        return [parse_refspec(spec, force, delete) for spec in specs]
    mode = setting('push.default', 'simple')
    if mode in ('upstream', 'tracking'):
        merge = setting('branch.' + current + '.merge')
        if merge:
            return [(current, merge, force, delete)]
    if mode == 'matching':
        return [(None, '*', force, False)]
    return [(current, current, force, delete)]


def push_option_names(name):
    """The long options a (possibly abbreviated) --name can mean. git accepts any unambiguous prefix; an
    ambiguous one is rejected by git, and every reading is applied here so none of them can hide a rewrite."""
    if name in PUSH_LONG_OPTIONS or not name.startswith('--') or len(name) < 3:
        return {name}
    return {option for option in PUSH_LONG_OPTIONS if option.startswith(name)} or {name}


def push(args, cwd, overrides=None):
    force = delete = everything = broad = dry_run = False
    remote, values, index = None, [], 0
    while index < len(args):
        arg = args[index]
        index += 1
        names = push_option_names(arg.split('=', 1)[0])
        if arg == '--':
            values.extend(args[index:])
            break
        if names & {'--mirror', '--prune'}:
            broad = True
        if names & {'--force', '--force-with-lease'}:
            force = True
        if names & {'--delete'}:
            delete = True
        if names & {'--all', '--branches'}:
            everything = True
        if names & {'--dry-run'}:
            dry_run = True
        if names & PUSH_VALUE_OPTIONS:
            value = arg.split('=', 1)[1] if '=' in arg else (args[index] if index < len(args) else None)
            remote = value if names & {'--repo'} else remote
            index += '=' not in arg
        elif names & {'--mirror', '--prune', '--force', '--force-with-lease', '--delete', '--all', '--branches', '--dry-run'}:
            pass
        elif re.fullmatch(r'-[A-Za-z]+', arg):
            flags = arg[1:].split('o', 1)  # -o takes the rest, or the next word, as its value.
            force, delete = force or 'f' in flags[0], delete or 'd' in flags[0]
            dry_run = dry_run or 'n' in flags[0]
            index += len(flags) == 2 and not flags[1]
        elif not arg.startswith('-'):
            values.append(arg)
    if dry_run:
        return  # A dry run changes nothing remotely.
    if remote is None and values:
        remote, values = values[0], values[1:]  # The first positional names the remote.
    if broad or everything and (force or delete):
        fail_broad_push()
    root = repository(cwd)
    current = git(root, 'symbolic-ref', '--quiet', '--short', 'HEAD') if root else None
    targets = ([parse_refspec(spec, force, delete) for spec in values] if values
               else configured_targets(root, remote, current, force, delete, overrides))
    rewritten = [resolved_branch(destination, current) for _, destination, forced, removed in targets if forced or removed]
    if not rewritten:
        return
    policy = project_policy(root) if root else {}
    protected = protected_branches(root, policy)
    for branch in rewritten:
        if branch is None or branch in protected:
            fail('Force-pushing or deleting a protected branch (' + (branch or 'unresolved target') + ') rewrites shared history.',
                 'Push without force (git pull --rebase first) or use a working branch; if it is truly intended, the owner runs the exact command.',
                 'protected-branch')


def environment_config(assigned):
    """(key, value) pairs Git reads from inline GIT_CONFIG_COUNT/KEY_n/VALUE_n and GIT_CONFIG_PARAMETERS."""
    pairs = []
    for item in shlex.split(assigned.get('GIT_CONFIG_PARAMETERS', '')):
        name, _, value = item.partition('=')
        pairs.append((name, value))
    count = assigned.get('GIT_CONFIG_COUNT', '')
    for number in range(int(count) if count.isdigit() and int(count) <= 100 else 0):
        key = assigned.get('GIT_CONFIG_KEY_%d' % number)
        if key is not None and ('GIT_CONFIG_VALUE_%d' % number) in assigned:
            pairs.append((key, assigned['GIT_CONFIG_VALUE_%d' % number]))
    return pairs


# Alias expansions and nested shells followed before the command is left to native permissions.
MAX_NESTING = 100
_BUILTINS = None


def git_builtins(cwd):
    """The builtin command names, listed by git once per process (a static list is the fallback)."""
    global _BUILTINS
    if _BUILTINS is None:
        listed = git(cwd or '.', '--list-cmds=builtins')
        _BUILTINS = set(listed.split()) if listed else set()
    return _BUILTINS


def git_command(args, cwd, depth=0, assigned=None, inherited=None):
    """A git invocation: -C, -c, --config-env and inline GIT_CONFIG_* are applied, a command-line alias is
    expanded, and push is evaluated. Variables exported by an earlier command are not known."""
    args, assigned = list(args), assigned or {}
    # A shell alias runs a child git that inherits this command line's -c settings, as git passes them on.
    overrides = {key: list(values) for key, values in inherited[0].items()} if inherited else {}
    seen = set(inherited[1]) if inherited else set()
    try:
        for name, value in environment_config(assigned):
            overrides.setdefault(config_key(name), []).append(value)
    except ValueError:
        pass  # Unreadable GIT_CONFIG_PARAMETERS pass to native permissions.
    def global_options(args, cwd):
        """Consume leading global options (-C, -c, --config-env, -p, --no-pager ...) of `args` in place."""
        while args and args[0].startswith('-'):
            option = args.pop(0)
            if option == '-C' and args or option.startswith('-C') and len(option) > 2:
                cwd = directory(cwd, args.pop(0) if option == '-C' else option[2:])
            elif option == '-c' and args:
                name, _, value = args.pop(0).partition('=')
                overrides.setdefault(config_key(name), []).append(value)
            elif (option == '--config-env' and args) or option.startswith('--config-env='):
                name, _, variable = (args.pop(0) if option == '--config-env' else option.split('=', 1)[1]).partition('=')
                if variable in assigned:  # Only a variable assigned in this very command is known.
                    overrides.setdefault(config_key(name), []).append(assigned[variable])
            elif option in GIT_VALUE_OPTIONS and args:
                args.pop(0)
        return cwd

    cwd = global_options(args, cwd)
    for _ in range(MAX_NESTING + 1):  # MAX_NESTING expansions are followed; the next lookup finds the command itself.
        name = args[0] if args else None
        alias = overrides.get(config_key('alias.' + name), [None])[-1] if name else None
        if alias is None or name in GIT_BUILTINS or name in git_builtins(cwd):
            break  # No alias, or one named like a builtin, which Git ignores.
        if name in seen:
            return  # An alias loop: Git rejects it, and it is not a push.
        seen.add(name)
        if alias.startswith('!'):
            inspect_command(alias[1:] + ' ' + ' '.join(shlex.quote(arg) for arg in args[1:]), cwd, depth + 1,
                            (overrides, frozenset(seen)))
            return
        try:
            args = shlex.split(alias) + args[1:]
        except ValueError:
            return
        cwd = global_options(args, cwd)  # An alias may begin with global options such as -c or -p.
    else:
        return  # More than MAX_NESTING expansions: unclassifiable, so it passes to native permissions.
    if args[:1] == ['push']:
        push(args[1:], cwd, overrides)


def directory(cwd, target):
    """The literal directory a cd or git -C names, or None when it cannot be known."""
    if DYNAMIC in target:
        return None
    path = Path(target).expanduser()
    if not path.is_absolute():
        if cwd is None:
            return None
        path = Path(cwd) / path
    path = path.resolve()
    return path if path.is_dir() else cwd


def deployment(args):
    if any(arg in ('--help', '-h', '--version', '-v') for arg in args):
        return
    index = skip_options(args, VERCEL_VALUE_OPTIONS.__contains__)
    command = args[index] if index < len(args) else None
    if command is not None and command != 'deploy' and command in VERCEL_SUBCOMMANDS:
        return  # Other subcommands belong to native permissions.
    targets = [arg.split('=', 1)[1] if arg.startswith('--target=') else (args[position + 1] if position + 1 < len(args) else None)
               for position, arg in enumerate(args) if arg == '--target' or arg.startswith('--target=')]
    if not ('--prod' in args or targets) or any(target != 'production' for target in targets):
        fail('Vercel Preview deployments (including the bare default deploy) are disabled for this project.',
             'Build locally with vercel build, or deploy production explicitly with vercel deploy --prod.', 'preview')


def github(args, cwd):
    if args[:2] == ['repo', 'delete']:
        fail('Deleting a repository is irreversible.',
             'The owner runs the exact gh repo delete command after confirming the target.', 'destructive-remote')
    if args[:1] == ['api']:
        api_delete(args[1:], cwd)


def shell_script(args):
    """The -c script of a shell invocation such as bash -ec 'CMD', sh -e -c 'CMD' or bash -c -e 'CMD'.

    A shell takes options (before and after -c) until its first non-option word, and with -c
    that word is the script. -o and -O take an option name."""
    index, command = 0, False
    while index < len(args):
        word = args[index]
        if word == '--':
            index += 1
            break
        if word[:1] not in ('-', '+') or word in ('-', '+'):
            break
        command = command or bool(re.fullmatch(r'-[A-Za-z]*c[A-Za-z]*', word))
        index += 2 if word in SHELL_VALUE_OPTIONS else 1  # -o and -O take an option name, --rcfile and --init-file a file.
    return args[index] if command and index < len(args) else None


def api_methods(args):
    """HTTP methods gh api is given: -X VALUE, -XVALUE, -iX VALUE (X inside a flag cluster), -X=VALUE, --method[=]VALUE."""
    methods = []
    for index, arg in enumerate(args):
        cluster = re.fullmatch(r'-i*X=?(.*)', arg)  # -i is gh api's only boolean short flag.
        if cluster:
            methods.append(cluster[1] or (args[index + 1] if index + 1 < len(args) else ''))
        elif arg == '--method':
            methods.append(args[index + 1] if index + 1 < len(args) else '')
        elif arg.startswith('--method='):
            methods.append(arg.split('=', 1)[1])
    return methods


def api_path(arg):
    """The endpoint path of a gh api operand, normalised: query and fragment removed, percent-decoded,
    repeated slashes collapsed and . and .. segments resolved. A host prefix is peeled off first."""
    import posixpath
    from urllib.parse import unquote
    path = unquote(re.split(r'[?#]', arg, maxsplit=1)[0])
    host = re.match(r'https?://[^/]+', path)
    path = path[host.end():] if host else path
    return posixpath.normpath(re.sub(r'/+', '/', path)) if path else path


def api_path_raw(arg):
    """The decoded operand before normalisation, for recognising a ref path that normalisation resolved away."""
    from urllib.parse import unquote
    return unquote(re.split(r'[?#]', arg, maxsplit=1)[0])


def api_delete(args, cwd):
    """Block API deletion of a repository or a protected branch ref."""
    if not any(method.upper() == 'DELETE' for method in api_methods(args)):
        return
    prefix = r'/?(?:api/v3/)?repos/[^/]+/[^/]+'
    for arg in args:
        path = api_path(arg)
        if '..' in path.split('/') and 'refs/heads' in api_path_raw(arg):
            fail('This API path climbs out of its endpoint, so a protected branch deletion cannot be ruled out.',
                 'Use the plain endpoint, for example repos/OWNER/REPO/git/refs/heads/BRANCH, and delete only working branches.',
                 'protected-branch')
        if re.fullmatch(prefix + r'/?', path):
            fail('Deleting a repository is irreversible.',
                 'The owner runs the exact deletion after confirming the target.', 'destructive-remote')
        match = re.fullmatch(prefix + r'/git/refs/heads/(.+?)/*', path)
        if match:
            root = repository(cwd)
            policy = project_policy(root) if root else {}
            if match[1] in protected_branches(root, policy):
                fail('Deleting a protected branch (' + match[1] + ') through the API rewrites shared history.',
                     'Delete only working branches; if it is truly intended, the owner runs the exact command.', 'protected-branch')


ANSI_ESCAPES = {'a': '\a', 'b': '\b', 'e': '\x1b', 'E': '\x1b', 'f': '\f', 'n': '\n', 'r': '\r', 't': '\t', 'v': '\v',
                '\\': '\\', "'": "'", '"': '"', '?': '?'}


def ansi_c_quoted(command, start):
    """Decode the $'...' word starting at command[start]; returns (text, index after the closing quote)."""
    index, output = start + 2, []
    while index < len(command):
        char = command[index]
        if char == "'":
            return ''.join(output), index + 1
        if char == '\\' and index + 1 < len(command):
            following = command[index + 1]
            digits = re.match(r'[0-7]{1,3}', command[index + 1:]) if following in '01234567' else None
            hexadecimal = re.match(r'x[0-9A-Fa-f]{1,2}|u[0-9A-Fa-f]{1,4}|U[0-9A-Fa-f]{1,8}', command[index + 1:])
            if following in ANSI_ESCAPES:
                output.append(ANSI_ESCAPES[following])
                index += 2
            elif digits:
                output.append(chr(int(digits[0], 8) & 0xFF))
                index += 1 + len(digits[0])
            elif hexadecimal:
                try:
                    output.append(chr(int(hexadecimal[0][1:], 16)))
                except (ValueError, OverflowError):
                    output.append('?')
                index += 1 + len(hexadecimal[0])
            elif following == 'c' and index + 2 < len(command):
                output.append(chr(ord(command[index + 2]) & 0x1f))
                index += 3
            else:
                output.append(char + following)
                index += 2
            continue
        output.append(char)
        index += 1
    raise Unclassifiable('unterminated ANSI-C quote')


def brace_expand(text):
    """Expand unquoted {a,b} lists (nested and repeated); more than MAX_BRACE_WORDS words fails closed."""
    start = text.find(OPEN_BRACE)
    while start != -1:
        depth, commas, close = 0, [], None
        for index in range(start, len(text)):
            if text[index] == OPEN_BRACE:
                depth += 1
            elif text[index] == CLOSE_BRACE:
                depth -= 1
                if not depth:
                    close = index
                    break
            elif text[index] == COMMA and depth == 1:
                commas.append(index)
        if close is not None and commas:
            bounds = [start] + commas + [close]
            expanded = []
            for number in range(len(bounds) - 1):
                expanded += brace_expand(text[:start] + text[bounds[number] + 1:bounds[number + 1]] + text[close + 1:])
                if len(expanded) > MAX_BRACE_WORDS:
                    fail('A brace expansion in this command produces more than ' + str(MAX_BRACE_WORDS) + ' words, which cannot be inspected.',
                         'Write the arguments out, or split the command.', 'policy-budget')
            return expanded
        start = text.find(OPEN_BRACE, start + 1)
    return [text]


def body_expansions(body):
    """Command and backtick substitutions in an unquoted here-document body; the shell runs them."""
    found, index = [], 0
    while index < len(body):
        if body[index] == '\\':
            index += 2
            continue
        try:
            if body.startswith('$(', index):
                end = substitution_end(body, index, '$(')
                found.append(body[index + 2:end])
                index = end + 1
                continue
            if body[index] == '`':
                end = backtick_end(body, index)
                found.append(body[index + 1:end])
                index = end + 1
                continue
        except Unclassifiable:
            break
        index += 1
    return found


def substitution_end(command, start, opener):
    quote, depth, index = None, 1, start + len(opener)
    while index < len(command):
        char = command[index]
        if char == '\\' and quote != "'":
            index += 2
            continue
        if char in ('"', "'"):
            if quote is None:
                quote = char
            elif quote == char:
                quote = None
            index += 1
            continue
        if quote != "'" and command.startswith('$(', index):
            index = substitution_end(command, index, '$(') + 1
            continue
        if quote is None:
            if char == '(':
                depth += 1
            elif char == ')':
                depth -= 1
                if not depth:
                    return index
        index += 1
    raise Unclassifiable('unterminated shell substitution')


def backtick_end(command, start):
    index = start + 1
    while index < len(command) and command[index] != '`':
        index += 2 if command[index] == '\\' else 1
    if index >= len(command):
        raise Unclassifiable('unterminated backtick substitution')
    return index


def tokenize(command):
    """Retain operator identity; quoted semicolons/newlines stay literal words.

    Substitutions and parameter expansions become DYNAMIC in their word, $'...' words are decoded, unquoted
    brace lists are expanded, and substitution bodies are returned separately for their own inspection.
    A real here-document operator (not one inside a comment, quote or string) becomes a ('heredoc', ref)
    token and its body is read from the following lines instead of being parsed as commands.
    """
    tokens, embedded, word, pending = [], [], [], []
    quote, started, index = None, False, 0
    def flush():
        nonlocal word, started
        if started:
            text = ''.join(word)
            for item in brace_expand(text) if OPEN_BRACE in text else [text]:
                tokens.append(('word', item.replace(OPEN_BRACE, '{').replace(COMMA, ',').replace(CLOSE_BRACE, '}')))
        word, started = [], False
    while index < len(command):
        char = command[index]
        if char == '\\' and quote != "'":
            if index + 1 == len(command):
                raise Unclassifiable('unterminated shell escape')
            if command[index + 1] != '\n':
                word.append(command[index + 1])
                started = True
            index += 2
            continue
        if char in ('"', "'"):
            if quote is None:
                quote, started = char, True
            elif quote == char:
                quote = None
            else:
                word.append(char)
            index += 1
            continue
        if quote is None and command.startswith("$'", index):
            text, index = ansi_c_quoted(command, index)
            word.append(text)
            started = True
            continue
        if quote is None and command.startswith('<<', index) and not command.startswith('<<<', index):
            cursor = index + 2
            strip_tabs = command.startswith('-', cursor)
            cursor += strip_tabs
            while cursor < len(command) and command[cursor] in ' \t':
                cursor += 1
            marker, quoted = [], False
            while cursor < len(command):
                letter = command[cursor]
                if letter in '"\'':
                    end = command.find(letter, cursor + 1)
                    if end < 0:
                        raise Unclassifiable('unterminated here-document delimiter')
                    marker.append(command[cursor + 1:end])
                    quoted, cursor = True, end + 1
                elif letter == '\\' and cursor + 1 < len(command):
                    marker.append(command[cursor + 1])
                    quoted, cursor = True, cursor + 2
                elif letter in ' \t\n;|&()<>':
                    break
                else:
                    marker.append(letter)
                    cursor += 1
            if marker:
                if word and ''.join(word).isdigit():
                    word, started = [], False  # A file descriptor number before the operator.
                flush()
                reference = {'quoted': quoted, 'marker': ''.join(marker), 'strip_tabs': strip_tabs, 'body': ''}
                tokens.append(('heredoc', reference))
                pending.append(reference)
                index = cursor
                continue
        opener = next((value for value in ('$(', '<(', '>(') if command.startswith(value, index)), None)
        body = None
        if quote != "'" and opener and (opener == '$(' or quote is None):
            end = substitution_end(command, index, opener)
            body = command[index + len(opener):end]
        elif quote != "'" and char == '`':
            end = backtick_end(command, index)
            body = command[index + 1:end]
        if body is not None:
            embedded.append(body)
            word.append(DYNAMIC)
            started, index = True, end + 1
            continue
        if quote != "'" and char == '$' and command.startswith('${', index):
            depth, cursor = 0, index + 1
            while cursor < len(command):
                depth += (command[cursor] == '{') - (command[cursor] == '}')
                if not depth:
                    break
                cursor += 1
            word.append(DYNAMIC)  # A parameter expansion, braces and all, cannot be resolved statically.
            started, index = True, (cursor + 1 if cursor < len(command) else index + 1)
            continue
        if quote != "'" and char == '$':
            word.append(DYNAMIC)  # A parameter expansion cannot be resolved statically.
            started = True
        elif quote is None and char == '#' and not started:
            end = command.find('\n', index)
            index = len(command) if end < 0 else end
            continue
        elif quote is None and char == '&' and (command.startswith('&>', index) or (word and word[-1] in '<>')):
            started = True  # Redirections such as 2>&1 and &>file stay words.
            word.append(char)
        elif quote is None and char in ' \t\r':
            flush()
        elif quote is None and char in ';|&()\n':
            flush()
            operator = char
            if char in '|&' and command[index:index + 2] == char * 2:
                operator += char
                index += 1
            tokens.append(('operator', operator))
            if char == '\n' and pending:
                position = index + 1
                for reference in pending:
                    lines = []
                    while position < len(command):
                        end = command.find('\n', position)
                        end = len(command) if end < 0 else end
                        line, position = command[position:end], min(end + 1, len(command))
                        if (line.lstrip('\t') if reference['strip_tabs'] else line).rstrip(' \t') == reference['marker']:
                            break
                        lines.append(line)
                    reference['body'] = '\n'.join(lines)
                pending = []
                index = position - 1
        elif quote is None and char in '{,}':
            started = True
            word.append({'{': OPEN_BRACE, ',': COMMA, '}': CLOSE_BRACE}[char])
        else:
            started = True
            word.append(char)
        index += 1
    if quote is not None:
        raise Unclassifiable('unterminated quote')
    flush()
    return tokens, embedded


def without_redirections(words):
    """Drop 2>&1, >file, > file, &>file and similar words; they are not arguments."""
    output, index = [], 0
    while index < len(words):
        word = words[index]
        match = REDIRECTION.fullmatch(word)
        if not match:
            glued = re.search(r'[<>]', word)  # main>/dev/null is the argument main with a redirection.
            if glued and glued.start() > 0:
                output.append(word[:glued.start()])
                match = REDIRECTION.fullmatch(word[glued.start():])
            else:
                output.append(word)
        if match and not match[1]:
            index += 1  # The target is the following word.
        index += 1
    return output


def env_split(words):
    """Expand env -S/--split-string into the words it runs."""
    for index, word in enumerate(words):
        if not word.startswith('-'):
            break
        if word in ('-S', '--split-string') and index + 1 < len(words):
            return words[:index] + words[index + 1].split() + words[index + 2:]
        if word.startswith('--split-string='):
            return words[:index] + word.split('=', 1)[1].split() + words[index + 1:]
    return words


def unwrap(words, assigned=None):
    """Strip shell keywords, assignments and common executable wrappers.

    Inline assignments (`VAR=value cmd`, `env VAR=value cmd`) are recorded in `assigned`."""
    while True:
        while words and (words[0] in SHELL_KEYWORDS or ASSIGNMENT.fullmatch(words[0]) or words[0] == 'function'):
            if assigned is not None and ASSIGNMENT.fullmatch(words[0]):
                name, _, value = words[0].partition('=')
                assigned[name] = value
            words = words[2:] if words[0] == 'function' else words[1:]  # function NAME { ... } defines, then runs its body here.
        if not words or Path(words[0]).name not in WRAPPERS:
            return words
        wrapper, words = Path(words[0]).name, words[1:]
        if wrapper == 'command' and words[:1] in (['-v'], ['-V']):
            return []  # Shell lookup describes operands without executing them.
        if wrapper == 'env':
            words = env_split(words)
        words = words[skip_options(words, WRAPPERS[wrapper].__contains__):]
        if wrapper == 'timeout' and words:
            words = words[1:]  # The duration operand.


ANSI_WORD = re.compile(r"\$'(?:[^'\\]|\\.)*'", re.S)


def policy_word_possible(command):
    """Could the shell turn this text into a command name the hook inspects? Deliberately generous: it only
    decides whether the tokenizer runs, so quote, escape and expansion characters are removed and $'...'
    words decoded before the search."""
    if POLICY_WORD.search(command):
        return True
    if "$'" in command:
        def decode(match):
            try:
                return ansi_c_quoted(match[0], 0)[0]
            except Unclassifiable:
                return match[0]
        command = ANSI_WORD.sub(decode, command)
    return bool(POLICY_WORD.search(SPLITTING.sub('', command)))


def command_name(words):
    unwrapped = unwrap(without_redirections(words))
    return os.path.basename(unwrapped[0]) if unwrapped else ''


def heredoc_is_code(segments, position):
    """A here-document body is script text when its consumer, or a later stage of its pipeline, is a shell,
    eval, source, . or xargs; for every other consumer (cat, tee, git commit -F -, gh, ruby ...) it is text."""
    segment = segments[position]
    if command_name(segment['words']) in CODE_CONSUMERS or (segment['words'] and os.path.basename(segment['words'][0]) in CODE_CONSUMERS):
        return True
    while segment['op'] == '|' and position + 1 < len(segments):
        position += 1
        segment = segments[position]
        if command_name(segment['words']) in CODE_CONSUMERS:
            return True
    return False


def inspect_command(command, cwd, depth=0, inherited=None):
    # Substitution bodies are part of the raw text, so no policy word anywhere
    # means nothing below can match. Quote, escape and expansion characters can split
    # a command name the shell still resolves, so the search runs on the text without them too.
    if depth > MAX_NESTING or not policy_word_possible(command):
        return
    check_budget()
    try:
        tokens, embedded = tokenize(command)
    except Unclassifiable:
        return
    for inner in embedded:
        inspect_command(inner, cwd, depth + 1, inherited)
    segments, current, held = [], [], []
    for kind, token in tokens:
        if kind == 'operator':
            if current or held:
                segments.append({'words': current, 'heredocs': held, 'op': token})
            current, held = [], []
        elif kind == 'heredoc':
            held.append(token)
        else:
            current.append(token)
    if current or held:
        segments.append({'words': current, 'heredocs': held, 'op': ''})
    for position, segment in enumerate(segments):
        check_budget()
        for reference in segment['heredocs']:
            if heredoc_is_code(segments, position):
                inspect_command(reference['body'], cwd, depth + 1, inherited)
            elif not reference['quoted']:
                for inner in body_expansions(reference['body']):
                    inspect_command(inner, cwd, depth + 1, inherited)
        assigned = {}
        words = unwrap(without_redirections(segment['words']), assigned)
        if not words:
            continue
        name, args = Path(words[0]).name, words[1:]
        if name in LITERAL_TEXT:
            continue
        if name in SHELLS:
            script = shell_script(args)
            if script is not None:
                inspect_command(script, cwd, depth + 1, inherited)
            continue
        if name == 'eval':
            inspect_command(' '.join(args), cwd, depth + 1, inherited)
            continue
        if name in ('npx', 'pnpm', 'npm', 'yarn', 'bunx'):
            args = args[skip_options(args, NPX_VALUE_OPTIONS.__contains__):]
            if args[:1] in (['exec'], ['dlx']):
                args = args[1:]
                args = args[skip_options(args, NPX_VALUE_OPTIONS.__contains__):]
            package = Path(args[0]).name.split('@', 1)[0] if args else ''
            if package not in ('vercel', 'vc'):
                continue
            name, args = package, args[1:]
        if name in ('cd', 'pushd', 'popd'):
            cwd = directory(cwd, args[0]) if name != 'popd' and len(args) == 1 else None
            continue
        try:
            if name == 'git':
                git_command(args, cwd, depth, assigned, inherited)
            elif name in ('vercel', 'vc'):
                deployment(args)
            elif name == 'gh':
                github(args, cwd)
        except Blocked:
            raise
        except Exception as error:  # One unreadable segment must not hide a later destructive one.
            print('POLICY UNAVAILABLE: a ' + name + ' segment could not be evaluated (' + type(error).__name__ +
                  '); later segments are still checked.', file=sys.stderr)


def evaluate(event):
    if not isinstance(event, dict) or not isinstance(event.get('tool_name'), str) or not event['tool_name']:
        fail('The native event does not identify its tool.', 'Reinstall the matching native PreToolUse adapter.', 'malformed-event')
    if event['tool_name'] != 'Bash':
        return
    if event.get('hook_event_name') != 'PreToolUse' or not isinstance(event.get('tool_input'), dict):
        fail('Malformed guarded PreToolUse event.', 'Reinstall the matching native adapter and verify its stdin schema.', 'malformed-event')
    command, cwd = event['tool_input'].get('command'), event.get('cwd')
    if not isinstance(command, str) or not isinstance(cwd, str):
        fail('Guarded shell event requires command text and a cwd.', 'Verify the native adapter tool_input.command and cwd fields.', 'malformed-event')
    if not command.strip() or not Path(cwd).is_dir():
        return  # A removed working directory must not block every shell command.
    global _DEADLINE
    _DEADLINE = time.monotonic() + BUDGET_SECONDS
    inspect_command(command, Path(cwd).resolve())


def telemetry(event, harness, decision, rule):
    from datetime import datetime, timezone
    try:
        cwd = event.get('cwd', '')
        root = repository(cwd) if Path(cwd).is_dir() else None
        if root is None:
            return  # Outside a repository there is no ignored evidence directory to write.
        if not (root / '.rpi').is_dir():
            return  # No installed state directory: do not create one.
        directory = root / '.rpi/local'
        if any(path.is_symlink() for path in (root, root / '.rpi', directory, directory / 'contract-events.jsonl')):
            return
        directory.mkdir(parents=True, exist_ok=True)
        value = {'ts': datetime.now(timezone.utc).isoformat(), 'session_id': event.get('session_id', ''),
                 'hook': 'rpi-policy-' + harness, 'decision': decision, 'rule': rule, 'file': ''}
        with (directory / 'contract-events.jsonl').open('a') as stream:
            stream.write(json.dumps(value) + '\n')
    except (OSError, TypeError):
        print('TELEMETRY UNAVAILABLE: policy evaluation still completed.', file=sys.stderr)


def main(argv):
    if len(argv) != 2 or argv[0] != '--harness' or argv[1] not in ('claude', 'codex'):
        print('BLOCKED / WHY: unsupported hook adapter arguments. / FIX: invoke rpi-policy.py --harness claude or --harness codex.', file=sys.stderr)
        return 2
    harness, event = argv[1], {}
    try:
        try:
            event = read_json(sys.stdin.read())
        except ValueError:
            fail('Native hook input must be one JSON object.', 'Reinstall the matching native PreToolUse adapter.', 'malformed-event')
        evaluate(event)
        return 0
    except Blocked as error:
        print('BLOCKED / WHY: ' + str(error) + ' / FIX: ' + error.fix, file=sys.stderr)
        if isinstance(event, dict) and isinstance(event.get('cwd'), str):
            telemetry(event, harness, 'block', error.rule)
        return 2
    except Exception as error:  # A denylist defect must not block ordinary work.
        print('POLICY UNAVAILABLE: evaluation failed (' + type(error).__name__ + '); the command passes to native permissions. '
              'FIX: run python3 .rpi/scripts/rpi-distribution.py check --target . and report the command shape to cc-rpi.', file=sys.stderr)
        return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
