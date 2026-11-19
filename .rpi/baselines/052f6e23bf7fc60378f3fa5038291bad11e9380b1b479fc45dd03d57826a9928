#!/usr/bin/env python3
"""Best-effort guardrail against a short list of clearly destructive remote operations.

The hook reads shell text and never runs it. Exit 2 blocks a command it positively
identifies as one of these operations:

- force-pushing or deleting a protected branch (main, master, develop, plus the
  integration and production branches declared in .rpi/policy.json);
- git push --mirror or --prune, and a forced or deleting --all;
- deleting or force-moving a version tag;
- a Vercel Preview deployment (any deploy without --prod);
- gh repo delete, and gh api deletion of a repository, a protected branch or a
  version tag.

Exit 0 passes everything else to the client's native permissions, which stay the
real boundary. This is not a shell security boundary: an alias, a script file, a
variable exported earlier or another unusual spelling can hide a command, and that
is accepted. Any error in the hook itself (bad input, a parser problem, a missing
repository) passes the command with a warning; the hook never blocks work because
it failed. The opt-in verification receipt gate is a separate Git pre-push hook
(rpi-prepush.py).
"""
import sys

if sys.version_info < (3, 11):
    print('RPI POLICY SKIPPED: the policy adapter requires Python 3.11 or newer. FIX: uv python install 3.13; '
          'launch the client through uv run --python 3.13 so its hooks use the supported runtime.', file=sys.stderr)
    sys.exit(0)

import fnmatch  # noqa: E402
import json  # noqa: E402
import os  # noqa: E402
from pathlib import Path  # noqa: E402
import posixpath  # noqa: E402
import re  # noqa: E402
import subprocess  # noqa: E402
import warnings  # noqa: E402
from urllib.parse import unquote  # noqa: E402

PROTECTED = ('main', 'master', 'develop')
# Text that is known only when the shell runs: a variable, a substitution, arithmetic.
DYNAMIC = '\x00'
# A substitution that prints the current branch; resolved to it when the repository is known.
CURRENT = '\x01'
# Subshell markers in the segment list: a directory change inside ( ... ) does not outlive it.
SUBSHELL_OPEN, SUBSHELL_CLOSE = '\x02(', '\x02)'
CURRENT_BRANCH_COMMANDS = {'git branch --show-current', 'git rev-parse --abbrev-ref HEAD', 'git symbolic-ref --short HEAD',
                           'git symbolic-ref --quiet --short HEAD'}
MAX_DEPTH = 6
# A version tag, as the receipt gate (rpi-prepush.py) defines it; a test keeps the two patterns identical. Three shapes: v1, v1.0,
# V3.0.0-rc.1 (a v and numbers); 2.0, 1.2.3 (numbers with at least one dot); release-v1, release-1.0.0 (a word and one of those).
# A bare number or word-number (1, issue-42, release-1) is a branch name, not a version.
VERSION_TAG = re.compile(r'(?:[A-Za-z][A-Za-z0-9]*+[-_])?(?:[vV]\d++(?:\.\d++)*+|\d++(?:\.\d++)++)(?:[-+_A-Za-z][-+._0-9A-Za-z]*+)?')
VERSION_TAG_SAMPLES = ('v1', 'v1.0', 'v1.0.0', '1.0.0', 'V1.0', 'release-1.0', 'release-v1')
POLICY_KEYS = {'schema_version', 'integration_branch', 'production_branches', 'remote',
               'require_verification_receipt', 'verification_checks', 'verification_command'}
