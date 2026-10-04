import { describe, expect, it } from 'vitest';
import {
    angularOffset,
    bearingDifference,
    bearingOf,
    bearingTo,
    coarseReading,
    readingStep,
    relativeBearing,
    SURVEY_COARSEST_STEP,
    SURVEY_TOLERANCE,
    surveyBearing,
    surveyReading,
    wholeBearing
} from './survey';

const origin = { x: 100, y: 100 };
const offset = (dx: number, dy: number) => ({ x: origin.x + dx, y: origin.y + dy });

describe('bearingTo', () => {
    it('reads the cardinal directions clockwise from north (world -y)', () => {
        expect(bearingTo(origin, offset(0, -50))).toBe(0);
        expect(bearingTo(origin, offset(50, 0))).toBe(90);
        expect(bearingTo(origin, offset(0, 50))).toBe(180);
        expect(bearingTo(origin, offset(-50, 0))).toBe(270);
    });

    it('reads diagonals and arbitrary angles', () => {
        expect(bearingTo(origin, offset(10, -10))).toBeCloseTo(45);
        expect(bearingTo(origin, offset(10, 10))).toBeCloseTo(135);
        expect(bearingTo(origin, offset(-10, 10))).toBeCloseTo(225);
        expect(bearingTo(origin, offset(-10, -10))).toBeCloseTo(315);
        expect(bearingTo(origin, offset(1, -Math.sqrt(3)))).toBeCloseTo(30);
        expect(bearingTo(origin, offset(-1, -Math.sqrt(3)))).toBeCloseTo(330);
    });

    it('stays in [0, 360) just either side of north', () => {
        const justEast = bearingTo(origin, offset(0.01, -100)) as number;
        const justWest = bearingTo(origin, offset(-0.01, -100)) as number;

        expect(justEast).toBeGreaterThanOrEqual(0);
        expect(justEast).toBeLessThan(0.01);
        expect(justWest).toBeGreaterThan(359.99);
        expect(justWest).toBeLessThan(360);
    });

    it('has no bearing between coincident points or for a zero or non-finite direction', () => {
        expect(bearingTo(origin, origin)).toBeNull();
        expect(bearingOf({ x: 0, y: 0 })).toBeNull();
        expect(bearingOf({ x: NaN, y: 1 })).toBeNull();
        expect(bearingOf({ x: Infinity, y: 0 })).toBeNull();
    });
});

describe('bearingDifference and wholeBearing', () => {
    it('measures the short way round, across 359/0', () => {
        expect(bearingDifference(10, 20)).toBe(10);
        expect(bearingDifference(359, 1)).toBe(2);
        expect(bearingDifference(1, 359)).toBe(2);
        expect(bearingDifference(0, 180)).toBe(180);
        expect(bearingDifference(90, 270)).toBe(180);
        expect(bearingDifference(350, 710)).toBe(0);
    });

    it('rounds for display without ever showing 360', () => {
        expect(wholeBearing(359.6)).toBe(0);
        expect(wholeBearing(359.4)).toBe(359);
        expect(wholeBearing(0.4)).toBe(0);
        expect(wholeBearing(236.5)).toBe(237);
    });
});

