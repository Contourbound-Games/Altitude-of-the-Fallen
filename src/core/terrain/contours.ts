import type { Point } from '../geometry';
import { elevationAt, type ElevationGrid } from './elevation';

/** A straight piece of a contour line, in world pixels. */
export interface Segment
{
    readonly a: Point;
    readonly b: Point;
}

/**
 * Line segments tracing where the elevation equals `level`.
 *
 * Marching squares over a lattice `subdivisions` times finer than the elevation grid, with every
 * lattice value read from `elevationAt`, so the lines follow the same surface movement uses.
 * Crossing points sit exactly on the surface (it is linear along lattice edges); between them
 * the curved bilinear contour is approximated by straight segments.
 *
 * A lattice value equal to `level` counts as above it. In an ambiguous cell (diagonal corners
 * above, the other two below) the cell-centre value decides: if it is at or above `level` the
 * high corners are joined through the middle, otherwise the low corners are.
 */
export function contourSegments (grid: ElevationGrid, level: number, subdivisions: number): Segment[]
{
    if (!Number.isInteger(subdivisions) || subdivisions < 1)
    {
        throw new RangeError(`Contour subdivisions must be a positive integer, got ${subdivisions}`);
    }

    const step = grid.spacing / subdivisions;
    const columns = (grid.columns - 1) * subdivisions + 1;
    const rows = (grid.rows - 1) * subdivisions + 1;
    const values = new Float64Array(columns * rows);

    for (let j = 0; j < rows; j++)
    {
        for (let i = 0; i < columns; i++)
        {
            values[j * columns + i] = elevationAt(grid, i * step, j * step);
        }
    }

    const value = (i: number, j: number) => values[j * columns + i];

    // Crossing on the lattice edge from (i, j) to (i + 1, j), or from (i, j) to (i, j + 1).
    // Each edge is always computed from the same end, so neighbouring cells share exact endpoints.
    const across = (i: number, j: number): Point => {
        const t = (level - value(i, j)) / (value(i + 1, j) - value(i, j));
        return { x: (i + t) * step, y: j * step };
    };
    const down = (i: number, j: number): Point => {
        const t = (level - value(i, j)) / (value(i, j + 1) - value(i, j));
        return { x: i * step, y: (j + t) * step };
    };

    const segments: Segment[] = [];
    const add = (a: Point, b: Point) => {
        if (a.x !== b.x || a.y !== b.y)
        {
            segments.push({ a, b });
        }
    };

    for (let j = 0; j < rows - 1; j++)
    {
        for (let i = 0; i < columns - 1; i++)
        {
            const topLeft = value(i, j) >= level;
            const topRight = value(i + 1, j) >= level;
            const bottomRight = value(i + 1, j + 1) >= level;
            const bottomLeft = value(i, j + 1) >= level;
            const index = (topLeft ? 8 : 0) | (topRight ? 4 : 0) | (bottomRight ? 2 : 0) | (bottomLeft ? 1 : 0);

            if (index === 0 || index === 15)
            {
                continue;
            }

            const top = () => across(i, j);
            const bottom = () => across(i, j + 1);
            const left = () => down(i, j);
            const right = () => down(i + 1, j);

            switch (index)
            {
                case 1: case 14: add(left(), bottom()); break;
                case 2: case 13: add(bottom(), right()); break;
                case 3: case 12: add(left(), right()); break;
                case 4: case 11: add(top(), right()); break;
                case 6: case 9: add(top(), bottom()); break;
                case 7: case 8: add(top(), left()); break;
                case 5: case 10:
                {
                    const centreHigh = elevationAt(grid, (i + 0.5) * step, (j + 0.5) * step) >= level;
                    // Cut off the two corners that are NOT joined through the centre.
                    const cutTopLeftAndBottomRight = (index === 5) === centreHigh;

                    if (cutTopLeftAndBottomRight)
                    {
                        add(top(), left());
                        add(bottom(), right());
                    }
                    else
                    {
                        add(top(), right());
                        add(left(), bottom());
                    }
                    break;
                }
            }
        }
    }

    return segments;
}
