import type { Point } from './geometry';
import { elevationAt, type ElevationGrid } from './terrain/elevation';

/**
 * Ground the map marks as dangerous. Entering a `slide` zone carries the player down the slope
 * (see slideFrom); entering a `fatal` zone ends the run.
 */
export type HazardKind = 'slide' | 'fatal';

export interface HazardZone
{
    readonly kind: HazardKind;
    /** Closed polygon in world px (the last vertex joins the first). */
    readonly polygon: readonly Point[];
}

/** Whether `point` lies inside `polygon` (even-odd rule; points exactly on an edge may go either way). */
export function insidePolygon (polygon: readonly Point[], point: Point): boolean
{
    let inside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++)
    {
        const a = polygon[i];
        const b = polygon[j];

        if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x)
        {
            inside = !inside;
        }
    }

    return inside;
}

/** The hazard at `point`, or null. Where zones overlap, a fatal zone wins over a slide zone. */
export function hazardAt (zones: readonly HazardZone[], point: Point): HazardZone | null
{
    let found: HazardZone | null = null;

    for (const zone of zones)
    {
        if (insidePolygon(zone.polygon, point))
        {
            if (zone.kind === 'fatal')
            {
                return zone;
            }

            found = zone;
        }
    }

    return found;
}

/** Distance (px) the slide moves per step. */
const SLIDE_STEP = 2;
/** Span (px) of the central differences that give the slope a slide follows. */
const SLIDE_SPAN = 6;
/** A slide stops once out of every slide zone on ground flatter than this (elevation per px). */
export const SLIDE_STOP_SLOPE = 0.001;
/** Safety cap on slide length in steps. */
const SLIDE_MAX_STEPS = 2000;

export interface Slide
{
    /** Every point the slide passes through, from the entry point to the landing. */
    readonly path: readonly Point[];
    readonly landing: Point;
    /** True when the slide carried the player into a fatal zone. */
    readonly fatal: boolean;
}

/**
 * Where a slide that starts at `start` carries the player: down the steepest descent of `grid`, a
 * fixed step at a time, until out of every slide zone on ground flatter than SLIDE_STOP_SLOPE.
 * Deterministic: the same start always gives the same path. Stops early if it reaches a fatal zone.
 */
export function slideFrom (grid: ElevationGrid, zones: readonly HazardZone[], start: Point): Slide
{
    const path: Point[] = [start];
    let current = start;

    for (let i = 0; i < SLIDE_MAX_STEPS; i++)
    {
        const at = (dx: number, dy: number) => elevationAt(grid, current.x + dx, current.y + dy);
        const gx = (at(SLIDE_SPAN, 0) - at(-SLIDE_SPAN, 0)) / (2 * SLIDE_SPAN);
        const gy = (at(0, SLIDE_SPAN) - at(0, -SLIDE_SPAN)) / (2 * SLIDE_SPAN);
        const slope = Math.hypot(gx, gy);
        const hazard = hazardAt(zones, current);

        if (hazard?.kind === 'fatal')
        {
            return { path, landing: current, fatal: true };
        }

        if ((hazard === null && slope < SLIDE_STOP_SLOPE) || !(slope > 0))
        {
            break;
        }

        current = { x: current.x - gx / slope * SLIDE_STEP, y: current.y - gy / slope * SLIDE_STEP };
        path.push(current);
    }

    return { path, landing: current, fatal: false };
}
