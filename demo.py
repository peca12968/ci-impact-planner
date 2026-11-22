"""Create an actual Git merge conflict in a disposable local repository."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile


CLI = Path(__file__).with_name("catalog_merge.py").resolve()
CATALOG = "locales/zh-TW.json"


def git(repo, *args, expected=0):
    p = subprocess.run(["git", "-c", "user.name=Catalog Demo", "-c", "user.email=demo@example.invalid",
                        "-c", "commit.gpgSign=false", "-c", "rerere.enabled=false", *args],
                       cwd=repo, capture_output=True)
    if p.returncode != expected:
        raise RuntimeError(p.stderr.decode(errors="replace"))
    return p.stdout


def commit_catalog(repo, value, message):
    path = repo / CATALOG
    path.parent.mkdir(exist_ok=True)
    if value is None:
        git(repo, "rm", "--", CATALOG)
    else:
        path.write_text(json.dumps(value, ensure_ascii=False) + "\n", encoding="utf-8")
        git(repo, "add", "--", CATALOG)
    git(repo, "commit", "-qm", message)


def branches(repo, base, ours, theirs):
    git(repo, "init", "-q", "-b", "main")
    if base is None:
        git(repo, "commit", "--allow-empty", "-qm", "base")
    else:
        commit_catalog(repo, base, "base")
    git(repo, "branch", "translation")
    commit_catalog(repo, ours, "storefront")
    git(repo, "switch", "-q", "translation")
    commit_catalog(repo, theirs, "translation")
    git(repo, "switch", "-q", "main")
    git(repo, "merge", "--no-edit", "translation", expected=1)


def run_cli(repo, *args, code=0, catalog=CATALOG):
    p = subprocess.run([sys.executable, CLI, catalog, *args], cwd=repo, capture_output=True)
    if p.returncode != code:
        raise RuntimeError(f"code {p.returncode}: {p.stderr!r} {p.stdout!r}")
    return json.loads(p.stdout) if p.stdout else None


def checkout_demo(repo):
    base = {"checkout": {"pay": "付款", "hint": "請確認金額"}, "nav": {"back": "返回"}}
    ours = {"checkout": {"pay": "立即付款", "invoice": "電子發票"}, "nav": {"back": "返回"}}
    theirs = {"checkout": {"pay": "前往付款", "hint": "請確認訂單金額"}, "nav": {"back": "返回", "pickup": "自取"}}
    branches(repo, base, ours, theirs)
    run_cli(repo, "--save-review", "review.json", code=1)
    report = json.loads((repo / "review.json").read_bytes())
    for item in report["conflicts"]:
        item["take"] = "ours" if item["path"] == "/checkout/hint" else "custom"
        if item["take"] == "custom":
            item["text"] = "確認並付款"
    (repo / "review.json").write_text(json.dumps(report), encoding="utf-8")
    run_cli(repo, "--review", "review.json", "--output", "merged.json")
    return {"reviewed": [item["path"] for item in report["conflicts"]],
            "catalog": json.loads((repo / "merged.json").read_bytes())}


if __name__ == "__main__":
    with tempfile.TemporaryDirectory() as directory:
        result = checkout_demo(Path(directory))
    sys.stdout.buffer.write((json.dumps(result, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
