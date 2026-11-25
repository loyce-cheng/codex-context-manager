"""Build a per-user offline installer from local, explicitly selected release artifacts."""
import argparse
import hashlib
import json
import os
import sys
from pathlib import Path
import subprocess
import tempfile
import zipfile
from setup_budget import require_final_size

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--iscc", required=True, type=Path)
parser.add_argument("--launcher-dir", type=Path, default=root/"dist/launcher")
dependency_group=parser.add_mutually_exclusive_group(required=True)
dependency_group.add_argument("--loader-setup",type=Path,help="Bundle the verified shared Loader installer")
dependency_group.add_argument("--portable-loader",type=Path,help="Bundle the verified upstream portable Loader and share identical payload data")
parser.add_argument("--codex-source", required=True, type=Path, help="Matching upstream source tree for LICENSE and NOTICE")
parser.add_argument("--fixture-profile", type=Path, help="Build isolated QA variant with a private Loader profile")
parser.add_argument("--fixture-loader", type=Path, help="Inert dependency installer used only in the QA build")
measure_group=parser.add_mutually_exclusive_group()
measure_group.add_argument("--measure-without-backend",action="store_true",help="Measure the fixed payload without the CLI; emits no installer")
measure_group.add_argument("--measure-backend",type=Path,help="Measure the complete payload with a candidate CLI; emits no installer")
parser.add_argument("--measure-portable",type=Path,help="Size study only: replace the separate upstream installer by all files of its pinned portable distribution")
parser.add_argument("--measure-large-dictionary",action="store_true",help="Size study only: use a 128 MiB LZMA2 dictionary")
parser.add_argument("--measure-host-node",action="store_true",help="Size study only: model using an independently verified runtime already present in Codex")
args = parser.parse_args()
measuring=any((args.measure_without_backend,args.measure_backend,args.measure_portable,args.measure_large_dictionary,args.measure_host_node))
portable=args.portable_loader or args.measure_portable
if args.portable_loader and args.measure_portable:
    parser.error("Select one portable archive")
if (args.fixture_loader and (not args.fixture_profile or portable)) or (args.fixture_profile and not portable and not args.fixture_loader):
    parser.error("The shared-installer QA variant requires a private profile and fixture-loader; portable QA uses just a private profile")
if measuring and args.fixture_profile:
    parser.error("Use the genuine offline dependency to measure the release payload")
version = json.loads((root / "native-sidebar/manifest.json").read_text(encoding="utf8"))["version"]
setup_name=f"Codex-Context-Manager-{version}-windows-x64-Setup" + ("" if args.portable_loader else "-shared")
runtime = json.loads((root / "package.json").read_text(encoding="utf8"))["version"]
node = Path(f"dist/context-lens-{runtime}-win32-x64/plugins/context-lens/runtime/node.exe")

def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()

def verify(path, expected):
    if digest(path) != expected:
        raise ValueError(f"Unexpected SHA-256: {path}")

verify(root / node, "3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237")
if args.loader_setup:
    verify(args.loader_setup, "00ffcd73eea11288f5c8ea4922b93b7ac8633874b067abca585c34cfe8107842")
release = json.loads(subprocess.check_output([root/node,"--input-type=module","-e",
    "import {desktopSetupReleases, cliVersion, expectedCliHash} from './experiments/desktop-context-window/loader/release.mjs';"
    "console.log(JSON.stringify({builds:desktopSetupReleases(),cliVersion,expectedCliHash}));"],cwd=root))
backend = Path("dist")/("experimental-backend-"+release["cliVersion"])/"codex.exe"
verify(root / backend, release["expectedCliHash"])
includes = []

def add(src, dest=None, check=None, extra=""):
    src = Path(src)
    if dest is None:
        dest = src.relative_to(root) if src.is_absolute() else src
    dest = Path(dest)
    src = (root / src).resolve(strict=True)
    if not src.is_file() or dest.is_absolute() or ".." in dest.parts:
        raise ValueError(f"Invalid payload: {src}, {dest}")
    target = "{app}" if dest.parent == Path(".") else "{app}\\" + str(dest.parent)
    line = f'Source: "{src}"; DestDir: "{target}"; DestName: "{dest.name}"; Flags: ignoreversion'
    if check:
        line += "; Check: " + check
    includes.append(line + extra)

for name in ["package.json","LICENSE","native-sidebar/manifest.json","native-sidebar/src/telemetry.mjs",
             "src/adapters/local-codex.mjs","src/core/context.mjs","src/control/levels.mjs",
             "packaging/install-workflow.mjs","packaging/windows-setup/sidebar-files.mjs",
             "third_party/NODE-LICENSE.txt"]:
    add(name)
if not args.measure_host_node:
    add(node)
for name in ["launch-sidebar","launcher-core","ensure-sidebar","sidebar-loader-client","sync-sidebar",
             "update-sidebar","verify-native-profile","rspack-usage","sidebar-status","upgrade-status","verify-stock-resume"]:
    add(f"scripts/{name}.mjs")
for name in ["acorn.mjs","LICENSE"]:
    add("third_party/acorn/"+name)
for name in ["manifest.json","index.js","LICENSE","NOTICE.md","README.md"]:
    add(f"dist/context-lens-sidebar-{version}/{name}")
for name in ["Context-Lens","Context-Lens-Status","Context-Lens-Recovery","Context-Lens-Experimental"]:
    add(args.launcher_dir/(name+".exe"),Path("dist/launcher")/(name+".exe"),
        check="InstallExperimentalComponents" if name.endswith("Experimental") else None)
for name in ["code-mode-host","loader/release"]:
    add(f"experiments/desktop-context-window/{name}.mjs")
