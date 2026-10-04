import { clamp, type Point } from './geometry';

/** Full width of the forward view cone. */
export const VIEW_CONE_ANGLE = Math.PI / 2;

/** Angle over which the cone edge fades out, beyond its half-angle. */
const CONE_EDGE_FADE = Math.PI / 18;

/** Radius around the player that stays visible in every direction, so its surroundings never vanish. */
export const NEAR_SIGHT = 12;

/**
 * Sight distance in clear weather (whiteout 0) and in the worst whiteout (whiteout 1), in px.
 * Severe sight was 28px at first: the cone then reached only ~6px past the near radius, so facing
 * barely changed what was visible. 40px keeps the forward view clearly longer than the near radius
 * and about one contour interval on the test field's gentle slopes.
 */
export const CLEAR_SIGHT = 200;
export const SEVERE_SIGHT = 40;

/** Fraction of the sight distance over which visibility fades to nothing. */
const DISTANCE_FADE = 0.35;

/**
 * Sight distance for a whiteout intensity from 0 (clear) to 1 (severe), clamped to that range.
 * Interpolated geometrically, so each step of whiteout cuts sight by the same proportion.
 */
export function sightDistance (whiteout: number): number
{
    const w = Number.isNaN(whiteout) ? 0 : clamp(whiteout, 0, 1);

    return CLEAR_SIGHT * (SEVERE_SIGHT / CLEAR_SIGHT) ** w;
}

/** A look target closer than this (px) to the viewer is too close to define a direction. */
export const MIN_LOOK_DISTANCE = 4;

/**
 * Unit facing from `viewer` towards `target`, at any angle. Keeps `previous` when the target is
 * within MIN_LOOK_DISTANCE of the viewer or not a finite point, so facing never becomes zero or NaN.
 */
export function facingToward (previous: Point, viewer: Point, target: Point): Point
{
    const dx = target.x - viewer.x;
    const dy = target.y - viewer.y;
    const length = Math.hypot(dx, dy);

    return length >= MIN_LOOK_DISTANCE && Number.isFinite(length) ? { x: dx / length, y: dy / length } : previous;
}

/**
 * Once the viewer walks within this distance (px) of a look target that is not itself moving,
 * facing is held instead of tracking the target, so walking through it does not flip facing round.
 */
export const LOOK_HOLD_RADIUS = 24;

export interface Look
{
    /** Unit facing. */
    readonly facing: Point;
    /** True while facing is held because the viewer came close to a stationary target. */
    readonly held: boolean;
}

/**
 * Mouse-look facing towards `target`, a fixed point on the ground.
 *
 * When the target moved (the mouse moved), facing points at it at once and any hold ends.
 * When it did not, facing keeps tracking it from the viewer's new position, unless the viewer
 * has come within LOOK_HOLD_RADIUS of it: from then on facing is held, even after the target
 * falls behind, until the target moves again.
 */
export function lookAt (look: Look, viewer: Point, target: Point, targetMoved: boolean): Look
{
    if (targetMoved)
    {
        return { facing: facingToward(look.facing, viewer, target), held: false };
    }

    if (look.held || Math.hypot(target.x - viewer.x, target.y - viewer.y) < LOOK_HOLD_RADIUS)
    {
        return { facing: look.facing, held: true };
    }

    return { facing: facingToward(look.facing, viewer, target), held: false };
}

/** Facing after moving in `direction`: the direction itself, or the previous facing when not moving. */
export function nextFacing (facing: Point, direction: Point): Point
{
    return direction.x === 0 && direction.y === 0 ? facing : direction;
}

/**
 * How visible `point` is (0 = hidden, 1 = fully visible) to a viewer at `viewer` looking along
 * `facing` (any length) who can see `distance` px. Visible: inside the forward cone and within
 * sight distance, with short fades at both edges, or within NEAR_SIGHT in any direction.
 * A zero or non-finite `facing` sees only the near radius.
 */
export function visibility (viewer: Point, facing: Point, distance: number, point: Point): number
{
    const dx = point.x - viewer.x;
    const dy = point.y - viewer.y;
    const range = Math.hypot(dx, dy);
    const near = clamp((NEAR_SIGHT - range) / 4 + 1, 0, 1);
    const facingLength = Math.hypot(facing.x, facing.y);

    if (range === 0)
    {
        return 1;
    }

    if (!(facingLength > 0) || !Number.isFinite(facingLength))
    {
        return near;
    }

    const cos = (dx * facing.x + dy * facing.y) / (range * facingLength);
    const angle = Math.acos(clamp(cos, -1, 1));
    const inCone = clamp((VIEW_CONE_ANGLE / 2 + CONE_EDGE_FADE - angle) / CONE_EDGE_FADE, 0, 1);
    const inRange = distance > 0 ? clamp((distance - range) / (distance * DISTANCE_FADE), 0, 1) : 0;

    return Math.max(near, inCone * inRange);
}
