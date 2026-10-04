import { clamp, type Point } from '../geometry';
import { elevationAt, type ElevationGrid } from './elevation';

/**
 * The local shape of the ground around a point. Every quantity is a difference between nearby
 * elevations, so none of it depends on how high the point is: adding a constant to the whole
 * field leaves the form unchanged. This is what the player may read from the snow.
 */
export interface SurfaceForm
{
    /** Elevation gradient (normalized elevation per world px); points uphill. */
    readonly gx: number;
    readonly gy: number;
    /** Steepness: the gradient's magnitude. */
    readonly slope: number;
    /**
     * Discrete Laplacian over the sampling span (per px²): positive in hollows and basins (concave),
     * negative on crests and ridges (convex), 0 on level or evenly sloping ground.
     */
    readonly curvature: number;
}

/**
 * Surface form at (x, y), from the four elevations `span` px away on each side. With a span of a
 * whole number of grid spacings, the result is a smooth interpolation of the same quantity at the
 * samples, so the creases between the grid's bilinear cells do not show.
 */
export function surfaceForm (grid: ElevationGrid, x: number, y: number, span: number): SurfaceForm
{
    const at = (dx: number, dy: number) => elevationAt(grid, x + dx, y + dy);
    const centre = at(0, 0);
    const east = at(span, 0);
    const west = at(-span, 0);
    const south = at(0, span);
    const north = at(0, -span);
    const gx = (east - west) / (2 * span);
    const gy = (south - north) / (2 * span);

    return {
        gx,
        gy,
        slope: Math.hypot(gx, gy),
        curvature: (east + west + south + north - 4 * centre) / (span * span)
    };
}

/**
 * How the snow at `form` is lit, from -1 to 1: positive where the ground faces the light, negative
 * where it faces away, 0 on level ground. `light` is a unit vector in the ground plane pointing
 * towards the light; ground that rises away from it faces it. A slope of `relief` (per px) or more
 * along the light is fully lit or fully shaded.
 */
export function snowLight (form: SurfaceForm, light: Point, relief: number): number
{
    return clamp(-(form.gx * light.x + form.gy * light.y) / relief, -1, 1);
}