SHELLS = {'bash', 'sh', 'zsh', 'dash', 'ksh', 'fish'}
SHELL_VALUE_OPTIONS = {'-o', '+o', '-O', '+O', '--rcfile', '--init-file'}
KEYWORDS = {'{', '}', '!', 'if', 'then', 'else', 'elif', 'do', 'while', 'until', 'time', 'coproc'}
ASSIGNMENT = re.compile(r'[A-Za-z_][A-Za-z0-9_]*=')
# Commands that run the command after their options, with the options that take a separate value and the
# number of operands (timeout's duration) before the command.
WRAPPERS = {
    'env': ({'-u', '--unset', '-C', '--chdir'}, 0), 'command': (set(), 0), 'builtin': (set(), 0), 'exec': ({'-a'}, 0),
    'nohup': (set(), 0), 'noglob': (set(), 0), 'nocorrect': (set(), 0), 'setsid': (set(), 0),
    'sudo': ({'-u', '-g', '-C', '-D', '-h', '-p', '-r', '-t', '-T', '-U', '--user', '--group', '--chdir'}, 0),
    'doas': ({'-u', '-C', '-a'}, 0), 'nice': ({'-n', '--adjustment'}, 0),
    'timeout': ({'-k', '-s', '--kill-after', '--signal'}, 1), 'gtimeout': ({'-k', '-s', '--kill-after', '--signal'}, 1),
    'stdbuf': ({'-i', '-o', '-e'}, 0), 'caffeinate': ({'-t', '-w'}, 0), 'watch': ({'-n', '--interval'}, 0),
    'xargs': ({'-n', '-I', '-P', '-L', '-s', '-d', '-E', '-a', '--max-args', '--max-procs'}, 0),
}
GIT_VALUE_OPTIONS = {'-c', '--git-dir', '--work-tree', '--namespace', '--config-env', '--super-prefix', '--attr-source'}
PUSH_VALUE_OPTIONS = {'-o', '--push-option', '--receive-pack', '--exec'}
PACKAGE_VALUE_OPTIONS = {'-p', '--package', '-c', '--call'}
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
PROTECTED_FIX = ('Push without force (git pull --rebase first) or use a working branch; if the target is a working branch, name it '
                 'explicitly (git push --force-with-lease origin BRANCH); if it is truly intended, the owner runs the exact command.')


class Blocked(Exception):
    def __init__(self, reason, fix, rule):
        super().__init__(reason)
        self.fix, self.rule = fix, rule


class Unreadable(Exception):
    """Shell text the tokenizer cannot read (an unclosed quote, for example). It passes."""


def fail(reason, fix, rule):
    raise Blocked(reason, fix, rule)


def fail_tag(name):
    fail('Deleting or force-moving a version tag (' + name + ') changes a published release.',
         'Publish a new version tag instead of changing a published one; if the name is a branch, write it as refs/heads/NAME; '
         'if it is truly intended, the owner runs the exact command.',
         'protected-tag')


# Tokenizer ---------------------------------------------------------------------------------------------------------

def closing(text, start, opener, closer):
    """Index of the `closer` that ends the group opened just before `start`, skipping quoted text and here-document bodies."""
    depth, index, markers = 1, start, []
    while index < len(text):
        char = text[index]
        if char == '\\':
            index += 2
            continue
        if char in ('"', "'"):
            end = index + 1
            while end < len(text) and text[end] != char:
                end += 2 if char == '"' and text[end] == '\\' else 1
            if end >= len(text):
                raise Unreadable()
            index = end + 1
            continue
        if text.startswith('<<', index) and not text.startswith('<<<', index):
            match = re.match(r'<<-?\s*([\'"]?)([A-Za-z0-9_.-]+)\1', text[index:])
            if match:
                markers.append((match[2], text[index + 2:index + 3] == '-'))
                index += match.end()
                continue
        if char == '\n' and markers:
            index += 1
            for marker, strip_tabs in markers:
                while index < len(text):
                    line_end = text.find('\n', index)
                    line = text[index:len(text) if line_end < 0 else line_end]
                    index = len(text) if line_end < 0 else line_end + 1
                    if (line.lstrip('\t') if strip_tabs else line) == marker:
                        break
            markers.clear()
            continue
        if char == opener:
            depth += 1
        elif char == closer:
            depth -= 1
            if not depth:
                return index
        index += 1
    raise Unreadable()


