import { describe, expect, it } from 'vitest';
import type { Point } from './geometry';
import { hazardAt, insidePolygon, slideFrom, SLIDE_STOP_SLOPE } from './hazards';
import { walk } from './movement';
import {
    CORPSE_B, distanceToDrop, HUT, KAREL, ROCK_BAND, SHELF_ELEVATION, SHELF_HAZARDS, SHELF_HEIGHT, SHELF_START,
    SHELF_WHITEOUT, SHELF_WIDTH, SLAB, TOWER, TRAVERSE
} from './shelf';
import { SURVEY_RANGE_FACTOR } from './survey';
import { surfaceForm } from './terrain/surface';
import { sightDistance } from './visibility';
import { bearingTo } from './survey';

// The same camera bounds FieldScene uses (half a 640x360 screen in from every world edge).
const BOUNDS = { minX: 320, minY: 180, maxX: SHELF_WIDTH - 320, maxY: SHELF_HEIGHT - 180 };
const FPS = 60;
const SURVEY_RANGE = SURVEY_RANGE_FACTOR * sightDistance(SHELF_WHITEOUT);
/** Readings within this distance are as precise as the instrument gets; beyond it they coarsen. */
const PRECISE_RANGE = 0.65 * SURVEY_RANGE;

interface Walked
{
    readonly seconds: number;
    readonly length: number;
    /** First hazard entered on the way, if any, and where. */
    readonly hazard: { kind: string; at: Point } | null;
}

/** Walks straight legs between waypoints at FPS with the game's own walk(), stopping at the first hazard. */
function traverse (waypoints: readonly Point[]): Walked
{
    let position = waypoints[0];
    let seconds = 0;
    let length = 0;

    for (const target of waypoints.slice(1))
    {
        const legLength = Math.hypot(target.x - position.x, target.y - position.y);
        const direction = { x: (target.x - position.x) / legLength, y: (target.y - position.y) / legLength };

        length += legLength;

        while ((target.x - position.x) * direction.x + (target.y - position.y) * direction.y > 0)
        {
            position = walk(SHELF_ELEVATION, position, direction, 1 / FPS, BOUNDS).position;
            seconds += 1 / FPS;

            const hazard = hazardAt(SHELF_HAZARDS, position);

            if (hazard)
            {
                return { seconds, length, hazard: { kind: hazard.kind, at: position } };
            }
        }

        position = target;
    }

    return { seconds, length, hazard: null };
}

const slope = (p: Point) => surfaceForm(SHELF_ELEVATION, p.x, p.y, 6).slope;

// Intended routes, as straight legs a player could walk. Each ends at the hut.
const ENTRY = TRAVERSE[0];
const ROUTES = {
    traverse: [SHELF_START, { x: 1000, y: 540 }, ENTRY, TRAVERSE[1], TRAVERSE[2], HUT],
    plateau: [SHELF_START, { x: 900, y: 420 }, { x: 1050, y: 400 }, { x: 1650, y: 400 }, { x: 1650, y: 640 }, HUT],
    /** From where a slide off the traverse lands, out through the gully. */
    gully: [{ x: 1150, y: 780 }, { x: 1280, y: 900 }, { x: 1600, y: 910 }, HUT],
    /** From the basin back up the west ramp onto the shelf. */
    climbBack: [{ x: 900, y: 800 }, { x: 600, y: 820 }, { x: 560, y: 600 }, { x: 640, y: 480 }]
};

/** Points along the slab's upper boundary, a few px inside it: where an accidental slide begins. */
function slabEntries (): Point[]
{
    const entries: Point[] = [];
    const top = [SLAB[0], SLAB[1], SLAB[2], SLAB[3], SLAB[4]];

    for (let i = 1; i < top.length; i++)
    {
        const [a, b] = [top[i - 1], top[i]];
        const length = Math.hypot(b.x - a.x, b.y - a.y);

        for (let d = 0; d < length; d += 10)
        {
            const t = d / length;
            // Step 3px towards the slab's inside (right-hand normal of the boundary as listed).
            const nx = -(b.y - a.y) / length;
            const ny = (b.x - a.x) / length;
            const point = { x: a.x + (b.x - a.x) * t + nx * 3, y: a.y + (b.y - a.y) * t + ny * 3 };

            if (insidePolygon(SLAB, point))
            {
                entries.push(point);
            }
        }
    }

    return entries;
}

