"""Build the same tiny Python project four times with a real wheel backend."""
import argparse
import os
from pathlib import Path
import subprocess
import sys


def build_demo(root):
    root.mkdir(parents=True)
    src = root / "project"
    src.mkdir()
    (src / "pyproject.toml").write_text("""[build-system]
requires = ["flit_core==3.12.0"]
build-backend = "flit_core.buildapi"

[project]
name = "parcel_count"
version = "1.0"
description = "Count cartons for a dispatch"
""", encoding="utf-8")
    builds = {}
    for label, epoch, size in [("baseline", "1700000000", 12), ("repeat", "1700000000", 12),
                               ("new-clock", "1700000600", 12), ("new-code", "1700000000", 24)]:
        module = f"def cartons(units):\n    return (units + {size - 1}) // {size}\n"
        (src / "parcel_count.py").write_text(module, encoding="utf-8", newline="\n")
        dest = root / label
        dest.mkdir()
        subprocess.run([sys.executable, "-m", "flit_core.wheel", "--outdir", str(dest.resolve()), str(src.resolve())],
                       check=True, env={**os.environ, "SOURCE_DATE_EPOCH": epoch})
        builds[label], = dest.glob("*.whl")
    return builds


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path, help="new directory for demonstration builds")
    build_demo(parser.parse_args().directory)
