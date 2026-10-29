"""Publishable working candidate inventory shared by local verification tools."""
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys


def environment(environ=None):
    """Fingerprint the gate runtime without executing tools or recording secrets.

    Executable metadata detects tool replacement; it is not an attestation of
    every machine setting. Locale, timezone and Python execution settings bind
    environment-sensitive checks; only their digest is recorded. Project-specific
    external inputs remain the declared check's responsibility. Package versions
    belong to this Python interpreter.
    """
    environ = os.environ if environ is None else environ
    executables = {}
    for name in ("python3", "git", "bash", "shellcheck", "node", "gh", "uv", "openssl", "curl"):
        found = shutil.which(name, path=environ.get("PATH", os.defpath))
        if found is None:
            executables[name] = None
            continue
        path = Path(found).resolve()
        stat = path.stat()
        executables[name] = {"path": str(path), "size": stat.st_size,
                             "mtime_ns": stat.st_mtime_ns}
    packages = {}
    for name in ("coverage", "PyYAML", "uv"):
        try:
            packages[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            packages[name] = None
    system = os.uname() if hasattr(os, 'uname') else None
    platform_id = ("-".join((system.sysname, system.release, system.version, system.machine))
                   if system else sys.platform + '-' + os.name)
    settings = {name: environ[name] for name in sorted(environ)
                if name.startswith('LC_') or name in (
                    'LANG', 'LANGUAGE', 'TZ', 'PYTHONUTF8', 'PYTHONIOENCODING',
                    'PYTHONCOERCECLOCALE', 'PYTHONHASHSEED')}
    return {"python": platform.python_version(),
            "implementation": platform.python_implementation(),
            "executable": str(Path(sys.executable).absolute()),
            "platform": platform_id, "packages": packages,
            "executables": executables,
            "execution_settings_sha256": hashlib.sha256(
                json.dumps(settings, sort_keys=True, ensure_ascii=True).encode()).hexdigest()}


def inventory(root, extra=()):
    output = subprocess.check_output(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        cwd=root)
    paths = {Path(os.fsdecode(name)) for name in output.split(b"\0") if name}
    paths.update(Path(name) for name in extra)
    for path in paths:
        if path.is_absolute() or ".." in path.parts:
            raise ValueError("candidate path must be repository-relative: " + str(path))
    return sorted(path for path in paths
                  if not str(path).startswith(".rpi/local/")
                  and "__pycache__" not in path.parts)


def identity(root, excluded=()):
    digest = hashlib.sha256()
    paths = [p for p in inventory(root) if (root / p).absolute() not in excluded]
    if not paths:
        raise ValueError("candidate inventory is empty")
    for path in paths:
        full = root / path
        digest.update(os.fsencode(path) + b"\0")
        if full.is_symlink():
            digest.update(b"symlink\0" + os.fsencode(os.readlink(full)))
        elif full.is_file():
            digest.update(str(full.stat().st_mode & 0o777).encode() + b"\0")
            digest.update(full.read_bytes())
        else:
            digest.update(b"missing")
        digest.update(b"\0")
    head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=root,
                          capture_output=True, text=True)
    return {"sha256": digest.hexdigest(), "file_count": len(paths),
            "commit": head.stdout.strip() if head.returncode == 0 else None}
