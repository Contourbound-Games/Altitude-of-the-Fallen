import type { Point } from './geometry';

/** A bearing taken by an observer towards a known landmark (compass degrees, see survey.ts). */
export interface Observation
{
    readonly landmark: Point;
    readonly bearing: number;
}

/**
 * Smallest angle (degrees) the two sight lines may make with each other. Below it the lines are
 * too close to parallel (or anti-parallel) for their crossing point to be a trustworthy position.
 */
export const MIN_INTERSECTION_ANGLE = 20;

/** The bearing pointing the opposite way: from the landmark back towards the observer. */
export function reverseBearing (bearing: number): number
{
    return ((bearing + 180) % 360 + 360) % 360;
}

/** Unit vector for a compass bearing (0 = north = -y, 90 = east = +x). */
export function bearingVector (bearing: number): Point
{
    const radians = bearing * Math.PI / 180;

    return { x: Math.sin(radians), y: -Math.cos(radians) };
}

/**
 * Where the observer must stand to have seen both landmarks at their observed bearings.
 *
 * Each observation defines a ray starting at its landmark and running along the reverse bearing,
 * back towards the observer. The result is where the two rays cross. Returns null when:
 * - a bearing or landmark coordinate is not finite;
 * - the rays make less than MIN_INTERSECTION_ANGLE with each other (parallel, anti-parallel or
 *   nearly so, including two observations of the same landmark position);
 * - the crossing lies behind either landmark (inconsistent observations).
 */
export function triangulate (first: Observation, second: Observation): Point | null
{
    const values = [first.bearing, second.bearing, first.landmark.x, first.landmark.y, second.landmark.x, second.landmark.y];

    if (!values.every(Number.isFinite))
    {
        return null;
    }

    const u = bearingVector(reverseBearing(first.bearing));
    const v = bearingVector(reverseBearing(second.bearing));

    // Solve first.landmark + s * u = second.landmark + t * v for s and t (Cramer's rule).
    // |cross| is the sine of the angle between the two rays' lines.
    const cross = u.x * v.y - u.y * v.x;

    if (Math.abs(cross) < Math.sin(MIN_INTERSECTION_ANGLE * Math.PI / 180))
    {
        return null;
    }

    const dx = second.landmark.x - first.landmark.x;
    const dy = second.landmark.y - first.landmark.y;
    const s = (dx * v.y - dy * v.x) / cross;
    const t = (dx * u.y - dy * u.x) / cross;

    if (!(s > 0 && t > 0))
    {
        return null;
    }

    return { x: first.landmark.x + s * u.x, y: first.landmark.y + s * u.y };
}

/** An observation read to within `halfWidth` degrees either side of its bearing. */
export interface WideObservation extends Observation
{
    readonly halfWidth: number;
}

/**
 * Where the observer may stand given both observations' uncertainty: the four corners where the
 * edges of the two reading wedges cross, in order round the region. Null when any pair of edges
 * fails to give a usable crossing (see triangulate).
 */
export function fixRegion (first: WideObservation, second: WideObservation): Point[] | null
{
    const corner = (a: number, b: number) => triangulate(
        { landmark: first.landmark, bearing: first.bearing + a * first.halfWidth },
        { landmark: second.landmark, bearing: second.bearing + b * second.halfWidth }
    );
    const corners = [corner(-1, -1), corner(-1, 1), corner(1, 1), corner(1, -1)];

    return corners.every(point => point !== null) ? corners as Point[] : null;
}

/**
 * Of several observations taken from one spot, the two whose sight lines cross most nearly at
 * right angles and still give a fix (see triangulate), or null when no pair does.
 */
export function bestPair<T extends Observation> (observations: readonly T[]): [T, T] | null
{
    let best: [T, T] | null = null;
    let bestSine = 0;

    for (let i = 0; i < observations.length; i++)
    {
        for (let j = i + 1; j < observations.length; j++)
        {
            const [a, b] = [observations[i], observations[j]];
            const sine = Math.abs(Math.sin((a.bearing - b.bearing) * Math.PI / 180));

            if (sine > bestSine && triangulate(a, b) !== null)
            {
                best = [a, b];
                bestSine = sine;
            }
        }
    }

    return best;
}