for name in ["launch-desktop","bridge-lifecycle","desktop-tier-bridge","wait-for-exit","update-fallback","turn-receipt"]:
    add(f"experiments/desktop-context-window/{name}.mjs",check="InstallExperimentalComponents")
for name in ["scripts/probe-capacity-protocol.mjs","scripts/compaction-provider-fixture.mjs",
             "src/control/capacity.mjs","src/control/reload.mjs","src/control/target-preference.mjs"]:
    add(name,check="InstallExperimentalComponents")
if not args.measure_without_backend:
    add(args.measure_backend.resolve() if args.measure_backend else backend,backend,check="InstallExperimentalComponents")
for name in ["LICENSE","NOTICE"]:
    add(args.codex_source.resolve()/name,"third_party/codex-"+name+".txt","InstallExperimentalComponents")
loader_sources = {}
for build in release["builds"]:
    directory=root/"dist"/build["directory"]
    manifest=directory/"context-lens-build.json"
    verify(manifest,build["hash"])
    add(manifest,check="InstallExperimentalComponents")
    for entry in json.loads(manifest.read_bytes())["files"]:
        file=directory/entry["path"]
        verify(file,entry["sha256"])
        # Inno shares compressed data by source path. Both manifests retain
        # their own destination paths, including for identical runtime DLLs.
        source = loader_sources.setdefault(entry["sha256"], file)
        add(source, file.relative_to(root), check="InstallExperimentalComponents")

dependency=None if portable else (args.fixture_loader or args.loader_setup).resolve()
if dependency:
    includes.insert(0,f'Source: "{dependency}"; DestDir: "{{tmp}}"; DestName: "LoaderSetup.exe"; Flags: dontcopy nocompression')
output_dir=args.fixture_profile.resolve().parent if args.fixture_profile else root/"dist"
output_dir.mkdir(parents=True,exist_ok=True)
# Build on the output volume so an over-budget stable build never replaces a published EXE.
with tempfile.TemporaryDirectory(dir=output_dir,prefix="desktop-setup-build-") as scratch:
    stage=Path(scratch)
    if portable:
        verify(portable,"82ebdad3c6f4ed5fff725a04dd4f57125ab117180c7d31c6b601b8b82123fa1f")
        start=len(includes)
        with zipfile.ZipFile(portable) as archive:
            for item in archive.infolist():
                if item.is_dir():
                    continue
                rel=Path(item.filename)
                if rel.is_absolute() or rel.drive or ".." in rel.parts:
                    raise ValueError("Invalid portable path")
                data=archive.read(item)
                key=hashlib.sha256(data).hexdigest()
                source=loader_sources.get(key)
                if source is None:
                    source=stage/key
                    source.write_bytes(data)
                    loader_sources[key]=source
                add(source,Path("dist/private-loader")/rel,check="InstallPrivateLoader")
        for notice in ["LICENSE-Loader.txt","NOTICE-Loader-branding.md"]:
            add(root/"dist"/release["builds"][0]["directory"]/notice,
                Path("third_party")/notice,check="InstallPrivateLoader")
        # Keep the stock runtime together ahead of the optional experimental payload.
        includes[:]=includes[start:]+includes[:start]
    marker=stage/"context-lens-install.id"
    marker.write_bytes(b"Context Lens Desktop")
    # A monitor-only installation can seek directly to its final marker.
    add(marker,marker.name,extra=" solidbreak uninsneveruninstall; AfterInstall: RegisterSidebar")
    files=stage/"files.iss"
    files.write_text("\n".join(includes)+"\n",encoding="utf-8-sig")
    env=dict(os.environ,LENS_BUILD_ROOT=str(root),LENS_BUILD_VERSION=version,LENS_SETUP_NAME=setup_name,LENS_BUILD_NODE=str(node),
             LENS_SETUP_MEASURE="1" if measuring else "",
             LENS_MEASURE_DICTIONARY="large" if args.measure_large_dictionary else "",
             LENS_BUILD_FILES=str(files),LENS_BUILD_FIXTURE="-QA" if args.fixture_profile else "",
             LENS_BUILD_DESKTOP_SET=",".join("''"+b["desktop"]+"''" for b in release["builds"]),
             LENS_BUILD_BACKEND=str(backend.parent),LENS_LOADER_SETUP_HASH=digest(dependency) if dependency else "",
             LENS_SETUP_PORTABLE="1" if portable else "",LENS_SETUP_OUTPUT_DIR=str(stage),
             LENS_FIXTURE_PROFILE=str(args.fixture_profile.resolve()) if args.fixture_profile else "")
    subprocess.run([args.iscc.resolve(),"/Q",root/"packaging/windows-setup/setup.iss"],env=env,check=True)
    name=f"{setup_name}{env['LENS_BUILD_FIXTURE']}.exe"
    exe=stage/name
    size=exe.stat().st_size
    if size<=0:
        raise ValueError("Empty installer")
    if measuring:
        print(json.dumps({"measurement":"fixed-payload" if args.measure_without_backend else "full-payload",
                          "portableLoader":bool(portable),
                          "bundledNode":not args.measure_host_node,"largeDictionary":args.measure_large_dictionary,
                          "bytes":size,"candidateSha256":digest(args.measure_backend) if args.measure_backend else None,
                          "published":False}))
    else:
        if not args.fixture_profile:
            try:
                require_final_size(size)
            except ValueError as note:
                print(f"Size target (advisory): {note}",file=sys.stderr)
        checksum=digest(exe)
        exe.with_suffix(".exe.sha256").write_text(f"{checksum}  {exe.name}\n",encoding="ascii")
        exe.replace(output_dir/name)
        exe.with_suffix(".exe.sha256").replace(output_dir/(name+".sha256"))
        print(output_dir/name,size,checksum)
