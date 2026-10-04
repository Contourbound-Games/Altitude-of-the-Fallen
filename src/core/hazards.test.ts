import { describe, expect, it } from 'vitest';
import { hazardAt, insidePolygon, slideFrom, type HazardZone } from './hazards';
import { createElevationGrid } from './terrain/elevation';

const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];

describe('insidePolygon', () => {
    it('tells inside from outside, including for a concave shape', () => {
        expect(insidePolygon(square, { x: 50, y: 50 })).toBe(true);
        expect(insidePolygon(square, { x: 150, y: 50 })).toBe(false);

        const ell = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }, { x: 40, y: 40 }, { x: 40, y: 100 }, { x: 0, y: 100 }];

        expect(insidePolygon(ell, { x: 20, y: 80 })).toBe(true);
        expect(insidePolygon(ell, { x: 80, y: 80 })).toBe(false);
    });
});

describe('hazardAt', () => {
    const slide: HazardZone = { kind: 'slide', polygon: square };
    const fatal: HazardZone = { kind: 'fatal', polygon: [{ x: 80, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 80, y: 100 }] };

    it('returns the zone a point is in, null outside, and fatal where zones overlap', () => {
        expect(hazardAt([slide, fatal], { x: 20, y: 20 })).toBe(slide);
        expect(hazardAt([slide, fatal], { x: 150, y: 20 })).toBe(fatal);
        expect(hazardAt([slide, fatal], { x: 90, y: 20 })).toBe(fatal);
        expect(hazardAt([slide, fatal], { x: 20, y: 150 })).toBeNull();
    });
});

describe('slideFrom', () => {
    // 10 samples of 20px: falling steeply southwards over the first rows, then level.
    const grid = createElevationGrid(20, Array.from({ length: 11 }, (_, r) =>
        Array.from({ length: 11 }, () => r <= 4 ? 0.9 - 0.2 * r : 0.1)));
    const slab: HazardZone = { kind: 'slide', polygon: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 80 }, { x: 0, y: 80 }] };

    it('carries the player down the fall line out of the zone onto level ground', () => {
        const slide = slideFrom(grid, [slab], { x: 100, y: 10 });

        expect(slide.fatal).toBe(false);
        expect(slide.landing.y).toBeGreaterThan(80);
        expect(slide.landing.x).toBeCloseTo(100);
        expect(hazardAt([slab], slide.landing)).toBeNull();
    });

    it('is the same every time from the same start', () => {
        expect(slideFrom(grid, [slab], { x: 63, y: 21 })).toEqual(slideFrom(grid, [slab], { x: 63, y: 21 }));
    });

    it('stops and reports it when the slide reaches a fatal zone', () => {
        const drop: HazardZone = { kind: 'fatal', polygon: [{ x: 0, y: 70 }, { x: 200, y: 70 }, { x: 200, y: 200 }, { x: 0, y: 200 }] };
        const slide = slideFrom(grid, [slab, drop], { x: 100, y: 10 });

        expect(slide.fatal).toBe(true);
        expect(hazardAt([drop], slide.landing)).toBe(drop);
    });
});
