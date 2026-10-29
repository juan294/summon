#!/usr/bin/env python3
"""Supplemental pre-action checks, not a complete shell authorization boundary.

Supported argv shapes are parsed, never executed. Exit 0 emits no native allow
permission: the client's trusted permission rules still decide authorization.
Exit 2 denies a guarded or unclassifiable policy-sensitive operation. Unknown
native approval modes cannot obtain consent from a repository flag or receipt.
"""
import argparse
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys

# Hook evaluation must not modify the verified candidate through sibling imports.
sys.dont_write_bytecode = True

POLICY_WORD = re.compile(r'\b(?:git|gh|vercel|vc)\b')
WORKING_BRANCH = re.compile(r'^(?:feature|feat|fix|bugfix|hotfix|work|wip|tmp|temp|remediation|remediate|codex)/')
SEPARATORS = {';', '&&', '||', '|', '&', '\n'}


def verification_contract(root):
    path = root / '.rpi/policy.json'
    if path.is_symlink() or not path.is_file():
        fail('The project must declare its complete local verification inventory.',
             'Run python3 .rpi/scripts/rpi-distribution.py check --target .; review .rpi/policy.json verification_checks and verification_command.', 'verification-contract')
    policy = read_json(path.read_text())
    checks = policy.get('verification_checks') if isinstance(policy, dict) else None
    command = policy.get('verification_command') if isinstance(policy, dict) else None
    names = set()
    if not isinstance(command, list) or not command or any(not isinstance(arg, str) or not arg for arg in command):
        fail('The project verification command is missing or malformed.', 'Declare verification_command as the reviewed local runner argv in .rpi/policy.json.', 'verification-contract')
    if not isinstance(checks, list) or not checks:
        fail('The complete project verification inventory is missing.', 'Declare every required local gate in .rpi/policy.json verification_checks.', 'verification-contract')
    for check in checks:
        if (not isinstance(check, dict) or set(check) != {'name', 'argv'} or not isinstance(check['name'], str) or not check['name'] or check['name'] in names or
                not isinstance(check['argv'], list) or not check['argv'] or any(not isinstance(arg, str) or not arg for arg in check['argv'])):
            fail('The project verification inventory must contain unique names and literal argv arrays.', 'Review .rpi/policy.json verification_checks against the complete local CI selection.', 'verification-contract')
        names.add(check['name'])
    return checks, shlex.join(command)


class Blocked(ValueError):
    def __init__(self, reason, fix, rule='unsupported'):
        super().__init__(reason)
        self.fix, self.rule = fix, rule


def fail(reason, fix='Use a separate explicit supported command; inspect project policy and native permissions.', rule='unsupported'):
    raise Blocked(reason, fix, rule)


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


def git(cwd, *arguments, required=True):
    if shutil.which('git') is None:
        repair = 'brew install git' if sys.platform == 'darwin' else 'sudo apt-get install git'
        fail('Git is required to evaluate this guarded command.', repair, 'missing-git')
    result = subprocess.run(['git', '-C', str(cwd), *arguments], capture_output=True, text=True)
    if required and result.returncode:
        fail('Git could not resolve the guarded repository state.', 'git -C ' + shlex.quote(str(cwd)) + ' status --short', 'git-state')
    return result.stdout.strip() if result.returncode == 0 else None


def repository(cwd):
    return Path(git(cwd, 'rev-parse', '--show-toplevel')).resolve()


def topology(root):
    path = root / '.rpi/policy.json'
    if path.is_symlink():
        fail('Project policy must be a regular file.', 'Review .rpi/policy.json and replace only its owned symlink entry.', 'topology')
    if path.exists():
        value = read_json(path.read_text())
        if not isinstance(value, dict) or set(value) - {'schema_version', 'integration_branch', 'production_branches', 'remote', 'verification_checks', 'verification_command'} or value.get('schema_version') != 1:
            fail('Invalid project topology schema.', 'Review the explicit .rpi/policy.json topology setup.', 'topology')
        branch = value.get('integration_branch')
        remote = value.get('remote', 'origin')
        source = 'project-policy'
    else:
        branch = next((name for name in ('develop', 'main', 'master') if git(root, 'rev-parse', '--verify', 'refs/heads/' + name, required=False)), None)
        remote, source = 'origin', 'inferred-local-branches'
    if not isinstance(branch, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._/-]*', branch) or WORKING_BRANCH.match(branch):
        fail('A documented integration branch is required; a working branch cannot be that target.', 'Declare the completed integration branch in .rpi/policy.json; keep working branches local.', 'topology')
    if not isinstance(remote, str) or not re.fullmatch(r'[A-Za-z0-9._-]+', remote):
        fail('The publication remote must be one configured name.', 'Review .rpi/policy.json remote and git remote -v.', 'topology')
    return {'integration_branch': branch, 'remote': remote, 'source': source}