describe('surveyBearing', () => {
    const karel = offset(0, -60);
    const facingBearing = (degrees: number) => {
        const r = degrees * Math.PI / 180;
        return { x: Math.sin(r), y: -Math.cos(r) };
    };

    it('gives the bearing to a clearly visible target when aimed within tolerance', () => {
        expect(surveyBearing(origin, facingBearing(0), 200, karel, 0)).toBe(0);
        expect(surveyBearing(origin, facingBearing(SURVEY_TOLERANCE - 0.1), 200, karel, 0)).toBe(0);
        expect(surveyBearing(origin, facingBearing(360 - SURVEY_TOLERANCE + 0.1), 200, karel, 0)).toBe(0);
    });

    it('gives nothing when aimed outside the tolerance, including across 359/0', () => {
        expect(surveyBearing(origin, facingBearing(SURVEY_TOLERANCE + 0.5), 200, karel, 0)).toBeNull();
        expect(surveyBearing(origin, facingBearing(360 - SURVEY_TOLERANCE - 0.5), 200, karel, 0)).toBeNull();
        expect(surveyBearing(origin, facingBearing(90), 200, karel, 0)).toBeNull();
        expect(surveyBearing(origin, facingBearing(180), 200, karel, 0)).toBeNull();
    });

    it('reports the target bearing, not the aim, so a reading does not wobble with the mouse', () => {
        const east = offset(80, 0);

        expect(surveyBearing(origin, facingBearing(91.5), 200, east, 0)).toBe(90);
        expect(surveyBearing(origin, facingBearing(88.7), 200, east, 0)).toBe(90);
    });

    it('gives nothing for a target the viewer cannot see clearly enough', () => {
        // 60px away: clear at 200px sight, faint near the edge of 66px sight, unseen at 40px sight.
        expect(surveyBearing(origin, facingBearing(0), 200, karel, 0)).toBe(0);
        expect(surveyBearing(origin, facingBearing(0), 66, karel, 0)).toBeNull();
        expect(surveyBearing(origin, facingBearing(0), 40, karel, 0)).toBeNull();
    });

    it('gives nothing for a coincident target or an unusable facing', () => {
        expect(surveyBearing(origin, facingBearing(0), 200, origin, 0)).toBeNull();
        expect(surveyBearing(origin, { x: 0, y: 0 }, 200, karel, 0)).toBeNull();
    });
});

describe('surveyBearing with a target of some size', () => {
    // Target 6px either side of its centre, like Karel; aim is at a point on his edge.
    const radius = 6;
    const aimAt = (viewer: { x: number; y: number }, point: { x: number; y: number }) => {
        const length = Math.hypot(point.x - viewer.x, point.y - viewer.y);
        return { x: (point.x - viewer.x) / length, y: (point.y - viewer.y) / length };
    };

    it('counts aiming at any part of a nearby target, and still reads the bearing to its centre', () => {
        const viewer = { x: 100, y: 120 };
        const target = { x: 100, y: 100 };
        const edge = { x: 105, y: 100 };

        expect(surveyBearing(viewer, aimAt(viewer, edge), 200, target, radius)).toBe(0);
        expect(surveyBearing(viewer, aimAt(viewer, edge), 200, target, 0)).toBeNull();
        expect(surveyBearing(viewer, aimAt(viewer, { x: 110, y: 100 }), 200, target, radius)).toBeNull();
    });

    it('falls back to the fixed tolerance for a distant target', () => {
        const viewer = { x: 100, y: 280 };
        const target = { x: 100, y: 100 };

        // 6px subtends ~1.9 degrees at 180px, so the 2 degree minimum applies (400px sight keeps it clearly visible).
        expect(surveyBearing(viewer, aimAt(viewer, { x: 106, y: 100 }), 400, target, radius)).toBe(0);
        expect(surveyBearing(viewer, aimAt(viewer, { x: 108, y: 100 }), 400, target, radius)).toBeNull();
    });
});

describe('relativeBearing', () => {
    it('is signed, clockwise positive, and wraps across north', () => {
        expect(relativeBearing(0, 30)).toBe(30);
        expect(relativeBearing(30, 0)).toBe(-30);
        expect(relativeBearing(350, 10)).toBe(20);
        expect(relativeBearing(10, 350)).toBe(-20);
        expect(relativeBearing(90, 270)).toBe(180);
        expect(relativeBearing(270, 90)).toBe(180);
        expect(relativeBearing(123, 123)).toBe(0);
    });
});

