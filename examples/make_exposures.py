"""Write a deterministic two-platform assignment example as JSON Lines."""
import json
import sys


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
    with open(sys.argv[1], "w", encoding="utf-8") as stream:
        for row in generate():
            stream.write(json.dumps(row) + "\n")
