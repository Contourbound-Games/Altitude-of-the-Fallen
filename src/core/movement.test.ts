import { describe, expect, it } from 'vitest';
import {
    HALF_SPEED_SLOPE,
    inputDirection,
    moveWithin,
    PLAYER_SPEED,
    slopeSpeedMultiplier,
    walk,
    type DirectionInput
} from './movement';
import { createElevationGrid } from './terrain/elevation';

const NONE: DirectionInput = { left: false, right: false, up: false, down: false };

describe('inputDirection', () => {
    it('maps each single direction to a cardinal unit vector', () => {
        expect(inputDirection({ ...NONE, left: true })).toEqual({ x: -1, y: 0 });
        expect(inputDirection({ ...NONE, right: true })).toEqual({ x: 1, y: 0 });
        expect(inputDirection({ ...NONE, up: true })).toEqual({ x: 0, y: -1 });
        expect(inputDirection({ ...NONE, down: true })).toEqual({ x: 0, y: 1 });
    });

    it('combines two axes into a normalized diagonal', () => {
        const cases: [DirectionInput, number, number][] = [
            [{ ...NONE, right: true, up: true }, 1, -1],
            [{ ...NONE, right: true, down: true }, 1, 1],
            [{ ...NONE, left: true, up: true }, -1, -1],
            [{ ...NONE, left: true, down: true }, -1, 1]
        ];

        for (const [input, sx, sy] of cases)
        {
            const direction = inputDirection(input);
            expect(direction.x).toBeCloseTo(sx * Math.SQRT1_2);
            expect(direction.y).toBeCloseTo(sy * Math.SQRT1_2);
            expect(Math.hypot(direction.x, direction.y)).toBeCloseTo(1);
        }
    });

    it('cancels opposite keys per axis and keeps the other axis', () => {
        expect(inputDirection(NONE)).toEqual({ x: 0, y: 0 });
        expect(inputDirection({ ...NONE, left: true, right: true })).toEqual({ x: 0, y: 0 });
        expect(inputDirection({ left: true, right: true, up: true, down: true })).toEqual({ x: 0, y: 0 });
        expect(inputDirection({ left: true, right: true, up: true, down: false })).toEqual({ x: 0, y: -1 });
        expect(inputDirection({ left: false, right: true, up: true, down: true })).toEqual({ x: 1, y: 0 });
    });
});

describe('moveWithin', () => {
    const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 50 };

    it('moves speed * seconds along the direction', () => {
        expect(moveWithin({ x: 10, y: 10 }, { x: 1, y: 0 }, 80, 0.5, bounds)).toEqual({ x: 50, y: 10 });
        expect(moveWithin({ x: 10, y: 40 }, { x: 0, y: -1 }, 80, 0.25, bounds)).toEqual({ x: 10, y: 20 });
    });

    it('covers the same distance regardless of frame rate', () => {
        const start = { x: 0, y: 25 };
        const right = { x: 1, y: 0 };

        let at60 = start;
        for (let i = 0; i < 60; i++)
        {
            at60 = moveWithin(at60, right, 80, 1 / 60, bounds);
        }

        let at144 = start;
        for (let i = 0; i < 144; i++)
        {
            at144 = moveWithin(at144, right, 80, 1 / 144, bounds);
        }

        expect(at60.x).toBeCloseTo(80);
        expect(at144.x).toBeCloseTo(80);
    });

    it('stops at every edge of the bounds', () => {
        expect(moveWithin({ x: 5, y: 25 }, { x: -1, y: 0 }, 80, 1, bounds)).toEqual({ x: 0, y: 25 });
        expect(moveWithin({ x: 95, y: 25 }, { x: 1, y: 0 }, 80, 1, bounds)).toEqual({ x: 100, y: 25 });
        expect(moveWithin({ x: 50, y: 5 }, { x: 0, y: -1 }, 80, 1, bounds)).toEqual({ x: 50, y: 0 });
        expect(moveWithin({ x: 50, y: 45 }, { x: 0, y: 1 }, 80, 1, bounds)).toEqual({ x: 50, y: 50 });
    });

    it('stays put with no direction', () => {
        expect(moveWithin({ x: 30, y: 30 }, { x: 0, y: 0 }, 80, 1, bounds)).toEqual({ x: 30, y: 30 });
    });
});

