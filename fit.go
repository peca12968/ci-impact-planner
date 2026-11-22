// Package fit selects compatible integer revisions for an offline plugin catalog.
package fit

import (
	"fmt"
	"maps"
	"slices"
	"strings"
)

type Requirement struct {
	Plugin string `json:"plugin"`
	Min    int    `json:"min"`
	Max    int    `json:"max"`
}

type Release struct {
	Revision int           `json:"revision"`
	Requires []Requirement `json:"requires,omitempty"`
}

type Request struct {
	Catalog   map[string][]Release `json:"catalog"`
	Roots     []Requirement        `json:"roots"`
	Installed map[string]int       `json:"installed"`
}

type Plan struct {
	Selected map[string]int `json:"selected"`
	Edits    int            `json:"edits"`
}

func validRequirements(requirements []Requirement) error {
	for _, req := range requirements {
		if strings.TrimSpace(req.Plugin) == "" || req.Min < 1 || req.Max < req.Min {
			return fmt.Errorf("invalid requirement %+v", req)
		}
	}
	return nil
}

// Solve returns nil for an unsatisfiable request. Each install, replacement or removal costs one edit.
func Solve(request Request) (*Plan, error) {
	if err := validRequirements(request.Roots); err != nil {
		return nil, err
	}
	for name, releases := range request.Catalog {
		if strings.TrimSpace(name) == "" {
			return nil, fmt.Errorf("blank catalog name")
		}
		seen := make(map[int]bool)
		for _, release := range releases {
			if release.Revision < 1 || seen[release.Revision] {
				return nil, fmt.Errorf("invalid or repeated revision %d for %s", release.Revision, name)
			}
			seen[release.Revision] = true
			if err := validRequirements(release.Requires); err != nil {
				return nil, err
			}
		}
	}
	for name, revision := range request.Installed {
		if strings.TrimSpace(name) == "" || revision < 1 {
			return nil, fmt.Errorf("invalid installed plugin %q at revision %d", name, revision)
		}
	}
	names := slices.Sorted(maps.Keys(request.Catalog))
	chosen := make(map[string]int)
	var best *Plan
	var visit func([]Requirement, int)
	visit = func(requirements []Requirement, edits int) {
		if best != nil && edits > best.Edits {
			return
		}
		bounds := make(map[string]Requirement)
		for _, req := range requirements {
			if existing, ok := bounds[req.Plugin]; ok {
				req.Min = max(req.Min, existing.Min)
				req.Max = min(req.Max, existing.Max)
			}
			revision, set := chosen[req.Plugin]
			if req.Min > req.Max || set && (revision < req.Min || revision > req.Max) {
				return
			}
			bounds[req.Plugin] = req
		}
		// Branch on the unassigned requirement with the fewest legal revisions.
		var next string
		var options []Release
		for name, interval := range bounds {
			if _, set := chosen[name]; set {
				continue
			}
			var matches []Release
			for _, release := range request.Catalog[name] {
				if release.Revision >= interval.Min && release.Revision <= interval.Max {
					matches = append(matches, release)
				}
			}
			if len(matches) == 0 {
				return
			}
			if next == "" || len(matches) < len(options) || len(matches) == len(options) && name < next {
				next, options = name, matches
			}
		}
		if next == "" {
			for name := range request.Installed {
				if _, keep := chosen[name]; !keep {
					edits++
				}
			}
			if best == nil || edits < best.Edits || edits == best.Edits && prefer(chosen, best.Selected, names) {
				best = &Plan{Selected: maps.Clone(chosen), Edits: edits}
			}
			return
		}
		for _, release := range options {
			cost := edits
			if request.Installed[next] != release.Revision {
				cost++
			}
			chosen[next] = release.Revision
			visit(append(requirements, release.Requires...), cost)
			delete(chosen, next)
		}
	}
	visit(slices.Clone(request.Roots), 0)
	return best, nil
}

// On equal costs compare revisions in sorted plugin-name order, treating absence as zero.
func prefer(left, right map[string]int, names []string) bool {
	for _, name := range names {
		if left[name] != right[name] {
			return left[name] > right[name]
		}
	}
	return false
}
