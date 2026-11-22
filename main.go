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
	fields := strings.Split(value, ",")
	if len(fields) != 4 {
		return errors.New("expected mask x,y,width,height")
	}
	var v [4]int
	for i, field := range fields {
		n, err := strconv.Atoi(field)
		if err != nil || n < 0 || n > maxPixels {
			return errors.New("invalid mask coordinate")
		}
		v[i] = n
	}
	if v[2] == 0 || v[3] == 0 {
		return errors.New("empty mask")
	}
	*m = append(*m, image.Rect(v[0], v[1], v[0]+v[2], v[1]+v[3]))
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
	report, diff := compare(base, candidate, ignores, *tolerance, *budget)
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
