import { describe, expect, it } from 'vitest';
import {
    CLEAR_SIGHT,
    facingToward,
    LOOK_HOLD_RADIUS,
    lookAt,
    MIN_LOOK_DISTANCE,
    NEAR_SIGHT,
    SEVERE_SIGHT,
    VIEW_CONE_ANGLE,
    nextFacing,
    sightDistance,
    visibility
} from './visibility';

const viewer = { x: 100, y: 100 };
const north = { x: 0, y: -1 };
const D = 100;

/** Point at `range` px from the viewer, `degrees` clockwise from north. */
const at = (range: number, degrees: number) => {
    const r = degrees * Math.PI / 180;
    return { x: viewer.x + Math.sin(r) * range, y: viewer.y - Math.cos(r) * range };
};

describe('visibility', () => {
    it('sees straight ahead and not behind', () => {
        expect(visibility(viewer, north, D, at(50, 0))).toBe(1);
        expect(visibility(viewer, north, D, at(50, 180))).toBe(0);
        expect(visibility(viewer, north, D, at(50, 90))).toBe(0);
        expect(visibility(viewer, north, D, at(50, -90))).toBe(0);
    });

    it('sees the whole cone, fades just past its edge, and nothing further round', () => {
        const half = VIEW_CONE_ANGLE / 2 * 180 / Math.PI;

        expect(visibility(viewer, north, D, at(50, half - 1))).toBe(1);
        expect(visibility(viewer, north, D, at(50, -(half - 1)))).toBe(1);
        const edge = visibility(viewer, north, D, at(50, half + 5));
        expect(edge).toBeGreaterThan(0);
        expect(edge).toBeLessThan(1);
        expect(visibility(viewer, north, D, at(50, half + 15))).toBe(0);
    });

    it('fades out towards the sight distance and sees nothing beyond it', () => {
        expect(visibility(viewer, north, D, at(0.6 * D, 0))).toBe(1);
        const fading = visibility(viewer, north, D, at(0.85 * D, 0));
        expect(fading).toBeGreaterThan(0);
        expect(fading).toBeLessThan(1);
        expect(visibility(viewer, north, D, at(D, 0))).toBe(0);
        expect(visibility(viewer, north, D, at(2 * D, 0))).toBe(0);
    });

    it('sees the near radius in every direction', () => {
        for (const degrees of [0, 90, 135, 180, 270])
        {
            expect(visibility(viewer, north, D, at(NEAR_SIGHT - 1, degrees))).toBe(1);
        }
        expect(visibility(viewer, north, D, at(NEAR_SIGHT + 10, 180))).toBe(0);
        expect(visibility(viewer, north, D, viewer)).toBe(1);
    });

    it('treats any facing length the same and follows diagonal facings', () => {
        const point = at(50, 45);

        expect(visibility(viewer, { x: 1, y: -1 }, D, point)).toBe(1);
        expect(visibility(viewer, { x: 7, y: -7 }, D, point)).toBe(1);
        expect(visibility(viewer, { x: Math.SQRT1_2, y: -Math.SQRT1_2 }, D, at(50, 225))).toBe(0);
    });

    it('sees only the near radius with no usable facing or distance', () => {
        for (const facing of [{ x: 0, y: 0 }, { x: NaN, y: 1 }, { x: Infinity, y: 0 }])
        {
            expect(visibility(viewer, facing, D, at(50, 0))).toBe(0);
            expect(visibility(viewer, facing, D, at(NEAR_SIGHT - 1, 0))).toBe(1);
        }
        expect(visibility(viewer, north, 0, at(50, 0))).toBe(0);
        expect(visibility(viewer, north, NaN, at(50, 0))).toBe(0);
    });
});

describe('sightDistance', () => {
    it('runs from clear to severe and shrinks steadily as whiteout rises', () => {
        expect(sightDistance(0)).toBeCloseTo(CLEAR_SIGHT);
        expect(sightDistance(1)).toBeCloseTo(SEVERE_SIGHT);

        let previous = Infinity;
        for (let w = 0; w <= 1; w += 0.25)
        {
            expect(sightDistance(w)).toBeLessThan(previous);
            previous = sightDistance(w);
        }

        // Equal whiteout steps cut sight by equal proportions.
        expect(sightDistance(0.25) / sightDistance(0)).toBeCloseTo(sightDistance(1) / sightDistance(0.75));
    });

    it('clamps out-of-range input', () => {
        expect(sightDistance(-1)).toBeCloseTo(CLEAR_SIGHT);
        expect(sightDistance(5)).toBeCloseTo(SEVERE_SIGHT);
        expect(sightDistance(NaN)).toBeCloseTo(CLEAR_SIGHT);
    });
});

describe('nextFacing', () => {
    it('turns to the movement direction and keeps facing when not moving', () => {
        const east = { x: 1, y: 0 };
        const southWest = { x: -Math.SQRT1_2, y: Math.SQRT1_2 };

        expect(nextFacing(north, east)).toEqual(east);
        expect(nextFacing(north, southWest)).toEqual(southWest);
        expect(nextFacing(east, { x: 0, y: 0 })).toEqual(east);
    });
});

