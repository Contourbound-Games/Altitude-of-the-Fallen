import type { Point } from './geometry';
import { visibility } from './visibility';

/**
 * Bearings are compass degrees in [0, 360): 0 = north (-y), 90 = east (+x), 180 = south (+y),
 * 270 = west (-x), increasing clockwise.
 */

/**
 * Least angle (degrees, either side) facing may be off a target's centre and still count as aimed
 * at it. Up close the target's own width takes over (see surveyBearing).
 */
export const SURVEY_TOLERANCE = 2;

/** The survey instrument sees this many times as far as the eye under the same whiteout. */
export const SURVEY_RANGE_FACTOR = 1.75;

/** How clearly (0..1, from `visibility`) a target must be seen before it can be surveyed. */
export const SURVEY_MIN_VISIBILITY = 0.5;

/** Bearing of a direction vector, or null for a zero or non-finite vector. */
export function bearingOf (direction: Point): number | null
{
    if (!(Math.hypot(direction.x, direction.y) > 0) || !Number.isFinite(direction.x + direction.y))
    {
        return null;
    }

    // atan2(east, north) with north = -y, so 0 is north and angles grow clockwise.
    const degrees = Math.atan2(direction.x, -direction.y) * 180 / Math.PI;

    return degrees < 0 ? degrees + 360 : degrees;
}

/** Bearing from `from` to `to`, or null when the points coincide. */
export function bearingTo (from: Point, to: Point): number | null
{
    return bearingOf({ x: to.x - from.x, y: to.y - from.y });
}

/** Smallest angle between two bearings, in degrees (0..180), across the 359/0 wrap. */
export function bearingDifference (a: number, b: number): number
{
    const difference = Math.abs(a - b) % 360;

    return difference > 180 ? 360 - difference : difference;
}

/** Angular step (degrees) of a reading taken at the very edge of visibility. */
export const SURVEY_COARSEST_STEP = 10;

/**
 * Angular step (degrees) of a reading taken of a target seen with `quality` (0..1, from
 * `visibility`): 1 when seen clearly, coarsening steadily to SURVEY_COARSEST_STEP as it fades.
 * Continuous on purpose: no particular quality (and so no particular distance) changes the
 * character of the reading, so the instrument cannot be used as a rangefinder.
 */
export function readingStep (quality: number): number
{
    const q = Number.isNaN(quality) ? 0 : Math.min(1, Math.max(0, quality));

    return 1 + (SURVEY_COARSEST_STEP - 1) * (1 - q);
}

/** `bearing` as an instrument with angular resolution `step` reads it: the nearest multiple of the step, in whole degrees. */
export function coarseReading (bearing: number, step: number): number
{
    return wholeBearing(((Math.round(bearing / step) * step) % 360 + 360) % 360);
}

/** A reading of a target: its whole-degree value and the angular step it was read with. */
export interface Reading
{
    readonly bearing: number;
    readonly step: number;
}

/**
 * What the instrument reads aimed along `facing`: null unless the target is seen at all
 * (visibility above 0) and aimed at within the tolerance. The reading is the true geometric bearing
 * read at the resolution its visibility allows (see readingStep). A coarse reading also accepts a
 * coarser aim: the tolerance is at least half its step.
 */
export function surveyReading (viewer: Point, facing: Point, sightDistance: number, target: Point, radius: number): Reading | null
{
    const aim = bearingOf(facing);
    const bearing = bearingTo(viewer, target);
    const quality = visibility(viewer, facing, sightDistance, target);

    if (aim === null || bearing === null || !(quality > 0))
    {
        return null;
    }

    const step = readingStep(quality);
    const range = Math.hypot(target.x - viewer.x, target.y - viewer.y);
    const tolerance = Math.max(SURVEY_TOLERANCE, Math.atan2(radius, range) * 180 / Math.PI, step / 2);

    return bearingDifference(aim, bearing) <= tolerance ? { bearing: coarseReading(bearing, step), step } : null;
}

/** Signed angle (degrees) from bearing `from` round to bearing `to`, in (-180, 180]: positive is clockwise (to the right). */
export function relativeBearing (from: number, to: number): number
{
    const difference = ((to - from) % 360 + 360) % 360;

    return difference > 180 ? difference - 360 : difference;
}

/**
 * Survey View projection: horizontal offset (px from the view centre) at which something
 * `relative` degrees right of the view's centre azimuth is drawn, in a view `width` px wide that
 * spans `fieldOfView` degrees. Linear in angle and independent of distance by construction, so the
 * view shows where a landmark lies, not how far away it is.
 */
export function angularOffset (relative: number, fieldOfView: number, width: number): number
{
    return relative * width / fieldOfView;
}

/** A bearing rounded to whole degrees for display, keeping 359.6 as 0 rather than 360. */
export function wholeBearing (bearing: number): number
{
    return Math.round(bearing) % 360;
}

/**
 * Bearing to the centre of `target` if the viewer is aimed at it and sees it at least
 * SURVEY_MIN_VISIBILITY clearly (with the same visibility rule the fog is drawn from); else null.
 *
 * "Aimed at it" means facing is within SURVEY_TOLERANCE of the centre, or within the angle the
 * target's `radius` (px) covers from the viewer, whichever is wider: aiming at any part of a nearby
 * target counts, while a distant one still needs a deliberate aim.
 */
export function surveyBearing (viewer: Point, facing: Point, sightDistance: number, target: Point, radius: number): number | null
{
    const aim = bearingOf(facing);
    const bearing = bearingTo(viewer, target);

    if (aim === null || bearing === null)
    {
        return null;
    }

    const range = Math.hypot(target.x - viewer.x, target.y - viewer.y);
    const tolerance = Math.max(SURVEY_TOLERANCE, Math.atan2(radius, range) * 180 / Math.PI);

    if (bearingDifference(aim, bearing) > tolerance)
    {
        return null;
    }

    return visibility(viewer, facing, sightDistance, target) >= SURVEY_MIN_VISIBILITY ? bearing : null;
}