def split_commands(text):
    """(segments, nested) of shell text. A segment is the word list of one simple command; nested are the bodies of
    $(...) and `...` substitutions, inspected as commands of their own. Here-document bodies, comments and
    redirections are dropped."""
    segments, nested, segment, word = [], [], [], []
    state = {'in_word': False, 'discard': False, 'marker': None}
    heredocs = []

    def end_word():
        if state['in_word']:
            value = ''.join(word)
            if state['marker'] is not None:
                heredocs.append((value, state['marker']))
                state['marker'] = None
            elif state['discard']:
                state['discard'] = False
            else:
                segment.append(value)
        word.clear()
        state['in_word'] = False

    def end_segment():
        end_word()
        if segment:
            segments.append(list(segment))
        segment.clear()

    def substitution(body):
        nested.append(body)
        return CURRENT if ' '.join(body.split()) in CURRENT_BRANCH_COMMANDS else DYNAMIC

    def dollar(index):
        """Read a $ expansion at text[index]; return the index after it."""
        following = text[index + 1:index + 2]
        if text.startswith('$((', index):
            end = closing(text, index + 3, '(', ')')
            word.append(DYNAMIC)
            return closing(text, end + 1, '(', ')') + 1 if text[end + 1:end + 2] == ')' else end + 1
        if following == '(':
            end = closing(text, index + 2, '(', ')')
            word.append(substitution(text[index + 2:end]))
            return end + 1
        if following == '{':
            word.append(DYNAMIC)
            return closing(text, index + 2, '{', '}') + 1
        match = re.match(r'[A-Za-z_][A-Za-z0-9_]*|[0-9@*#?$!-]', text[index + 1:])
        if match:
            word.append(DYNAMIC)
            return index + 1 + match.end()
        word.append('$')
        return index + 1

    index, length = 0, len(text)
    while index < length:
        char = text[index]
        if char == '\\':
            if text[index + 1:index + 2] != '\n':
                word.append(text[index + 1:index + 2])
                state['in_word'] = True
            index += 2
        elif char == "'":
            end = text.find("'", index + 1)
            if end < 0:
                raise Unreadable()
            word.append(text[index + 1:end])
            state['in_word'] = True
            index = end + 1
        elif char == '"':
            state['in_word'] = True
            index += 1
            while True:
                if index >= length:
                    raise Unreadable()
                char = text[index]
                if char == '"':
                    index += 1
                    break
                if char == '\\' and text[index + 1:index + 2] in ('"', '\\', '$', '`'):
                    word.append(text[index + 1])
                    index += 2
                elif char == '$':
                    index = dollar(index)
                elif char == '`':
                    end = text.find('`', index + 1)
                    if end < 0:
                        raise Unreadable()
                    word.append(substitution(text[index + 1:end]))
                    index = end + 1
                else:
                    word.append(char)
                    index += 1
        elif char == '$':
            state['in_word'] = True
            if text.startswith("$'", index):
                end = text.find("'", index + 2)
                if end < 0:
                    raise Unreadable()
                with warnings.catch_warnings():
                    warnings.simplefilter('ignore')
                    word.append(text[index + 2:end].encode('latin-1', 'backslashreplace').decode('unicode_escape', 'replace'))
                index = end + 1
            else:
                index = dollar(index)
        elif char == '`':
            end = text.find('`', index + 1)
            if end < 0:
                raise Unreadable()
            word.append(substitution(text[index + 1:end]))
            state['in_word'] = True
            index = end + 1
        elif char in ' \t\r':
            end_word()
            index += 1
        elif char == '#' and not state['in_word']:
            end = text.find('\n', index)
            index = length if end < 0 else end
        elif char == '\n':
            end_segment()
            index += 1
            for marker, strip_tabs in heredocs:
                while index < length:
                    end = text.find('\n', index)
                    line = text[index:length if end < 0 else end]
                    index = length if end < 0 else end + 1
                    if (line.lstrip('\t') if strip_tabs else line) == marker:
                        break
            heredocs.clear()
        elif char == '&' and text.startswith('&>', index):
            end_word()
            index += 3 if text.startswith('&>>', index) else 2
            state['discard'] = True
        elif char in '()':
            end_segment()
            segments.append([SUBSHELL_OPEN if char == '(' else SUBSHELL_CLOSE])
            index += 1
        elif char in ';&|':
            end_segment()
            index += 1
        elif char in '<>':
            if state['in_word'] and ''.join(word).isdigit():
                word.clear()
                state['in_word'] = False  # 2>file: the digits name a descriptor.
            else:
                end_word()
            if text.startswith('<<<', index):
                index += 3
                state['discard'] = True
            elif text.startswith('<<', index):
                index += 2
                strip_tabs = text[index:index + 1] == '-'
                index += strip_tabs
                state['marker'] = strip_tabs
            else:
                index += 1
                if text[index:index + 1] in ('>', '&', '|'):
                    index += 1
                state['discard'] = True
        else:
            word.append(char)
            state['in_word'] = True
            index += 1
    end_segment()
    return segments, nested