def verified_candidate(root):
    expected, repair = verification_contract(root)
    if git(root, 'status', '--porcelain', '--untracked-files=normal'):
        fail('Publication requires a clean completed integration candidate.', 'Commit the completed integration, then run ' + repair, 'dirty-publication')
    path = root / '.rpi/local/verification.json'
    if path.is_symlink() or not path.is_file():
        fail('Exact-candidate local verification evidence is missing.', 'Run ' + repair + ' in the completed integration checkout.', 'missing-evidence')
    report = read_json(path.read_text())
    if not isinstance(report, dict):
        fail('Local verification report must be a JSON object.', 'Run ' + repair + ' to regenerate complete candidate evidence.', 'malformed-evidence')
    spec = importlib.util.spec_from_file_location('rpi_policy_candidate', Path(__file__).with_name('rpi-candidate.py'))
    if spec is None or spec.loader is None:
        fail('The shared candidate identity helper is missing.', 'Reinstall the complete declared RPI policy resources.', 'missing-helper')
    candidate = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(candidate)
    actual = candidate.identity(root)
    checks = report.get('checks')
    environment = candidate.environment()
    if (report.get('schema_version') != 1 or report.get('suite') != 'ci-equivalent' or report.get('passed') is not True or
            report.get('identity_unchanged') is not True or report.get('environment_unchanged') is not True or report.get('environment') != environment or report.get('environment_after') != environment or report.get('identity') != actual or report.get('identity_after') != actual or
            not isinstance(checks, list) or len(checks) != len(expected) or any(not isinstance(item, dict) or type(item.get('exit_code')) is not int or item['exit_code'] != 0 for item in checks) or
            [{key: item.get(key) for key in ('name', 'argv')} for item in checks] != expected):
        fail('Local verification does not attest this exact complete candidate.', 'Run ' + repair + '; custom, stale, partial or failed reports do not attest the candidate.', 'stale-evidence')
    return actual


def publication_trust(root):
    """Standing owner authorization for publication in a non-prompting mode.

    The owner records consent once, locally, instead of approving a native prompt
    for every action. This file is ignored evidence, so it authorizes the
    checkout that holds it and never travels with the product. It replaces the
    prompt boundary alone: candidate verification, topology, refspec, remote and
    branch checks all still apply.
    """
    if any(path.is_symlink() for path in (root / '.rpi', root / '.rpi/local')):
        return False
    path = root / '.rpi/local/publication-trust.json'
    if path.is_symlink() or not path.is_file():
        return False
    record = read_json(path.read_text())
    return (isinstance(record, dict) and record.get('schema_version') == 1
            and record.get('publication_without_prompt') is True)


