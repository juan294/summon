#!/usr/bin/env python3
"""Validate a completed bounded-assignment handoff; never launch or authorize work.

Usage: rpi-dispatch.py handoff.json [--report findings.md]
       [--current-candidate ID]
See the bundled references/dispatch.md for schema and evidence limitations.
"""
import argparse
import importlib.util
import json
from pathlib import Path, PurePosixPath
import sys

CORE_DOMAINS = ('AR', 'FE', 'BE', 'PE', 'DO', 'SE', 'QA', 'UX')
DOMAINS = set(CORE_DOMAINS) | {'AS'}
PHASES = {'research', 'assess', 'plan', 'implement', 'pre-launch', 'remediate',
          'simplify', 'update-docs', 'release', 'validate'}


def nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def strings(value, required=False):
    return isinstance(value, list) and (not required or bool(value)) and all(nonempty(item) for item in value)


def in_scope(path, scopes):
    """Literal repo-relative paths, with a trailing slash for a directory."""
    if not nonempty(path) or '\\' in path or PurePosixPath(path).is_absolute() or '..' in path.split('/'):
        return False
    return any(path == scope or (scope.endswith('/') and path.startswith(scope)) for scope in scopes)


def finding_module():
    previous = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        spec = importlib.util.spec_from_file_location('rpi_findings', Path(__file__).with_name('validate-findings.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        sys.dont_write_bytecode = previous


def validate(document, *, report_text=None, current_candidate=None):
    """Return all structural acceptance gaps. Supplied claims are not proof or consent."""
    if not isinstance(document, dict):
        return ['handoff must be an object']
    errors = []
    if type(document.get('schema_version')) is not int or document['schema_version'] != 1:
        errors.append('schema_version must be 1')
    for field in ('objective', 'candidate'):
        if not nonempty(document.get(field)):
            errors.append(f'{field} is required')
    phase, candidate = document.get('phase'), document.get('candidate')
    approved = document.get('approved_phases')
    if not strings(approved, True) or not set(approved) <= PHASES:
        errors.append('approved_phases must contain known phases')
        approved = []
    if not isinstance(phase, str) or phase not in PHASES or phase not in approved:
        errors.append('phase is not approved')
    if document.get('next_phase') is not None and document['next_phase'] not in approved:
        errors.append('next_phase is not approved; stop for acceptance')
    if current_candidate is not None and current_candidate != candidate:
        errors.append('resume candidate mismatch; revalidate actual state and invalidated evidence')
    if 'behavioral_change' in document and type(document['behavioral_change']) is not bool:
        errors.append('behavioral_change must be boolean')
    limit = document.get('resource_limit')
    if type(limit) is not int or not 1 <= limit <= 3:
        errors.append('resource_limit must be the effective implementer limit, 1..3')
        limit = 1

    assignments, results = document.get('assignments'), document.get('results')
    if not isinstance(assignments, list) or not assignments or not all(isinstance(item, dict) for item in assignments):
        return errors + ['assignments must be a nonempty object list (parent-only is valid)']
    if not isinstance(results, list) or not all(isinstance(item, dict) for item in results):
        return errors + ['results must be an object list']
    indexed, implementers, groups = {}, set(), {}
    for item in assignments:
        identifier = item.get('id')
        if not nonempty(identifier):
            errors.append('assignment id is required')
            continue
        if identifier in indexed:
            errors.append(f'duplicate assignment: {identifier}')
        indexed[identifier] = item
        for field in ('owner', 'objective', 'evidence_contract', 'resource_constraints', 'completion_condition', 'concurrency_group'):
            if not nonempty(item.get(field)):
                errors.append(f'{identifier}: {field} is required')
        for field in ('allowed_actions', 'allowed_files', 'domains', 'root_causes'):
            if not strings(item.get(field), field.startswith('allowed_')):
                errors.append(f'{identifier}: {field} must be a string list')
        if strings(item.get('domains')) and not set(item['domains']) <= DOMAINS:
            errors.append(f'{identifier}: unknown domains')
        role = item.get('role')
        if role not in ('investigator', 'implementer', 'reviewer'):
            errors.append(f'{identifier}: unknown role')
        if role == 'implementer':
            if nonempty(item.get('owner')):
                implementers.add(item['owner'])
            group = item.get('concurrency_group')
            if nonempty(group) and nonempty(item.get('owner')):
                groups.setdefault(group, set()).add(item['owner'])
    for group, owners in groups.items():
        count = len(owners)
        if count > limit:
            errors.append(f'{group}: simultaneous implementer limit exceeded ({count}>{limit})')

    successful, seen, coverage, changed_files = set(), set(), set(), set()
    for item in results:
        identifier = item.get('assignment_id')
        if not nonempty(identifier) or identifier not in indexed:
            errors.append('result has unknown assignment')
            continue
        if identifier in seen:
            errors.append(f'duplicate result: {identifier}')
        seen.add(identifier)
        assignment = indexed[identifier]
        before = len(errors)
        if item.get('status') != 'complete':
            errors.append(f'{identifier}: required result failed or incomplete')
        if item.get('candidate') != candidate:
            errors.append(f'{identifier}: stale result candidate')
        if not strings(item.get('evidence'), True):
            errors.append(f'{identifier}: result evidence is required')
        for field in ('domains', 'root_causes', 'actions', 'changed_files'):
            if not strings(item.get(field)):
                errors.append(f'{identifier}: result {field} must be a string list')
        for field, allowed, label in (('domains', 'domains', 'unassigned domains'),
                                      ('root_causes', 'root_causes', 'unassigned root causes'),
                                      ('actions', 'allowed_actions', 'unpermitted actions')):
            if strings(item.get(field)) and strings(assignment.get(allowed)) and not set(item[field]) <= set(assignment[allowed]):
                errors.append(f'{identifier}: {label}')
        if strings(item.get('root_causes')) and strings(assignment.get('root_causes')):
            if set(assignment['root_causes']) - set(item['root_causes']):
                errors.append(f'{identifier}: root cause gap')
        if strings(item.get('domains')) and strings(assignment.get('domains')):
            if set(assignment['domains']) - set(item['domains']):
                errors.append(f'{identifier}: domain gap')
        if strings(item.get('changed_files')) and strings(assignment.get('allowed_files')):
            for path in item['changed_files']:
                if not in_scope(path, assignment['allowed_files']):
                    errors.append(f'{identifier}: unpermitted changed file: {path}')
            if item['changed_files'] and (not strings(item.get('actions')) or 'write' not in item['actions']):
                errors.append(f'{identifier}: changed files require a declared write action')
        if len(errors) == before:
            successful.add(identifier)
            coverage.update(item['domains'])
            changed_files.update(item['changed_files'])
    for identifier in indexed.keys() - seen:
        errors.append(f'{identifier}: missing required result')
    if phase in ('implement', 'remediate'):
        if not any(item['id'] in successful and item.get('role') == 'reviewer'
                   and nonempty(item.get('owner')) and item['owner'] not in implementers
                   for item in assignments if nonempty(item.get('id'))):
            errors.append('completed independent review is required')

    finding_ids = set()
    findings = finding_module() if report_text is not None or 'findings' in document else None
    if report_text is not None:
        errors.extend(f'{label}: {reason}' for label, reason in findings.validate_text(report_text))
        finding_ids = {block.first_token for block in findings.parse_blocks(report_text)
                       if findings.ID_VALID.fullmatch(block.first_token)}
    if 'audit' in document or phase == 'pre-launch':
        if any(strings(item.get('allowed_actions')) and not set(item['allowed_actions']) <= {'read', 'check'}
               for item in assignments):
            errors.append('audit assignments must be read-only (read/check actions)')
        audit = document.get('audit')
        surface = audit.get('agent_surface') if isinstance(audit, dict) else None
        required = set(CORE_DOMAINS)
        if not isinstance(surface, dict) or type(surface.get('applicable')) is not bool:
            errors.append('audit.agent_surface.applicable must be boolean')
        else:
            if not strings(surface.get('evidence'), True):
                errors.append('audit.agent_surface.evidence is required')
            if surface['applicable']:
                required.add('AS')
            elif 'AS' in coverage or any(identifier.startswith('AS-') for identifier in finding_ids):
                errors.append('AS findings without applicable coverage')
        errors.extend(f'coverage gap: {domain}' for domain in sorted(required - coverage))
        if report_text is None:
            errors.append('audit requires --report for finding ID/ref validation')
    if 'findings' in document or (phase in ('implement', 'remediate') and finding_ids):
        dispositions = document.get('findings')
        if not isinstance(dispositions, list) or not all(isinstance(item, dict) for item in dispositions):
            errors.append('findings must be an object list')
        else:
            disposed = set()
            grammar = findings.ID_VALID
            for item in dispositions:
                identifier = item.get('id')
                if not nonempty(identifier) or not grammar.fullmatch(identifier) or identifier in disposed:
                    errors.append('invalid or duplicate disposition Finding-ID')
                    continue
                disposed.add(identifier)
                if item.get('disposition') not in ('resolved', 'rejected', 'architectural_exception'):
                    errors.append(f'{identifier}: unresolved finding')
                if not strings(item.get('evidence'), True):
                    errors.append(f'{identifier}: disposition evidence is required')
                if item.get('disposition') == 'architectural_exception' and not nonempty(item.get('owner_review')):
                    errors.append(f'{identifier}: architectural exception requires owner_review')
            if report_text is not None and disposed != finding_ids:
                errors.append('finding disposition gap: report IDs and dispositions differ')
    validate_acceptance(document, errors, changed_files)
    return errors


def validate_acceptance(document, errors, changed_files):
    """Check applicable recorded acceptance evidence, without inventing authorization."""
    if document.get('behavioral_change') is True:
        tdd = document.get('tdd')
        red = tdd.get('red') if isinstance(tdd, dict) else None
        green = tdd.get('green') if isinstance(tdd, dict) else None
        valid = (isinstance(red, dict) and isinstance(green, dict) and nonempty(tdd.get('regression'))
                 and type(red.get('sequence')) is int and type(green.get('sequence')) is int
                 and 0 <= red['sequence'] < green['sequence']
                 and nonempty(red.get('evidence')) and nonempty(green.get('evidence'))
                 and green.get('candidate') == document.get('candidate'))
        if not valid:
            errors.append('TDD requires the named regression, RED before GREEN, evidence and current GREEN candidate')
    if document.get('phase') == 'simplify':
        simplify = document.get('simplify')
        if not isinstance(simplify, dict) or simplify.get('mode') not in ('parent', 'standalone'):
            errors.append('simplify requires mode parent or standalone')
        else:
            for field in ('changed_files', 'invalidated_checks'):
                if not strings(simplify.get(field)):
                    errors.append(f'simplify.{field} must be a string list')
            if strings(simplify.get('changed_files')) and set(simplify['changed_files']) != changed_files:
                errors.append('simplify changed scope must match successful scoped result changed_files')
            checks = simplify.get('checks')
            if not isinstance(checks, list) or not all(isinstance(item, dict) for item in checks):
                errors.append('simplify.checks must be an object list')
            elif simplify['mode'] == 'standalone' and strings(simplify.get('invalidated_checks')):
                valid_checks = {item['id'] for item in checks if nonempty(item.get('id'))
                                and item.get('status') == 'pass' and item.get('candidate') == document.get('candidate')
                                and strings(item.get('evidence'), True)}
                errors.extend(f'invalidated check: {name}' for name in simplify['invalidated_checks'] if name not in valid_checks)
    context, decisions = document.get('context', {}), document.get('decisions_requested', [])
    if not isinstance(context, dict) or not strings(decisions):
        errors.append('context must be an object and decisions_requested a string list')
    else:
        if nonempty(context.get('supplied_version')) and 'release_version' in decisions:
            errors.append('release_version already supplied; reuse it')
        if context.get('docs_authorized') is True and 'docs_authorization' in decisions:
            errors.append('docs_authorization already supplied; reuse it within scope')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('handoff', type=Path)
    parser.add_argument('--report', type=Path)
    parser.add_argument('--current-candidate', help='freshly measured identity; mismatch invalidates resumed handoff')
    args = parser.parse_args()
    try:
        document = json.loads(args.handoff.read_text(encoding='utf-8'))
        report = args.report.read_text(encoding='utf-8') if args.report else None
        errors = validate(document, report_text=report, current_candidate=args.current_candidate)
    except (OSError, ValueError) as error:
        print(f'BLOCKED / WHY: cannot read handoff contract: {error} / FIX: provide readable valid JSON/report paths', file=sys.stderr)
        return 2
    if errors:
        for error in errors:
            print(f'BLOCKED / WHY: {error} / FIX: repair the handoff or complete the missing work, then rerun this command', file=sys.stderr)
        return 1
    print('OK: supplied handoff is structurally complete; evidence and authorization still require parent verification')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