# Repository facts --------------------------------------------------------------------------------------------------

_GIT = {}


def git(cwd, *arguments):
    """Git's stdout in `cwd`, or None when Git or the repository is unavailable."""
    if cwd is None:
        return None
    key = (str(cwd), arguments)
    if key not in _GIT:
        try:
            result = subprocess.run(['git', '-C', str(cwd), *arguments], capture_output=True, text=True, timeout=5,
                                    stdin=subprocess.DEVNULL)
            _GIT[key] = result.stdout.strip() if result.returncode == 0 else None
        except (OSError, subprocess.SubprocessError, ValueError):
            _GIT[key] = None
    return _GIT[key]


def repository(cwd):
    top = git(cwd, 'rev-parse', '--show-toplevel')
    return Path(top) if top else None


def branch_name(name):
    """refs/heads/NAME, heads/NAME and NAME are the same branch."""
    return name.removeprefix('refs/').removeprefix('heads/')


def project_policy(root):
    """The optional project policy. A file that cannot be used is reported and the default protection applies."""
    path = root / '.rpi/policy.json' if root else None
    if path is None or not (path.exists() or path.is_symlink()):
        return {}
    try:
        value = json.loads(path.read_text(encoding='utf-8'))
        if not isinstance(value, dict) or value.get('schema_version') != 1 or set(value) - POLICY_KEYS:
            raise ValueError('use schema_version 1 and only these keys: ' + ', '.join(sorted(POLICY_KEYS)))
        if not isinstance(value.get('integration_branch', 'main'), str):
            raise ValueError('integration_branch must be one branch name')
        branches = value.get('production_branches', [])
        if not isinstance(branches, list) or not all(isinstance(item, str) for item in branches):
            raise ValueError('production_branches must be a list of branch names')
        return value
    except (OSError, ValueError) as error:
        print('POLICY NOTE: .rpi/policy.json cannot be used (' + str(error) + '); only main, master and develop are protected.',
              file=sys.stderr)
        return {}


def protected_branches(cwd):
    policy = project_policy(repository(cwd))
    names = set(PROTECTED) | {branch_name(name) for name in policy.get('production_branches', []) if name}
    if policy.get('integration_branch'):
        names.add(branch_name(policy['integration_branch']))
    return names


def current_branch(cwd):
    """The checked-out branch; DYNAMIC when the repository is unknown, None when HEAD is detached."""
    if repository(cwd) is None:
        return DYNAMIC
    return git(cwd, 'symbolic-ref', '--quiet', '--short', 'HEAD')


def directory(cwd, target):
    """The directory a cd/pushd/git -C target names, or None when it is unknown."""
    if cwd is None or DYNAMIC in target or CURRENT in target or target == '-':
        return None
    path = Path(os.path.expanduser(target))
    path = path if path.is_absolute() else Path(cwd) / path
    return path if path.is_dir() else None