def native_boundary(harness, event, canonical):
    mode = event.get('permission_mode')
    raw = event['tool_input']['command'].strip()
    parsed, embedded = tokenize(raw)
    if not canonical or embedded or parsed != [('word', word) for word in canonical] or not re.match(re.escape(canonical[0]) + r'(?:\s|$)', raw):
        fail('Remote approval requires one separately issued canonical executable command.',
             'Issue the reviewed command separately: ' + shlex.join(canonical), 'native-approval')
    if harness == 'claude':
        if mode not in ('default', 'acceptEdits', 'plan') and not publication_trust(repository(Path(event['cwd']))):
            fail('This execution mode cannot supply the required native publication approval.',
                 'Use a trusted Claude permission mode with the shipped ask rules, record standing consent in .rpi/local/publication-trust.json, or have the owner execute the reviewed command.', 'native-approval')
        # Only separately issued literal forms covered by shipped native ask rules.
        supported = canonical and (canonical[0] in ('git', 'gh', 'vercel', 'vc') or
                    canonical[0] in ('npx', 'pnpm') and 'vercel' in canonical)
        if not supported:
            fail('This remote shell wrapper is outside the verified native permission shapes.',
                 'Issue the reviewed publication as a separate canonical command: ' + shlex.join(canonical), 'native-approval')
        return
    # In pinned Codex, default covers on-request/unless-trusted/granular.
    # An applicable prompt rule yields NeedsApproval, or Forbidden when that
    # policy disables prompting. It never becomes Skip. Intended project hook
    # invocation requires the same trusted project layer that loads these rules.
    if not canonical or canonical[0] not in ('git', 'gh', 'vercel', 'vc'):
        fail('This Codex execution mode/command shape lacks a verified native prompt boundary.',
             'Use the trusted project rules and a canonical command in a native approval mode; otherwise the owner executes: ' + shlex.join(canonical), 'native-approval')
    if mode != 'default':
        if not publication_trust(repository(Path(event['cwd']))):
            fail('This Codex execution mode lacks a verified native prompt boundary.',
                 'Use a native approval mode, record standing consent in .rpi/local/publication-trust.json, or have the owner execute: ' + shlex.join(canonical), 'native-approval')
        return
    root = repository(Path(event['cwd']))
    rules = root / '.codex/rules/rpi.rules'
    if any(path.is_symlink() for path in (root / '.codex', root / '.codex/rules', rules)) or not rules.is_file():
        fail('The applicable project native permission rules are missing or redirected.',
             'Review the separate config:codex-hooks and resource:codex-permissions setup, then trust the project layer and exact hook through /hooks.', 'native-approval')
    if shutil.which('codex') is None:
        fail('The native Codex rule evaluator is unavailable.', 'Restore the supported codex executable on PATH and run codex --version.', 'missing-codex')
    version = subprocess.run(['codex', '--version'], capture_output=True, text=True)
    if version.returncode or not re.fullmatch(r'codex-cli 0\.153\.4\s*', version.stdout):
        fail('This Codex client version is outside the verified 0.153.4 native prompt contract.',
             'Run codex --version; use owner-executed publication until this client contract is verified.', 'native-version')
    result = subprocess.run(['codex', 'execpolicy', 'check', '--rules', str(rules), '--', *canonical],
                            capture_output=True, text=True)
    matched = read_json(result.stdout) if result.returncode == 0 else {}
    if not isinstance(matched, dict) or matched.get('decision') != 'prompt':
        fail('Native rules do not require approval for this exact executable shape.',
             'Use a canonical separately reviewed command covered by a trusted prompt rule; do not synthesize approval in a hook.', 'native-approval')


def push(args, cwd, harness, event, canonical):
    forbidden = ('--tags', '--follow-tags', '--all', '--mirror', '--prune', '--delete', '--force', '--force-with-lease', '--force-if-includes', '-f', '-d')
    if any(arg.split('=', 1)[0] in forbidden or arg.startswith('+') for arg in args):
        fail('Broad tag publication, force, deletion and mirror operations are outside the supported release path.', 'Push only the verified integration branch or one explicit named tag after native approval.', 'broad-push')
    values = []
    for arg in args:
        if arg in ('-u', '--set-upstream', '--porcelain', '--dry-run', '-n', '--verbose', '-v', '--quiet', '-q'):
            continue
        if arg.startswith('-'):
            fail('An unsupported push option prevents reliable target classification.', 'Use git push REMOTE BRANCH or git push REMOTE TAG with one explicit ref.', 'push-options')
        values.append(arg)
    root = repository(cwd)
    policy = topology(root)
    branch = git(root, 'symbolic-ref', '--quiet', '--short', 'HEAD', required=False)
    if len(values) != 2:
        fail('Publication requires one explicit remote and literal ref; implicit push configuration is unsupported.', 'Use git push REMOTE REF with the verified integration branch or named tag.', 'push-refspec')
    remote, refspec = values
    if remote != policy['remote'] or git(root, 'remote', 'get-url', '--push', remote, required=False) is None:
        fail('The push remote is not the documented configured publication remote.', 'Inspect git remote -v and use the documented named remote.', 'push-remote')
    if git(root, 'config', '--bool', '--get', 'push.followTags', required=False) == 'true' or git(root, 'config', '--bool', '--get', 'remote.' + remote + '.mirror', required=False) == 'true':
        fail('Git configuration expands publication beyond the explicit ref.', 'Review git config --show-origin --get-regexp "push.followTags|remote.*.mirror" and remove the broad publication setting before review.', 'broad-push')
    if not refspec or refspec.startswith(':') or any(character in refspec for character in ('$', '*', '?', '[', '~', '^', '\\')):
        fail('The publication ref must be explicit and statically resolvable.', 'Use one literal integration branch or named release tag.', 'push-refspec')
    if ':' in refspec:
        source, destination = refspec.split(':', 1)
    else:
        source = destination = refspec
    destination_namespace = 'heads' if destination.startswith('refs/heads/') else 'tags' if destination.startswith('refs/tags/') else None
    destination = destination.removeprefix('refs/heads/')
    if WORKING_BRANCH.match(destination) or WORKING_BRANCH.match(source):
        fail('Working branches must remain local.', 'Complete local integration and all gates, then publish only the integration branch.', 'working-branch')
    tag = destination.removeprefix('refs/tags/')
    is_tag = git(root, 'rev-parse', '--verify', 'refs/tags/' + tag, required=False) is not None
    if is_tag:
        if destination_namespace == 'heads' or source not in (tag, 'refs/tags/' + tag) or not re.fullmatch(r'v?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?', tag):
            fail('Only one existing named release tag is a supported tag publication.', 'Use git push REMOTE vMAJOR.MINOR.PATCH after exact release review.', 'named-tag')
        if git(root, 'cat-file', '-t', 'refs/tags/' + tag) != 'tag':
            fail('Release publication requires an annotated named tag.', 'Create the reviewed annotated release tag with git tag -a VERSION -m MESSAGE.', 'named-tag')
        source_commit = git(root, 'rev-parse', 'refs/tags/' + tag + '^{commit}')
    else:
        if destination != policy['integration_branch'] or branch != policy['integration_branch']:
            fail('Publication must run from the completed documented integration branch.', 'Switch to the integration checkout, complete local gates and obtain native publication approval.', 'integration-target')
        if source not in ('HEAD', branch, 'refs/heads/' + branch):
            fail('The push source differs from the completed integration branch.', 'Use git push ' + remote + ' ' + policy['integration_branch'] + '.', 'integration-source')
        source_commit = git(root, 'rev-parse', source + '^{commit}')
    evidence = verified_candidate(root)
    if source_commit != evidence['commit']:
        fail('The ref being published differs from the verified candidate commit.', 'Verify the exact integration/tag commit before publication.', 'ref-evidence')
    native_boundary(harness, event, canonical)
    return 'publication-requires-native-approval'