describe('slopeSpeedMultiplier', () => {
    const gentle = HALF_SPEED_SLOPE / 2;
    const steep = HALF_SPEED_SLOPE * 2;

    it('is 1 on flat ground', () => {
        expect(slopeSpeedMultiplier(0)).toBe(1);
    });

    it('slows gentle uphill a little and steeper uphill more', () => {
        expect(slopeSpeedMultiplier(gentle)).toBeCloseTo(0.8);
        expect(slopeSpeedMultiplier(HALF_SPEED_SLOPE)).toBeCloseTo(0.5);
        expect(slopeSpeedMultiplier(steep)).toBeCloseTo(0.2);
        expect(slopeSpeedMultiplier(steep)).toBeLessThan(slopeSpeedMultiplier(gentle));
        expect(slopeSpeedMultiplier(gentle)).toBeLessThan(1);
    });

    it('keeps downhill at flat speed', () => {
        for (const slope of [-1e-6, -gentle, -steep, -1])
        {
            expect(slopeSpeedMultiplier(slope)).toBe(1);
        }
    });

    it('decreases smoothly with no jumps as uphill slope grows', () => {
        let previous = slopeSpeedMultiplier(0);

        for (let slope = 0; slope <= 5 * HALF_SPEED_SLOPE; slope += HALF_SPEED_SLOPE / 100)
        {
            const multiplier = slopeSpeedMultiplier(slope);
            expect(multiplier).toBeLessThanOrEqual(previous);
            expect(previous - multiplier).toBeLessThan(0.01);
            previous = multiplier;
        }

        // Nearly level travel stays at nearly full speed.
        expect(slopeSpeedMultiplier(HALF_SPEED_SLOPE / 20)).toBeGreaterThan(0.99);
    });

    it('stays finite and within 0..1 for extreme input', () => {
        for (const slope of [Infinity, -Infinity, NaN, Number.MAX_VALUE, -Number.MAX_VALUE, 1e300, 1, Number.MIN_VALUE])
        {
            const multiplier = slopeSpeedMultiplier(slope);
            expect(Number.isFinite(multiplier)).toBe(true);
            expect(multiplier).toBeGreaterThanOrEqual(0);
            expect(multiplier).toBeLessThanOrEqual(1);
        }
    });
});

describe('walk', () => {
    const bounds = { minX: 0, minY: 0, maxX: 400, maxY: 40 };
    // Rises 0.25 per 100px to the east (half of HALF_SPEED_SLOPE), level north-south.
    const ramp = createElevationGrid(100, [
        [0, 0.25, 0.5, 0.75, 1],
        [0, 0.25, 0.5, 0.75, 1]
    ]);
    const flat = createElevationGrid(100, [
        [0.5, 0.5, 0.5, 0.5, 0.5],
        [0.5, 0.5, 0.5, 0.5, 0.5]
    ]);
    const east = { x: 1, y: 0 };

    it('moves at the baseline speed on flat ground', () => {
        const step = walk(flat, { x: 100, y: 20 }, east, 0.5, bounds);
        expect(step.position.x).toBeCloseTo(100 + PLAYER_SPEED * 0.5);
        expect(step.speedMultiplier).toBe(1);
    });

    it('moves slower uphill, by the multiplier for the slope', () => {
        const step = walk(ramp, { x: 100, y: 20 }, east, 0.5, bounds);
        expect(step.slope).toBeCloseTo(0.0025);
        expect(step.speedMultiplier).toBeCloseTo(slopeSpeedMultiplier(0.0025));
        expect(step.position.x).toBeCloseTo(100 + PLAYER_SPEED * slopeSpeedMultiplier(0.0025) * 0.5);
    });

    it('moves at the baseline speed downhill and across the slope', () => {
        expect(walk(ramp, { x: 300, y: 20 }, { x: -1, y: 0 }, 0.5, bounds).position.x).toBeCloseTo(300 - PLAYER_SPEED * 0.5);
        expect(walk(ramp, { x: 150, y: 0 }, { x: 0, y: 1 }, 0.25, bounds).position.y).toBeCloseTo(PLAYER_SPEED * 0.25);
    });

    it('covers the same distance over changing terrain at any frame rate', () => {
        // Flat, then gentle, then steep: after 5 s the walker is partway up the steep part.
        const mixed = createElevationGrid(100, [
            [0, 0, 0.2, 0.9, 0.9],
            [0, 0, 0.2, 0.9, 0.9]
        ]);

        const xAfterFiveSeconds = (fps: number) => {
            let position = { x: 0, y: 20 };

            for (let frame = 0; frame < 5 * fps; frame++)
            {
                position = walk(mixed, position, east, 1 / fps, bounds).position;
            }

            return position.x;
        };

        const at60 = xAfterFiveSeconds(60);
        expect(at60).toBeGreaterThan(200);
        expect(at60).toBeLessThan(300);
        expect(Math.abs(xAfterFiveSeconds(15) - at60)).toBeLessThan(0.5);
        expect(Math.abs(xAfterFiveSeconds(144) - at60)).toBeLessThan(0.5);
    });

    it('stops at the bounds, including while climbing', () => {
        expect(walk(ramp, { x: 390, y: 20 }, east, 5, bounds).position).toEqual({ x: 400, y: 20 });
        expect(walk(ramp, { x: 10, y: 20 }, { x: -1, y: 0 }, 5, bounds).position).toEqual({ x: 0, y: 20 });
        expect(walk(ramp, { x: 200, y: 30 }, { x: 0, y: 1 }, 5, bounds).position).toEqual({ x: 200, y: 40 });
    });

    it('does not move without a direction or with a non-finite time step', () => {
        expect(walk(ramp, { x: 200, y: 20 }, { x: 0, y: 0 }, 1, bounds).position).toEqual({ x: 200, y: 20 });
        expect(walk(ramp, { x: 200, y: 20 }, east, NaN, bounds).position).toEqual({ x: 200, y: 20 });
    });
});

