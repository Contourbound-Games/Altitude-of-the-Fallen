import { describe, expect, it } from 'vitest';
import type { Point } from './geometry';
import { HALF_SPEED_SLOPE, PLAYER_SPEED, slopeSpeedMultiplier, walk } from './movement';
import { createElevationGrid, elevationAt, type ElevationGrid } from './terrain/elevation';
import { FIELD_ELEVATION } from './terrain/fieldElevation';

// Same limits FieldScene uses for its 6px marker on the 640x360 field.
const BOUNDS = { minX: 3, minY: 3, maxX: 637, maxY: 357 };
const FPS = 240;

/** Walks straight legs between waypoints at a fixed frame rate; returns elapsed seconds and path length. */
function traverse (grid: ElevationGrid, waypoints: Point[], bounds = BOUNDS): { seconds: number; length: number }
{
    let position = waypoints[0];
    let seconds = 0;
    let length = 0;

    for (const target of waypoints.slice(1))
    {
        const legLength = Math.hypot(target.x - position.x, target.y - position.y);
        const direction = { x: (target.x - position.x) / legLength, y: (target.y - position.y) / legLength };

        length += legLength;

        // Until the target is reached or passed along this leg.
        while ((target.x - position.x) * direction.x + (target.y - position.y) * direction.y > 0)
        {
            position = walk(grid, position, direction, 1 / FPS, bounds).position;
            seconds += 1 / FPS;
        }

        position = target;
    }

    return { seconds, length };
}

// Low ground east of the hill to the summit.
const START = { x: 600, y: 180 };
const SUMMIT = { x: 340, y: 180 };
// A: straight west, up the gully floor and its headwall.
const DIRECT = [START, SUMMIT];
// B: north onto the ridge line, west along its gentle climb, then south onto the summit.
const RIDGE = [START, { x: 600, y: 120 }, { x: 340, y: 120 }, SUMMIT];

describe('route choice', () => {
    it('both routes link the same low start and high summit, and the ridge route is longer', () => {
        expect(elevationAt(FIELD_ELEVATION, START.x, START.y)).toBeCloseTo(2 / 9);
        expect(elevationAt(FIELD_ELEVATION, SUMMIT.x, SUMMIT.y)).toBe(1);
        expect(traverse(FIELD_ELEVATION, RIDGE).length).toBe(380);
        expect(traverse(FIELD_ELEVATION, DIRECT).length).toBe(260);
    });

    it('the longer, gentler ridge route beats the short route up the headwall', () => {
        const direct = traverse(FIELD_ELEVATION, DIRECT).seconds;
        const ridge = traverse(FIELD_ELEVATION, RIDGE).seconds;

        expect(ridge).toBeLessThan(direct * 0.75);
    });

    it('without the headwall, the same short route wins: the detour only pays off around steep ground', () => {
        // The field as it was before the gully was cut: the direct line climbs at most 2 levels per 40px.
        const noGully = createElevationGrid(40, [
            '33333333444321000',
            '33333345565432100',
            '33333456776543210',
            '33334567887654320',
            '33334578998754320',
            '33334578998754320',
            '33334567887654320',
            '33333456776543210',
            '33333345565432100',
            '33333333444321000'
        ].map(row => Array.from(row, digit => Number(digit) / 9)));

        expect(traverse(noGully, DIRECT).seconds).toBeLessThan(traverse(noGully, RIDGE).seconds);
    });
});

describe('switchbacks on a uniform slope', () => {
    /** 160 x 80 px plane rising northward (towards -y) by `gradient` per px; level east-west. */
    const planeRisingNorth = (gradient: number) => createElevationGrid(20, Array.from({ length: 5 }, (_, row) =>
        Array.from({ length: 9 }, () => gradient * (80 - row * 20))
    ));
    const bounds = { minX: 0, minY: 0, maxX: 160, maxY: 80 };

    const START = { x: 80, y: 70 };
    const GOAL = { x: 80, y: 10 };
    // A: straight up the fall line, 60px.
    const STRAIGHT = [START, GOAL];
    // B: four 45-degree legs zig-zagging to the same goal, 4 x 15 * sqrt(2) = 84.9px.
    const SWITCHBACKS = [START, { x: 95, y: 55 }, { x: 80, y: 40 }, { x: 95, y: 25 }, GOAL];

    /** Travel time over a leg of `length` px climbing at a constant directional `slope`. */
    const predicted = (length: number, slope: number) => length / (PLAYER_SPEED * slopeSpeedMultiplier(slope));

    it('climbs the same height on both routes, with the switchbacks 41% longer', () => {
        const plane = planeRisingNorth(HALF_SPEED_SLOPE);
        const gain = elevationAt(plane, GOAL.x, GOAL.y) - elevationAt(plane, START.x, START.y);

        expect(gain).toBeCloseTo(60 * HALF_SPEED_SLOPE);
        expect(traverse(plane, STRAIGHT, bounds).length).toBeCloseTo(60);
        expect(traverse(plane, SWITCHBACKS, bounds).length).toBeCloseTo(60 * Math.SQRT2);
    });

    it('on a gentle slope, going straight up is faster', () => {
        const gradient = HALF_SPEED_SLOPE / 2;
        const plane = planeRisingNorth(gradient);
        const straight = traverse(plane, STRAIGHT, bounds).seconds;
        const switchbacks = traverse(plane, SWITCHBACKS, bounds).seconds;

        expect(straight).toBeCloseTo(predicted(60, gradient), 1);
        expect(switchbacks).toBeCloseTo(predicted(60 * Math.SQRT2, gradient * Math.SQRT1_2), 1);
        expect(straight).toBeLessThan(switchbacks);
    });

    it('on a steep slope, the longer switchbacks are faster', () => {
        const gradient = HALF_SPEED_SLOPE * 2;
        const plane = planeRisingNorth(gradient);
        const straight = traverse(plane, STRAIGHT, bounds).seconds;
        const switchbacks = traverse(plane, SWITCHBACKS, bounds).seconds;

        expect(straight).toBeCloseTo(predicted(60, gradient), 1);
        expect(switchbacks).toBeCloseTo(predicted(60 * Math.SQRT2, gradient * Math.SQRT1_2), 1);
        expect(switchbacks).toBeLessThan(straight * 0.9);
    });
});
