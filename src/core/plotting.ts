import type { Point } from './geometry';
import type { Bounds } from './movement';
import { bearingVector } from './triangulation';

/** Where the map draws the world: world point p appears at (x + p.x * scale, y + p.y * scale). */
export interface MapLayout
{
    readonly x: number;
    readonly y: number;
    readonly scale: number;
}

/**
 * The largest uniform scale that fits a `worldWidth` x `worldHeight` world into `area`, with the
 * map centred horizontally in the area and aligned to its top. Throws on non-positive sizes.
 */
export function fitMap (worldWidth: number, worldHeight: number, area: { x: number; y: number; width: number; height: number }): MapLayout
{
    if (!(worldWidth > 0 && worldHeight > 0 && area.width > 0 && area.height > 0))
    {
        throw new RangeError(`Map sizes must be positive, got world ${worldWidth}x${worldHeight}, area ${area.width}x${area.height}`);
    }

    const scale = Math.min(area.width / worldWidth, area.height / worldHeight);

    return { x: area.x + (area.width - worldWidth * scale) / 2, y: area.y, scale };
}

/** A world point's position on the map. */
export function toMap (point: Point, layout: MapLayout): Point
{
    return { x: layout.x + point.x * layout.scale, y: layout.y + point.y * layout.scale };
}

/**
 * Where a ray from `origin` along compass `bearing` leaves `bounds` (see survey.ts for the bearing
 * convention). Used to draw a plotted bearing line from a landmark to the edge of the map.
 * Returns null when the bearing or origin is not finite or the origin lies outside the bounds.
 */
export function rayExit (origin: Point, bearing: number, bounds: Bounds): Point | null
{
    if (![bearing, origin.x, origin.y].every(Number.isFinite))
    {
        return null;
    }

    if (origin.x < bounds.minX || origin.x > bounds.maxX || origin.y < bounds.minY || origin.y > bounds.maxY)
    {
        return null;
    }

    const direction = bearingVector(bearing);
    // Distance along the ray to the vertical and horizontal edges it is heading for.
    const toX = direction.x > 0 ? (bounds.maxX - origin.x) / direction.x
        : direction.x < 0 ? (bounds.minX - origin.x) / direction.x : Infinity;
    const toY = direction.y > 0 ? (bounds.maxY - origin.y) / direction.y
        : direction.y < 0 ? (bounds.minY - origin.y) / direction.y : Infinity;

    // Land exactly on the edge that is hit first (and on both at a corner).
    if (toX <= toY)
    {
        const y = toX === toY ? (direction.y > 0 ? bounds.maxY : bounds.minY) : origin.y + direction.y * toX;
        return { x: direction.x > 0 ? bounds.maxX : bounds.minX, y };
    }

    return { x: origin.x + direction.x * toY, y: direction.y > 0 ? bounds.maxY : bounds.minY };
}