# Rules -------------------------------------------------------------------------------------------------------------

def check_destination(destination, cwd, current):
    """Block a forced or deleting push to `destination` when it can be a protected branch or a version tag."""
    destination = destination.replace(CURRENT, current if current and current != DYNAMIC else DYNAMIC)
    if destination in ('HEAD', '@'):
        destination = current or ''
        if not destination:
            return  # A detached HEAD pushes no branch.
    qualified_tag = destination.startswith(('refs/tags/', 'tags/'))
    qualified_branch = destination.startswith(('refs/heads/', 'heads/'))
    name = destination.removeprefix('refs/').removeprefix('tags/') if qualified_tag else branch_name(destination)
    pattern = name.replace(DYNAMIC, '*')
    wildcard = '*' in pattern
    if (not qualified_tag and not qualified_branch and not wildcard and VERSION_TAG.fullmatch(pattern)
            and git(cwd, 'rev-parse', '--verify', '--quiet', 'refs/heads/' + name) and not git(cwd, 'rev-parse', '--verify', '--quiet', 'refs/tags/' + name)):
        qualified_branch = True  # A local branch of that name, and no such tag: it is that branch.
    if qualified_tag or (not qualified_branch and not wildcard and VERSION_TAG.fullmatch(pattern)):
        if (any(fnmatch.fnmatchcase(sample, pattern) for sample in VERSION_TAG_SAMPLES) if wildcard
                else VERSION_TAG.fullmatch(pattern)):
            fail_tag(name.replace(DYNAMIC, '$VALUE'))
        return
    protected = {item.lower() for item in protected_branches(cwd)}
    if (any(fnmatch.fnmatchcase(item, pattern.lower()) for item in protected) if wildcard else pattern.lower() in protected):
        label = 'unresolved target' if not pattern.replace('*', '') else name.replace(DYNAMIC, '$VALUE')
        fail('Force-pushing or deleting a protected branch (' + label + ') rewrites shared history.', PROTECTED_FIX, 'protected-branch')
    if wildcard and not qualified_branch and any(fnmatch.fnmatchcase(sample, pattern) for sample in VERSION_TAG_SAMPLES):
        fail_tag(name.replace(DYNAMIC, '$VALUE'))  # An unqualified name known only at run time may be a version tag.


def push(args, cwd):
    force = delete = everything = broad = dry_run = tags = False
    values, index = [], 0
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
        elif name == '--tags':
            tags = True
        elif name == '--dry-run':
            dry_run = True
        elif name in PUSH_VALUE_OPTIONS or name == '--repo':
            value = arg.split('=', 1)[1] if '=' in arg else (args[index] if index < len(args) else None)
            index += '=' not in arg
            if name == '--repo' and value is not None:
                values.insert(0, value)
        elif re.fullmatch(r'-[A-Za-z0-9]+', arg):
            flags = arg[1:].split('o', 1)  # -o takes the rest of the cluster, or the next word, as its value.
            force, delete, dry_run = force or 'f' in flags[0], delete or 'd' in flags[0], dry_run or 'n' in flags[0]
            index += len(flags) == 2 and not flags[1]
        elif not arg.startswith('-'):
            values.append(arg)
    if dry_run:
        return
    if broad or (everything and (force or delete)):
        fail('This push rewrites or deletes remote refs beyond the named branch.',
             'Push explicit refs instead: git push REMOTE BRANCH.', 'destructive-push')
    if tags and force:
        fail_tag('all tags')
    refspecs = values[1:]
    if not (force or delete or any(spec.startswith('+') or spec.startswith(':') for spec in refspecs)):
        return  # Nothing is rewritten or deleted.
    current = current_branch(cwd)
    if not refspecs:
        if force and not (tags or everything) and current:
            check_destination(current if current == DYNAMIC else 'refs/heads/' + current, cwd, current)
        return
    for spec in refspecs:
        forced = force or spec.startswith('+')
        spec = spec.lstrip('+')
        if spec == ':':
            destination, removed = '*', False  # The matching push: every branch present on both sides.
        else:
            source, destination = spec.split(':', 1) if ':' in spec else (spec, spec)
            removed = delete or not source
        if forced or removed:
            check_destination(destination, cwd, current)


