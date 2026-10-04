import { describe, expect, it } from 'vitest';
import type { Point } from '../geometry';
import { contourSegments, type Segment } from './contours';
import { createElevationGrid, elevationAt, gridHeight, gridWidth, slopeBetween, type ElevationGrid } from './elevation';
import { FIELD_ELEVATION } from './fieldElevation';

const key = (p: Point) => `${p.x},${p.y}`;
const length = (segments: Segment[]) => segments.reduce((sum, s) => sum + Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y), 0);

/** How many segment ends meet at each endpoint. A closed loop has exactly two everywhere. */
function endpointCounts (segments: Segment[]): Map<string, number>
{
    const counts = new Map<string, number>();

    for (const { a, b } of segments)
    {
        counts.set(key(a), (counts.get(key(a)) ?? 0) + 1);
        counts.set(key(b), (counts.get(key(b)) ?? 0) + 1);
    }

    return counts;
}

/** Whether `p` is enclosed by the segments (ray cast towards +x). */
function encloses (segments: Segment[], p: Point): boolean
{
    let inside = false;

    for (const { a, b } of segments)
    {
        if ((a.y > p.y) !== (b.y > p.y) && p.x < a.x + (p.y - a.y) * (b.x - a.x) / (b.y - a.y))
        {
            inside = !inside;
        }
    }

    return inside;
}

function expectWellFormed (grid: ElevationGrid, level: number, segments: Segment[])
{
    for (const { a, b } of segments)
    {
        for (const p of [a, b])
        {
            expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
            expect(p.x).toBeGreaterThanOrEqual(0);
            expect(p.y).toBeGreaterThanOrEqual(0);
            expect(p.x).toBeLessThanOrEqual(gridWidth(grid));
            expect(p.y).toBeLessThanOrEqual(gridHeight(grid));
            // Endpoints lie on the surface at the requested elevation.
            expect(elevationAt(grid, p.x, p.y)).toBeCloseTo(level, 9);
        }
    }
}

describe('contourSegments', () => {
    it('draws nothing for a level the terrain never reaches', () => {
        const flat = createElevationGrid(10, [[0.5, 0.5], [0.5, 0.5]]);

        expect(contourSegments(flat, 0.3, 4)).toEqual([]);
        expect(contourSegments(flat, 0.7, 4)).toEqual([]);
        expect(contourSegments(FIELD_ELEVATION, -0.1, 9)).toEqual([]);
        expect(contourSegments(FIELD_ELEVATION, 1.1, 9)).toEqual([]);
    });

    it('traces a straight line across a planar slope where the plane meets the level', () => {
        // Rises from 0 at x = 0 to 1 at x = 40, level north-south: 40 x 20 px.
        const plane = createElevationGrid(20, [[0, 0.5, 1], [0, 0.5, 1]]);

        for (const level of [0.1, 0.25, 0.6, 0.9])
        {
            const segments = contourSegments(plane, level, 5);
            const points = segments.flatMap(s => [s.a, s.b]);

            expectWellFormed(plane, level, segments);
            for (const p of points)
            {
                expect(p.x).toBeCloseTo(level * 40, 9);
            }
            expect(Math.min(...points.map(p => p.y))).toBe(0);
            expect(Math.max(...points.map(p => p.y))).toBe(20);
            expect(length(segments)).toBeCloseTo(20, 9);
        }
    });

    it('spaces contours by interval / slope: twice as steep, half as far apart', () => {
        // Gentle half (x 0..20) rises 0.2, steep half (x 20..40) rises 0.4.
        const plane = createElevationGrid(20, [[0, 0.2, 0.6], [0, 0.2, 0.6]]);
        const xAt = (level: number) => contourSegments(plane, level, 5)[0].a.x;

        expect(xAt(0.1) - xAt(0.05)).toBeCloseTo(5);   // 0.05 apart at 0.01 per px
        expect(xAt(0.35) - xAt(0.3)).toBeCloseTo(2.5); // 0.05 apart at 0.02 per px
    });

    it('closes a ring around a hilltop, smaller for higher levels', () => {
        const hill = createElevationGrid(10, [
            [0, 0, 0],
            [0, 1, 0],
            [0, 0, 0]
        ]);
        const peak = { x: 10, y: 10 };
        const reach = (segments: Segment[]) => Math.max(...segments.flatMap(s => [s.a, s.b]).map(p => Math.hypot(p.x - peak.x, p.y - peak.y)));

        for (const level of [0.2, 0.5, 0.8])
        {
            const ring = contourSegments(hill, level, 6);

            expectWellFormed(hill, level, ring);
            expect(ring.length).toBeGreaterThan(8);
            expect([...endpointCounts(ring).values()].every(count => count === 2)).toBe(true);
            expect(encloses(ring, peak)).toBe(true);
            expect(encloses(ring, { x: 1, y: 1 })).toBe(false);
        }

        expect(reach(contourSegments(hill, 0.8, 6))).toBeLessThan(reach(contourSegments(hill, 0.5, 6)));
        expect(reach(contourSegments(hill, 0.5, 6))).toBeLessThan(reach(contourSegments(hill, 0.2, 6)));
    });

    it('resolves a saddle cell by its centre value', () => {
        // High corners top-left and bottom-right; the centre is 0.5.
        const saddle = createElevationGrid(10, [[1, 0], [0, 1]]);
        const cutsCorner = (segments: Segment[], corner: Point) => segments.some(({ a, b }) => {
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            return Math.abs(mid.x - corner.x) < 5 && Math.abs(mid.y - corner.y) < 5;
        });

        // Below the centre value: the high corners connect through the middle; the low corners are cut off.
        const joined = contourSegments(saddle, 0.4, 1);
        expect(joined).toHaveLength(2);
        expect(cutsCorner(joined, { x: 10, y: 0 }) && cutsCorner(joined, { x: 0, y: 10 })).toBe(true);

        // Above the centre value: the high corners are separate islands.
        const separate = contourSegments(saddle, 0.6, 1);
        expect(separate).toHaveLength(2);
        expect(cutsCorner(separate, { x: 0, y: 0 }) && cutsCorner(separate, { x: 10, y: 10 })).toBe(true);
    });

    it('is deterministic', () => {
        expect(contourSegments(FIELD_ELEVATION, 4.5 / 9, 9)).toEqual(contourSegments(FIELD_ELEVATION, 4.5 / 9, 9));
    });

    it('rejects a non-integer subdivision count', () => {
        expect(() => contourSegments(FIELD_ELEVATION, 0.5, 2.5)).toThrow(RangeError);
        expect(() => contourSegments(FIELD_ELEVATION, 0.5, 0)).toThrow(RangeError);
    });
});