describe('walk in any direction', () => {
    const g = HALF_SPEED_SLOPE;
    // Plane rising northward (towards -y) by g per px; level east-west. 160 x 80 px.
    const plane = createElevationGrid(40, [
        [80 * g, 80 * g, 80 * g, 80 * g, 80 * g],
        [40 * g, 40 * g, 40 * g, 40 * g, 40 * g],
        [0, 0, 0, 0, 0]
    ]);
    const level = createElevationGrid(40, [
        [0.5, 0.5, 0.5],
        [0.5, 0.5, 0.5],
        [0.5, 0.5, 0.5]
    ]);
    const open = { minX: 0, minY: 0, maxX: 160, maxY: 80 };
    const centre = { x: 80, y: 40 };
    const d = Math.SQRT1_2;
    const travelled = (from: { x: number; y: number }, to: { x: number; y: number }) => Math.hypot(to.x - from.x, to.y - from.y);

    it('covers the same distance cardinally and diagonally on flat ground', () => {
        const start = { x: 40, y: 40 };

        for (const direction of [{ x: 1, y: 0 }, { x: 0, y: -1 }, { x: d, y: d }, { x: -d, y: -d }])
        {
            expect(travelled(start, walk(level, start, direction, 0.25, open).position)).toBeCloseTo(PLAYER_SPEED * 0.25);
        }
    });

    it('measures the slope along the direction of travel', () => {
        const slopeTowards = (x: number, y: number) => walk(plane, centre, { x, y }, 0.05, open).slope;

        expect(slopeTowards(0, -1)).toBeCloseTo(g);            // straight uphill
        expect(slopeTowards(d, -d)).toBeCloseTo(g * d);        // 45 degrees off the fall line
        expect(slopeTowards(0.6, -0.8)).toBeCloseTo(g * 0.8);  // about 37 degrees off
        expect(slopeTowards(1, 0)).toBeCloseTo(0);             // along the contour
        expect(slopeTowards(-1, 0)).toBeCloseTo(0);
        expect(slopeTowards(0, 1)).toBeCloseTo(-g);            // straight downhill
        expect(slopeTowards(-d, d)).toBeCloseTo(-g * d);
    });

    it('slows less the further the direction turns from straight uphill', () => {
        const speedTowards = (x: number, y: number) => travelled(centre, walk(plane, centre, { x, y }, 0.1, open).position) / 0.1;

        expect(speedTowards(0, -1)).toBeCloseTo(PLAYER_SPEED * slopeSpeedMultiplier(g));
        expect(speedTowards(d, -d)).toBeCloseTo(PLAYER_SPEED * slopeSpeedMultiplier(g * d));
        expect(speedTowards(1, 0)).toBeCloseTo(PLAYER_SPEED);
        expect(speedTowards(0, 1)).toBeCloseTo(PLAYER_SPEED);
        expect(speedTowards(0, -1)).toBeLessThan(speedTowards(d, -d));
        expect(speedTowards(d, -d)).toBeLessThan(speedTowards(1, 0));
    });

    it('covers the same diagonal distance over changing terrain at any frame rate', () => {
        const mixed = createElevationGrid(100, [
            [1, 0.9, 0.5, 0.5],
            [0.9, 0.4, 0.2, 0.3],
            [0.5, 0.2, 0, 0],
            [0.5, 0.3, 0, 0]
        ]);
        const northWest = { x: -d, y: -d };
        const bounds = { minX: 0, minY: 0, maxX: 300, maxY: 300 };

        const afterThreeSeconds = (fps: number) => {
            let position = { x: 280, y: 280 };

            for (let frame = 0; frame < 3 * fps; frame++)
            {
                position = walk(mixed, position, northWest, 1 / fps, bounds).position;
            }

            return position;
        };

        const at60 = afterThreeSeconds(60);
        expect(at60.x).toBeGreaterThan(100);
        expect(travelled(afterThreeSeconds(15), at60)).toBeLessThan(0.5);
        expect(travelled(afterThreeSeconds(144), at60)).toBeLessThan(0.5);
    });

    it('slides along an edge at the remaining component speed, using the slope along the edge', () => {
        // Against the east edge of the plane, moving north-east: only the uphill north component remains.
        const slide = walk(plane, { x: 160, y: 60 }, { x: d, y: -d }, 0.1, open);
        expect(slide.position.x).toBe(160);
        expect(slide.slope).toBeCloseTo(g);
        expect(60 - slide.position.y).toBeCloseTo(PLAYER_SPEED * d * slopeSpeedMultiplier(g) * 0.1);

        // In a corner, moving diagonally outward: no movement at all.
        expect(walk(plane, { x: 160, y: 0 }, { x: d, y: -d }, 1, open).position).toEqual({ x: 160, y: 0 });
        expect(walk(level, { x: 5, y: 75 }, { x: -d, y: d }, 1, { minX: 0, minY: 0, maxX: 80, maxY: 80 }).position).toEqual({ x: 0, y: 80 });
    });
});
