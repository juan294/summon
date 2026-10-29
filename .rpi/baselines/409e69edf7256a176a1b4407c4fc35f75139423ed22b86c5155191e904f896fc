"""Entry-level native configuration reconciliation; never owns an entire settings file.

Pointers traverse object keys. `entry` owns one exact array member; `value` owns
one scalar leaf. Caller stores only these public, template-derived records in
baselines. Existing secrets and unrelated entries never enter ownership records.
Adding/changing capabilities needs an explicit setup scope supplied by the caller.
Removing a boundary likewise needs setup scope, or an explicitly selected detach.
"""
import copy
import json

MISSING = object()


def fingerprint(value):
    return json.dumps(value, sort_keys=True, allow_nan=False)


def same(first, second):
    return first is not MISSING and second is not MISSING and fingerprint(first) == fingerprint(second)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate native configuration key: ' + key)
        result[key] = value
    return result


def invalid_constant(value):
    raise ValueError('non-finite JSON constant: ' + value)


def validate_records(records):
    if not isinstance(records, list):
        raise ValueError('configuration ownership must be a list')
    identities, slots = set(), set()
    for record in records:
        if not isinstance(record, dict) or set(record) - {'id', 'pointer', 'mode', 'value', 'retain_on_remove'}:
            raise ValueError('invalid configuration ownership record')
        identity, pointer, mode = record.get('id'), record.get('pointer'), record.get('mode')
        if not isinstance(identity, str) or not identity or identity in identities:
            raise ValueError('duplicate or invalid configuration identity')
        if not isinstance(pointer, list) or not pointer or any(not isinstance(key, str) or not key for key in pointer):
            raise ValueError('configuration pointer requires explicit object keys')
        if mode not in ('entry', 'value') or 'value' not in record:
            raise ValueError('configuration ownership requires entry/value mode and value')
        if mode == 'value' and isinstance(record['value'], (dict, list)):
            raise ValueError('whole configuration objects cannot be owned scalar values')
        if 'retain_on_remove' in record and not isinstance(record['retain_on_remove'], bool):
            raise ValueError('retain_on_remove must be boolean')
        token = fingerprint(record['value'])
        slot = (tuple(pointer), mode, token if mode == 'entry' else '')
        if slot in slots:
            raise ValueError('duplicate configuration ownership slot')
        identities.add(identity)
        slots.add(slot)
    return {record['id']: record for record in records}


def leaf(document, pointer, create=False):
    current = document
    for key in pointer[:-1]:
        if key not in current:
            if not create:
                return None, pointer[-1]
            current[key] = {}
        current = current[key]
        if not isinstance(current, dict):
            raise ValueError('configuration pointer crosses a non-object')
    return current, pointer[-1]


def read(document, record):
    parent, key = leaf(document, record['pointer'])
    value = parent.get(key, MISSING) if parent is not None else MISSING
    if record['mode'] == 'entry' and value is not MISSING and not isinstance(value, list):
        raise ValueError('owned configuration entry requires a native array')
    if record['mode'] == 'value' and value is not MISSING and isinstance(value, (dict, list)):
        raise ValueError('owned scalar points to an existing object/array')
    return value


def reconcile(local, previous_records, desired_records, allow_capabilities=False, allow_removal=False):
    if not isinstance(allow_capabilities, bool) or not isinstance(allow_removal, bool):
        raise ValueError('capability setup scope must be an explicit boolean')
    previous, desired = validate_records(previous_records), validate_records(desired_records)
    document = json.loads(local, object_pairs_hook=unique_object,
                          parse_constant=invalid_constant) if local is not None else {}
    if not isinstance(document, dict):
        raise ValueError('native settings must be a JSON object')
    original = copy.deepcopy(document)
    entries, conflicts, retained = [], [], []
    for identity in sorted(set(previous) | set(desired)):
        old, new = previous.get(identity), desired.get(identity)
        record = new or old
        if old and new and (old['pointer'] != new['pointer'] or old['mode'] != new['mode']):
            conflicts.append({'id': identity, 'reason': 'ownership pointer/mode changed; remove then add in separate reviewed setup'})
            continue
        value = read(document, record)
        array = record['mode'] == 'entry'
        old_indices = [i for i, item in enumerate(value) if old and same(item, old['value'])] if array and value is not MISSING else []
        if len(old_indices) > 1:
            conflicts.append({'id': identity, 'reason': 'duplicate native entries make exact ownership ambiguous'})
            continue
        old_present = old is not None and (bool(old_indices) if array else same(value, old['value']))
        new_present = new is not None and (value is not MISSING and (any(same(item, new['value']) for item in value) if array else same(value, new['value'])))
        if not new:
            if old.get('retain_on_remove') or not old_present:
                retained.append({'id': identity, 'reason': 'existing explicit opt-in or modified entry remains project-owned'})
                continue
            if not (allow_capabilities or allow_removal):
                conflicts.append({'id': identity, 'reason': 'removing a native boundary requires setup or detach scope'})
                continue
            parent, key = leaf(document, old['pointer'])
            if array:
                del parent[key][old_indices[0]]
            else:
                del parent[key]
            continue
        if not old and new_present:
            retained.append({'id': identity, 'reason': 'matching existing entry is project-owned'})
            continue
        if old and not old_present:
            if same(old['value'], new['value']):
                entries.append(copy.deepcopy(new))
                retained.append({'id': identity, 'reason': 'local-only changed or missing entry retained'})
            else:
                conflicts.append({'id': identity, 'reason': 'local and template both changed an owned entry'})
            continue
        changing = not old or not same(old['value'], new['value'])
        if changing and old and array and new_present:
            conflicts.append({'id': identity, 'reason': 'new value already exists without this ownership; reconcile duplicate identity explicitly'})
            continue
        if changing and not allow_capabilities:
            conflicts.append({'id': identity, 'reason': 'capability addition/change requires explicit setup scope'})
            continue
        if changing:
            if not array and value is not MISSING and not old:
                conflicts.append({'id': identity, 'reason': 'unowned scalar would be overwritten'})
                continue
            parent, key = leaf(document, new['pointer'], create=True)
            if array:
                if key not in parent:
                    parent[key] = []
                if old_present:
                    parent[key][old_indices[0]] = copy.deepcopy(new['value'])
                else:
                    parent[key].append(copy.deepcopy(new['value']))
            else:
                parent[key] = copy.deepcopy(new['value'])
        entries.append(copy.deepcopy(new))
    if conflicts:
        return {'content': local, 'entries': copy.deepcopy(previous_records), 'conflicts': conflicts, 'retained': retained}
    content = local if same(document, original) else (json.dumps(document, indent=2, ensure_ascii=False, allow_nan=False) + '\n').encode()
    return {'content': content, 'entries': entries, 'conflicts': [], 'retained': retained}
