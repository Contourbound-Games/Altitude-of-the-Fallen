import { clamp, type Point } from './geometry';
import type { HazardZone } from './hazards';
import { createElevationGrid } from './terrain/elevation';

/**
 * "The Shelf": the vertical-slice leg. Every number here is authored; FieldScene draws it and the
 * tests check its routes, hazards and fix geometry with the same rules the game uses.
 *
 * ```
 * N ~~~~~~~~~~~~~~~~~~~~ drop (fatal) ~~~~~~~~~~~~~~~~~~~~~~~~
 *    UPPER SHELF (falls gently SE)          PLATEAU
 *    start      ▲ tower knoll   ROCK BAND        │ ramp
 *    ═══════ shelf edge / TRAVERSE ledge ════╗   ↓
 *    ////////// SLAB (slide) //// K /////////║  LOWER SNOWFIELD
 *  ramp   RUN-OUT BASIN   · B   ── gully ──→      ⌂ hut
 * S ~~~~~~~~~~~~~~~~~~~~ drop (fatal) ~~~~~~~~~~~~~~~~~~~~~~~~
 * ```
 *
 * The slab is the one slide zone: steep, loaded snow between the shelf edge / traverse ledge above
 * and the basin floor below. Its polygon follows the terrain's steep band (see the tests), so a
 * slide always starts where the ground visibly steepens. Everything outside SHELF_INNER is a drop.
 */
export const SHELF_WIDTH = 2400;
export const SHELF_HEIGHT = 1380;
const SPACING = 30;

/** Walkable ground; beyond it the mountain drops away (fatal). */
export const SHELF_INNER = { minX: 400, minY: 240, maxX: 2000, maxY: 1130 };

const BASIN = 0.12;
const PLATEAU = 0.95;
/** Traverse ledge centreline: entry, bend, exit. */
export const TRAVERSE: readonly Point[] = [{ x: 1120, y: 575 }, { x: 1300, y: 575 }, { x: 1400, y: 675 }];
/** Half-width (px) of the gentle ledge on either side of the traverse centreline. */
export const LEDGE_HALF_WIDTH = 30;
/** Depth (px) of the slab below the ledge or shelf edge, measured down the fall line. */
const SLAB_DEPTH = 100;

/** The upper shelf: a broad plane falling gently to the south-east. */
const shelf = (x: number, y: number) => 0.92 - 0.00022 * (x - 420) - 0.0003 * (y - 240);
/** The lower snowfield: almost level, falling slightly to the south. */
const snowfield = (x: number, y: number) => 0.47 - 0.0003 * (y - 680) - 0.00004 * (x - 1420);
/** Ledge level along the traverse: the shelf's level at the entry, falling to the snowfield's at the exit. */
const ledgeLevel = (x: number) => x <= 1300
    ? shelf(1120, 575) + (0.64 - shelf(1120, 575)) * (x - 1120) / 180
    : 0.64 + (snowfield(1420, 680) - 0.64) * (x - 1300) / 100;

const smooth = (t: number) => {
    const c = clamp(t, 0, 1);

    return c * c * (3 - 2 * c);
};

/** Signed distance from `p` to the second traverse segment (positive on its south-west side) and how far along it `p` projects (0..1). */
function seg2 (p: Point): { distance: number; along: number }
{
    const [, a, b] = TRAVERSE;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const ux = (b.x - a.x) / length;
    const uy = (b.y - a.y) / length;

    return { distance: (p.x - a.x) * -uy + (p.y - a.y) * ux, along: ((p.x - a.x) * ux + (p.y - a.y) * uy) / length };
}

