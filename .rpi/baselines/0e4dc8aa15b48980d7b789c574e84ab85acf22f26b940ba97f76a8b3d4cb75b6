"""Collect the declared offline lifecycle source closure, never a checkout scan."""
from pathlib import Path


def bundle_sources(root, manifest):
    root = Path(root).resolve()
    tree = {}

    def validate(relative):
        if not isinstance(relative, str) or not relative:
            raise ValueError("runtime source must be a nonempty relative path")
        path = Path(relative)
        if path.is_absolute() or ".." in path.parts or path.as_posix() != relative:
            raise ValueError("runtime source escapes package: " + relative)
        return path

    def include(relative):
        path = validate(relative)
        source = root / path
        try:
            source.resolve().relative_to(root)
        except ValueError as error:
            raise ValueError("runtime source symlink escapes package: " + relative) from error
        if not source.is_file():
            raise ValueError("missing runtime dependency: " + relative)
        data = source.read_bytes()
        if relative in tree and tree[relative] != data:
            raise ValueError("runtime source collision: " + relative)
        tree[relative] = data

    for relative in manifest.get("runtime_sources", []):
        include(relative)
    for component in manifest["components"]:
        source = component["source"]
        if component["kind"] == "skill":
            include(source + "/SKILL.md")
            for resource in component.get("resources", []):
                if isinstance(resource, str):
                    include(source + "/" + resource)
                else:
                    include(resource["source"])
                    # Authoring symlinks become ordinary contained copies. Keep
                    # their relative links readable in an extracted source tree.
                    alias = source + "/" + resource["destination"]
                    validate(alias)
                    data = tree[resource["source"]]
                    if alias in tree and tree[alias] != data:
                        raise ValueError("runtime resource alias collision: " + alias)
                    tree[alias] = data
        else:
            include(source)
    return dict(sorted(tree.items()))
