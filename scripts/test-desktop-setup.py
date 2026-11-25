"""Exercise the compiled installer on Windows with a private Loader profile and shortcuts."""
import argparse
import json
import os
import shutil
from pathlib import Path
import subprocess
import sys
import tempfile
import hashlib
import zipfile

root=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
for name in ["iscc","codex-source"]:
    parser.add_argument("--"+name,required=True,type=Path)
parser.add_argument("--launcher-dir",type=Path,default=root/"dist/launcher")
deps=parser.add_mutually_exclusive_group(required=True)
deps.add_argument("--loader-setup",type=Path)
deps.add_argument("--portable-loader",type=Path)
args=parser.parse_args()
base=Path(tempfile.mkdtemp(prefix="installer-qa-",dir=root/".research"))
compiler=Path(os.environ["WINDIR"])/"Microsoft.NET/Framework64/v4.0.30319/csc.exe"
recovery_checks=base/"RecoveryChecks.exe"
subprocess.run([compiler,"/nologo","/main:LoaderRecoveryChecks","/reference:System.Windows.Forms.dll",
                "/reference:System.Drawing.dll","/out:"+str(recovery_checks),root/"packaging/windows-launcher/LoaderRecovery.cs",
                root/"tests/fixtures/LoaderRecoveryChecks.cs"],check=True)
subprocess.run([recovery_checks],check=True,timeout=20)
profile=base/"中文 测试用户"
target=base/"安装 目录"
loader=profile/"Programs/CodexScriptLoader"
version=json.loads((root/"native-sidebar/manifest.json").read_bytes())["version"]
if args.portable_loader:
    dep_args=["--portable-loader",args.portable_loader.resolve()]
else:
    stub=base/"LoaderSetupFixture.exe"
    csc=Path(os.environ["WINDIR"])/"Microsoft.NET/Framework64/v4.0.30319/csc.exe"
    subprocess.run([csc,"/nologo","/target:exe","/out:"+str(stub),root/"tests/fixtures/LoaderSetupFixture.cs"],check=True)
    dep_args=["--loader-setup",args.loader_setup.resolve(),"--fixture-loader",stub]
    os.environ["LENS_QA_PROFILE"]=str(profile)
subprocess.run([sys.executable,root/"scripts/build-desktop-setup.py","--iscc",args.iscc.resolve(),
                "--codex-source",args.codex_source.resolve(),"--launcher-dir",args.launcher_dir.resolve(),"--fixture-profile",profile,*dep_args],check=True)
setup,=base.glob(f"Codex-Context-Manager-{version}-windows-x64-Setup*-QA.exe")

def run(exe, label, *options, expect_ok=True):
    log=base/(label+".log")
    code=subprocess.run([exe,"/VERYSILENT","/NORESTART","/SUPPRESSMSGBOXES",f"/LOG={log}",*options]).returncode
    if (code==0)!=expect_ok:
        raise RuntimeError(f"{label}: exit {code}; see {log}")

plugin=profile/"CodexScriptLoader/scripts/local.context-lens.sidebar"
monitor=target/"dist/launcher/Context-Lens.exe"
experiment=target/"dist/launcher/Context-Lens-Experimental.exe"
uninstaller=target/"unins000.exe"
programs=profile/"programs/Context Lens"
dest="/DIR="+str(target)
if not args.portable_loader:
    os.environ["LENS_QA_FAIL"]="1"
    run(setup,"dependency-install-failure",dest,expect_ok=False)
    del os.environ["LENS_QA_FAIL"]