describe('angularOffset (Survey View projection)', () => {
    // The prototype view: 90 degrees across 640px.
    const fov = 90;
    const width = 640;

    it('maps angle linearly: the centre azimuth to 0, the view edges to half the width', () => {
        expect(angularOffset(0, fov, width)).toBe(0);
        expect(angularOffset(45, fov, width)).toBe(320);
        expect(angularOffset(-45, fov, width)).toBe(-320);
        expect(angularOffset(9, fov, width)).toBeCloseTo(64);
    });

    it('draws a landmark at the same place whatever its distance, as long as its bearing is the same', () => {
        const landmark = { x: 730, y: 510 };
        const facing = 300;
        // Three viewers on one line through the landmark: same bearing, distances 60, 150 and 240px.
        const viewers = [60, 150, 240].map(d => ({ x: landmark.x + d * 0.6, y: landmark.y + d * 0.8 }));
        const xs = viewers.map(viewer => angularOffset(relativeBearing(facing, bearingTo(viewer, landmark)!), fov, width));

        expect(xs[1]).toBeCloseTo(xs[0], 9);
        expect(xs[2]).toBeCloseTo(xs[0], 9);
    });

    it('puts a landmark east of a north-facing viewer to the right, west to the left', () => {
        const viewer = { x: 500, y: 500 };
        const east = relativeBearing(0, bearingTo(viewer, { x: 600, y: 400 })!);
        const west = relativeBearing(0, bearingTo(viewer, { x: 400, y: 400 })!);

        expect(angularOffset(east, fov, width)).toBeCloseTo(320);
        expect(angularOffset(west, fov, width)).toBeCloseTo(-320);
    });
});

describe('readingStep / coarseReading (observation quality)', () => {
    it('reads whole degrees when clear and coarsens to the coarsest step as the target fades', () => {
        expect(readingStep(1)).toBe(1);
        expect(readingStep(0)).toBe(SURVEY_COARSEST_STEP);
        expect(readingStep(0.5)).toBeCloseTo((1 + SURVEY_COARSEST_STEP) / 2);
        expect(readingStep(2)).toBe(1);
        expect(readingStep(-1)).toBe(SURVEY_COARSEST_STEP);
    });

    it('has no jumps: a tiny change in quality never changes the step by more than a tiny amount', () => {
        for (let q = 0; q < 1; q += 0.001)
        {
            expect(Math.abs(readingStep(q + 0.001) - readingStep(q))).toBeLessThan(0.01);
        }
    });

    it('rounds to the nearest multiple of the step, in whole degrees, across north', () => {
        expect(coarseReading(137.3, 1)).toBe(137);
        expect(coarseReading(137.3, 5)).toBe(135);
        expect(coarseReading(137.6, 5)).toBe(140);
        expect(coarseReading(358, 10)).toBe(0);
        expect(coarseReading(3, 10)).toBe(0);
    });
});

describe('surveyReading', () => {
    const viewer = { x: 0, y: 0 };
    const north = { x: 0, y: -1 };
    const sight = 200;

    it('reads a clearly seen target at whole-degree resolution', () => {
        // Visibility is full out to 65% of the sight distance.
        const reading = surveyReading(viewer, north, sight, { x: 0, y: -100 }, 3);

        expect(reading).toEqual({ bearing: 0, step: 1 });
    });

    it('still reads a faint target, but coarsely, and nothing beyond sight', () => {
        const faint = surveyReading(viewer, north, sight, { x: 0, y: -190 }, 3)!;

        expect(faint.step).toBeGreaterThan(5);
        expect(faint.bearing).toBe(0);
        expect(surveyReading(viewer, north, sight, { x: 0, y: -201 }, 3)).toBeNull();
    });

    it('changes resolution smoothly with distance: no distance where the reading changes character', () => {
        let previous = surveyReading(viewer, north, sight, { x: 0, y: -100 }, 3)!.step;

        for (let d = 101; d < 199; d++)
        {
            const step = surveyReading(viewer, north, sight, { x: 0, y: -d }, 3)!.step;

            expect(step).toBeGreaterThanOrEqual(previous);
            expect(step - previous).toBeLessThan(0.2);
            previous = step;
        }
    });

    it('accepts a coarser aim for a coarse reading, never less than the normal tolerance', () => {
        const target = { x: 0, y: -190 };
        const step = surveyReading(viewer, north, sight, target, 3)!.step;
        const off = (degrees: number) => ({ x: Math.sin(degrees * Math.PI / 180), y: -Math.cos(degrees * Math.PI / 180) });

        expect(surveyReading(viewer, off(step / 2 - 0.1), sight, target, 3)).not.toBeNull();
        expect(surveyReading(viewer, off(step / 2 + 0.1), sight, target, 3)).toBeNull();
        expect(surveyReading(viewer, off(1.9), sight, { x: 0, y: -100 }, 0)).not.toBeNull();
    });
});