def git_command(args, cwd, harness, event, canonical):
    args = list(args)
    while args and args[0].startswith('-'):
        option = args.pop(0)
        if option == '-C' and args:
            cwd = (Path(cwd) / args.pop(0)).resolve()
        elif option.startswith('-C') and len(option) > 2:
            cwd = (Path(cwd) / option[2:]).resolve()
        elif option in ('--no-pager', '--paginate'):
            continue
        else:
            fail('Unsupported Git global options could change the command or repository.', 'Use a literal git -C PATH command without injected aliases/configuration.', 'git-options')
    if not args:
        return None
    command, tail = args[0], args[1:]
    alias = subprocess.run(['git', '-C', str(cwd), 'config', '--get', 'alias.' + command],
                           capture_output=True, text=True)
    if alias.returncode != 1:
        fail('Configured Git aliases or unreadable configuration cannot establish the executed command.',
             'Inspect git config --get ' + shlex.quote('alias.' + command) +
             '; issue the expanded literal command separately for policy and native permission review.', 'git-alias')
    if command == 'pull':
        root = repository(cwd)
        if git(root, 'status', '--porcelain', '--untracked-files=normal'):
            fail('Pulling into a dirty working tree risks established project work.', 'Commit or intentionally preserve your changes, then run git pull --rebase.', 'dirty-pull')
        return 'clean-pull'
    if command == 'push':
        return push(tail, cwd, harness, event, canonical)
    return None


def deployment(args, cwd, harness, event, canonical):
    read_only = {'--help', '-h', '--version', '-v', 'help', 'inspect', 'ls', 'list', 'logs', 'whoami', 'build', 'dev', 'pull'}
    if args and (args[0] in read_only or args[:2] in (['env', 'ls'], ['env', 'list'], ['project', 'ls'], ['teams', 'ls'])):
        return None
    target = None
    for index, arg in enumerate(args):
        if arg.startswith('--target='):
            target = arg.split('=', 1)[1]
        elif arg == '--target':
            if index + 1 >= len(args):
                fail('Missing Vercel target value.', 'Use an explicit supported production deployment command.', 'deployment-target')
            target = args[index + 1]
    if args and args[0] in ('promote', 'rollback'):
        fail('Production promotion/rollback requires a separately reviewed native command.', 'Have the owner review and execute the exact production promotion command.', 'deployment-shape')
    if target is not None and target != 'production' or ('--prod' not in args and target != 'production'):
        fail('Vercel Preview creation, including the bare deploy default, is forbidden.', 'Run local preflight; use a separately authorized explicit production command only.', 'preview')
    if args and args[0] not in ('deploy', '.', '--prod') and not args[0].startswith('--'):
        fail('Unsupported Vercel mutation shape.', 'Use a documented explicit production deployment entry point.', 'deployment-shape')
    root = repository(cwd)
    verified_candidate(root)
    native_boundary(harness, event, canonical)
    return 'production-requires-native-approval'


