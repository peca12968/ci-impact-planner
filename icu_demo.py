"""Verify that an automatically merged translation still has its ICU branches."""
import json
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory

from demo import branches, run_cli


ROOT = Path(__file__).resolve().parent / 'modules/message-parity'


def read(name):
    return json.loads((ROOT / 'examples' / name).read_bytes())


def check(delivery):
    original = read('zh-TW.json')
    store = original | {'order': '訂單 {id}（{name}）'}
    translated = original | {'delivery': delivery}
    with TemporaryDirectory() as directory:
        repo = Path(directory)
        branches(repo, original, store, translated)
        merged = repo / 'merged.json'
        run_cli(repo, '--output', str(merged))
        if json.loads(merged.read_bytes())['order'] != store['order']:
            raise ValueError('The independent order translation was lost')
        return subprocess.run(['node', ROOT / 'check.js', 'en', ROOT / 'examples/en.json', 'zh-TW', merged],
                              capture_output=True, check=False)


if __name__ == '__main__':
    bad = check(read('zh-TW.draft.json')['delivery'])
    corrected = check(read('zh-TW.json')['delivery'].replace('客服', '客服人員'))
    if bad.returncode != 1 or corrected.returncode != 0:
        raise ValueError(f'Unexpected ICU validation outcomes: {bad.stderr!r} {corrected.stderr!r}')
    bad_ids = {row['id'] for row in json.loads(bad.stdout)['findings']}
    if bad_ids != {'delivery'} or json.loads(corrected.stdout)['findings']:
        raise ValueError('The ICU check must flag only the uncorrected delivery message')
    print(json.dumps({'flagged_messages': sorted(bad_ids), 'fixed_catalog_passed': True}))