def git_command(args, cwd):
    index = 0
    while index < len(args) and args[index].startswith('-'):
        option = args[index]
        if option == '-C' and index + 1 < len(args):
            cwd = directory(cwd, args[index + 1])
            index += 2
        elif option in GIT_VALUE_OPTIONS:
            index += 2
        else:
            index += 1
    if index < len(args) and args[index] == 'push':
        push(args[index + 1:], cwd)


def deployment(args):
    if any(arg in ('--help', '-h', '--version', '-v') for arg in args):
        return
    index = 0
    while index < len(args) and args[index].startswith('-'):
        index += 1 + ('=' not in args[index] and args[index] in VERCEL_VALUE_OPTIONS)
    command = args[index] if index < len(args) else None
    if command is not None and command != 'deploy' and command in VERCEL_SUBCOMMANDS:
        return  # Other subcommands belong to native permissions.
    targets = [arg.split('=', 1)[1] if arg.startswith('--target=') else (args[position + 1] if position + 1 < len(args) else None)
               for position, arg in enumerate(args) if arg == '--target' or arg.startswith('--target=')]
    if not ('--prod' in args or targets) or any(target != 'production' for target in targets):
        fail('Vercel Preview deployments (including the bare default deploy) are disabled for this project.',
             'Build locally with vercel build, or deploy production explicitly with vercel deploy --prod.', 'preview')


def api_path(arg):
    path = unquote(re.split(r'[?#]', arg, maxsplit=1)[0])
    path = re.sub(r'^https?://[^/]+', '', path)
    path = posixpath.normpath(re.sub(r'/+', '/', path)).lstrip('/') if path else path
    return path.removeprefix('api/v3/')


def github(args, cwd):
    if args[:2] == ['repo', 'delete'] and not any(arg in ('--help', '-h') for arg in args):
        fail('Deleting a repository is irreversible.',
             'The owner runs the exact gh repo delete command after confirming the target.', 'destructive-remote')
    if args[:2] == ['release', 'delete'] and any(arg.split('=', 1)[0] == '--cleanup-tag' for arg in args):
        fail_tag('the release tag')
    if args[:1] != ['api']:
        return
    args = args[1:]
    if 'graphql' in args and re.search(r'\b(deleteRepository|deleteRef)\b', ' '.join(args)):
        fail('This GraphQL mutation deletes a repository or a ref.',
             'Use the REST endpoint for a working branch (gh api -X DELETE repos/OWNER/REPO/git/refs/heads/BRANCH); '
             'the owner runs the exact mutation otherwise.', 'destructive-remote')
    methods, forced, paths, index = set(), False, [], 0
    while index < len(args):
        arg = args[index]
        index += 1
        cluster = re.fullmatch(r'-i*X=?(.*)', arg)
        if cluster or arg in ('--method',) or arg.startswith('--method='):
            value = cluster[1] if cluster else (arg.split('=', 1)[1] if '=' in arg else '')
            if not value and index < len(args):
                value, index = args[index], index + 1
            methods.add(value.upper())
        elif arg in ('-f', '-F', '--field', '--raw-field') or re.fullmatch(r'-[fF].+', arg) or arg.startswith(('--field=', '--raw-field=')):
            text = arg[2:].removeprefix('=') if re.fullmatch(r'-[fF].+', arg) else (arg.split('=', 1)[1] if '=' in arg else '')
            if not text and index < len(args):
                text, index = args[index], index + 1
            name, _, value = text.partition('=')
            forced = forced or (name == 'force' and value.strip().lower() in ('true', '1', 't', 'yes'))
        elif not arg.startswith('-'):
            paths.append(api_path(arg))
    if not methods & {'DELETE', 'PATCH'}:
        return
    for path in paths:
        if 'DELETE' in methods and re.fullmatch(r'repos/[^/]+/[^/]+', path):
            fail('Deleting a repository is irreversible.', 'The owner runs the exact deletion after confirming the target.',
                 'destructive-remote')
        match = re.fullmatch(r'repos/[^/]+/[^/]+/git/refs/(heads|tags)/(.+)', path)
        if match and ('DELETE' in methods or forced):
            check_destination(('refs/tags/' if match[1] == 'tags' else 'refs/heads/') + match[2], cwd, None)


