/**
 * A position or direction in world space.
 * World units are pixels, the origin is the field's top-left corner, +x is right and +y is down.
 */
export interface Point
{
    readonly x: number;
    readonly y: number;
}

export function clamp (value: number, min: number, max: number): number
{
    return Math.min(Math.max(value, min), max);
}
