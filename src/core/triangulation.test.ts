import { describe, expect, it } from 'vitest';
import type { Point } from './geometry';
import { bearingTo } from './survey';
import { MIN_INTERSECTION_ANGLE, reverseBearing, triangulate } from './triangulation';

/** Bearings an observer at `player` would read; only these and the landmark positions reach the solver. */
const observe = (player: Point, landmark: Point) => ({ landmark, bearing: bearingTo(player, landmark) as number });

const expectAt = (solved: Point | null, expected: Point) => {
    expect(solved).not.toBeNull();
    expect(solved!.x).toBeCloseTo(expected.x, 9);
    expect(solved!.y).toBeCloseTo(expected.y, 9);
};

describe('reverseBearing', () => {
    it('points the opposite way, wrapping at 360', () => {
        expect(reverseBearing(0)).toBe(180);
        expect(reverseBearing(90)).toBe(270);
        expect(reverseBearing(180)).toBe(0);
        expect(reverseBearing(270)).toBe(90);
        expect(reverseBearing(10)).toBe(190);
        expect(reverseBearing(200)).toBe(20);
        expect(reverseBearing(359)).toBe(179);
        expect(reverseBearing(359.5)).toBeCloseTo(179.5);
    });
});

describe('triangulate', () => {
    it('finds the observer from two cardinal bearings', () => {
        const player = { x: 100, y: 100 };

        // Landmark due north (0) and due east (90).
        expectAt(triangulate({ landmark: { x: 100, y: 20 }, bearing: 0 }, { landmark: { x: 180, y: 100 }, bearing: 90 }), player);
        // Due south (180) and due west (270).
        expectAt(triangulate({ landmark: { x: 100, y: 160 }, bearing: 180 }, { landmark: { x: 30, y: 100 }, bearing: 270 }), player);
    });

    it('reconstructs many observer positions exactly from bearings alone', () => {
        const a = { x: 140, y: 100 };
        const b = { x: 200, y: 170 };

        for (const player of [{ x: 200, y: 100 }, { x: 130, y: 170 }, { x: 60, y: 180 }, { x: 90, y: 90 }, { x: 320, y: 40 }, { x: 40, y: 240 }])
        {
            expectAt(triangulate(observe(player, a), observe(player, b)), player);
        }
    });

    it('handles diagonal bearings and readings either side of north', () => {
        const player = { x: 200, y: 200 };

        expectAt(triangulate(observe(player, { x: 260, y: 140 }), observe(player, { x: 120, y: 120 })), player);
        // About 359.4 and 0.6 degrees would be parallel; use 359.4 with a landmark to the east.
        const north = observe(player, { x: 199, y: 100 });
        expect(north.bearing).toBeGreaterThan(359);
        expectAt(triangulate(north, observe(player, { x: 300, y: 230 })), player);
        expectAt(triangulate(observe(player, { x: 201, y: 100 }), observe(player, { x: 100, y: 230 })), player);
    });

    it('gives the same answer whichever landmark comes first', () => {
        const player = { x: 90, y: 250 };
        const first = observe(player, { x: 140, y: 100 });
        const second = observe(player, { x: 200, y: 170 });

        expectAt(triangulate(second, first), triangulate(first, second)!);
        expectAt(triangulate(second, first), player);
    });

    it('rejects parallel and anti-parallel sight lines', () => {
        // Two landmarks both due east, at different heights: parallel lines never meet.
        expect(triangulate({ landmark: { x: 200, y: 100 }, bearing: 90 }, { landmark: { x: 200, y: 140 }, bearing: 90 })).toBeNull();
        // Observer exactly between two landmarks: the sight lines are one line, no unique point.
        const middle = { x: 170, y: 135 };
        expect(triangulate(observe(middle, { x: 140, y: 100 }), observe(middle, { x: 200, y: 170 }))).toBeNull();
    });

    it('rejects sight lines closer than the minimum angle and accepts them just above it', () => {
        const player = { x: 0, y: 0 };
        const at = (bearing: number, range: number) => {
            const r = bearing * Math.PI / 180;
            return { landmark: { x: Math.sin(r) * range, y: -Math.cos(r) * range }, bearing };
        };

        expect(triangulate(at(90, 100), at(90 + MIN_INTERSECTION_ANGLE - 1, 150))).toBeNull();
        expect(triangulate(at(90, 100), at(90 + 10, 150))).toBeNull();
        expectAt(triangulate(at(90, 100), at(90 + MIN_INTERSECTION_ANGLE + 1, 150)), player);
        // Nearly anti-parallel is just as useless.
        expect(triangulate(at(90, 100), at(270 - 5, 150))).toBeNull();
    });

    it('rejects two observations of the same landmark position', () => {
        const landmark = { x: 140, y: 100 };

        expect(triangulate({ landmark, bearing: 45 }, { landmark, bearing: 135 })).toBeNull();
        expect(triangulate({ landmark, bearing: 45 }, { landmark, bearing: 45 })).toBeNull();
    });

    it('rejects observations whose sight lines cross behind a landmark', () => {
        const player = { x: 100, y: 100 };
        const first = observe(player, { x: 200, y: 100 });
        const second = observe(player, { x: 100, y: 0 });

        // The east landmark reported as due west of the observer: no consistent position.
        expect(triangulate({ ...first, bearing: 270 }, second)).toBeNull();
    });

    it('returns null, never NaN, for non-finite input', () => {
        const good = { landmark: { x: 100, y: 20 }, bearing: 0 };

        expect(triangulate({ landmark: { x: 180, y: 100 }, bearing: NaN }, good)).toBeNull();
        expect(triangulate({ landmark: { x: 180, y: 100 }, bearing: Infinity }, good)).toBeNull();
        expect(triangulate({ landmark: { x: NaN, y: 100 }, bearing: 90 }, good)).toBeNull();
    });

    it('always returns finite coordinates when it returns a position', () => {
        for (let b1 = 0; b1 < 360; b1 += 7)
        {
            for (let b2 = 0; b2 < 360; b2 += 11)
            {
                const solved = triangulate({ landmark: { x: 140, y: 100 }, bearing: b1 }, { landmark: { x: 200, y: 170 }, bearing: b2 });

                if (solved)
                {
                    expect(Number.isFinite(solved.x) && Number.isFinite(solved.y)).toBe(true);
                }
            }
        }
    });
});
