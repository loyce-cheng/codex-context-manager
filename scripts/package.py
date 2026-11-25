"""Optional release tooling; end users need only the bundled runtime."""
import hashlib
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parent.parent
VERSION = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
NAME = f"context-lens-{VERSION}-win32-x64"
FOLDER = ROOT / "dist" / NAME
TARGET = ROOT / "dist" / f"{NAME}.zip"

if not (FOLDER / "RELEASE.json").is_file():
    raise SystemExit("Run node scripts/build.mjs first.")
with ZipFile(TARGET, "w", compression=ZIP_DEFLATED, compresslevel=6) as archive:
    for path in sorted(FOLDER.rglob("*")):
        if path.is_symlink():
            raise ValueError(f"Unexpected symlink: {path}")
        if path.is_file():
            path.resolve().relative_to(FOLDER.resolve())
            archive.write(path, NAME + "/" + path.relative_to(FOLDER).as_posix())
with ZipFile(TARGET) as archive:
    required = [".agents/plugins/marketplace.json", "plugins/context-lens/plugin.json",
                "plugins/context-lens/mcp.json", "plugins/context-lens/runtime/node.exe", "scripts/install-workflow.mjs",
                "plugins/context-lens/runtime/NODE-LICENSE.txt", "Start.cmd", "Start-Fixed.cmd", "Follow-New.cmd", "Install.cmd", "Uninstall.cmd",
                "plugins/context-lens/src/adapters/desktop-follow.mjs", "plugins/context-lens/src/core/follow.mjs"]
    for entry in required:
        archive.getinfo(NAME + "/" + entry)
    bad = archive.testzip()
    if bad:
        raise ValueError("Corrupt entry: " + bad)
digest = hashlib.file_digest(TARGET.open("rb"), "sha256").hexdigest()
TARGET.with_suffix(".zip.sha256").write_text(digest + "  " + TARGET.name + "\n", encoding="utf-8")
print(f"Packaged: {TARGET}\nSize: {TARGET.stat().st_size} bytes\nSHA256: {digest}")
