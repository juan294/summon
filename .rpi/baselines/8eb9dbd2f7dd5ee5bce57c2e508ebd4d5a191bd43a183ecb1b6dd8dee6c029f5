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
from pathlib import Path  # noqa: E402
import re  # noqa: E402

POLICY_WORD = re.compile(r'\b(?:git|gh|vercel|vc)\b')
SHELL_KEYWORDS = {'{', '}', '!', 'if', 'then', 'else', 'elif', 'do', 'while', 'until'}
ASSIGNMENT = re.compile(r'[A-Za-z_][A-Za-z0-9_]*=.*')
REDIRECTION = re.compile(r'(?:\d*|&)(?:>>?|<)&?(.*)')
HEREDOC = re.compile(r"\b(?:cat|tee)\b[^\n]*?<<-?(['\"])([A-Za-z_][A-Za-z0-9_]*)\1[^\n]*\n")
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


def git(cwd, *arguments):
    """Return Git's stdout, or None when Git or the repository state is unavailable."""
    import subprocess
    try:
        result = subprocess.run(['git', '-C', str(cwd), *arguments], capture_output=True, text=True)
    except OSError:
        return None
    return result.stdout.strip() if result.returncode == 0 else None


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


def integration_branch(root, policy):
    declared = policy.get('integration_branch')
    if isinstance(declared, str) and declared:
        return declared
    return next((name for name in PROTECTED if git(root, 'rev-parse', '--verify', '--quiet', 'refs/heads/' + name)), None)


def resolved_branch(ref, current):
    """Branch a push destination names, or None when it cannot be resolved."""
    if not ref or DYNAMIC in ref or '*' in ref:
        return None  # Unresolved or a glob that can match any branch.
    if ref in ('HEAD', '@'):
        return current
    return ref.removeprefix('refs/heads/')


def parse_refspec(spec, force, delete):
    """(source, destination, forced, removed) for one push refspec."""
    forced = force or spec.startswith('+')
    spec = spec.lstrip('+')
    if spec == ':':
        return None, '*', forced, False  # The matching push: every branch present on both sides.
    source, destination = spec.split(':', 1) if ':' in spec else (spec, spec)
    return source or None, destination, forced, delete or not source


def configured_targets(root, remote, current, force, delete):
    """Destinations Git derives from configuration when a push names no refspec."""
    if root is None or current is None:
        return [(current, current, force, delete)]
    remote = remote or git(root, 'config', '--get', 'branch.' + current + '.remote') or 'origin'
    specs = (git(root, 'config', '--get-all', 'remote.' + remote + '.push') or '').splitlines()
    if specs:
        return [parse_refspec(spec, force, delete) for spec in specs]
    mode = git(root, 'config', '--get', 'push.default') or 'simple'
    if mode in ('upstream', 'tracking'):
        merge = git(root, 'config', '--get', 'branch.' + current + '.merge')
        if merge:
            return [(current, merge, force, delete)]
    if mode == 'matching':
        return [(None, '*', force, False)]
    return [(current, current, force, delete)]


def push(args, cwd):
    force = delete = everything = broad = dry_run = False
    remote, values, index = None, [], 0
    while index < len(args):
        arg = args[index]
        index += 1
        name = arg.split('=', 1)[0]
        if arg == '--':
            values.extend(args[index:])
            break
        if name in ('--mirror', '--prune'):
            broad = True
        elif name in ('--force', '--force-with-lease'):
            force = True
        elif name == '--delete':
            delete = True
        elif name in ('--all', '--branches'):
            everything = True
        elif name == '--dry-run':
            dry_run = True
        elif name in PUSH_VALUE_OPTIONS:
            value = arg.split('=', 1)[1] if '=' in arg else (args[index] if index < len(args) else None)
            remote = value if name == '--repo' else remote
            index += '=' not in arg
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
               else configured_targets(root, remote, current, force, delete))
    rewritten = [resolved_branch(destination, current) for _, destination, forced, removed in targets if forced or removed]
    if not rewritten:
        return
    policy = project_policy(root) if root else {}
    integration = integration_branch(root, policy) if root else None
    protected = set(PROTECTED) | set(policy.get('production_branches', [])) | {integration}
    for branch in rewritten:
        if branch is None or branch in protected:
            fail('Force-pushing or deleting a protected branch (' + (branch or 'unresolved target') + ') rewrites shared history.',
                 'Push without force (git pull --rebase first) or use a working branch; if it is truly intended, the owner runs the exact command.',
                 'protected-branch')


