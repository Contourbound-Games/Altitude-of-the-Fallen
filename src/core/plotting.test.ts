import { describe, expect, it } from 'vitest';
import { fitMap, rayExit, toMap } from './plotting';
import { reverseBearing } from './triangulation';

const map = { minX: 0, minY: 0, maxX: 640, maxY: 360 };
const centre = { x: 320, y: 180 };
const expectPoint = (actual: { x: number; y: number } | null, x: number, y: number) => {
    expect(actual).not.toBeNull();
    expect(actual!.x).toBeCloseTo(x, 9);
    expect(actual!.y).toBeCloseTo(y, 9);
};

describe('rayExit', () => {
    it('runs to the edge in each cardinal direction', () => {
        expectPoint(rayExit(centre, 0, map), 320, 0);
        expectPoint(rayExit(centre, 90, map), 640, 180);
        expectPoint(rayExit(centre, 180, map), 320, 360);
        expectPoint(rayExit(centre, 270, map), 0, 180);
    });

    it('runs diagonally to an edge or exactly into a corner', () => {
        // 45 degrees from the centre reaches the top edge first (180 up vs 320 across).
        const ne = rayExit(centre, 45, map)!;
        expect(ne.y).toBe(0);
        expect(ne.x).toBeCloseTo(500);

        // From a point 100px from both the left and bottom edges, 225 degrees ends in the corner.
        expectPoint(rayExit({ x: 100, y: 260 }, 225, map), 0, 360);
    });

    it('treats 360 as 0 and stays continuous either side of north', () => {
        expect(rayExit(centre, 360, map)!.x).toBeCloseTo(320);
        expect(rayExit(centre, 360, map)!.y).toBe(0);

        const east = rayExit(centre, 0.5, map)!;
        const west = rayExit(centre, 359.5, map)!;
        expect(east.y).toBe(0);
        expect(west.y).toBe(0);
        expect(east.x - 320).toBeCloseTo(320 - west.x);
        expect(east.x).toBeGreaterThan(320);
    });

    it('plots a recorded bearing back from the landmark towards the observer', () => {
        // Observer due west of a landmark reads 90; the plotted line runs west from the landmark.
        const landmark = { x: 200, y: 170 };
        const end = rayExit(landmark, reverseBearing(90), map)!;

        expectPoint(end, 0, 170);
    });

    it('always ends on the boundary with finite coordinates', () => {
        for (let bearing = 0; bearing < 360; bearing += 3.7)
        {
            const end = rayExit({ x: 140, y: 100 }, bearing, map)!;
            const onEdge = end.x === 0 || end.x === 640 || end.y === 0 || end.y === 360;

            expect(Number.isFinite(end.x) && Number.isFinite(end.y)).toBe(true);
            expect(onEdge).toBe(true);
            expect(end.x).toBeGreaterThanOrEqual(0);
            expect(end.x).toBeLessThanOrEqual(640 + 1e-9);
            expect(end.y).toBeGreaterThanOrEqual(-1e-9);
            expect(end.y).toBeLessThanOrEqual(360 + 1e-9);
        }
    });

    it('rejects an origin outside the map or a non-finite bearing', () => {
        expect(rayExit({ x: -1, y: 10 }, 90, map)).toBeNull();
        expect(rayExit({ x: 10, y: 400 }, 90, map)).toBeNull();
        expect(rayExit(centre, NaN, map)).toBeNull();
        expect(rayExit(centre, Infinity, map)).toBeNull();
    });

    it('clips to the bounds of a world larger than the screen', () => {
        const world = { minX: 0, minY: 0, maxX: 1920, maxY: 1080 };
        const landmark = { x: 730, y: 510 };

        // Points that lie outside the old 640x360 field are inside this one.
        expectPoint(rayExit({ x: 1500, y: 900 }, 90, world), 1920, 900);
        expectPoint(rayExit(landmark, 180, world), 730, 1080);
        expectPoint(rayExit(landmark, 270, world), 0, 510);
        // 135 degrees from (730, 510): 1190px to the east edge, 570px to the bottom edge.
        expectPoint(rayExit(landmark, 135, world), 730 + 570, 1080);
    });
});

describe('fitMap / toMap', () => {
    const area = { x: 0, y: 0, width: 640, height: 316.8 };

    it('scales a wide world uniformly to fit, centred horizontally and aligned to the top', () => {
        const layout = fitMap(1920, 1080, area);

        // Height is the tighter fit: 316.8 / 1080.
        expect(layout.scale).toBeCloseTo(0.29333, 5);
        expect(layout.y).toBe(0);
        expect(layout.x).toBeCloseTo((640 - 1920 * layout.scale) / 2);
        expectPoint(toMap({ x: 0, y: 0 }, layout), layout.x, 0);
        expectPoint(toMap({ x: 1920, y: 1080 }, layout), 640 - layout.x, 316.8);
    });

    it('keeps the old 640x360 field at its previous 0.88 scale', () => {
        const layout = fitMap(640, 360, area);

        expect(layout.scale).toBeCloseTo(0.88);
        expect(layout.x).toBeCloseTo(38.4);
    });

    it('preserves directions, so a plotted bearing keeps its angle on the map', () => {
        const layout = fitMap(1920, 1080, { x: 10, y: 20, width: 600, height: 300 });
        const from = { x: 730, y: 510 };
        const end = rayExit(from, 135, { minX: 0, minY: 0, maxX: 1920, maxY: 1080 })!;
        const a = toMap(from, layout);
        const b = toMap(end, layout);

        expect(Math.atan2(b.x - a.x, -(b.y - a.y)) * 180 / Math.PI).toBeCloseTo(135);
    });

    it('rejects non-positive sizes', () => {
        expect(() => fitMap(0, 1080, area)).toThrow(RangeError);
        expect(() => fitMap(1920, 1080, { ...area, height: 0 })).toThrow(RangeError);
    });
});
