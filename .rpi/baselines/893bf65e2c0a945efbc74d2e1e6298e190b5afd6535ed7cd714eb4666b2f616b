#!/usr/bin/env python3
"""Run the CI-equivalent selection sequentially and bind results to candidate bytes.

Prerequisites: Git, Bash, Python 3, PyYAML, ShellCheck, Node, gh and uv.
Disposable database recipe acceptance is a separate required phase check.
The custom --checks
option supports fixture/regression execution and emits a clearly distinct suite
identity; it can never attest that the full default suite ran.
"""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import shlex
import stat
import subprocess
import sys
import tempfile
import time
import uuid

try:
    _previous_bytecode = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    _spec = importlib.util.spec_from_file_location('rpi_verify_candidate', Path(__file__).resolve().with_name('rpi-candidate.py'))
    _candidate = importlib.util.module_from_spec(_spec)
    _spec.loader.exec_module(_candidate)
except (OSError, ImportError) as error:
    print(f'BLOCKED / WHY: shared candidate helper unavailable: {error} / FIX: restore the complete declared RPI runtime package', file=sys.stderr)
    raise SystemExit(1) from error
finally:
    sys.dont_write_bytecode = _previous_bytecode
environment, identity = _candidate.environment, _candidate.identity


def required_checks(root):
    def unique(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise ValueError('duplicate verification declaration key: ' + key)
            value[key] = item
        return value
    declaration = root / '.rpi/policy.json'
    if declaration.is_symlink():
        raise ValueError('project verification declaration must be a regular file')
    policy = json.loads(declaration.read_text(), object_pairs_hook=unique)
    if not isinstance(policy, dict) or policy.get('schema_version') != 1:
        raise ValueError('declare the complete project CI selection in .rpi/policy.json verification_checks')
    return policy.get('verification_checks')


def safe_output(root, path):
    """Validate a local output without following owner-controlled aliases."""
    path = Path(os.path.abspath(path))
    # Normalize only the caller's root spelling (e.g. macOS /var -> /private/var),
    # preserving descendant components so local symlinks are still rejected.
    for parent in reversed(path.parents):
        if parent.resolve() == root:
            path = root / path.relative_to(parent)
            break
    local = root / '.rpi/local'
    try:
        relative = path.relative_to(local)
    except ValueError as error:
        raise ValueError('evidence must stay inside .rpi/local without escaping symlinks') from error
    if relative == Path('.'):
        raise ValueError('evidence must name a file inside .rpi/local')
    for parent in (root / '.rpi', local, *path.parents):
        if parent == root:
            break
        if parent.is_symlink() or (parent.exists() and not parent.is_dir()):
            raise ValueError('verification output has an unsafe parent: ' + str(parent))
    if path.is_symlink() or (path.exists() and (not path.is_file() or path.stat().st_nlink != 1)):
        raise ValueError('verification output must be a regular, unaliased file: ' + str(path))
    return path


def write_receipt(root, path, report):
    path = safe_output(root, path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent,
                                         prefix='.verification-', suffix='.tmp', delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(json.dumps(report, indent=2) + '\n')
            handle.flush()
            os.fsync(handle.fileno())
        safe_output(root, path)
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


@contextmanager
def attempt_lock(root):
    # This standalone verifier ships with the candidate helper, independently of
    # lifecycle installation. Keep the small POSIX locking boundary self-contained.
    try:
        import fcntl
    except ImportError as error:
        raise ValueError('verification requires POSIX advisory locks; use the tested macOS or Linux runtime') from error
    if not hasattr(os, 'O_NOFOLLOW'):
        raise ValueError('verification requires safe no-follow opens; use the tested macOS or Linux runtime')
    path = safe_output(root, root / '.rpi/local/verification.lock')
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    try:
        node = os.fstat(descriptor)
        if not stat.S_ISREG(node.st_mode) or node.st_nlink != 1 or node.st_size:
            raise ValueError('unsafe verification lock; preserve it and inspect its owner')
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise ValueError('verification is actively locked; wait for the current attempt before retrying') from error
        current = os.stat(path, follow_symlinks=False)
        if ((current.st_dev, current.st_ino) != (node.st_dev, node.st_ino)
                or current.st_nlink != 1 or current.st_size):
            raise ValueError('verification lock changed during acquisition; inspect concurrent writers')
        yield
    finally:
        # Persistent inode prevents split locks; process death also releases it.
        os.close(descriptor)


def run(root, checks, evidence, suite):
    root = root.resolve()
    evidence = safe_output(root, evidence)
    authoritative = safe_output(root, root / '.rpi/local/verification.json')
    if evidence == root / '.rpi/local/verification.lock':
        raise ValueError('evidence cannot replace the verification lock')
    if not isinstance(checks, list) or not checks:
        raise ValueError("required check inventory is empty or invalid")
    names = set()
    for check in checks:
        if (not isinstance(check, dict) or not isinstance(check.get("name"), str)
                or not check["name"] or check["name"] in names
                or not isinstance(check.get("argv"), list) or not check["argv"]
                or any(not isinstance(arg, str) or not arg for arg in check["argv"])):
            raise ValueError("checks require unique names and nonempty argv arrays")
        names.add(check["name"])
    with attempt_lock(root):
        attempt = {'schema_version': 1, 'suite': suite, 'attempt_id': uuid.uuid4().hex,
                   'status': 'running', 'passed': False, 'checks': [],
                   'started_at': datetime.now(timezone.utc).isoformat()}
        # Supersede historical success before executing any check. A killed
        # attempt leaves this durable non-success state, including custom output.
        write_receipt(root, authoritative, attempt)
        try:
            if evidence != authoritative:
                write_receipt(root, evidence, attempt)
            return execute_checks(root, checks, evidence, authoritative, attempt)
        except BaseException as error:
            failed = {**attempt, 'status': 'failed', 'error_type': type(error).__name__,
                      'recorded_at': datetime.now(timezone.utc).isoformat()}
            write_receipt(root, authoritative, failed)
            raise


def execute_checks(root, checks, evidence, authoritative, attempt):
    rerun = shlex.join([sys.executable, str(Path(__file__).resolve()), '--root', str(root)])
    before = identity(root)
    runtime_before = environment()
    results = []
    for check in checks:
        print(f"\nCHECK {check['name']}", flush=True)
        started = time.monotonic()
        try:
            completed = subprocess.run(check["argv"], cwd=root, check=False)
            code = completed.returncode
        except OSError as error:
            print(f"BLOCKED / WHY: {error} / FIX: restore the declared executable and rerun {rerun}", file=sys.stderr)
            code = 127
        results.append({**check, "exit_code": code,
                        "duration_seconds": round(time.monotonic() - started, 3)})
    after = identity(root)
    runtime_after = environment()
    unchanged = before == after
    runtime_unchanged = runtime_before == runtime_after
    passed = unchanged and runtime_unchanged and len(results) == len(checks) and all(c["exit_code"] == 0 for c in results)
    report = {**attempt, 'status': 'complete' if passed else 'failed', "identity": before,
              "identity_after": after, "identity_unchanged": unchanged,
              "environment": runtime_before, "environment_after": runtime_after,
              "environment_unchanged": runtime_unchanged,
              "recorded_at": datetime.now(timezone.utc).isoformat(),
              "checks": results, "passed": passed,
              "scope": "Portable CI selection; excludes separately required live-harness and disposable database acceptance"}
    write_receipt(root, evidence, report)
    if evidence != authoritative:
        write_receipt(root, authoritative, report)
    if not unchanged:
        print(f"BLOCKED / WHY: candidate inputs changed during verification / FIX: {rerun}", file=sys.stderr)
    if not runtime_unchanged:
        print(f"BLOCKED / WHY: verification runtime changed during checks / FIX: {rerun}", file=sys.stderr)
    print(f"{'PASS' if passed else 'FAIL'}: {len(results)} checks; evidence: {evidence}")
    return 0 if passed else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--checks", type=Path, help="custom JSON check array (not a full-gate attestation)")
    parser.add_argument("--evidence", type=Path)
    args = parser.parse_args()
    root = args.root.resolve()
    evidence = args.evidence or root / ".rpi/local/verification.json"
    try:
        if sys.version_info < (3, 11):
            raise ValueError('verification requires Python 3.11 or newer')
        checks = json.loads(args.checks.read_text()) if args.checks else required_checks(root)
        return run(root, checks, evidence, "custom" if args.checks else "ci-equivalent")
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        rerun = shlex.join([sys.executable, str(Path(__file__).resolve()), '--root', str(root)])
        print(f"BLOCKED / WHY: {error} / FIX: review .rpi/policy.json verification_checks and the Git candidate, then run {rerun}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