def git_command(args, cwd):
    args = list(args)
    while args and args[0].startswith('-'):
        option = args.pop(0)
        if option == '-C' and args or option.startswith('-C') and len(option) > 2:
            cwd = directory(cwd, args.pop(0) if option == '-C' else option[2:])
        elif option in GIT_VALUE_OPTIONS and args:
            args.pop(0)
    if args[:1] == ['push']:
        push(args[1:], cwd)


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
    """The -c script of a shell invocation such as bash -ec 'CMD' or sh -e -c 'CMD'."""
    index = 0
    while index < len(args) and args[index][:1] in ('-', '+'):
        if re.fullmatch(r'-[A-Za-z]*c[A-Za-z]*', args[index]):
            return args[index + 1] if index + 1 < len(args) else None
        index += 2 if args[index] in ('-o', '+o', '-O', '+O') else 1  # -o takes an option name.
    return None


def api_delete(args, cwd):
    """Block API deletion of a repository or a protected branch ref."""
    methods = [args[index + 1] for index, arg in enumerate(args[:-1]) if arg in ('-X', '--method')]
    methods += [arg.split('=', 1)[1] for arg in args if arg.startswith(('--method=', '-X='))]
    if not any(method.upper() == 'DELETE' for method in methods):
        return
    for arg in args:
        if re.fullmatch(r'/?repos/[^/]+/[^/]+/?', arg):
            fail('Deleting a repository is irreversible.',
                 'The owner runs the exact deletion after confirming the target.', 'destructive-remote')
        match = re.fullmatch(r'/?repos/[^/]+/[^/]+/git/refs/heads/(.+)', arg)
        if match:
            root = repository(cwd)
            policy = project_policy(root) if root else {}
            integration = integration_branch(root, policy) if root else None
            if match[1] in set(PROTECTED) | set(policy.get('production_branches', [])) | {integration}:
                fail('Deleting a protected branch (' + match[1] + ') through the API rewrites shared history.',
                     'Delete only working branches; if it is truly intended, the owner runs the exact command.', 'protected-branch')


def strip_quoted_heredocs(command):
    while True:
        match = HEREDOC.search(command)
        if not match:
            return command
        end = re.search(r'(?m)^\t*' + re.escape(match[2]) + r'[ \t]*$', command[match.end():])
        if not end:
            raise Unclassifiable('unterminated quoted here-document')
        header = re.sub(r"<<-?(['\"])" + re.escape(match[2]) + r'\1', '', match[0])
        command = command[:match.start()] + header + command[match.end() + end.end():]


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

    Substitutions and parameter expansions become DYNAMIC in their word, and
    substitution bodies are returned separately for their own inspection.
    """
    command = strip_quoted_heredocs(command)
    tokens, embedded, word = [], [], []
    quote, started, index = None, False, 0
    def flush():
        nonlocal word, started
        if started:
            tokens.append(('word', ''.join(word)))
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
        match = REDIRECTION.fullmatch(words[index])
        if not match:
            output.append(words[index])
        elif not match[1]:
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


def unwrap(words):
    """Strip shell keywords, assignments and common executable wrappers."""
    while True:
        while words and (words[0] in SHELL_KEYWORDS or ASSIGNMENT.fullmatch(words[0])):
            words = words[1:]
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


def inspect_command(command, cwd, depth=0):
    # Substitution bodies are part of the raw text, so no policy word anywhere
    # means nothing below can match.
    if depth > 5 or not POLICY_WORD.search(command):
        return
    try:
        tokens, embedded = tokenize(command)
    except Unclassifiable:
        return
    for inner in embedded:
        inspect_command(inner, cwd, depth + 1)
    segments, current = [], []
    for kind, token in tokens:
        if kind == 'operator':
            if current:
                segments.append(current)
            current = []
        else:
            current.append(token)
    if current:
        segments.append(current)
    for words in segments:
        words = unwrap(without_redirections(words))
        if not words:
            continue
        name, args = Path(words[0]).name, words[1:]
        if name in LITERAL_TEXT:
            continue
        if name in SHELLS:
            script = shell_script(args)
            if script is not None:
                inspect_command(script, cwd, depth + 1)
            continue
        if name == 'eval':
            inspect_command(' '.join(args), cwd, depth + 1)
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
                git_command(args, cwd)
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
