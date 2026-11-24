package fit

import (
	"maps"
	"testing"
)

func TestSharedEngineAndMinimumEdits(t *testing.T) {
	request := Request{
		Catalog: map[string][]Release{
			"layout": {{1, []Requirement{{"engine", 1, 1}}}, {2, []Requirement{{"engine", 2, 2}}}},
			"export": {{1, []Requirement{{"engine", 1, 1}}}, {2, []Requirement{{"engine", 1, 2}}}},
			"engine": {{1, nil}, {2, nil}},
		},
		Roots:     []Requirement{{"layout", 1, 2}, {"export", 2, 2}},
		Installed: map[string]int{"layout": 1, "export": 1, "engine": 1},
	}
	plan, err := Solve(request)
	if err != nil || plan == nil || plan.Edits != 1 || !maps.Equal(plan.Selected, map[string]int{"layout": 1, "export": 2, "engine": 1}) {
		t.Fatalf("plan=%+v err=%v", plan, err)
	}
}

func TestCyclesAndBacktracking(t *testing.T) {
	request := Request{Roots: []Requirement{{"A", 1, 2}}, Catalog: map[string][]Release{
		"A": {{2, []Requirement{{"B", 2, 2}}}, {1, []Requirement{{"B", 1, 1}}}},
		"B": {{2, []Requirement{{"A", 1, 1}}}, {1, []Requirement{{"A", 1, 1}}}},
	}}
	plan, err := Solve(request)
	if err != nil || plan == nil || !maps.Equal(plan.Selected, map[string]int{"A": 1, "B": 1}) {
		t.Fatalf("plan=%+v err=%v", plan, err)
	}
	request.Roots[0].Min = 2
	plan, err = Solve(request)
	if err != nil || plan != nil {
		t.Fatalf("conflicting cycle: plan=%+v err=%v", plan, err)
	}
}
