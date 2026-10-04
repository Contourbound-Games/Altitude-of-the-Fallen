import { describe, expect, it } from 'vitest';
import { createElevationGrid } from './elevation';
import { snowLight, surfaceForm } from './surface';

/** A 9x9-sample grid (spacing 20, so 160x160 px) with each sample from `height(column, row)`. */
const grid = (height: (c: number, r: number) => number) => createElevationGrid(20, Array.from({ length: 9 }, (_, r) =>
    Array.from({ length: 9 }, (_, c) => height(c, r))
));

const centre = { x: 80, y: 80 };
const fromWest = { x: -1, y: 0 };
const fromEast = { x: 1, y: 0 };

describe('surfaceForm', () => {
    it('is level, uncurved and unlit on flat ground', () => {
        const form = surfaceForm(grid(() => 0.4), centre.x, centre.y, 24);

        expect(form.gx).toBe(0);
        expect(form.gy).toBe(0);
        expect(form.slope).toBe(0);
        expect(form.curvature).toBe(0);
        expect(snowLight(form, fromWest, 0.006)).toBeCloseTo(0);
    });

    it('does not depend on absolute height: the same shape higher up has the same form', () => {
        const shape = (c: number, r: number) => 0.02 * c + 0.01 * Math.abs(r - 4);
        const low = surfaceForm(grid((c, r) => 0.1 + shape(c, r)), 70, 90, 24);
        const high = surfaceForm(grid((c, r) => 0.6 + shape(c, r)), 70, 90, 24);

        expect(high.gx).toBeCloseTo(low.gx, 12);
        expect(high.gy).toBeCloseTo(low.gy, 12);
        expect(high.curvature).toBeCloseTo(low.curvature, 12);
    });

    it('points uphill: a plane rising to the east has a positive x gradient and no curvature', () => {
        const form = surfaceForm(grid(c => 0.05 * c), centre.x, centre.y, 24);

        expect(form.gx).toBeCloseTo(0.05 / 20);
        expect(form.gy).toBeCloseTo(0);
        expect(form.curvature).toBeCloseTo(0);
    });

    it('is negative on a ridge crest and positive in a hollow', () => {
        const ridge = surfaceForm(grid(c => 0.8 - 0.05 * Math.abs(c - 4)), centre.x, centre.y, 24);
        const hollow = surfaceForm(grid(c => 0.1 + 0.05 * Math.abs(c - 4)), centre.x, centre.y, 24);

        expect(ridge.curvature).toBeLessThan(0);
        expect(hollow.curvature).toBeGreaterThan(0);
    });
});

describe('snowLight', () => {
    // Ground rising to the east faces west.
    const rising = surfaceForm(grid(c => 0.05 * c), centre.x, centre.y, 24);

    it('lights ground that faces the light and shades ground that faces away', () => {
        expect(snowLight(rising, fromWest, 0.006)).toBeGreaterThan(0);
        expect(snowLight(rising, fromEast, 0.006)).toBeLessThan(0);
    });

    it('scales with steepness and saturates at the relief slope', () => {
        const gentle = surfaceForm(grid(c => 0.01 * c), centre.x, centre.y, 24);

        expect(snowLight(gentle, fromWest, 0.006)).toBeCloseTo(0.0005 / 0.006);
        expect(snowLight(rising, fromWest, 0.001)).toBe(1);
        expect(snowLight(rising, fromEast, 0.001)).toBe(-1);
    });

    it('gives no light or shade across a slope running along the light', () => {
        expect(snowLight(rising, { x: 0, y: -1 }, 0.006)).toBeCloseTo(0);
    });
});
