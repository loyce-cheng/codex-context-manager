"""Build the Loader import ZIP and optionally a separate code review snapshot."""
from pathlib import Path
import argparse
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--review-source', action='store_true')
options = parser.parse_args()
manifest = json.loads((root / 'native-sidebar/manifest.json').read_text(encoding='utf-8'))
name = f'context-lens-sidebar-{manifest["version"]}'
folder = root / 'dist' / name
target = root / 'dist' / f'{name}.zip'
with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for filename in ['manifest.json', 'index.js', 'README.md', 'NOTICE.md', 'LICENSE']:
        archive.write(folder / filename, f'{name}/{filename}')
digest = hashlib.sha256(target.read_bytes()).hexdigest()
target.with_suffix('.zip.sha256').write_text(f'{digest}  {target.name}\n', encoding='ascii')
print(json.dumps({'path': str(target), 'bytes': target.stat().st_size, 'sha256': digest}))

if options.review_source:
    review_name = f'context-lens-{manifest["version"]}-review-source'
    review_zip = root / 'dist' / f'{review_name}.zip'
    paths = [root / name for name in ('README.md', 'README.en.md', 'LICENSE', 'package.json',
                                      'third_party/README.md', 'third_party/NODE-LICENSE.txt',
                                      f'docs/RELEASE-{manifest["version"]}.md', 'docs/REVIEW-0.1.0.md')]
    paths.extend(root.glob('*.cmd'))
    paths.extend((root / 'third_party/acorn').glob('*'))
    paths.extend((root / 'docs/assets').glob('*.gif'))
    paths.extend((root / 'docs/assets').glob('*.png'))
    extensions = {'.mjs', '.rs', '.py', '.cs', '.iss', '.ps1', '.cmd', '.patch', '.json', '.md', '.html', '.css'}
    for directory in ('src', 'native-sidebar', 'experiments', 'scripts', 'tests', 'packaging'):
        paths.extend(p for p in (root / directory).rglob('*') if p.is_file() and p.suffix in extensions)
    with zipfile.ZipFile(review_zip, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(paths):
            archive.write(path, f'{review_name}/{path.relative_to(root).as_posix()}')
    review_hash = hashlib.sha256(review_zip.read_bytes()).hexdigest()
    review_zip.with_suffix('.zip.sha256').write_text(f'{review_hash}  {review_zip.name}\n', encoding='ascii')
    print(json.dumps({'path': str(review_zip), 'files': len(paths), 'sha256': review_hash}))
