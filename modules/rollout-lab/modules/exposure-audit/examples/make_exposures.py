"""Write a deterministic two-platform assignment example as JSON Lines."""
import json
import sys
from contextlib import nullcontext


def generate():
    for platform, treated in [("app", 1), ("web", 15)]:
        for i in range(16):
            user = f"{platform}-{i}"
            yield {"event_id": user, "user": user, "variant": "treatment" if i < treated else "control",
                   "stratum": platform}
    # A retried event and a genuine return visit from the same assigned user.
    for event in ("app-0", "return-visit"):
        yield {"event_id": event, "user": "app-0", "variant": "treatment", "stratum": "app"}


if __name__ == "__main__":
    dest = nullcontext(sys.stdout) if sys.argv[1] == "-" else open(sys.argv[1], "w", encoding="utf-8")
    with dest as stream:
        for row in generate():
            stream.write(json.dumps(row) + "\n")