def issue_create(args, cwd, canonical):
    """Issue creation reports work; it publishes no code and triggers no build.

    It is therefore allowed without candidate verification, but the target stays
    the configured repository and the body stays a reviewed local file.
    """
    options, index = {}, 0
    while index < len(args):
        option = args[index]
        if option in options or option not in ('--title', '--body', '--body-file', '--label', '--assignee'):
            fail('Unsupported or duplicate GitHub issue option.',
                 'Use gh issue create --title TITLE with --body TEXT or --body-file LOCAL_FILE; repository, web and template overrides are unsupported.', 'issue-shape')
        if index + 1 >= len(args) or args[index + 1].startswith('-'):
            fail('A GitHub issue option requires a literal value.',
                 'Provide each option with one literal value, for example --title TITLE.', 'issue-shape')
        options[option] = args[index + 1]
        index += 2
    if '--title' not in options or not options['--title'].strip():
        fail('Issue creation requires one literal title.',
             'Use gh issue create --title TITLE with --body TEXT or --body-file LOCAL_FILE.', 'issue-shape')
    if ('--body' in options) == ('--body-file' in options):
        fail('Issue creation requires exactly one reviewed body source.',
             'Provide either --body TEXT or --body-file LOCAL_FILE, not both and not neither.', 'issue-shape')
    if any(os.environ.get(name) for name in ('GH_REPO', 'GH_HOST')) or any(re.match(r'(?:GH_REPO|GH_HOST)=', word) for word in canonical):
        fail('GitHub repository overrides are outside the supported issue target.',
             'Use the configured repository without GH_REPO/GH_HOST overrides.', 'issue-shape')
    root = repository(cwd)
    if '--body-file' in options:
        body_path = Path(os.path.abspath(Path(cwd) / options['--body-file']))
        body = body_path.resolve()
        redirected = any(path.is_symlink() for path in (body_path, *body_path.parents) if path.is_relative_to(root))
        if redirected or not body.is_relative_to(root) or not body.is_file():
            fail('An issue body file must be an existing local file inside the repository.',
                 'Write the issue body locally and provide its project-relative path.', 'issue-body')
    return 'issue-create'


def github_api(args, cwd, canonical):
    """Allow bounded, repository-local GETs for required alert inventories."""
    endpoint = None
    method_option = None
    seen = set()
    index = 0
    while index < len(args):
        option = args[index]
        if option in ('--paginate', '--include'):
            if option in seen:
                fail('Duplicate GitHub API output option.',
                     'Use each of --paginate and --include at most once.', 'github-api-shape')
            seen.add(option)
            index += 1
        elif option in ('-X', '--method'):
            if method_option is not None or index + 1 >= len(args):
                fail('GitHub API method requires one literal value.',
                     'Use no method flag or one literal --method GET.', 'github-api-shape')
            value = args[index + 1]
            if value != 'GET':
                fail('Only GitHub API GET requests are allowed.',
                     'Use gh api with no method flag or one literal --method GET.', 'github-api-method')
            method_option = option
            index += 2
        elif option == '--jq':
            if option in seen or index + 1 >= len(args):
                fail('GitHub API option requires one literal value.',
                     'Use at most one literal --jq FILTER.', 'github-api-shape')
            value = args[index + 1]
            if not value or any(mark in value for mark in ('$', '`', '\n', '__RPI_DYNAMIC__')):
                fail('GitHub API option value must be literal.',
                     'Use a static GET request and literal jq output filter.', 'github-api-shape')
            seen.add(option)
            index += 2
        elif option.startswith('-'):
            fail('Unsupported GitHub API option.',
                 'Use only --paginate, --include, --method GET and --jq with a required alert endpoint.', 'github-api-shape')
        else:
            if endpoint is not None:
                fail('GitHub API requests require exactly one endpoint.',
                     'Use one repository alert endpoint per command.', 'github-api-shape')
            endpoint = option
            index += 1
    if endpoint is None:
        fail('GitHub API request must be one explicit GET endpoint.',
             'Use one repository alert endpoint with the default method or --method GET.', 'github-api-shape')
    if any(os.environ.get(name) for name in ('GH_REPO', 'GH_HOST')) or any(re.match(r'(?:GH_REPO|GH_HOST)=', word) for word in canonical):
        fail('GitHub API repository overrides are outside the supported read-only target.',
             'Use the configured repository without GH_REPO/GH_HOST overrides.', 'github-api-target')
    root = repository(cwd)
    policy = topology(root)
    remote_url = git(root, 'remote', 'get-url', policy['remote'], required=False)
    match = re.fullmatch(r'(?:https://github\.com/|git@github\.com:)([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+?)(?:\.git)?', remote_url or '')
    if not match:
        fail('The configured remote is not one unambiguous GitHub repository.',
             'Use the documented GitHub remote without a repository override.', 'github-api-target')
    suffixes = ('code-scanning/alerts', 'dependabot/alerts', 'secret-scanning/alerts')
    expected = {f'repos/{match.group(1)}/{suffix}?state=open' for suffix in suffixes}
    if endpoint not in expected:
        fail('GitHub API endpoint is outside the required open-alert inventories.',
             'Query the configured repository code-scanning, Dependabot, or secret-scanning alerts with state=open.', 'github-api-target')
    return None


