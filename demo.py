"""Create a shipping-rule PR with green tests and demonstrate the missing boundary case."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile


CLI = Path(__file__).resolve().with_name("patch_cover.py")
SOURCE = '''"""Shipping fees for a single parcel."""


def shipping(items):
    return 5
'''
TEST = '''import unittest

from shop.shipping import shipping


class ShippingTests(unittest.TestCase):
    def test_small_order(self):
        self.assertEqual(shipping([20, 30]), 5)
'''
BOUNDARY = '''
    def test_free_shipping_boundary(self):
        self.assertEqual(shipping([40, 60]), 0)
'''


def git(repo, *args):
    return subprocess.check_output(["git", "-C", repo, "-c", "user.name=Shipping Demo",
                                   "-c", "user.email=demo@example.invalid", "-c", "commit.gpgSign=false", *args])


def save(repo, name, text):
    path = repo / name
    path.parent.mkdir(exist_ok=True, parents=True)
    path.write_text(text, encoding="utf-8")


def snapshot(repo, message):
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", message)
    return git(repo, "rev-parse", "HEAD").decode().strip()


def prepare(repo):
    git(repo, "init", "-q", "-b", "main")
    save(repo, "shop/shipping.py", SOURCE)
    save(repo, "tests/test_shipping.py", TEST)
    base = snapshot(repo, "Original flat shipping fee")
    git(repo, "switch", "-qc", "free-shipping")
    save(repo, "shop/shipping.py", SOURCE.replace("    return 5", "    subtotal = sum(items)\n"
                                                 "    if subtotal >= 100:\n        return 0\n    return 5"))
    snapshot(repo, "Ship orders of 100 or more for free")
    return base


def run(repo, base, *args, code):
    command = [sys.executable, CLI, base, "--repo", repo, "--source", "shop", "--tests", "tests", *args]
    result = subprocess.run(command, capture_output=True)
    if result.returncode != code:
        raise RuntimeError(f"expected exit {code}, got {result.returncode}: {result.stderr!r} {result.stdout!r}")
    return json.loads(result.stdout) if result.stdout else None


def demo(repo):
    base = prepare(repo)
    before = run(repo, base, code=1)
    save(repo, "tests/test_shipping.py", TEST + BOUNDARY)
    snapshot(repo, "Exercise the free shipping boundary")
    after = run(repo, base, code=0)
    return {"before": before, "after": after}


if __name__ == "__main__":
    with tempfile.TemporaryDirectory() as directory:
        print(json.dumps(demo(Path(directory)), indent=2))
