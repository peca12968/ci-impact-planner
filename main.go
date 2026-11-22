package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"image"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Keep memory bounded before decoding screenshots supplied on the command line.
const maxPixels = 12_000_000

type masks []image.Rectangle

func (m *masks) String() string { return fmt.Sprint([]image.Rectangle(*m)) }
func (m *masks) Set(value string) error {
	rect, err := parseRect(strings.Split(value, ","))
	if err == nil {
		*m = append(*m, rect)
	}
	return err
}

func parseRect(fields []string) (image.Rectangle, error) {
	if len(fields) != 4 {
		return image.Rectangle{}, errors.New("expected x,y,width,height")
	}
	var v [4]int
	for i, field := range fields {
		n, err := strconv.Atoi(field)
		if err != nil || n < 0 || n > maxPixels {
			return image.Rectangle{}, errors.New("invalid rectangle coordinate")
		}
		v[i] = n
	}
	if v[2] == 0 || v[3] == 0 {
		return image.Rectangle{}, errors.New("empty rectangle")
	}
	return image.Rect(v[0], v[1], v[0]+v[2], v[1]+v[3]), nil
}

type zone struct {
	name   string
	rect   image.Rectangle
	budget int
}

type zones []zone

func (z *zones) String() string { return fmt.Sprint([]zone(*z)) }
func (z *zones) Set(value string) error {
	fields := strings.Split(value, ",")
	if len(fields) != 6 || strings.TrimSpace(fields[0]) == "" {
		return errors.New("expected zone name,x,y,width,height,budget")
	}
	name := strings.TrimSpace(fields[0])
	for _, prior := range *z {
		if prior.name == name {
			return fmt.Errorf("duplicate zone %q", name)
		}
	}
	rect, err := parseRect(fields[1:5])
	if err != nil {
		return err
	}
	budget, err := strconv.Atoi(fields[5])
	if err != nil || budget < 0 {
		return errors.New("zone budget must be a nonnegative integer")
	}
	*z = append(*z, zone{name, rect, budget})
	return nil
}

func load(path string) (image.Image, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	cfg, err := png.DecodeConfig(f)
	if err != nil {
		return nil, err
	}
	if cfg.Height <= 0 || cfg.Width <= 0 || cfg.Width > maxPixels/cfg.Height {
		return nil, errors.New("PNG exceeds pixel limit")
	}
	if _, err = f.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}
	return png.Decode(f)
}

func writeDiff(path string, diff image.Image, inputs []string) error {
	existing, err := os.Stat(path)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	if existing != nil {
		for _, input := range inputs {
			info, err := os.Stat(input)
			if err != nil {
				return err
			}
			if os.SameFile(existing, info) {
				return errors.New("diff output would overwrite an input")
			}
		}
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".frame-delta-*.png")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	encodeErr := png.Encode(tmp, diff)
	closeErr := tmp.Close()
	if encodeErr != nil {
		return encodeErr
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(tmp.Name(), path)
}

func run(args []string) (int, error) {
	flags := flag.NewFlagSet("frame-delta", flag.ContinueOnError)
	tolerance := flags.Int("tolerance", 0, "maximum allowed difference per visible RGB channel")
	budget := flags.Int("budget", 0, "maximum changed pixels for a pass")
	output := flags.String("diff", "", "write a diagnostic PNG")
	var ignores masks
	flags.Var(&ignores, "ignore", "ignore a rectangle x,y,width,height (repeatable)")
	var checks zones
	flags.Var(&checks, "zone", "check name,x,y,width,height,budget (repeatable)")
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0, nil
		}
		return 2, err
	}
	if flags.NArg() != 2 || *budget < 0 || *tolerance < 0 || *tolerance > 255 {
		return 2, errors.New("usage: frame-delta [flags] BASELINE.png CANDIDATE.png (budget >= 0, tolerance 0..255)")
	}
	base, err := load(flags.Arg(0))
	if err != nil {
		return 2, err
	}
	candidate, err := load(flags.Arg(1))
	if err != nil {
		return 2, err
	}
	if base.Bounds().Size() != candidate.Bounds().Size() {
		return 2, errors.New("image dimensions differ")
	}
	for _, r := range ignores {
		if !r.In(base.Bounds()) {
			return 2, errors.New("mask exceeds screenshot bounds")
		}
	}
	for _, check := range checks {
		if !check.rect.In(base.Bounds()) {
			return 2, fmt.Errorf("zone %q exceeds screenshot bounds", check.name)
		}
	}
	report, diff := compare(base, candidate, ignores, checks, *tolerance, *budget)
	if *output != "" {
		if err := writeDiff(*output, diff, flags.Args()); err != nil {
			return 2, err
		}
	}
	if err := json.NewEncoder(os.Stdout).Encode(report); err != nil {
		return 2, err
	}
	if !report.Passed {
		return 1, nil
	}
	return 0, nil
}

func main() {
	code, err := run(os.Args[1:])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
	}
	os.Exit(code)
}