describe('facingToward', () => {
    const previous = { x: 0, y: -1 };

    it('points at the target at any angle, with unit length', () => {
        for (let degrees = 0; degrees < 360; degrees += 7.5)
        {
            const r = degrees * Math.PI / 180;
            const facing = facingToward(previous, viewer, { x: viewer.x + Math.cos(r) * 37, y: viewer.y + Math.sin(r) * 37 });

            expect(facing.x).toBeCloseTo(Math.cos(r));
            expect(facing.y).toBeCloseTo(Math.sin(r));
            expect(Math.hypot(facing.x, facing.y)).toBeCloseTo(1);
        }

        expect(facingToward(previous, viewer, { x: viewer.x + 300, y: viewer.y + 400 })).toEqual({ x: 0.6, y: 0.8 });
        expect(facingToward(previous, viewer, { x: viewer.x + 3e6, y: viewer.y - 4e6 })).toEqual({ x: 0.6, y: -0.8 });
    });

    it('keeps the previous facing when the target is on or right next to the viewer', () => {
        expect(facingToward(previous, viewer, viewer)).toBe(previous);
        expect(facingToward(previous, viewer, { x: viewer.x + MIN_LOOK_DISTANCE - 0.1, y: viewer.y })).toBe(previous);
        expect(facingToward(previous, viewer, { x: viewer.x + MIN_LOOK_DISTANCE, y: viewer.y })).toEqual({ x: 1, y: 0 });
    });

    it('keeps the previous facing for a non-finite target', () => {
        expect(facingToward(previous, viewer, { x: NaN, y: 0 })).toBe(previous);
        expect(facingToward(previous, viewer, { x: Infinity, y: 0 })).toBe(previous);
    });
});

describe('lookAt', () => {
    const east = { facing: { x: 1, y: 0 }, held: false };
    const angle = (p: { x: number; y: number }) => Math.atan2(p.y, p.x);
    const isUnit = (p: { x: number; y: number }) => Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(Math.hypot(p.x, p.y) - 1) < 1e-9;

    it('points at a moved target at any angle', () => {
        for (let degrees = 0; degrees < 360; degrees += 15)
        {
            const r = degrees * Math.PI / 180;
            const look = lookAt(east, viewer, { x: viewer.x + Math.cos(r) * 80, y: viewer.y + Math.sin(r) * 80 }, true);

            expect(look.facing.x).toBeCloseTo(Math.cos(r));
            expect(look.facing.y).toBeCloseTo(Math.sin(r));
            expect(look.held).toBe(false);
        }
    });

    it('follows the mouse right up to the player, keeping only the dead zone', () => {
        const near = lookAt(east, viewer, { x: viewer.x, y: viewer.y - (MIN_LOOK_DISTANCE + 2) }, true);
        expect(near.facing).toEqual({ x: 0, y: -1 });

        // Standing still with the target that close afterwards does not change anything.
        expect(lookAt(near, viewer, { x: viewer.x, y: viewer.y - (MIN_LOOK_DISTANCE + 2) }, false).facing).toEqual({ x: 0, y: -1 });

        expect(lookAt(east, viewer, { x: viewer.x + 1, y: viewer.y + 1 }, true).facing).toBe(east.facing);
    });

    it('keeps tracking a distant stationary target while the viewer walks', () => {
        const target = { x: 300, y: 0 };
        let look = lookAt(east, { x: 0, y: 0 }, target, true);

        look = lookAt(look, { x: 0, y: 300 }, target, false);
        expect(look.facing.x).toBeCloseTo(Math.SQRT1_2);
        expect(look.facing.y).toBeCloseTo(-Math.SQRT1_2);
        expect(look.held).toBe(false);
    });

    it('does not reverse when the viewer walks straight through a stationary target', () => {
        const target = { x: 100, y: 0 };
        let look = lookAt(east, { x: 0, y: 0 }, target, true);

        for (let x = 0; x <= 200; x += 1.3)
        {
            look = lookAt(look, { x, y: 0 }, target, false);
            expect(look.facing.x).toBeCloseTo(1);
            expect(isUnit(look.facing)).toBe(true);
        }

        expect(look.held).toBe(true);
    });

    it('turns smoothly, without a jump, when passing beside a stationary target', () => {
        const target = { x: 100, y: LOOK_HOLD_RADIUS + 1 };
        let look = lookAt(east, { x: 0, y: 0 }, target, true);
        let previous = angle(look.facing);

        for (let x = 0; x <= 200; x += 1)
        {
            look = lookAt(look, { x, y: 0 }, target, false);
            const turn = Math.abs(angle(look.facing) - previous);

            expect(Math.min(turn, 2 * Math.PI - turn)).toBeLessThan(5 * Math.PI / 180);
            expect(isUnit(look.facing)).toBe(true);
            previous = angle(look.facing);
        }
    });

    it('ends the hold as soon as the target moves', () => {
        const held = { facing: { x: 1, y: 0 }, held: true };
        const look = lookAt(held, { x: 200, y: 0 }, { x: 100, y: 0 }, true);

        expect(look).toEqual({ facing: { x: -1, y: 0 }, held: false });
    });
});