/** Authored elevation before smoothing (0..1). Regions are checked from the most specific outwards. */
function rawElevation (x: number, y: number): number
{
    const inner = SHELF_INNER;

    if (x < inner.minX || x > inner.maxX || y < inner.minY || y > inner.maxY)
    {
        return 0;
    }

    const knoll = 0.05 * Math.max(0, Math.cos(Math.min(Math.PI / 2, Math.hypot(x - TOWER.x, y - TOWER.y) / 70 * Math.PI / 2)));
    const s2 = seg2({ x, y });
    const top = 575 - LEDGE_HALF_WIDTH;
    const slabTop = 575 + LEDGE_HALF_WIDTH;

    /** Gully floor: rises gently from the basin to the snowfield. */
    const gully = (gx: number, gy: number) => BASIN + (snowfield(gx, gy) - BASIN) * clamp((gx - 1300) / 200, 0, 1);

    // South bank of the basin and gully, rising to the drop.
    if (y > 960 && x < 1650)
    {
        return (x < 1300 ? BASIN : gully(x, 960)) + (y - 960) * 0.0012;
    }

    // Rib: the snowfield's western edge falls steeply into the basin.
    if (x >= 1320 && x < 1420 && y >= 700 && y < 850)
    {
        return BASIN + (snowfield(1420, y) - BASIN) * smooth((x - 1320) / 100);
    }

    // Gully: a gentle trough from the basin up to the snowfield, with gentle sides.
    if (x >= 1300 && x < 1650 && y >= 820)
    {
        return x < 1420 ? gully(x, y) : snowfield(x, y) + (gully(x, y) - snowfield(x, y)) * smooth((y - 820) / 80);
    }

    // Lower snowfield.
    if (x >= 1420 && y >= 690)
    {
        return snowfield(x, y);
    }

    // Plateau-side ramp, north-east of the second traverse segment.
    if (x >= 1300 && s2.distance < -LEDGE_HALF_WIDTH && y >= 450)
    {
        return PLATEAU - (PLATEAU - snowfield(Math.max(x, 1420), 690)) * clamp((y - 450) / 240, 0, 1);
    }

    // Second traverse segment: ledge, then slab down to the basin.
    if (x >= 1290 && s2.along >= 0 && s2.along <= 1.2 && s2.distance >= -LEDGE_HALF_WIDTH)
    {
        const level = ledgeLevel(1300 + 100 * clamp(s2.along, 0, 1));

        if (s2.distance <= LEDGE_HALF_WIDTH)
        {
            return level - 0.0004 * s2.distance;
        }

        return level - (level - BASIN) * smooth((s2.distance - LEDGE_HALF_WIDTH) / SLAB_DEPTH);
    }

    // Plateau and the gentle access ramp up from the shelf's north-east corner.
    if (y < 480 && x >= 980)
    {
        return x >= 1120 ? PLATEAU : shelf(x, y) + (PLATEAU - shelf(x, y)) * (x - 980) / 140;
    }

    // Rock band above the first traverse segment.
    if (x >= 1120 && x < 1300 && y < top)
    {
        return PLATEAU - (PLATEAU - ledgeLevel(x)) * clamp((y - 480) / (top - 480), 0, 1);
    }

    // First traverse segment: the ledge.
    if (x >= 1120 && x < 1300 && y <= slabTop)
    {
        return ledgeLevel(x) - 0.0004 * (y - 575);
    }

    // West ramp: the gentle way between the shelf and the basin floor.
    const ramp = shelf(x, 575) - (shelf(x, 575) - BASIN) * clamp((y - 575) / 330, 0, 1);

    if (y <= slabTop)
    {
        return x < 600 && y > 575 ? ramp : shelf(x, y) + knoll;
    }

    // Slab below the shelf edge and the first traverse segment, then the basin floor.
    const edge = x < 1120 ? shelf(x, slabTop) : ledgeLevel(x) - 0.0004 * LEDGE_HALF_WIDTH;
    const slab = edge - (edge - BASIN) * smooth((y - slabTop) / SLAB_DEPTH);

    // Towards the west end the slab gives way to the ramp.
    return ramp + (slab - ramp) * smooth((x - 560) / 80);
}

