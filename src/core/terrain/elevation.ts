import { clamp, type Point } from '../geometry';

/**
 * Elevation samples on a regular grid.
 *
 * Sample (column, row) sits at world position (column * spacing, row * spacing),
 * so the grid covers [0, gridWidth] x [0, gridHeight] in world pixels.
 * Values are normalized: 0 is the lowest ground, 1 the highest.
 */
export interface ElevationGrid
{
    readonly columns: number;
    readonly rows: number;
    /** World pixels between neighbouring samples. */
    readonly spacing: number;
    /** Row-major: index = row * columns + column. */
    readonly samples: readonly number[];
}

/** Builds a grid from rows of samples (top row first). Throws on malformed data. */
export function createElevationGrid (spacing: number, rows: readonly (readonly number[])[]): ElevationGrid
{
    if (!(spacing > 0))
    {
        throw new RangeError(`Elevation spacing must be positive, got ${spacing}`);
    }

    const columns = rows[0]?.length ?? 0;

    if (rows.length < 2 || columns < 2)
    {
        throw new RangeError(`Elevation grid needs at least 2x2 samples, got ${columns}x${rows.length}`);
    }

    const samples: number[] = [];

    rows.forEach((row, r) => {
        if (row.length !== columns)
        {
            throw new RangeError(`Elevation row ${r} has ${row.length} samples, expected ${columns}`);
        }

        row.forEach((value, c) => {
            if (!(value >= 0 && value <= 1))
            {
                throw new RangeError(`Elevation sample (${c}, ${r}) is ${value}, expected 0..1`);
            }

            samples.push(value);
        });
    });

    return { columns, rows: rows.length, spacing, samples };
}

export function gridWidth (grid: ElevationGrid): number
{
    return (grid.columns - 1) * grid.spacing;
}

export function gridHeight (grid: ElevationGrid): number
{
    return (grid.rows - 1) * grid.spacing;
}

/**
 * Elevation at a continuous world position.
 *
 * Bilinear interpolation between the four surrounding samples: exact at sample points,
 * linear along grid lines, continuous across cells. Positions outside the grid read
 * the nearest edge value.
 */
export function elevationAt (grid: ElevationGrid, x: number, y: number): number
{
    const gx = clamp(x / grid.spacing, 0, grid.columns - 1);
    const gy = clamp(y / grid.spacing, 0, grid.rows - 1);

    // Top-left sample of the containing cell. Points on the far edge use the last cell.
    const column = Math.min(Math.floor(gx), grid.columns - 2);
    const row = Math.min(Math.floor(gy), grid.rows - 2);
    const tx = gx - column;
    const ty = gy - row;

    const s = grid.samples;
    const i = row * grid.columns + column;
    const top = lerp(s[i], s[i + 1], tx);
    const bottom = lerp(s[i + grid.columns], s[i + grid.columns + 1], tx);

    return lerp(top, bottom, ty);
}

/** Elevation change going from `from` to `to`, in normalized units. Positive is uphill. */
export function elevationDelta (grid: ElevationGrid, from: Point, to: Point): number
{
    return elevationAt(grid, to.x, to.y) - elevationAt(grid, from.x, from.y);
}

/**
 * Average slope going from `from` to `to`: elevation delta divided by the straight-line
 * distance between them, in normalized elevation per world pixel. Positive is uphill.
 * Returns 0 when the two points coincide.
 */
export function slopeBetween (grid: ElevationGrid, from: Point, to: Point): number
{
    const run = Math.hypot(to.x - from.x, to.y - from.y);

    return run === 0 ? 0 : elevationDelta(grid, from, to) / run;
}

// Weighted form is exact at t = 0 and t = 1, unlike a + (b - a) * t.
function lerp (a: number, b: number, t: number): number
{
    return a * (1 - t) + b * t;
}