def release_create(args, cwd, harness, event, canonical):
    if not args or not re.fullmatch(r'v?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?', args[0]):
        fail('Release creation requires one literal named version tag.', 'Use gh release create VERSION --verify-tag --title TITLE --notes-file LOCAL_FILE.', 'release-shape')
    tag, options, index = args[0], {}, 1
    while index < len(args):
        option = args[index]
        if option in options or option not in ('--verify-tag', '--title', '--notes-file'):
            fail('Unsupported or duplicate GitHub release option.', 'Use only --verify-tag, --title and --notes-file; repository/target overrides are unsupported.', 'release-shape')
        if option == '--verify-tag':
            options[option] = True
            index += 1
        else:
            if index + 1 >= len(args) or args[index + 1].startswith('-'):
                fail('A release option requires a literal value.', 'Provide --title TITLE and --notes-file LOCAL_FILE.', 'release-shape')
            options[option] = args[index + 1]
            index += 2
    if set(options) != {'--verify-tag', '--title', '--notes-file'}:
        fail('Release creation requires explicit existing-tag verification, title and local notes.', 'Use gh release create VERSION --verify-tag --title TITLE --notes-file LOCAL_FILE.', 'release-shape')
    if any(os.environ.get(name) for name in ('GH_REPO', 'GH_HOST')) or any(re.match(r'(?:GH_REPO|GH_HOST)=', word) for word in canonical):
        fail('GitHub repository overrides are outside the supported release target.', 'Use the configured publication repository without GH_REPO/GH_HOST overrides.', 'release-shape')
    root = repository(cwd)
    notes_path = Path(os.path.abspath(Path(cwd) / options['--notes-file']))
    notes = notes_path.resolve()
    redirected = any(path.is_symlink() for path in (notes_path, *notes_path.parents) if path.is_relative_to(root))
    if redirected or not notes.is_relative_to(root) or not notes.is_file():
        fail('Release notes must be an existing local file inside the verified repository.', 'Write and review the local release notes, then provide their project-relative path.', 'release-notes')
    policy = topology(root)
    remotes = git(root, 'remote').splitlines()
    fetch_urls = git(root, 'remote', 'get-url', '--all', policy['remote'], required=False)
    push_urls = git(root, 'remote', 'get-url', '--push', '--all', policy['remote'], required=False)
    resolved = git(root, 'config', '--get-regexp', r'^remote\..*\.gh-resolved$', required=False)
    allowed_resolution = 'remote.' + policy['remote'] + '.gh-resolved base'
    if (remotes != [policy['remote']] or not fetch_urls or '\n' in fetch_urls or fetch_urls != push_urls or
            resolved not in (None, allowed_resolution)):
        fail('The GitHub release repository is not one unambiguous documented publication remote.',
             'Review git remote -v and gh repo set-default --view; use an isolated release checkout with one matching fetch/push remote and no divergent gh default.', 'release-remote')
    if git(root, 'symbolic-ref', '--quiet', '--short', 'HEAD', required=False) != policy['integration_branch']:
        fail('Release creation must run from the completed integration checkout.', 'Switch to the documented integration branch and verify the exact release candidate.', 'integration-target')
    if git(root, 'cat-file', '-t', 'refs/tags/' + tag, required=False) != 'tag':
        fail('Release creation requires an existing annotated version tag.', 'Create and review the annotated named tag, then publish that exact verified tag.', 'named-tag')
    evidence = verified_candidate(root)
    if git(root, 'rev-parse', 'refs/tags/' + tag + '^{commit}') != evidence['commit']:
        fail('The release tag differs from the verified candidate commit.', 'Verify the exact annotated release-tag commit before creation.', 'ref-evidence')
    native_boundary(harness, event, canonical)
    return 'release-requires-native-approval'


def strip_quoted_heredocs(command):
    pattern = re.compile(r"(?m)^[ \t]*(?:cat|tee)\b[^\n]*?<<-?(['\"])([A-Za-z_][A-Za-z0-9_]*)\1[^\n]*\n")
    while True:
        match = pattern.search(command)
        if not match:
            return command
        end = re.search(r'(?m)^\t*' + re.escape(match[2]) + r'[ \t]*$', command[match.end():])
        if not end:
            fail('Unterminated quoted here-document in policy-sensitive shell text.')
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
    fail('Unterminated shell substitution prevents safe classification.')


