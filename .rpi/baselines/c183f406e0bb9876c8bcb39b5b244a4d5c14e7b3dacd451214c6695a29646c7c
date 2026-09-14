#!/usr/bin/env python3
"""Read-only model request/profile descriptions and session-bound diagnostics.

No client launch, network lookup, global configuration write, or automatic model
selection runs here. Observation envelopes must come from a caller's captured
native event and include source, client_version, session_id, observed_at (timezone
required), and data. This validates binding/freshness and filters supported fields;
it does not authenticate a caller's capture or grant any permission. Never discover
an observation by taking the newest rollout file or an unrelated pane's cache.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

CATALOG = Path(__file__).resolve().parents[1] / 'adapters/model-profiles.json'
EFFORTS = {'low', 'medium', 'high', 'xhigh', 'max', 'ultra'}


def load_catalog(path=CATALOG):
    value = json.loads(Path(path).read_text())
    if not isinstance(value, dict) or value.get('schema_version') != 1 or value.get('default_policy') != 'inherit':
        raise ValueError('unsupported model profile descriptor')
    clients = value.get('clients')
    if not isinstance(clients, dict) or any(not isinstance(client, dict) for client in clients.values()):
        raise ValueError('model profile clients must be a mapping of client records')
    return value


def supported_efforts(harness):
    return EFFORTS - {'ultra'} if harness == 'claude' else EFFORTS


def select_profile(harness, role, policy='inherit', explicit=None, mechanical=False,
                   catalog=None, client_version=None):
    if harness not in ('claude', 'codex') or policy not in ('inherit', 'economy'):
        raise ValueError('unsupported harness or model policy')
    if not isinstance(role, str) or not role.strip():
        raise ValueError('requested role must be nonempty')
    if catalog is None:
        catalog = load_catalog()
    client = catalog.get('clients', {}).get(harness, {})
    compatible = client_version is None or client_version == client.get('version')
    capabilities = client.get('capabilities', {}) if compatible else {}
    selected = {}
    source = 'session inheritance'
    if explicit and any(explicit.get(key) is not None for key in ('model', 'effort')):
        # A partial explicit request stays partial. Do not fill its omitted
        # model/effort from a cheaper profile behind the owner's selection.
        selected = {key: explicit[key] for key in ('model', 'effort') if explicit.get(key) is not None}
        source = explicit.get('source', 'explicit user selection')
    elif policy == 'economy':
        if not mechanical or role not in catalog.get('mechanical_roles', []):
            raise ValueError('economy requires an explicitly mechanical status-summary, formatting or locator task')
        if not client or not compatible:
            raise ValueError('economy client capability unavailable; inherit or provide an explicit selection')
        selected = dict(client['economy'])
        source = 'explicit economy profile'
    if set(selected) - {'model', 'effort'}:
        raise ValueError('model profile may contain only model and effort controls')
    for key, value in selected.items():
        if not isinstance(value, str) or not value or '\n' in value:
            raise ValueError('model and effort requests must be nonempty single-line strings')
    effort = selected.get('effort')
    if effort is not None and effort not in supported_efforts(harness):
        raise ValueError('unsupported effort request; use a native supported level or omit it to inherit')
    known = capabilities.get(selected.get('model'))
    if known is not None and effort is not None and effort not in known['efforts']:
        raise ValueError('effort is unsupported by this model/client snapshot; omit unsupported effort')
    fields = {'model_reasoning_effort' if harness == 'codex' and key == 'effort' else key: value
              for key, value in selected.items()}
    return {'source': source, 'fields': fields, 'application': 'separate explicit session/profile',
            'capability_status': 'dated snapshot' if known is not None else 'unverified'}


def timestamp(value):
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('observation timestamp requires a timezone')
    return parsed


def native_values(harness, observation, session_id):
    """Extract only fields actually supplied by the named native event shape."""
    data = observation.get('data')
    if not isinstance(data, dict):
        return None, None
    source = observation.get('source')
    if harness == 'codex' and source == 'codex.turn_context':
        if data.get('type') == 'turn_context' and isinstance(data.get('payload'), dict):
            return data['payload'].get('model'), data['payload'].get('effort')
    elif harness == 'codex' and source == 'codex.thread.start':
        if isinstance(data.get('thread'), dict) and data['thread'].get('id') == session_id:
            return data.get('model'), data.get('reasoningEffort')
    elif harness == 'claude' and source == 'claude.system.init':
        if data.get('type') == 'system' and data.get('subtype') == 'init' and data.get('session_id') == session_id:
            return data.get('model'), None
    elif harness == 'claude' and source == 'claude.assistant':
        if data.get('type') == 'assistant' and data.get('session_id') == session_id and isinstance(data.get('message'), dict):
            return data['message'].get('model'), None
    elif harness == 'claude' and source == 'claude.CLAUDE_EFFORT':
        return None, data.get('CLAUDE_EFFORT')
    return None, None


def diagnose(harness, role, client_version, selection=None, observation=None,
             session_id=None, now=None, max_age=300):
    if max_age <= 0:
        raise ValueError('observation max age must be positive')
    selection = selection or select_profile(harness, role, client_version=client_version)
    result = {'requested_role': role, 'requested_model_effort_source': selection,
              'resolved_model_effort': {'model': None, 'effort': None, 'status': 'unavailable',
                                       'reason': 'no session-bound native observation'},
              'evidence_source_client_version': {'source': None, 'client_version': client_version}}
    if not isinstance(observation, dict):
        return result
    evidence = result['evidence_source_client_version']
    evidence['source'] = observation.get('source') if isinstance(observation.get('source'), str) else None
    resolved = result['resolved_model_effort']
    if not session_id or observation.get('session_id') != session_id:
        resolved['reason'] = 'missing or mismatched session binding'
        return result
    if observation.get('client_version') != client_version:
        resolved['reason'] = 'mismatched client version'
        return result
    try:
        current = timestamp(now) if now is not None else datetime.now(timezone.utc)
        age = (current - timestamp(observation['observed_at'])).total_seconds()
    except (KeyError, TypeError, ValueError, AttributeError):
        resolved['reason'] = 'invalid observation timestamp'
        return result
    if not 0 <= age <= max_age:
        resolved['reason'] = 'stale or future observation'
        return result
    model, effort = native_values(harness, observation, session_id)
    model = model if isinstance(model, str) and model.strip() and '\n' not in model else None
    allowed_efforts = supported_efforts(harness)
    effort = effort if isinstance(effort, str) and effort in allowed_efforts else None
    if model is None and effort is None:
        resolved['reason'] = 'unsupported or empty native observation'
        return result
    resolved.update(model=model, effort=effort, status='observed', reason=None)
    evidence.update(session_id=session_id, observed_at=observation['observed_at'])
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--harness', choices=('claude', 'codex'), required=True)
    parser.add_argument('--role', required=True)
    parser.add_argument('--client-version', required=True)
    parser.add_argument('--policy', choices=('inherit', 'economy'), default='inherit')
    parser.add_argument('--mechanical', action='store_true')
    parser.add_argument('--model')
    parser.add_argument('--effort')
    parser.add_argument('--request-source', default='explicit user selection')
    parser.add_argument('--catalog', type=Path, default=CATALOG)
    parser.add_argument('--session-id')
    parser.add_argument('--observation', type=Path)
    parser.add_argument('--max-age', type=int, default=300)
    parser.add_argument('--now', help='explicit diagnostic clock in timezone-qualified ISO 8601')
    args = parser.parse_args()
    try:
        try:
            catalog = load_catalog(args.catalog)
        except OSError:
            catalog = {}  # Offline metadata never changes an explicit owner request.
        selected = select_profile(args.harness, args.role, args.policy,
            {'model': args.model, 'effort': args.effort, 'source': args.request_source},
            args.mechanical, catalog, args.client_version)
        observation = json.loads(args.observation.read_text()) if args.observation else None
        print(json.dumps(diagnose(args.harness, args.role, args.client_version, selected,
            observation, args.session_id, args.now, args.max_age), sort_keys=True))
        return 0
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f'BLOCKED / WHY: {error} / FIX: provide supported explicit model/effort or omit overrides; '
              'rerun python3 templates/scripts/rpi-models.py --help', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
