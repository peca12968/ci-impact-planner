"""Check published bucket vectors against an independent Python implementation."""
import hashlib
import json
from pathlib import Path
import unicodedata


def bucket(domain, flag, subject):
    fields = [1, domain, unicodedata.normalize("NFC", flag), unicodedata.normalize("NFC", subject)]
    wire = json.dumps(fields, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    first_four = hashlib.sha256(wire).digest()[:4]
    return int.from_bytes(first_four, "big") * 10_000 // (2 ** 32)


if __name__ == "__main__":
    vectors = json.loads(Path(__file__).with_name("vectors.json").read_text(encoding="utf-8"))
    for vector in vectors:
        for domain in ("exposure", "variant"):
            actual = bucket(domain, vector["flag"], vector["subject"])
            if actual != vector[domain]:
                raise SystemExit(f"Mismatch for {vector['subject']} / {domain}")
    print(f"Verified {len(vectors)} shared assignment vectors.")