describe('The Shelf: world integrity', () => {
    it('starts on safe, nearly level ground, far from the drop', () => {
        expect(hazardAt(SHELF_HAZARDS, SHELF_START)).toBeNull();
        expect(distanceToDrop(SHELF_START)).toBeGreaterThanOrEqual(150);
        expect(slope(SHELF_START)).toBeLessThan(SLIDE_STOP_SLOPE);
    });

    it('puts the hut, the tower and Corpse B on safe ground and Karel on the slab', () => {
        for (const point of [HUT, TOWER, CORPSE_B])
        {
            expect(hazardAt(SHELF_HAZARDS, point)).toBeNull();
        }

        expect(hazardAt(SHELF_HAZARDS, KAREL)?.kind).toBe('slide');
    });

    it('can walk every intended route to its end without entering a hazard', () => {
        for (const [name, route] of Object.entries(ROUTES))
        {
            const walked = traverse(route);

            expect(walked.hazard, name).toBeNull();
        }
    });

    it('keeps every intended route at least 150px from the drop', () => {
        for (const route of Object.values(ROUTES))
        {
            for (let i = 1; i < route.length; i++)
            {
                for (let t = 0; t <= 1; t += 0.02)
                {
                    const point = { x: route[i - 1].x + (route[i].x - route[i - 1].x) * t, y: route[i - 1].y + (route[i].y - route[i - 1].y) * t };

                    expect(distanceToDrop(point)).toBeGreaterThanOrEqual(150);
                }
            }
        }
    });

    it('takes the plateau clearly longer than the traverse', () => {
        expect(traverse(ROUTES.plateau).seconds).toBeGreaterThan(1.3 * traverse(ROUTES.traverse).seconds);
    });
});

describe('The Shelf: hazards match the terrain', () => {
    it('reports the slab as a slide and beyond the edges as fatal', () => {
        expect(hazardAt(SHELF_HAZARDS, { x: 900, y: 660 })?.kind).toBe('slide');
        expect(hazardAt(SHELF_HAZARDS, { x: 1360, y: 780 })?.kind).toBe('slide');
        expect(hazardAt(SHELF_HAZARDS, { x: 900, y: 560 })).toBeNull();
        expect(hazardAt(SHELF_HAZARDS, { x: 900, y: 800 })).toBeNull();

        for (const outside of [{ x: 390, y: 600 }, { x: 2010, y: 600 }, { x: 900, y: 230 }, { x: 900, y: 1140 }])
        {
            expect(hazardAt(SHELF_HAZARDS, outside)?.kind).toBe('fatal');
        }
    });

    it('makes the slab steep inside and the ground either side of it gentle', () => {
        // Sample the slab's middle band (away from its edges, where smoothing softens the slope).
        for (const point of [{ x: 750, y: 665 }, { x: 1000, y: 665 }, { x: 1200, y: 665 }, { x: 1335, y: 680 }, { x: 1360, y: 780 }])
        {
            expect(slope(point)).toBeGreaterThan(0.003);
        }

        // The traverse ledge, the shelf above the slab and the basin floor below it.
        for (const point of [{ x: 1200, y: 575 }, { x: 1340, y: 615 }, { x: 900, y: 560 }, { x: 900, y: 800 }, { x: 1100, y: 820 }])
        {
            expect(slope(point)).toBeLessThan(0.002);
        }
    });

    it('steepens over the rock band, which is walkable', () => {
        expect(slope({ x: 1210, y: 512 })).toBeGreaterThan(0.003);
        expect(hazardAt(SHELF_HAZARDS, { x: 1210, y: 512 })).toBeNull();
        expect(insidePolygon(ROCK_BAND, { x: 1210, y: 512 })).toBe(true);
    });
});

describe('The Shelf: slides', () => {
    const entries = slabEntries();

    it('samples the whole slab boundary', () => {
        expect(entries.length).toBeGreaterThan(100);
    });

    it('is deterministic', () => {
        for (const entry of entries.slice(0, 20))
        {
            expect(slideFrom(SHELF_ELEVATION, SHELF_HAZARDS, entry)).toEqual(slideFrom(SHELF_ELEVATION, SHELF_HAZARDS, entry));
        }
    });

    it('always lands on safe, flat ground well away from the drop', () => {
        for (const entry of entries)
        {
            const slide = slideFrom(SHELF_ELEVATION, SHELF_HAZARDS, entry);

            expect(slide.fatal).toBe(false);
            expect(hazardAt(SHELF_HAZARDS, slide.landing)).toBeNull();
            expect(slope(slide.landing)).toBeLessThan(SLIDE_STOP_SLOPE * 1.5);
            expect(Math.min(...slide.path.map(distanceToDrop))).toBeGreaterThanOrEqual(150);
        }
    });

    it('lands far enough from Corpse B that walking to him is a choice, not a given', () => {
        const near = entries.filter(entry => {
            const { landing } = slideFrom(SHELF_ELEVATION, SHELF_HAZARDS, entry);

            return Math.hypot(landing.x - CORPSE_B.x, landing.y - CORPSE_B.y) < 60;
        });

        expect(near.length).toBeLessThan(entries.length / 4);
    });
});

