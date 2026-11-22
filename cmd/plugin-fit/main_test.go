package main

import (
	"bytes"
	"encoding/json"
	"os"
	"slices"
	"strings"
	"testing"

	fit "github.com/peca12968/plugin-fit"
)

func TestExplainRootConflict(t *testing.T) {
	raw, err := os.ReadFile("../../examples/conflict.json")
	if err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	code, err := run(bytes.NewReader(raw), &out)
	if err != nil || code != 1 {
		t.Fatalf("code %d: %v", code, err)
	}
	var result struct {
		Status   string
		Conflict []fit.Requirement `json:"conflicting_roots"`
	}
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	var request fit.Request
	if err := json.Unmarshal(raw, &request); err != nil {
		t.Fatal(err)
	}
	if result.Status != "unsatisfiable" || !slices.Equal(result.Conflict, request.Roots[:2]) {
		t.Fatal(result)
	}
	for i := range result.Conflict {
		request.Roots = slices.Delete(slices.Clone(result.Conflict), i, i+1)
		plan, err := fit.Solve(request)
		if err != nil || plan == nil {
			t.Fatalf("conflict is reducible: %+v %v", request.Roots, err)
		}
	}
}

func TestInvalidInputAndRemoval(t *testing.T) {
	for _, data := range []string{`{}`, `{"catalog":{},"roots":[],"extra":1}`, `{"catalog":{"X":[{"revision":1},{"revision":1}]},"roots":[]}`, `{"catalog":{},"roots":[]} null`} {
		var out bytes.Buffer
		if c, err := run(strings.NewReader(data), &out); c != 2 || err == nil || out.Len() != 0 {
			t.Fatalf("accepted %s", data)
		}
	}
	var out bytes.Buffer
	c, err := run(strings.NewReader(`{"catalog":{},"roots":[],"installed":{"obsolete":7}}`), &out)
	if c != 0 || err != nil || !strings.Contains(out.String(), `"after": null`) {
		t.Fatal(out.String(), err)
	}
}
