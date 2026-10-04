import { describe, expect, it } from 'vitest';
import {
    createElevationGrid,
    elevationAt,
    elevationDelta,
    gridHeight,
    gridWidth,
    slopeBetween
} from './elevation';

// 3 x 2 samples, 10px apart: covers x 0..20, y 0..10.
//   (0,0)=0.0   (10,0)=1.0   (20,0)=0.5
//   (0,10)=0.5  (10,10)=0.25 (20,10)=0.0
const grid = createElevationGrid(10, [
    [0.0, 1.0, 0.5],
    [0.5, 0.25, 0.0]
]);

describe('elevationAt', () => {
    it('returns the stored value at every sample point', () => {
        expect(elevationAt(grid, 0, 0)).toBe(0.0);
        expect(elevationAt(grid, 10, 0)).toBe(1.0);
        expect(elevationAt(grid, 20, 0)).toBe(0.5);
        expect(elevationAt(grid, 0, 10)).toBe(0.5);
        expect(elevationAt(grid, 10, 10)).toBe(0.25);
        expect(elevationAt(grid, 20, 10)).toBe(0.0);
    });

    it('interpolates linearly along grid lines', () => {
        expect(elevationAt(grid, 2.5, 0)).toBeCloseTo(0.25);
        expect(elevationAt(grid, 5, 0)).toBeCloseTo(0.5);
        expect(elevationAt(grid, 15, 0)).toBeCloseTo(0.75);
        expect(elevationAt(grid, 0, 5)).toBeCloseTo(0.25);
        expect(elevationAt(grid, 10, 4)).toBeCloseTo(0.7);
    });

    it('returns the average of the four corners at a cell centre', () => {
        expect(elevationAt(grid, 5, 5)).toBeCloseTo((0.0 + 1.0 + 0.5 + 0.25) / 4);
        expect(elevationAt(grid, 15, 5)).toBeCloseTo((1.0 + 0.5 + 0.25 + 0.0) / 4);
    });

    it('stays within the range of the four surrounding samples', () => {
        const cell = createElevationGrid(10, [
            [0.2, 0.6],
            [0.4, 0.3]
        ]);

        for (let x = 0; x <= 10; x += 0.5)
        {
            for (let y = 0; y <= 10; y += 0.5)
            {
                const e = elevationAt(cell, x, y);
                expect(e).toBeGreaterThanOrEqual(0.2 - 1e-12);
                expect(e).toBeLessThanOrEqual(0.6 + 1e-12);
            }
        }
    });

    it('is continuous across the boundary between two cells', () => {
        const onLine = elevationAt(grid, 10, 7);
        expect(elevationAt(grid, 10 - 1e-9, 7)).toBeCloseTo(onLine, 6);
        expect(elevationAt(grid, 10 + 1e-9, 7)).toBeCloseTo(onLine, 6);
    });

    it('reads the far edges and corner of the grid', () => {
        expect(gridWidth(grid)).toBe(20);
        expect(gridHeight(grid)).toBe(10);
        expect(elevationAt(grid, 20, 10)).toBe(0.0);
        expect(elevationAt(grid, 20, 5)).toBeCloseTo(0.25);
        expect(elevationAt(grid, 15, 10)).toBeCloseTo(0.125);
    });

    it('clamps positions outside the grid to the nearest edge', () => {
        expect(elevationAt(grid, -50, 0)).toBe(elevationAt(grid, 0, 0));
        expect(elevationAt(grid, 5, -50)).toBe(elevationAt(grid, 5, 0));
        expect(elevationAt(grid, 99, 5)).toBe(elevationAt(grid, 20, 5));
        expect(elevationAt(grid, 99, 99)).toBe(elevationAt(grid, 20, 10));
    });
});

describe('elevationDelta and slopeBetween', () => {
    // Ramp rising 0.5 per 10px to the east, constant north-south.
    const ramp = createElevationGrid(10, [
        [0.0, 0.5, 1.0],
        [0.0, 0.5, 1.0]
    ]);

    it('is positive going uphill and negative going downhill', () => {
        const low = { x: 2, y: 5 };
        const high = { x: 18, y: 5 };

        expect(elevationDelta(ramp, low, high)).toBeCloseTo(0.8);
        expect(elevationDelta(ramp, high, low)).toBeCloseTo(-0.8);
        expect(slopeBetween(ramp, low, high)).toBeCloseTo(0.8 / 16);
        expect(slopeBetween(ramp, high, low)).toBeCloseTo(-0.8 / 16);
    });

    it('is zero when moving across the slope', () => {
        expect(elevationDelta(ramp, { x: 7, y: 0 }, { x: 7, y: 10 })).toBeCloseTo(0);
        expect(slopeBetween(ramp, { x: 7, y: 0 }, { x: 7, y: 10 })).toBeCloseTo(0);
    });

    it('divides by straight-line distance on diagonal moves', () => {
        // 6px east and 8px south is 10px of travel for 0.3 of rise.
        expect(slopeBetween(ramp, { x: 0, y: 0 }, { x: 6, y: 8 })).toBeCloseTo(0.3 / 10);
    });

    it('gives a constant slope along a uniform ramp regardless of step length', () => {
        const from = { x: 3, y: 5 };
        expect(slopeBetween(ramp, from, { x: 3.5, y: 5 })).toBeCloseTo(0.05);
        expect(slopeBetween(ramp, from, { x: 17, y: 5 })).toBeCloseTo(0.05);
    });

    it('returns zero delta and slope for identical points', () => {
        expect(elevationDelta(grid, { x: 4, y: 4 }, { x: 4, y: 4 })).toBe(0);
        expect(slopeBetween(grid, { x: 4, y: 4 }, { x: 4, y: 4 })).toBe(0);
    });
});

describe('flat terrain', () => {
    const flat = createElevationGrid(10, [
        [0.4, 0.4, 0.4],
        [0.4, 0.4, 0.4],
        [0.4, 0.4, 0.4]
    ]);

    it('has the same elevation everywhere, including outside the grid', () => {
        for (const [x, y] of [[0, 0], [3.3, 17.9], [10, 10], [20, 20], [-5, 40]])
        {
            expect(elevationAt(flat, x, y)).toBeCloseTo(0.4);
        }
    });

    it('has zero delta and slope in every direction', () => {
        const centre = { x: 10, y: 10 };

        for (const to of [{ x: 0, y: 10 }, { x: 20, y: 10 }, { x: 10, y: 0 }, { x: 10, y: 20 }, { x: 17, y: 3 }])
        {
            expect(elevationDelta(flat, centre, to)).toBeCloseTo(0);
            expect(slopeBetween(flat, centre, to)).toBeCloseTo(0);
        }
    });
});

describe('createElevationGrid', () => {
    it('rejects malformed data', () => {
        expect(() => createElevationGrid(10, [[0, 0], [0]])).toThrow(RangeError);
        expect(() => createElevationGrid(10, [[0, 1.5], [0, 0]])).toThrow(RangeError);
        expect(() => createElevationGrid(10, [[0, -0.1], [0, 0]])).toThrow(RangeError);
        expect(() => createElevationGrid(10, [[0, NaN], [0, 0]])).toThrow(RangeError);
        expect(() => createElevationGrid(10, [[0, 0]])).toThrow(RangeError);
        expect(() => createElevationGrid(10, [[0], [0]])).toThrow(RangeError);
        expect(() => createElevationGrid(0, [[0, 0], [0, 0]])).toThrow(RangeError);
    });
});
