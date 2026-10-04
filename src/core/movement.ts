import { clamp, type Point } from './geometry';
import { slopeBetween, type ElevationGrid } from './terrain/elevation';

/** Player walking speed on flat ground, in world pixels per second. */
export const PLAYER_SPEED = 80;

/**
 * Uphill slope (normalized elevation per px) at which walking speed halves.
 * 1/180 is a rise of 0.222 (two of the test field's nine levels) per 40px.
 */
export const HALF_SPEED_SLOPE = 1 / 180;

/** Longest distance (px) a single update moves before the slope is measured again. */
const MAX_SUBSTEP = 1;

/** Upper bound on substeps per update, so a huge time step cannot stall the game. */
const MAX_SUBSTEPS = 1000;

export interface DirectionInput
{
    readonly left: boolean;
    readonly right: boolean;
    readonly up: boolean;
    readonly down: boolean;
}

/** Inclusive rectangle a position must stay inside. */
export interface Bounds
{
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
}

/**
 * Resolves held directions to a unit-length movement direction, or (0, 0).
 * Opposite directions cancel per axis. Diagonals are normalized so they are not faster.
 */
export function inputDirection (input: DirectionInput): Point
{
    const x = Number(input.right) - Number(input.left);
    const y = Number(input.down) - Number(input.up);
    const length = Math.hypot(x, y);

    return length === 0 ? { x: 0, y: 0 } : { x: x / length, y: y / length };
}

/** Moves along `direction` at `speed` px/s for `seconds`, then clamps the result to `bounds`. */
export function moveWithin (position: Point, direction: Point, speed: number, seconds: number, bounds: Bounds): Point
{
    return {
        x: clamp(position.x + direction.x * speed * seconds, bounds.minX, bounds.maxX),
        y: clamp(position.y + direction.y * speed * seconds, bounds.minY, bounds.maxY)
    };
}

/**
 * Walking speed multiplier for a directional slope (normalized elevation per px, positive uphill).
 *
 * Flat and downhill: 1. Uphill: 1 / (1 + (slope / HALF_SPEED_SLOPE)^2), which stays near 1 on
 * gentle slopes, is 0.5 at HALF_SPEED_SLOPE and falls towards 0 on cliffs.
 *
 * The time cost per pixel grows with the square of the slope, so the cheapest way to gain height
 * is at HALF_SPEED_SLOPE: anything steeper costs more time than a longer, gentler climb.
 * (A cost linear in slope would make every climb between two points cost the same,
 * so the shortest route would always win.)
 */
export function slopeSpeedMultiplier (slope: number): number
{
    if (!(slope > 0))
    {
        // Flat, downhill, or not a number.
        return 1;
    }

    const ratio = slope / HALF_SPEED_SLOPE;

    return 1 / (1 + ratio * ratio);
}

export interface WalkStep
{
    readonly position: Point;
    /** Directional slope at the end of the step, as used for its speed. */
    readonly slope: number;
    readonly speedMultiplier: number;
}

/**
 * Walks along `direction` (unit length, any angle) for `seconds` over `grid`, slowed by the uphill
 * slope in the direction actually travelled, and clamped to `bounds`. Long steps are split so the
 * slope is re-measured at least every MAX_SUBSTEP px, which keeps travel time independent of frame rate.
 *
 * Against an edge the blocked component is dropped, so the walker slides along the edge at the
 * remaining component's speed, and the slope is measured along that slide.
 */
export function walk (grid: ElevationGrid, position: Point, direction: Point, seconds: number, bounds: Bounds): WalkStep
{
    const substeps = clamp(Math.ceil(PLAYER_SPEED * seconds / MAX_SUBSTEP), 1, MAX_SUBSTEPS);
    const dt = seconds / substeps;

    let current = position;
    let slope = 0;
    let speedMultiplier = 1;

    for (let i = 0; i < substeps; i++)
    {
        // Where a full-speed substep would end: the slope along it is the slope of the actual path.
        const ahead = moveWithin(current, direction, PLAYER_SPEED, dt, bounds);

        slope = slopeBetween(grid, current, ahead);
        speedMultiplier = slopeSpeedMultiplier(slope);
        current = moveWithin(current, direction, PLAYER_SPEED * speedMultiplier, dt, bounds);
    }

    return { position: current, slope, speedMultiplier };
}
