// Command plugin-fit reads an offline catalog and prints an installation plan.
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"slices"
	"strings"

	fit "github.com/peca12968/plugin-fit"
)

type edit struct {
	Plugin string `json:"plugin"`
	Before *int   `json:"before"`
	After  *int   `json:"after"`
}

func diff(old, selected map[string]int) []edit {
	result := []edit{}
	for name, before := range old {
		after, keep := selected[name]
		if !keep {
			result = append(result, edit{name, &before, nil})
		} else if before != after {
			result = append(result, edit{name, &before, &after})
		}
	}
	for name, after := range selected {
		if _, known := old[name]; !known {
			result = append(result, edit{name, nil, &after})
		}
	}
	slices.SortFunc(result, func(a, b edit) int { return strings.Compare(a.Plugin, b.Plugin) })
	return result
}

func run(input io.Reader, output io.Writer) (int, error) {
	var req *fit.Request
	decoder := json.NewDecoder(input)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		return 2, err
	}
	if req == nil || req.Catalog == nil || req.Roots == nil {
		return 2, errors.New("expected catalog object and roots array")
	}
	if err := decoder.Decode(new(json.RawMessage)); err != io.EOF {
		return 2, errors.New("expected exactly one JSON document")
	}
	plan, err := fit.Solve(*req)
	if err != nil {
		return 2, err
	}
	encoder := json.NewEncoder(output)
	encoder.SetIndent("", "  ")
	if plan == nil {
		// The full request is already validated and unsatisfiable. Drop each
		// root whose removal still leaves an unsatisfiable request.
		core := slices.Clone(req.Roots)
		for i := 0; i < len(core); {
			trial := *req
			trial.Roots = slices.Delete(slices.Clone(core), i, i+1)
			candidate, err := fit.Solve(trial)
			if err != nil {
				return 2, err
			}
			if candidate == nil {
				core = trial.Roots
			} else {
				i++
			}
		}
		return 1, encoder.Encode(struct {
			Status   string            `json:"status"`
			Conflict []fit.Requirement `json:"conflicting_roots"`
		}{"unsatisfiable", core})
	}
	return 0, encoder.Encode(struct {
		Status   string         `json:"status"`
		Selected map[string]int `json:"selected"`
		Changes  []edit         `json:"changes"`
	}{"compatible", plan.Selected, diff(req.Installed, plan.Selected)})
}

func main() {
	input := os.Stdin
	if len(os.Args) > 2 {
		fmt.Fprintln(os.Stderr, "usage: plugin-fit [request.json]")
		os.Exit(2)
	}
	if len(os.Args) == 2 {
		file, err := os.Open(os.Args[1])
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(2)
		}
		input = file
	}
	code, err := run(input, os.Stdout)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		code = 2
	}
	os.Exit(code)
}
