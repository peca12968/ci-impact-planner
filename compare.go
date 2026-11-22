package main

import (
	"image"
	"image/color"
	"slices"
)

type Region struct {
	Pixels int `json:"pixels"`
	Left   int `json:"left"`
	Top    int `json:"top"`
	Right  int `json:"right"`
	Bottom int `json:"bottom"`
}

type Report struct {
	Width        int          `json:"width"`
	Height       int          `json:"height"`
	Ignored      int          `json:"ignored_pixels"`
	Changed      int          `json:"changed_pixels"`
	RegionCount  int          `json:"region_count"`
	Largest      []Region     `json:"largest_regions"`
	GlobalPassed bool         `json:"global_passed"`
	Zones        []ZoneResult `json:"zones,omitempty"`
	Passed       bool         `json:"passed"`
}

type ZoneResult struct {
	Name     string `json:"name"`
	Budget   int    `json:"budget"`
	Compared int    `json:"compared_pixels"`
	Changed  int    `json:"changed_pixels"`
	Passed   bool   `json:"passed"`
}

// Sample a running 2D prefix sum at the top and bottom edges of each rectangle.
// Overlapping zones share the scan. Only one row of prefix sums stays in memory.
func evaluateZones(state []byte, width int, checks []zone) []ZoneResult {
	if len(checks) == 0 {
		return nil
	}
	type edge struct{ index, sign int }
	edges := make(map[int][]edge)
	results := make([]ZoneResult, len(checks))
	lastRow := 0
	for i, check := range checks {
		r := check.rect
		results[i] = ZoneResult{Name: check.name, Budget: check.budget}
		if r.Min.Y > 0 {
			edges[r.Min.Y] = append(edges[r.Min.Y], edge{i, -1})
		}
		edges[r.Max.Y] = append(edges[r.Max.Y], edge{i, 1})
		lastRow = max(lastRow, r.Max.Y)
	}
	type counts struct{ compared, changed int }
	prefix := make([]counts, width+1)
	for y := 0; y < lastRow; y++ {
		var row counts
		for x, pixel := range state[y*width : (y+1)*width] {
			if pixel != 2 {
				row.compared++
			}
			if pixel == 1 {
				row.changed++
			}
			prefix[x+1].compared += row.compared
			prefix[x+1].changed += row.changed
		}
		for _, e := range edges[y+1] {
			r := checks[e.index].rect
			left, right := prefix[r.Min.X], prefix[r.Max.X]
			results[e.index].Compared += e.sign * (right.compared - left.compared)
			results[e.index].Changed += e.sign * (right.changed - left.changed)
		}
	}
	for i := range results {
		z := &results[i]
		z.Passed = z.Compared > 0 && z.Changed <= z.Budget
	}
	return results
}

// Go supplies premultiplied 16-bit channels. Composite onto white, then round to 8 bits.
func visible(c color.Color) [3]int {
	r, g, b, a := c.RGBA()
	white := 65535 - a + 128
	return [3]int{int((r + white) / 257), int((g + white) / 257), int((b + white) / 257)}
}

func compare(base, candidate image.Image, ignores []image.Rectangle, checks []zone, tolerance, budget int) (Report, *image.RGBA) {
	bounds := base.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	state := make([]byte, width*height)
	for _, rect := range ignores {
		for y := rect.Min.Y; y < rect.Max.Y; y++ {
			for x := rect.Min.X; x < rect.Max.X; x++ {
				state[y*width+x] = 2
			}
		}
	}
	diff := image.NewRGBA(image.Rect(0, 0, width, height))
	report := Report{Width: width, Height: height, Largest: []Region{}}
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			i := y*width + x
			if state[i] == 2 {
				report.Ignored++
				diff.SetRGBA(x, y, color.RGBA{173, 203, 222, 255})
				continue
			}
			a := visible(base.At(x+bounds.Min.X, y+bounds.Min.Y))
			b := visible(candidate.At(x+candidate.Bounds().Min.X, y+candidate.Bounds().Min.Y))
			delta := 0
			for k := range a {
				delta = max(delta, a[k]-b[k], b[k]-a[k])
			}
			if delta > tolerance {
				state[i] = 1
				report.Changed++
				diff.SetRGBA(x, y, color.RGBA{190, 16, 94, 255})
			} else {
				shade := uint8(120 + (299*b[0]+587*b[1]+114*b[2])*135/255000)
				diff.SetRGBA(x, y, color.RGBA{shade, shade, shade, 255})
			}
		}
	}
	report.GlobalPassed = report.Changed <= budget
	report.Passed = report.GlobalPassed
	report.Zones = evaluateZones(state, width, checks)
	for _, z := range report.Zones {
		report.Passed = report.Passed && z.Passed
	}
	// Flood-fill only changed pixels. The top ten are kept in stable scan order on ties.
	stack := []int{}
	visit := func(i int) {
		if state[i] == 1 {
			state[i] = 0
			stack = append(stack, i)
		}
	}
	for start, mark := range state {
		if mark != 1 {
			continue
		}
		report.RegionCount++
		region := Region{Left: width, Top: height}
		visit(start)
		for len(stack) > 0 {
			i := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			x, y := i%width, i/width
			region.Pixels++
			region.Left = min(region.Left, x)
			region.Right = max(region.Right, x+1)
			region.Top = min(region.Top, y)
			region.Bottom = max(region.Bottom, y+1)
			if x > 0 {
				visit(i - 1)
			}
			if x+1 < width {
				visit(i + 1)
			}
			if y > 0 {
				visit(i - width)
			}
			if y+1 < height {
				visit(i + width)
			}
		}
		pos := 0
		for pos < len(report.Largest) && report.Largest[pos].Pixels >= region.Pixels {
			pos++
		}
		if pos < 10 {
			report.Largest = slices.Insert(report.Largest, pos, region)
			if len(report.Largest) > 10 {
				report.Largest = report.Largest[:10]
			}
		}
	}
	return report, diff
}