describe('The Shelf: fix geometry (light whiteout)', () => {
    /** Readable landmarks from `point` and the widest angle between any two of them. */
    const evidence = (point: Point, landmarks: readonly Point[]) => {
        const readable = landmarks.filter(landmark => Math.hypot(landmark.x - point.x, landmark.y - point.y) < SURVEY_RANGE);
        let widest = 0;

        for (let i = 0; i < readable.length; i++)
        {
            for (let j = i + 1; j < readable.length; j++)
            {
                const difference = Math.abs(bearingTo(point, readable[i])! - bearingTo(point, readable[j])!) % 360;

                widest = Math.max(widest, Math.min(difference, 360 - difference));
            }
        }

        return { readable, widest };
    };
    const all = [TOWER, KAREL, CORPSE_B];

    it('sees no landmark from the start: the first hypothesis comes from the ground', () => {
        expect(evidence(SHELF_START, all).readable).toEqual([]);
    });

    it('fixes at the traverse entry from the tower and Karel, crossing well', () => {
        const { readable, widest } = evidence(ENTRY, all);

        expect(readable).toEqual(expect.arrayContaining([TOWER, KAREL]));
        expect(widest).toBeGreaterThan(60);
    });

    it('reads Karel precisely at the bend, across the ledge', () => {
        expect(Math.hypot(KAREL.x - TRAVERSE[1].x, KAREL.y - TRAVERSE[1].y)).toBeLessThan(PRECISE_RANGE);
    });

    it('fixes in the basin east from Karel and Corpse B', () => {
        const { readable, widest } = evidence({ x: 1150, y: 790 }, all);

        expect(readable).toEqual(expect.arrayContaining([KAREL, CORPSE_B]));
        expect(widest).toBeGreaterThan(45);
    });

    it('fixes on the final approach from Karel and Corpse B, coarsely', () => {
        const { readable, widest } = evidence({ x: 1440, y: 760 }, all);

        expect(readable).toEqual(expect.arrayContaining([KAREL, CORPSE_B]));
        expect(widest).toBeGreaterThan(30);
    });

    it('cannot read any landmark from the hut itself: the last leg is walked from a fix', () => {
        expect(evidence(HUT, all).readable).toEqual([]);
    });
});

describe('The Shelf: shortcuts', () => {
    it('makes a deliberate slide slower than the traverse: off the shelf, down, out by the gully', () => {
        const toSlab = traverse([SHELF_START, { x: 1000, y: 540 }, { x: 1000, y: 650 }]);

        expect(toSlab.hazard?.kind).toBe('slide');

        const slide = slideFrom(SHELF_ELEVATION, SHELF_HAZARDS, toSlab.hazard!.at);
        const out = traverse([slide.landing, { x: 1280, y: 900 }, { x: 1600, y: 910 }, HUT]);
        const deliberate = toSlab.seconds + out.seconds;

        expect(out.hazard).toBeNull();
        expect(deliberate).toBeGreaterThan(traverse(ROUTES.traverse).seconds);
    });

    it('does not find the hut by following the drop: a loop 80px inside it passes nowhere near', () => {
        const { minX, minY, maxX, maxY } = { minX: 480, minY: 320, maxX: 1920, maxY: 1050 };
        const loop = [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }, { x: minX, y: minY }];
        let nearest = Infinity;

        for (let i = 1; i < loop.length; i++)
        {
            for (let t = 0; t <= 1; t += 0.01)
            {
                const point = { x: loop[i - 1].x + (loop[i].x - loop[i - 1].x) * t, y: loop[i - 1].y + (loop[i].y - loop[i - 1].y) * t };

                nearest = Math.min(nearest, Math.hypot(point.x - HUT.x, point.y - HUT.y));
            }
        }

        expect(nearest).toBeGreaterThan(200);
    });
});