def package_command(name, args):
    """The command a package runner (npx, bunx, pnpm dlx/exec, yarn dlx/exec) runs, or None."""
    if name in ('pnpm', 'yarn'):
        if args[:1] not in (['dlx'], ['exec']):
            return None
        args = args[1:]
    index = 0
    while index < len(args) and args[index].startswith('-'):
        index += 1 + (args[index] in PACKAGE_VALUE_OPTIONS)
    return args[index:]


def strip_prefix(words):
    """Drop assignments, shell keywords and wrapper commands in front of the command. Returns (words, nested text)."""
    nested = []
    while words:
        first = words[0]
        if first in KEYWORDS or ASSIGNMENT.match(first):
            words = words[1:]
            continue
        name = os.path.basename(first)
        if name not in WRAPPERS:
            break
        value_options, operands = WRAPPERS[name]
        index = 1
        while index < len(words) and words[index].startswith('-') and words[index] != '-':
            option = words[index]
            if name == 'command' and option in ('-v', '-V'):
                return [], nested  # command -v NAME looks NAME up; it does not run it.
            if name == 'env' and (option.startswith('-S') or option.split('=', 1)[0] == '--split-string'):
                if option.startswith('--split-string='):
                    nested.append(option.split('=', 1)[1])
                elif option not in ('-S', '--split-string'):
                    nested.append(option[2:])
                elif index + 1 < len(words):
                    nested.append(words[index + 1])
                return [], nested
            index += 1 + (option in value_options)
        while index < len(words) and name == 'env' and ASSIGNMENT.match(words[index]):
            index += 1
        words = words[index + operands:]
    return words, nested


def inspect_command(text, cwd, depth=0):
    if depth > MAX_DEPTH:
        return
    segments, nested = split_commands(text)
    for body in nested:
        inspect_command(body, cwd, depth + 1)
    failure, saved = None, []
    for words in segments:
        if words == [SUBSHELL_OPEN]:
            saved.append(cwd)
            continue
        if words == [SUBSHELL_CLOSE]:
            cwd = saved.pop() if saved else cwd
            continue
        try:
            cwd = inspect_segment(words, cwd, depth)
        except Blocked:
            raise
        except Exception as error:  # Keep judging the later segments; report the failure only if nothing is blocked.
            failure = failure or error
    if failure is not None:
        raise failure


def inspect_segment(words, cwd, depth):
    """Judge one simple command; returns the working directory for the next one."""
    words, extra = strip_prefix(words)
    for body in extra:
        inspect_command(body, cwd, depth + 1)
    if not words or DYNAMIC in words[0] or CURRENT in words[0]:
        return cwd
    name, args = os.path.basename(words[0]), words[1:]
    if '@' in name and not name.startswith('@'):
        name = name.split('@', 1)[0]
    if name in ('cd', 'pushd'):
        target = next((arg for arg in args if not arg.startswith('-') or arg == '-'), '~')
        cwd = directory(cwd, target)
    elif name == 'git':
        git_command(args, cwd)
    elif name == 'gh':
        github(args, cwd)
    elif name in ('vercel', 'vc'):
        deployment(args)
    elif name in ('npx', 'bunx', 'pnpm', 'yarn'):
        command = package_command(name, args)
        if command:
            inspect_command(' '.join(quote(word) for word in command), cwd, depth + 1)
    elif name in SHELLS:
        script = shell_script(args)
        if script is not None:
            inspect_command(script, cwd, depth + 1)
    elif name == 'eval':
        inspect_command(' '.join(args), cwd, depth + 1)
    elif name in ('su', 'runuser') and '-c' in args[:-1]:
        inspect_command(args[args.index('-c') + 1], cwd, depth + 1)
    return cwd


