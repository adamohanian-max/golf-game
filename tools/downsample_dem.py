#!/usr/bin/env python3
"""Box-average a baked course's DEM grid down to a coarser resolution.

Some courses' `dem` grid ended up far denser than the game needs — e.g.
colonial-country-club.json baked at 1106x1317 (~1.46M cells, 8.5MB of the
9MB total file) vs. a ~58K-cell median across the other 108 courses. The DEM
just feeds smooth terrain elevation (hillshade, green topo, tilt lift) —
every consumer (buildDEMShade/terrainZ/liftAt in game.js) bilinear/gradient-
samples it, so a coarser grid costs no visible fidelity at this scale, just
less JSON to download/parse and less memory to hold.

This is a pure re-grid: `x0/x1/y0/y1` (the physical bounds) and `baseElevM`
are untouched, only `nx`/`ny`/`data` change. No network calls, no re-bake of
geometry/imagery — safe to run on any course whose grid is oversized.

Usage:
  python3 tools/downsample_dem.py courses/colonial-country-club.json --factor 4
  python3 tools/downsample_dem.py courses/colonial-country-club.json --factor 4 --dry-run
"""
import argparse, json, os, sys


def downsample(dem, factor):
    nx, ny, data = dem["nx"], dem["ny"], dem["data"]
    new_nx = max(2, -(-nx // factor))  # ceil division
    new_ny = max(2, -(-ny // factor))
    new_data = [0.0] * (new_nx * new_ny)
    for j2 in range(new_ny):
        j0, j1 = j2 * factor, min(ny, (j2 + 1) * factor)
        for i2 in range(new_nx):
            i0, i1 = i2 * factor, min(nx, (i2 + 1) * factor)
            total, count = 0.0, 0
            for j in range(j0, j1):
                row = j * nx
                for i in range(i0, i1):
                    total += data[row + i]
                    count += 1
            new_data[j2 * new_nx + i2] = total / count if count else 0.0
    return new_nx, new_ny, new_data


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("course_json", help="path to courses/<id>.json")
    ap.add_argument("--factor", type=int, default=4, help="cells-per-new-cell in each axis (default 4)")
    ap.add_argument("--dry-run", action="store_true", help="print before/after sizes, don't write")
    args = ap.parse_args()

    path = args.course_json
    with open(path) as f:
        course = json.load(f)
    dem = course.get("dem")
    if not dem:
        sys.exit(f"{path}: no top-level 'dem' key")

    old_nx, old_ny = dem["nx"], dem["ny"]
    old_cells = old_nx * old_ny
    before_size = os.path.getsize(path)

    new_nx, new_ny, new_data = downsample(dem, args.factor)
    new_cells = new_nx * new_ny
    print(f"{path}: dem {old_nx}x{old_ny} ({old_cells:,} cells) -> {new_nx}x{new_ny} ({new_cells:,} cells), "
          f"factor {args.factor}, {old_cells / new_cells:.1f}x fewer cells")

    if args.dry_run:
        print("(dry run, not writing)")
        return

    dem["nx"], dem["ny"], dem["data"] = new_nx, new_ny, new_data
    with open(path, "w") as f:
        json.dump(course, f, separators=(",", ":"))

    after_size = os.path.getsize(path)
    print(f"{path}: {before_size:,} bytes -> {after_size:,} bytes ({after_size / before_size:.1%} of original)")


if __name__ == "__main__":
    main()