def tokenize(command):
    """Retain operator identity; quoted semicolons/newlines stay literal words."""
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
                fail('Unterminated shell escape.')
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
        if quote != "'" and opener and (opener == '$(' or quote is None):
            end = substitution_end(command, index, opener)
            embedded.append(command[index + len(opener):end])
            word.append('__RPI_DYNAMIC__')
            started, index = True, end + 1
            continue
        if quote != "'" and char == '`':
            end = index + 1
            while end < len(command) and command[end] != '`':
                end += 2 if command[end] == '\\' else 1
            if end >= len(command):
                fail('Unterminated backtick substitution.')
            embedded.append(command[index + 1:end])
            word.append('__RPI_DYNAMIC__')
            started, index = True, end + 1
            continue
        if quote is None and char == '#' and not started:
            end = command.find('\n', index)
            index = len(command) if end < 0 else end
            continue
        if quote is None and char in ' \t\r':
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
        fail('Unterminated quote in policy-sensitive shell text.')
    flush()
    return tokens, embedded


def inspect_command(command, cwd, harness, event, depth=0):
    if depth > 5:
        fail('Nested shell wrappers exceed the supported parser depth.')
    try:
        tokens, embedded = tokenize(command)
    except ValueError as error:
        fail('Malformed policy-sensitive shell syntax: ' + str(error))
    if not embedded and not any(kind == 'word' and POLICY_WORD.search(word) for kind, word in tokens):
        return []
    decisions = []
    for inner in embedded:
        decisions.extend(inspect_command(inner, cwd, harness, event, depth + 1))
    segments, current = [], []
    for kind, token in tokens:
        if kind == 'operator' and token in SEPARATORS:
            if current:
                segments.append(current)
                current = []
        elif kind == 'operator':
            fail('Unsupported compound shell grouping around a policy-sensitive command.')
        else:
            current.append(token)
    if current:
        segments.append(current)
    for words in segments:
        original = list(words)
        while words and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*=.*', words[0]):
            words.pop(0)
        while words and Path(words[0]).name in ('env', 'command', 'exec', 'sudo', 'time'):
            wrapper = Path(words.pop(0)).name
            if wrapper == 'command' and words and words[0] in ('-v', '-V'):
                # Shell lookup describes operands; it does not execute them.
                # Embedded substitutions and subsequent segments are still checked.
                decisions.append('command-lookup')
                words.clear()
                break
            if wrapper == 'env':
                while words and (words[0] in ('-i', '--ignore-environment', '--') or re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*=.*', words[0])):
                    words.pop(0)
            elif words and words[0] == '--':
                words.pop(0)
        if not words:
            continue
        name, args = Path(words[0]).name, words[1:]
        if name in ('echo', 'printf', 'cat', 'rg', 'grep'):
            continue  # Literal argument text is not itself an executable command.
        if name in ('bash', 'sh', 'zsh') and len(args) >= 2 and args[0] in ('-c', '-lc'):
            decisions.extend(inspect_command(args[1], cwd, harness, event, depth + 1))
            continue
        if name == 'eval':
            fail('eval cannot provide a statically reviewable policy-sensitive command.')
        if name in ('npx', 'pnpm', 'npm', 'yarn'):
            if name == 'npx':
                while args and args[0] in ('--yes', '-y', '--no-install', '--'):
                    args = args[1:]
            elif args and args[0] in ('exec', 'dlx'):
                args = args[1:]
            else:
                fail('Package scripts hide policy-sensitive executable expansion.', 'Use a separate literal supported executable command.')
            if not args or Path(args[0]).name not in ('vercel', 'vc'):
                fail('Unsupported package wrapper around a policy-sensitive command.')
            name, args = Path(args[0]).name, args[1:]
        if name == 'cd' and len(args) == 1 and not any(mark in args[0] for mark in ('$', '__RPI_DYNAMIC__')):
            cwd = (Path(cwd) / args[0]).resolve()
            if not cwd.is_dir():
                fail('The chained working directory does not exist.')
            continue
        if name not in ('git', 'gh', 'vercel', 'vc'):
            if any(POLICY_WORD.search(arg) for arg in words):
                fail('Unsupported executable wrapper around a policy-sensitive command.')
            continue
        github_api_request = name == 'gh' and args[:1] == ['api']
        if not github_api_request and any(any(mark in arg for mark in ('$', '`', '\n', '(', ')', '__RPI_DYNAMIC__')) for arg in args):
            fail('Dynamic shell expansion prevents reliable policy-sensitive classification.')
        if name == 'git':
            if any(re.match(r'GIT_[A-Za-z0-9_]*=', word) for word in original):
                fail('Git environment overrides could redirect the inspected repository or publication configuration.',
                     'Use the repository cwd and a literal git command without GIT_* assignments.', 'git-environment')
            decision = git_command(args, cwd, harness, event, original)
        elif name in ('vercel', 'vc'):
            decision = deployment(args, cwd, harness, event, original)
        elif args[:2] in (['pr', 'create'], ['pr', 'merge'], ['workflow', 'run'], ['run', 'rerun']):
            fail('Remote pull-request/build experimentation is forbidden by the local-compute workflow.', 'Complete local integration and use the reviewed publication path only.', 'remote-compute')
        elif args[:2] == ['issue', 'create']:
            decision = issue_create(args[2:], cwd, original)
        elif args[:2] == ['release', 'create']:
            decision = release_create(args[2:], cwd, harness, event, original)
        elif args[:2] in (['release', 'edit'], ['release', 'upload']):
            fail('GitHub release mutations require a separately reviewed owner command; repository/tag/asset options are outside this adapter contract.',
                 'Review the verified annotated tag and exact gh release command with the owner; this hook never supplies consent.', 'release-shape')
        elif github_api_request:
            decision = github_api(args[1:], cwd, original)
        elif name == 'gh':
            readonly = {('run', 'view'), ('run', 'list'), ('run', 'watch'), ('pr', 'view'), ('pr', 'list'), ('pr', 'diff'), ('pr', 'checks'), ('release', 'view'), ('release', 'list'), ('workflow', 'view'), ('workflow', 'list'), ('repo', 'view'), ('auth', 'status'), ('issue', 'list'), ('issue', 'view'), ('issue', 'status'), ('label', 'list')}
            if tuple(args[:2]) not in readonly and args not in (['--version'], ['--help']):
                fail('Unsupported GitHub CLI command may mutate remote state or trigger compute.',
                     'Use a supported read-only gh command, or have the owner review and execute the exact remote action.', 'remote-compute')
            decision = None
        else:
            decision = None
        if decision:
            decisions.append(decision)
    return decisions


def evaluate(event, harness):
    if not isinstance(event, dict):
        fail('Native hook input must be a JSON object.', 'Reinstall the matching native PreToolUse adapter.', 'malformed-event')
    if event.get('tool_name') not in ('Bash',):
        if isinstance(event.get('tool_name'), str) and event['tool_name']:
            return []
        fail('The native event does not identify its tool.', 'Reinstall the matching native PreToolUse adapter.', 'malformed-event')
    if event.get('hook_event_name') != 'PreToolUse' or not isinstance(event.get('tool_input'), dict):
        fail('Malformed guarded PreToolUse event.', 'Reinstall the matching native adapter and verify its stdin schema.', 'malformed-event')
    command = event['tool_input'].get('command')
    cwd = event.get('cwd')
    if not isinstance(command, str) or not command.strip() or not isinstance(cwd, str) or not Path(cwd).is_dir():
        fail('Guarded shell event requires command text and an existing cwd.', 'Verify the native adapter tool_input.command and cwd fields.', 'malformed-event')
    return inspect_command(command, Path(cwd).resolve(), harness, event)


def telemetry(event, harness, decision, rule):
    try:
        root = Path(event.get('cwd', ''))
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--harness', choices=('claude', 'codex'), required=True)
    args = parser.parse_args()
    event = {}
    try:
        event = read_json(sys.stdin.read())
        decisions = evaluate(event, args.harness)
        for rule in decisions:
            telemetry(event, args.harness, 'allow', rule)
        return 0
    except Blocked as error:
        print('BLOCKED / WHY: ' + str(error) + ' / FIX: ' + error.fix, file=sys.stderr)
        if isinstance(event, dict) and event.get('cwd'):
            telemetry(event, args.harness, 'block', error.rule)
        return 2
    except FileNotFoundError as error:
        print('BLOCKED / WHY: policy dependency is missing: ' + str(error.filename) + '. / FIX: run python3 .rpi/scripts/rpi-distribution.py check --target . and restore the declared missing resource through a reviewed update.', file=sys.stderr)
        return 2
    except Exception as error:  # Native clients may fail open on an unhandled non-2 hook exit.
        print('BLOCKED / WHY: policy evaluation failed (' + type(error).__name__ + '). / FIX: verify Python 3, Git and the matching native event/config schema; rerun the local policy tests.', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
