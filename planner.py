"""Estimate parallel CI duration with one environment startup per worker and fixture."""
from dataclasses import dataclass, field


@dataclass(frozen=True)
class TestFile:
    path: str
    duration_ms: int
    fixture: str


@dataclass
class Worker:
    paths: list[str] = field(default_factory=list)
    fixtures: set[str] = field(default_factory=set)
    run_ms: int = 0
    setup_ms: int = 0

    @property
    def finish_ms(self):
        return self.setup_ms + self.run_ms

    def startup(self, file, setup):
        return 0 if file.fixture in self.fixtures else setup[file.fixture]

    def add(self, file, setup):
        self.setup_ms += self.startup(file, setup)
        self.fixtures.add(file.fixture)
        self.paths.append(file.path)
        self.run_ms += file.duration_ms


def plan(files, setup, workers):
    files = list(files)
    if type(workers) is not int or workers < 1:
        raise ValueError("workers must be a positive integer")
    if any(not isinstance(key, str) or not key.strip() or type(ms) is not int or ms < 0
           for key, ms in setup.items()):
        raise ValueError("expected named fixtures with nonnegative setup times")
    seen = set()
    for file in files:
        if (not isinstance(file.path, str) or not file.path.strip() or file.path in seen or
                file.fixture not in setup or type(file.duration_ms) is not int or file.duration_ms < 0):
            raise ValueError(f"invalid or duplicate test file: {file.path}")
        seen.add(file.path)

    baseline = [Worker() for _ in range(workers)]
    for i, file in enumerate(files):
        baseline[i % workers].add(file, setup)
    balanced = [Worker() for _ in range(workers)]
    for file in sorted(files, key=lambda f: (-(f.duration_ms + setup[f.fixture]), f.path)):
        worker = min(balanced, key=lambda w: (w.finish_ms + w.startup(file, setup), w.startup(file, setup),
                                              len(w.paths)))
        worker.add(file, setup)

    def score(group):
        return max(w.finish_ms for w in group), sum(w.setup_ms for w in group)

    selected = min((baseline, balanced), key=score)
    used = {f.fixture for f in files}
    total = sum(f.duration_ms for f in files) + sum(setup[key] for key in used)
    lower_bound = max((total + workers - 1) // workers,
                      max((f.duration_ms + setup[f.fixture] for f in files), default=0))
    return {
        "strategy": "round_robin" if selected is baseline else "fixture_aware",
        "baseline_ms": score(baseline)[0], "estimated_ms": score(selected)[0], "lower_bound_ms": lower_bound,
        "workers": [{"paths": w.paths, "fixtures": sorted(w.fixtures), "run_ms": w.run_ms,
                     "setup_ms": w.setup_ms, "finish_ms": w.finish_ms} for w in selected],
    }