describe('contours of the test field', () => {
    const levels = Array.from({ length: 9 }, (_, k) => (k + 0.5) / 9);
    const byLevel = levels.map(level => contourSegments(FIELD_ELEVATION, level, 9));

    it('produce well-formed lines on the surface at every half level', () => {
        levels.forEach((level, k) => {
            expect(byLevel[k].length).toBeGreaterThan(0);
            expectWellFormed(FIELD_ELEVATION, level, byLevel[k]);
        });
    });

    it('ring the summit with the highest contour and leave the flat plateau empty', () => {
        const top = byLevel[8];

        expect([...endpointCounts(top).values()].every(count => count === 2)).toBe(true);
        expect(encloses(top, { x: 340, y: 180 })).toBe(true);

        const plateau = byLevel.flat().flatMap(s => [s.a, s.b]).filter(p => p.x < 120);
        expect(plateau).toEqual([]);
    });

    /** x positions where contours cross the horizontal line y, between x0 and x1 (half-open, so shared ends count once). */
    const crossings = (y: number, x0: number, x1: number) => byLevel.flat()
        .filter(({ a, b }) => (a.y > y) !== (b.y > y))
        .map(({ a, b }) => a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y))
        .filter(x => x >= x0 && x <= x1)
        .sort((p, q) => p - q);

    it('space contours by 1/9 divided by the slope movement measures along the same line', () => {
        // Gentle ridge (y = 120), the 5 -> 7 step on the west flank (y = 180) and the headwall (y = 180).
        for (const [y, x0, x1, spacing] of [[120, 400, 560, 40], [180, 200, 240, 20], [180, 360, 400, 40 / 7]])
        {
            const xs = crossings(y, x0, x1);

            expect(xs.length).toBeGreaterThan(0);
            for (let n = 1; n < xs.length; n++)
            {
                const gap = xs[n] - xs[n - 1];
                const slope = Math.abs(slopeBetween(FIELD_ELEVATION, { x: xs[n - 1], y }, { x: xs[n], y }));

                expect(gap).toBeCloseTo(spacing, 6);
                expect(gap * slope).toBeCloseTo(1 / 9, 9);
            }
        }
    });
});
