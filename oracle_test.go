package fit

import (
	"maps"
	"math/rand"
	"slices"
	"testing"
)

// Independently try every complete assignment, including absence. Discard
// unreachable plugins even when their own requirements happen to be met.
func enumerate(req Request, names []string) *Plan {
	var best *Plan
	var bestTuple []int
	limit := 1
	for range names {
		limit *= 3
	}
	for serial := 0; serial < limit; serial++ {
		code := serial
		selection := make(map[string]int)
		tuple := make([]int, len(names))
		for i, name := range names {
			tuple[i], code = code%3, code/3
			if tuple[i] > 0 {
				selection[name] = tuple[i]
			}
		}
		seen := map[string]bool{}
		queue := slices.Clone(req.Roots)
		valid := true
		for len(queue) > 0 {
			r := queue[0]
			queue = queue[1:]
			v := selection[r.Plugin]
			if v < r.Min || v > r.Max {
				valid = false
				break
			}
			if !seen[r.Plugin] {
				seen[r.Plugin] = true
				queue = append(queue, req.Catalog[r.Plugin][v-1].Requires...)
			}
		}
		if !valid || len(seen) != len(selection) {
			continue
		}
		edits := 0
		for _, name := range names {
			if req.Installed[name] != selection[name] {
				edits++
			}
		}
		if best == nil || edits < best.Edits || edits == best.Edits && slices.Compare(tuple, bestTuple) > 0 {
			best = &Plan{selection, edits}
			bestTuple = tuple
		}
	}
	return best
}

func TestSolverAgainstAllAssignments(t *testing.T) {
	rng := rand.New(rand.NewSource(12968))
	names := []string{"A", "B", "C", "D", "E"}
	requirement := func() Requirement {
		minimum := 1 + rng.Intn(2)
		return Requirement{names[rng.Intn(len(names))], minimum, minimum + rng.Intn(3-minimum)}
	}
	solved := 0
	for trial := 0; trial < 300; trial++ {
		req := Request{Catalog: map[string][]Release{}, Installed: map[string]int{}}
		for _, name := range names {
			for v := 1; v <= 2; v++ {
				release := Release{Revision: v}
				for range rng.Intn(3) {
					release.Requires = append(release.Requires, requirement())
				}
				req.Catalog[name] = append(req.Catalog[name], release)
			}
			if current := rng.Intn(3); current > 0 {
				req.Installed[name] = current
			}
		}
		for range 1 + rng.Intn(4) {
			req.Roots = append(req.Roots, requirement())
		}
		want := enumerate(req, names)
		got, err := Solve(req)
		if err != nil || (got == nil) != (want == nil) ||
			got != nil && (got.Edits != want.Edits || !maps.Equal(got.Selected, want.Selected)) {
			t.Fatalf("trial %d: got %+v err %v, want %+v; request %+v", trial, got, err, want, req)
		}
		if got != nil {
			solved++
		}
	}
	if solved == 0 || solved == 300 {
		t.Fatal("expected both satisfiable and unsatisfiable catalogs")
	}
	t.Logf("%d compatible, %d unsatisfiable; checked 72,900 complete assignments", solved, 300-solved)
}