assert not monitor.exists()
active=loader/"active.json"
collision=profile/"desktop/Codex + Context Lens.lnk"
collision.parent.mkdir(parents=True);collision.write_bytes(b"keep existing link")
run(setup,"monitor",dest,"/MODE=monitor")
assert monitor.exists() and not experiment.exists() and (plugin/"index.js").exists()
assert (programs/"恢复 Loader.lnk").is_file() and (target/"dist/launcher/Context-Lens-Recovery.exe").is_file()
assert not list(target.glob("dist/experimental-*"))
runtime=next(target.glob("dist/context-lens-*-win32-x64/plugins/context-lens/runtime/node.exe"))
subprocess.run([runtime,"--input-type=module","-e","import './scripts/sidebar-status.mjs';"],cwd=target,check=True)
assert (programs/"查看状态.lnk").exists() and collision.read_bytes()==b"keep existing link"
private=target/"dist/private-loader"
if args.portable_loader:
    assert not loader.exists()
    assert (target/"third_party/LICENSE-Loader.txt").is_file()
    assert (target/"third_party/NOTICE-Loader-branding.md").is_file()
    with zipfile.ZipFile(args.portable_loader) as archive:
        for item in archive.infolist():
            if item.is_dir():
                continue
            with (private/item.filename).open("rb") as stream:
                assert hashlib.file_digest(stream,"sha256").digest()==hashlib.sha256(archive.read(item)).digest()
    subprocess.run([runtime,"--input-type=module","-e",
        "import assert from 'node:assert/strict';import {selectLoaderDirectory,activeLoaderDirectory} from './scripts/sidebar-loader-client.mjs';"
        "const [missing,privateDir]=process.argv.slice(1);assert.equal(await selectLoaderDirectory(missing,privateDir),privateDir);"
        "assert.ok((await activeLoaderDirectory('.',privateDir)).includes('0.6.2'));",str(loader),str(private)],cwd=target,check=True)
    # A previously shared installation appears; ensure it is preferred and preserved.
    shutil.copytree(private,loader)
descriptor=json.loads(active.read_bytes())
active.write_text(json.dumps(dict(descriptor,launcherProtocol=0)))
run(setup,"incompatible-loader",dest,expect_ok=False)
active.write_text(json.dumps(descriptor))
config=profile/"CodexScriptLoader/config.json"
config.write_bytes(b'{"globalEnabled":false}')
run(setup,"repair",dest,"/MODE=monitor")
run(setup,"add-experiment",dest,"/MODE=experimental")
assert experiment.exists() and (programs/"Codex + Context Lens（实验扩容）.lnk").exists()
dispatcher=target/"experiments/desktop-context-window/launch-desktop.mjs"
original=dispatcher.read_bytes()
dispatcher.write_bytes(b"import { desktopVersion } from './loader/release.mjs';")
(profile/"simulated-new-desktop").touch()
run(setup,"monitor-repair-retains-coherent-experiment",dest,"/MODE=monitor")
assert dispatcher.read_bytes()==original and experiment.exists()
assert config.read_bytes()==b'{"globalEnabled":false}'
runtime=next(target.glob("dist/context-lens-*-win32-x64/plugins/context-lens/runtime/node.exe"))
# Follow normal imports from the extracted installation, independent of the development tree.
subprocess.run([runtime,"--input-type=module","-e",
    "import {desktopSetupReleases,verifyLoaderBuild,verifyExperimentalCli,cliVersion} from './experiments/desktop-context-window/loader/release.mjs';"
    "import './scripts/sync-sidebar.mjs';import './scripts/sidebar-status.mjs';"
    "await verifyExperimentalCli('dist/experimental-backend-'+cliVersion+'/codex.exe');"
    "for(const v of desktopSetupReleases())await verifyLoaderBuild('dist/'+v.directory,v.hash);"],cwd=target,check=True)
(target/".research"/"launcher-status.json").write_text("{}")
run(uninstaller,"uninstall")
assert not monitor.exists() and not plugin.exists()
assert not private.exists() and loader.exists()
assert not (programs/"查看状态.lnk").exists() and config.exists() and collision.read_bytes()==b"keep existing link"
assert not (programs/"恢复 Loader.lnk").exists()

# A subsequent install discovers an independently imported plugin.
shutil.copytree(root/"dist"/("context-lens-sidebar-"+version),plugin)
before=(plugin/"index.js").read_bytes()
run(setup,"existing-plugin",dest,"/MODE=monitor")
if args.portable_loader:
    assert not private.exists()
run(uninstaller,"uninstall-preexisting")
assert (plugin/"index.js").read_bytes()==before and config.read_bytes()==b'{"globalEnabled":false}'
if not args.portable_loader:
    assert (profile/"dependency-calls.txt").read_text().splitlines()==["install"]
print("Passed: prerequisites, monitor, repair, add experimental, links, uninstall, existing plugin.",base)