/** [1, 2, 1] / 4 smoothing in each direction, so region seams become slopes rather than steps. */
function smoothed (rows: number[][]): number[][]
{
    const pass = (grid: number[][], dx: number, dy: number) => grid.map((row, r) => row.map((value, c) => {
        const at = (rr: number, cc: number) => grid[clamp(rr, 0, grid.length - 1)][clamp(cc, 0, row.length - 1)];

        return (at(r - dy, c - dx) + 2 * value + at(r + dy, c + dx)) / 4;
    }));

    return pass(pass(rows, 1, 0), 0, 1);
}

/** A rock tower on a knoll at the shelf's north-east: ordinary, reachable, the safe reset point. */
export const TOWER: Point = { x: 960, y: 470 };
/** Karel lies on the slab below the traverse: seen from the entry and the bend, unreachable without sliding. */
export const KAREL: Point = { x: 1240, y: 680 };
/** Corpse B lies on the basin floor, where an earlier slide ended. */
export const CORPSE_B: Point = { x: 1250, y: 820 };
/** The buried hut on the lower snowfield. */
export const HUT: Point = { x: 1520, y: 760 };
/** Where the run starts: on the shelf, with no landmark in survey range. */
export const SHELF_START: Point = { x: 640, y: 430 };
/** Fixed light whiteout for the whole slice. */
export const SHELF_WHITEOUT = 0.25;

export const SHELF_ELEVATION = createElevationGrid(SPACING, smoothed(
    Array.from({ length: SHELF_HEIGHT / SPACING + 1 }, (_, r) =>
        Array.from({ length: SHELF_WIDTH / SPACING + 1 }, (_, c) => clamp(rawElevation(c * SPACING, r * SPACING), 0, 1)))
));

/** The slab: the steep band below the shelf edge, the traverse ledge and the snowfield's west edge. */
export const SLAB: readonly Point[] = [
    { x: 600, y: 605 }, { x: 1288, y: 605 }, { x: 1379, y: 696 }, { x: 1420, y: 700 },
    { x: 1420, y: 850 }, { x: 1320, y: 850 }, { x: 1320, y: 705 }, { x: 600, y: 705 }
];

/** Rock band above the first traverse segment (drawn as rock; steep but safe to walk). */
export const ROCK_BAND: readonly Point[] = [
    { x: 1120, y: 480 }, { x: 1300, y: 480 }, { x: 1300, y: 545 }, { x: 1120, y: 545 }
];

const { minX, minY, maxX, maxY } = SHELF_INNER;

export const SHELF_HAZARDS: readonly HazardZone[] = [
    { kind: 'slide', polygon: SLAB },
    // The drop on every side, as four bands out to the world edge.
    { kind: 'fatal', polygon: [{ x: 0, y: 0 }, { x: SHELF_WIDTH, y: 0 }, { x: SHELF_WIDTH, y: minY }, { x: 0, y: minY }] },
    { kind: 'fatal', polygon: [{ x: 0, y: maxY }, { x: SHELF_WIDTH, y: maxY }, { x: SHELF_WIDTH, y: SHELF_HEIGHT }, { x: 0, y: SHELF_HEIGHT }] },
    { kind: 'fatal', polygon: [{ x: 0, y: 0 }, { x: minX, y: 0 }, { x: minX, y: SHELF_HEIGHT }, { x: 0, y: SHELF_HEIGHT }] },
    { kind: 'fatal', polygon: [{ x: maxX, y: 0 }, { x: SHELF_WIDTH, y: 0 }, { x: SHELF_WIDTH, y: SHELF_HEIGHT }, { x: maxX, y: SHELF_HEIGHT }] }
];

/** Distance (px) from `point` to the nearest fatal edge (0 or less once over it). */
export function distanceToDrop (point: Point): number
{
    return Math.min(point.x - minX, maxX - point.x, point.y - minY, maxY - point.y);
}