def quote(word):
    return "'" + word.replace("'", "'\\''") + "'" if word else "''"


def shell_script(args):
    """The -c script of bash -c 'CMD', bash -ec 'CMD', sh -e -c 'CMD' or bash -c -e 'CMD'; None for a script file."""
    saw_c, index = False, 0
    while index < len(args):
        arg = args[index]
        if arg in SHELL_VALUE_OPTIONS:
            index += 2
            continue
        if arg == '--':
            pass
        elif arg.startswith(('-', '+')) and arg != '-':
            saw_c = saw_c or (not arg.startswith('--') and 'c' in arg[1:])
        elif saw_c:
            return arg
        else:
            return None
        index += 1
    return None


# Hook entry point --------------------------------------------------------------------------------------------------

def telemetry(event, harness, rule):
    from datetime import datetime, timezone
    try:
        cwd = event.get('cwd', '')
        root = repository(cwd) if isinstance(cwd, str) and Path(cwd).is_dir() else None
        if root is None or not (root / '.rpi').is_dir():
            return  # No installed state directory: do not create one.
        directory_path = root / '.rpi/local'
        if any(path.is_symlink() for path in (root / '.rpi', directory_path, directory_path / 'contract-events.jsonl')):
            return
        directory_path.mkdir(parents=True, exist_ok=True)
        value = {'ts': datetime.now(timezone.utc).isoformat(), 'session_id': event.get('session_id', ''),
                 'hook': 'rpi-policy-' + harness, 'decision': 'block', 'rule': rule, 'file': ''}
        with (directory_path / 'contract-events.jsonl').open('a') as stream:
            stream.write(json.dumps(value) + '\n')
    except (OSError, TypeError, ValueError):
        print('TELEMETRY UNAVAILABLE: policy evaluation still completed.', file=sys.stderr)


def unavailable(reason):
    print('POLICY UNAVAILABLE: ' + reason + '; the command passes to native permissions.', file=sys.stderr)
    return 0


def main(argv):
    for stream in (sys.stderr, sys.stdout):
        try:
            stream.reconfigure(errors='backslashreplace')
        except (AttributeError, ValueError):
            pass
    if len(argv) != 2 or argv[0] != '--harness' or argv[1] not in ('claude', 'codex'):
        return unavailable('unsupported adapter arguments (expected --harness claude or --harness codex)')
    harness = argv[1]
    try:
        event = json.loads(sys.stdin.buffer.read().decode('utf-8', 'surrogateescape'))
    except (ValueError, OSError):
        return unavailable('the hook input is not one JSON object')
    if not isinstance(event, dict) or event.get('tool_name') != 'Bash':
        return 0
    tool_input = event.get('tool_input')
    command = tool_input.get('command') if isinstance(tool_input, dict) else None
    if not isinstance(command, str):
        return unavailable('the Bash event has no command text')
    cwd = event.get('cwd')
    cwd = Path(cwd) if isinstance(cwd, str) and Path(cwd).is_dir() else None
    try:
        inspect_command(command, cwd)
    except Blocked as error:
        print('BLOCKED / WHY: ' + str(error) + ' / FIX: ' + error.fix, file=sys.stderr, flush=True)
        telemetry(event, harness, error.rule)
        return 2
    except Unreadable:
        return 0
    except Exception as error:  # A defect in the hook never blocks work.
        return unavailable('evaluation failed (' + type(error).__name__ + ')')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
