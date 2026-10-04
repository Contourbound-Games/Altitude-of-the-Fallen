import { GameObjects, Input, Scene, Textures } from 'phaser';
import { clamp, type Point } from '../../core/geometry';
import { inputDirection, walk, type Bounds, type WalkStep } from '../../core/movement';
import { contourSegments, type Segment } from '../../core/terrain/contours';
import { hazardAt, slideFrom, type HazardZone } from '../../core/hazards';
import {
    CORPSE_B, distanceToDrop, HUT, KAREL, ROCK_BAND, SHELF_ELEVATION, SHELF_HAZARDS, SHELF_INNER, SHELF_START, SHELF_WHITEOUT, TOWER
} from '../../core/shelf';
import { elevationAt, gridHeight, gridWidth } from '../../core/terrain/elevation';
import { snowLight, surfaceForm } from '../../core/terrain/surface';
import { angularOffset, bearingOf, bearingTo, coarseReading, readingStep, relativeBearing, SURVEY_RANGE_FACTOR, surveyReading, wholeBearing, type Reading } from '../../core/survey';
import { fitMap, rayExit, toMap, type MapLayout } from '../../core/plotting';
import { bearingVector, bestPair, fixRegion, reverseBearing, triangulate } from '../../core/triangulation';
import { lookAt, nextFacing, sightDistance, VIEW_CONE_ANGLE, visibility, type Look } from '../../core/visibility';
import { RunLog } from './runLog';
import { shelfAudio } from './shelfAudio';

const ELEVATION_TEXTURE = 'field-elevation';
/** Debug shading: elevation 0 draws as LOW_SHADE grey, elevation 1 as HIGH_SHADE. */
const LOW_SHADE = 24;
const HIGH_SHADE = 232;

/**
 * Debug contours halfway between the test field's nine authored levels (k / 9), so no line runs
 * exactly through a sample. Spacing between neighbouring lines is (1/9) / slope.
 */
const CONTOUR_LEVELS = Array.from({ length: 9 }, (_, k) => (k + 0.5) / 9);
const CONTOUR_SUBDIVISIONS = 9;
const CONTOUR_COLOR = 0x20b8ff;
/** The world everything below is drawn from: the vertical-slice leg (see core/shelf.ts). */
const WORLD_ELEVATION = SHELF_ELEVATION;

/**
 * A pixel's paint: an opaque colour, or [colour, alpha] for pixels that let the snow show through
 * (contact shadow, drifted snow), so they sit right on any ground.
 */
type Paint = number | readonly [color: number, alpha: number];

/** Paint as [colour, alpha]. */
const paintOf = (paint: Paint): readonly [number, number] => typeof paint === 'number' ? [paint, 1] : paint;

/**
 * Something drawn in the field from a pixel map: drawn on the ground layer under the fog, so it is
 * seen exactly as much as the terrain there. Pixel maps are centred on the position; each character
 * maps to a paint (unmapped characters are empty).
 */
interface Landmark
{
    readonly label: string;
    readonly position: Point;
    readonly pixels: readonly string[];
    readonly colors: Readonly<Record<string, Paint>>;
    /** Darker version of the landmark's saturated colour, readable on the map paper. */
    readonly mapColor: number;
}

/**
 * A landmark the Survey View can read. It is seen through the instrument from ground level, so it
 * has its own `profile`: a pixel map in the same paints, standing on the horizon.
 */
interface SurveyLandmark extends Landmark
{
    readonly profile: readonly string[];
    /** Aiming anywhere within this many px of the position counts as aiming at it (see surveyReading). */
    readonly radius: number;
}

/**
 * Shared field paints: a cold, translucent contact shadow (c) where a body or object meets the
 * snow, on its lee side from the north-west light, and drifted snow (S) half over it, shaded (s)
 * on its own lee side so it reads as a mound.
 */
const CONTACT_SHADOW: Paint = [0x2e3a4c, 0.3];
const DRIFTED_SNOW: Paint = [0xeef1f3, 0.9];
const DRIFT_SHADE: Paint = [0x8a9bb0, 0.3];

/**
 * The slice's three landmarks: one ordinary (the rock tower, reachable, the safe reset point) and
 * two fallen climbers, told apart by pose first and by one saturated colour among muted ones second.
 *
 * The tower is dark rock (R, shaded r) with snow lodged on its north-west faces (S); through the
 * instrument it is the only tall, narrow spire on the horizon.
 *
 * Karel lies face down with his head to the west: grey helmet (H, shaded h), dark jacket (J, j)
 * under a muted pack (P), dark gloves (W) and trousers (L). His right arm is crooked up over his
 * helmet, his left arm is buried in a drift (S, its lee edge s), and his legs are splayed, the left
 * one bent at the knee. His green boots (G, shaded g) are the only saturated colour on him: the
 * hook that makes him recognisable, kept to six pixels each so they stay exceptional rather than a
 * beacon. Through the instrument he is a long, low dark shape with the green boots raised at one end.
 *
 * Corpse B (no name yet) lies curled on one side with the head to the north: a dark hood (K) with
 * a pale fur ruff (F) round the face (f), an olive-grey down suit (D) and an orange pack (O, shaded
 * o) on the back, facing west. One arm (W) rests on the drawn-up knees; the upper leg (L) is bent
 * hard with its boot (B) forward, the lower leg (l) half buried in a drift. Compact and upright
 * where Karel is long and sprawled; the orange pack is its only saturated colour. Through the
 * instrument it is a short, rounded hump capped with orange.
 *
 * Each corpse's radius is the half-length of the original prototype sprite, so aiming is unchanged.
 */
const LANDMARKS: readonly SurveyLandmark[] = [
    {
        label: 'TOWER',
        position: TOWER,
        pixels: [
            '...RRr....',
            '..RSRRr...',
            '.RSSRRRrc.',
            '.RSRRRRrcc',
            '.RRRRRrrcc',
            '..RRRrrcc.',
            '...rrcc...'
        ],
        profile: [
            '...R...',
            '..RR...',
            '..RSR..',
            '.RRRr..',
            '.RSRRr.',
            '.RRRRr.',
            'RRRRRrr',
            'SSSSSSS'
        ],
        colors: { R: 0x5a5650, r: 0x3f3c38, S: DRIFTED_SNOW, c: CONTACT_SHADOW },
        mapColor: 0x4a4640,
        radius: 4
    },
    {
        label: 'KAREL',
        position: KAREL,
        pixels: [
            '..WWJJ..................',
            '...cccJ.................',
            '......JJ................',
            '.HH..JJPPPP.............',
            'HHHhJJJPPPPJJLLLLLLL....',
            'HHHhJJJPPPPJJLLLLLLLGGG.',
            '.hhccJJjjjjJJLLcccccGGgc',
            '..ccSJJJJjjJccLL.....ccc',
            '...SSSSSScccc..LL.......',
            '....sSSSs......LLLLGGG..',
            '......ss........ccGGgcc.',
            '...................ccc..'
        ],
        profile: [
            '...PPP.......GG',
            '.HHPPPJ.....LGG',
            'HHhJJJJJLLLLLGg',
            'SSSSSjjSSSSSSSS'
        ],
        colors: {
            H: 0x9a968e, h: 0x6f6c66, J: 0x3b4350, j: 0x2c323c, P: 0x5a5044, W: 0x1f2226, L: 0x262a31,
            G: 0x2ccc55, g: 0x178a35, S: DRIFTED_SNOW, s: DRIFT_SHADE, c: CONTACT_SHADOW
        },
        mapColor: 0x0c8a34,
        radius: 6
    },
    {
        label: 'CORPSE B',
        position: CORPSE_B,
        pixels: [
            '...KKKF.........',
            '..KKKFfF........',
            '..KKKFfFc.......',
            '...KKFFcc.......',
            '..OODDDc........',
            '.OOODDDDW.......',
            '.OOODDDDWc......',
            '.OOoDDDDcW......',
            '.ooDDDDDcWW.....',
            '..DDDDLLLLLLL...',
            '..sDDLLLLLLLLL..',
            '...SSlllllccLLL.',
            '...SSSllllc.LLLc',
            '....SSSlllc.LLLc',
            '.....SSsBBc.BBBc',
            '.........cc.BBBc',
            '.............ccc'
        ],
        profile: [
            '...OO.....',
            '..OOOO....',
            '.FOOOODLL.',
            'FfKDDDDLLL',
            'KKDDDDDLLB',
            'SSSSSSSSSS'
        ],
        colors: {
            K: 0x4a4038, F: 0xc9bfae, f: 0x8a8366, D: 0x6b6c58, O: 0xd8642a, o: 0x9a4320, W: 0x1f2226,
            L: 0x4a443d, l: 0x38332e, B: 0x3a3633, S: DRIFTED_SNOW, s: DRIFT_SHADE, c: CONTACT_SHADOW
        },
        mapColor: 0xb4501a,
        radius: 3
    }
];

/**
 * The destination: a small buried hut at a known map position. It is drawn like a landmark and
 * fades in only as close as they do (see LANDMARK_FIELD_RANGE), but is deliberately not in
 * LANDMARKS, so it can never be surveyed: the last leg is walked from a fix. Muted, low-contrast
 * colours. R roof, W wall, D door.
 */
const SHELTER: Landmark = {
    label: 'HUT',
    position: HUT,
    pixels: [
        '..RRRRRR..',
        '.RRRRRRRR.',
        'RRRRRRRRRR',
        '.WWWWWWWW.',
        '.WWDDWWWW.',
        '.WWDDWWWW.'
    ],
    colors: { R: 0x6e6254, W: 0x4c443c, D: 0x26221e },
    mapColor: 0x6b4a2a
};
/** Within this distance of the hut's centre (world px) the player has reached it. */
const SHELTER_REACH = 10;

/**
 * In the top-down field the landmarks and the hut are drawn only this close (world px), so the field
 * cannot be used as a rangefinder: from further off landmarks are observed in the Survey View, by
 * bearing only. Standing this close to a known landmark is allowed to tell the player where they are.
 *
 * They fade in rather than appear: invisible beyond LANDMARK_FIELD_RANGE, fully drawn within
 * LANDMARK_FIELD_SOLID, and in between as opaque as the distance is far into that band. The fog
 * still covers them on top, so the fade and the view cone combine.
 */
const LANDMARK_FIELD_RANGE = 46;
const LANDMARK_FIELD_SOLID = 34;

/**
 * Survey View (SPACE held): the horizon seen through the survey instrument's eyepiece, around the
 * instrument's azimuth. A landmark is drawn at the horizontal position of its bearing relative to
 * that azimuth (see angularOffset), at its one fixed size, as opaque as it is visible, so it fades
 * out smoothly with distance. It sees SURVEY_RANGE_FACTOR times as far as the field under the same
 * whiteout, and reads fainter landmarks more coarsely (see surveyReading). In the slice's light
 * whiteout that is 234px, so the start has no landmark in sight (see core/shelf.test.ts).
 *
 * The instrument turns like one: horizontal mouse movement turns it SURVEY_DEGREES_PER_PIXEL per
 * game pixel (mouse height does nothing), and the left/right movement keys turn it continuously at
 * SURVEY_TURN_RATE for full sweeps. The player stands still while surveying.
 */
const SURVEY_DEGREES_PER_PIXEL = 0.25;
const SURVEY_TURN_RATE = 120;
const SURVEY_VIEW_FOV = VIEW_CONE_ANGLE * 180 / Math.PI;

/**
 * Prototype instrument drawing (Phaser graphics only). The eyepiece window spans SURVEY_VIEW_FOV,
 * framed by a brass ring on dark metal; the red hairline is the instrument's azimuth, where the
 * reading is taken. Fixed reticle ticks mark 5 degree steps either side of it. Below the window a
 * knurled drum turns with the instrument, so turning left or right visibly moves it that way.
 */
const EYEPIECE = { x: 56, y: 36, width: 528, height: 240, radius: 22 };
const INSTRUMENT_METAL = 0x16171a;
const INSTRUMENT_METAL_EDGE = 0x2b2d31;
const BRASS = 0xa8844c;
const BRASS_LIGHT = 0xd9bb7c;
const BRASS_DARK = 0x5c4727;
const SURVEY_SKY = 0xb9c4ce;
const SURVEY_GROUND = 0xd2d6d8;
const SURVEY_HORIZON = 0x8995a1;
const SURVEY_TICK = 0x4c5560;
const SURVEY_RED = 0xc8322b;
const PARCHMENT_TEXT = '#e6d8b4';
/** The drum's marks move SURVEY_DRUM_SCALE px per degree turned, one mark every 5 degrees. */
const SURVEY_DRUM_SCALE = 2;

/**
 * Map overlay: the whole world scaled uniformly into the top MAP_HEIGHT_SHARE of the screen (see
 * fitMap), with the legend in the strip below it so nothing covers the map. Plain paper, a faint
 * grid every MAP_GRID_STEP world px, and the same contour lines the terrain produces.
 */
const MAP_HEIGHT_SHARE = 0.88;
const MAP_BACKDROP = 0x15181c;
const MAP_PAPER = 0xebe6da;
const MAP_CONTOUR = 0xb8a184;
const MAP_GRID = 0xd8d0c0;
const MAP_GRID_STEP = 120;
/**
 * How far either side of a recorded reading the true bearing may lie: half its step, plus half a
 * degree when the step is fractional and the reading was then rounded to whole degrees.
 */
const readingHalfWidth = (reading: Reading) => reading.step / 2 + (Number.isInteger(reading.step) ? 0 : 0.5);
/** One decimal place, for the run log. */
const round = (value: number) => Math.round(value * 10) / 10;

/** Traces a closed polygon as the graphics' current path. */
function tracePolygon (g: GameObjects.Graphics, points: readonly Point[])
{
    g.beginPath();
    g.moveTo(points[0].x, points[0].y);
    points.slice(1).forEach(point => g.lineTo(point.x, point.y));
    g.closePath();
}

const fillPolygon = (g: GameObjects.Graphics, points: readonly Point[]) => { tracePolygon(g, points); g.fillPath(); };
const strokePolygon = (g: GameObjects.Graphics, points: readonly Point[]) => { tracePolygon(g, points); g.strokePath(); };

/**
 * Hatching for a polygon: segments of the diagonal lines x + y = c, `spacing` px apart (measured
 * across them), clipped to the polygon (even-odd: pairs of crossings along each line).
 */
function hatch (polygon: readonly Point[], spacing: number): [Point, Point][]
{
    const sums = polygon.map(p => p.x + p.y);
    const segments: [Point, Point][] = [];
    const step = spacing * Math.SQRT2;

    for (let c = Math.min(...sums) + step / 2; c < Math.max(...sums); c += step)
    {
        const crossings: Point[] = [];

        polygon.forEach((a, i) => {
            const b = polygon[(i + 1) % polygon.length];
            const fa = a.x + a.y - c;
            const fb = b.x + b.y - c;

            if ((fa < 0) !== (fb < 0))
            {
                const t = fa / (fa - fb);

                crossings.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
            }
        });

        crossings.sort((p, q) => p.x - q.x);

        for (let i = 0; i + 1 < crossings.length; i += 2)
        {
            segments.push([crossings[i], crossings[i + 1]]);
        }
    }

    return segments;
}
/**
 * The last survey fix, drawn as the region where the two readings' wedges overlap (see fixRegion),
 * so a coarse fix looks as uncertain as it is; the crossing of the lines stays visible inside it.
 */
const FIX_MARK_COLOR = 0xd01818;
/** Map hazards: slide zones hatched in blue-grey, the drop beyond the walkable ground in dark ink. */
const MAP_SLIDE_COLOR = 0x5d7aa0;
const MAP_DROP_COLOR = 0x3a3330;
const MAP_HATCH_STEP = 6;
/** Debrief: the true track in red ink, slides in blue, recall marks as pencil crosses. */
const TRACK_COLOR = 0xc0301e;
const SLIDE_TRACK_COLOR = 0x2f5fa8;
const RECALL_COLOR = 0x2a2a2a;
/** The moments the facilitator asks about after a run (TAB cycles; a click marks the player's belief). */
const RECALL_MOMENTS = ['route decision', 'traverse entry / bend', 'just after the slide', 'start of final approach', 'other'];

const FOG_TEXTURE = 'visibility-fog';
/** Fog is painted at 1/FOG_SCALE resolution and scaled up, so each fog cell is FOG_SCALE px square. */
const FOG_SCALE = 2;
/** Snow-blue, so obscured ground reads as weather rather than as dark or high terrain. */
const FOG_RGB = [176, 194, 214];
/** Whiteout set by the debug keys 0-4 (development builds only, see DEV). */
const WHITEOUT_LEVELS = [0, 0.25, 0.5, 0.75, 1];

/**
 * `?dev` in the URL enables the development view and its keys (H, E, C, V, 0-4) and the log
 * download. Without it the player view is all there is: no position readout, no weather keys.
 */
const DEV = new URLSearchParams(window.location.search).has('dev');
/** Walkable ground beyond which the mountain drops away, darkened in the field. */
const DROP_RGB = [52, 60, 74];
/** Within this distance (px) of the drop the wind rises to a roar (see ShelfAudio). */
const DROP_WARNING = 80;
/** A slide plays at this speed (px/s) along its path; the player has no control meanwhile. */
const SLIDE_SPEED = 160;
/**
 * Player view snow: shaped by the ground's local form only, never by how high it is (see
 * surfaceForm), so level snow looks the same at any altitude. The elevation shading is a
 * development view only. Off-white with a cold cast, distinct from the blue fog.
 *
 * - Light from the north-west: slopes facing it brighten, slopes facing away fall into blue-grey
 *   shade, as much as SNOW_RELIEF of slope along the light fully lights or shades.
 * - Steep ground of any aspect takes a cold, wind-scoured cast, up to SNOW_STEEP.
 * - Crests (convex) are a little brighter, hollows (concave) a little bluer, as drifted snow,
 *   up to a Laplacian of SNOW_CURVATURE.
 *
 * The gradient is sampled across one grid spacing and the curvature across two, so both come out as
 * smooth interpolations of the authored samples instead of showing the grid's cells. Sampled every
 * SNOW_CELL px and baked once into a world-sized image under the fog, so whiteout hides it like any
 * other ground.
 */
const SNOW_COLOR = 0xd2d7db;
const SNOW_LIT = [246, 247, 248];
const SNOW_SHADE = [124, 142, 166];
const SNOW_SCOURED = [160, 178, 200];
const SNOW_DRIFT = [178, 194, 214];
const SNOW_LIGHT_FROM = { x: -Math.SQRT1_2, y: -Math.SQRT1_2 };
const SNOW_RELIEF = 0.0024;
const SNOW_STEEP = 0.008;
const SNOW_CURVATURE = 0.00002;
const SNOW_CELL = 2;
const SNOW_FIELD_TEXTURE = 'snow-field';
/**
 * The rock band takes an even rock cast over its shading where its face is steep: none below a
 * slope of ROCK_STEEP_FROM, full ROCK_COVER from ROCK_STEEP_FULL, so its outline follows the ground.
 * It also fades across the band's sides (ROCK_FADE_X wide) and top and bottom (ROCK_FADE_Y), so it
 * reads as rock emerging from the snow rather than a painted strip. Deliberately no small marks
 * anywhere on the ground (specks, streaks, scattered rocks): fixed in the world, they would be
 * fingerprints of a place, and repeating they would count distance like an odometer.
 */
const ROCK_RGB = [88, 84, 78];
const ROCK_COVER = 0.55;
const ROCK_STEEP_FROM = 0.0018;
const ROCK_STEEP_FULL = 0.003;
const ROCK_FADE_X = 60;
const ROCK_FADE_Y = 30;
const START_WHITEOUT = SHELF_WHITEOUT;
/** How long a short notice (e.g. "bearings cleared") stays in the panel. */
const NOTICE_MS = 3000;


/** Even size so the centred marker lands on whole pixels. */
const MARKER_SIZE = 6;
/** Slopes smaller than this (per px) read as flat; absorbs floating-point noise on level ground. */
const FLAT_SLOPE = 1e-9;

type MoveKeys = Record<'left' | 'right' | 'up' | 'down', Input.Keyboard.Key[]>;

/**
 * playing: walking and surveying. sliding: carried down a slide's path, no control. recall: the run
 * is over and the map is shown without the true track while the facilitator asks where the player
 * believed they were. debrief: the map with the true track.
 */
type Phase = 'playing' | 'sliding' | 'recall' | 'debrief';

/** A recorded fix: where the lines crossed, and the region the readings' uncertainty allows. */
interface Fix
{
    readonly point: Point;
    readonly region: Point[] | null;
}

/**
 * The vertical-slice leg "The Shelf" (see core/shelf.ts): a player marker moving over the leg's
 * terrain with the Survey View, the map, the hazards and the playtest log.
 * The world is larger than the screen; the camera stays centred on the player.
 */
export class FieldScene extends Scene
{
    static readonly KEY = 'FieldScene';

    private moveKeys: MoveKeys;
    /** Held to survey (SPACE). */
    private surveyKey: Input.Keyboard.Key;
    private surveyText: GameObjects.Text;
    /** The Survey View overlay, drawn over the field while SPACE is held, and its azimuth plate. */
    private surveyView: GameObjects.Graphics;
    private surveyAzText: GameObjects.Text;
    /** Field drawings of LANDMARKS, faded in within LANDMARK_FIELD_RANGE. */
    private landmarkSprites: GameObjects.Graphics[];
    /** Map overlay (M). While open the player neither moves nor surveys. */
    private mapOpen: boolean;
    private mapGraphics: GameObjects.Graphics;
    private mapLegend: GameObjects.Text;
    private mapLabels: GameObjects.Text[];
    private mapDebug: GameObjects.Text;
    private mapFixLabel: GameObjects.Text;
    /** Where the map draws the world (uniform scale, see fitMap). */
    private mapLayout: MapLayout;
    /**
     * Where the last accepted fix placed the player when they took the bearings. Written onto the map
     * and kept when the player moves; only a new accepted fix replaces it.
     */
    private savedFix: Fix | null;
    /** Every accepted fix this run, for the debrief. */
    private fixes: Fix[];
    private phase: Phase;
    /** The slide in progress: its path and how far along it (px) the player has been carried. */
    private slide: { path: readonly Point[]; travelled: number; fatal: boolean } | null;
    /** Snow spray drawn round the player while sliding. */
    private spray: GameObjects.Graphics;
    /** The hut's field drawing, faded in like the landmarks. */
    private hutSprite: GameObjects.Graphics;
    /** How the run ended. */
    private ending: 'arrived' | 'fell' | null;
    /** Scene time (ms) the run started at; log times are measured from it. */
    private startTime: number;
    private log: RunLog;
    /** Recall: the moment currently being asked about, and the player's mark for each moment. */
    private recallMoment: number;
    private recallMarks: Map<string, Point>;
    /** Contour lines of the terrain, shared by the development overlay and the map. */
    private contourLines: Segment[];
    /** A short message for the panel, shown until the given scene time. */
    private notice: { text: string; until: number } | null;
    /** Whether any bearing has been recorded this run (the opening "Lost" hint is shown only before). */
    private everRecorded: boolean;
    /** Recorded readings of each of LANDMARKS (by index), from the current position only. */
    private readings: (Reading | null)[];
    /** The instrument's azimuth while surveying (null otherwise), and the mouse x it was last turned from. */
    private surveyAzimuth: number | null;
    private surveyPointerX: number;
    /** Where the instrument was last left pointing, and from where: it resumes there if the player has not moved. */
    private lastSurvey: { position: Point; azimuth: number } | null;
    private bounds: Bounds;
    private position: Point;
    /**
     * Unit vector the player looks along. Follows the movement input until the mouse first moves
     * over the game; from then on it points at the mouse, independently of movement.
     */
    private facing: Point;
    private lookWithPointer: boolean;
    /** Whether the mouse moved since the last update. */
    private pointerMoved: boolean;
    /** World point the mouse was at when facing was last worked out from it. */
    private lookTarget: Point;
    /** Whether facing is held after walking close to the mouse target (see lookAt). */
    private lookHeld: boolean;
    private whiteout: number;
    /**
     * Development view (readout, contour/shading toggles, unlimited-view toggle) or player view
     * (no numbers, no contours, no elevation shading, view always limited). H switches between them.
     */
    private debugView: boolean;
    private showShading: boolean;
    private showContours: boolean;
    private viewLimited: boolean;
    private shading: GameObjects.Image;
    private contours: GameObjects.Graphics;
    private fog: Textures.CanvasTexture;
    private fogImage: GameObjects.Image;
    private fogPixels: ImageData;
    /** State the fog was last painted for, so it is only repainted when something changed. */
    private fogPaintedFor: string;
    private marker: GameObjects.Rectangle;
    private debugText: GameObjects.Text;

    constructor ()
    {
        super(FieldScene.KEY);
    }

    create ()
    {
        const keyboard = this.input.keyboard;

        if (!keyboard)
        {
            throw new Error('FieldScene needs keyboard input, but it is disabled in the game config.');
        }

        const cursors = keyboard.createCursorKeys();

        this.surveyKey = cursors.space;
        this.moveKeys = {
            left: [cursors.left, keyboard.addKey('A')],
            right: [cursors.right, keyboard.addKey('D')],
            up: [cursors.up, keyboard.addKey('W')],
            down: [cursors.down, keyboard.addKey('S')]
        };

        const width = gridWidth(WORLD_ELEVATION);
        const height = gridHeight(WORLD_ELEVATION);
        const view = { width: this.scale.width, height: this.scale.height };

        // The player stays half a screen from every world edge, so the camera, centred on the player,
        // never has to stop at an edge: the marker always sits mid-screen, and where it sits on the
        // screen says nothing about where it is in the world.
        this.bounds = { minX: view.width / 2, minY: view.height / 2, maxX: width - view.width / 2, maxY: height - view.height / 2 };
        this.cameras.main.setBounds(0, 0, width, height);
        // The player is never told where this is; the slice always starts here (see core/shelf.ts).
        this.position = { ...SHELF_START };
        this.cameras.main.setBackgroundColor(SNOW_COLOR);
        this.facing = { x: 0, y: -1 };
        this.lookWithPointer = false;
        this.pointerMoved = false;
        this.lookTarget = { x: NaN, y: NaN };
        this.lookHeld = false;
        this.readings = LANDMARKS.map(() => null);
        this.surveyAzimuth = null;
        this.surveyPointerX = 0;
        this.lastSurvey = null;
        this.mapOpen = false;
        this.notice = null;
        this.everRecorded = false;
        this.savedFix = null;
        this.fixes = [];
        this.phase = 'playing';
        this.slide = null;
        this.ending = null;
        this.startTime = this.time.now;
        this.log = new RunLog();
        this.recallMoment = 0;
        this.recallMarks = new Map();
        this.whiteout = START_WHITEOUT;
        this.debugView = false;
        this.showShading = true;
        this.showContours = true;
        this.viewLimited = true;
        this.fogPaintedFor = '';

        this.contourLines = CONTOUR_LEVELS.flatMap(level => contourSegments(WORLD_ELEVATION, level, CONTOUR_SUBDIVISIONS));
        this.drawSnow(width, height);
        this.shading = this.drawElevation(width, height).setVisible(false);
        this.contours = this.drawContours();
        this.landmarkSprites = LANDMARKS.map(landmark => this.drawLandmark(landmark));
        this.hutSprite = this.drawLandmark(SHELTER);
        this.spray = this.add.graphics();

        this.createFog(view.width, view.height);

        // Survey presentation sits above the fog: it shows the aim, not the terrain.
        // Screen-fixed and above the field (and the marker); the panel text and the map go above it.
        this.surveyView = this.add.graphics().setScrollFactor(0).setDepth(10).setVisible(false);
        this.surveyAzText = this.add.text(view.width / 2, EYEPIECE.y - 14, '', { fontFamily: 'monospace', fontSize: '8px', color: PARCHMENT_TEXT })
            .setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(11).setVisible(false);
        this.surveyText = this.add.text(view.width / 2, view.height - 4, '', {
            fontFamily: 'monospace',
            fontSize: '8px',
            color: '#ffffff',
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            padding: { x: 3, y: 2 }
        }).setOrigin(0.5, 1).setScrollFactor(0).setDepth(11).setVisible(false);

        // Development builds only (?dev): H switches to the development view, where E/C/V act;
        // E = elevation shading, C = contour lines, V = view limit; 0-4 = whiteout.
        if (DEV)
        {
            keyboard.on('keydown-H', () => this.debugView = !this.debugView);
            keyboard.on('keydown-E', () => { if (this.debugView) this.showShading = !this.showShading; });
            keyboard.on('keydown-C', () => { if (this.debugView) this.showContours = !this.showContours; });
            keyboard.on('keydown-V', () => { if (this.debugView) this.viewLimited = !this.viewLimited; });
            ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR'].forEach((name, level) => {
                keyboard.on(`keydown-${name}`, () => this.whiteout = WHITEOUT_LEVELS[level]);
            });
        }

        keyboard.on('keydown', () => shelfAudio.unlock());
        keyboard.on('keydown-M', () => {
            if (this.phase === 'playing')
            {
                this.mapOpen = !this.mapOpen;
                this.logEvent(this.mapOpen ? 'map-open' : 'map-close');
            }
        });
        // After the run: TAB picks the moment being recalled, ENTER reveals the debrief,
        // R starts again, L saves the run log.
        keyboard.on('keydown-TAB', (event: KeyboardEvent) => {
            event.preventDefault();

            if (this.phase === 'recall')
            {
                this.recallMoment = (this.recallMoment + 1) % RECALL_MOMENTS.length;
            }
        });
        keyboard.on('keydown-ENTER', () => {
            if (this.phase === 'recall')
            {
                this.phase = 'debrief';
                this.logEvent('debrief');
            }
        });
        keyboard.on('keydown-R', () => {
            if (this.phase === 'debrief')
            {
                this.scene.restart();
            }
        });
        keyboard.on('keydown-L', () => {
            if (this.phase === 'debrief' || DEV)
            {
                this.log.download();
            }
        });

        // Click while surveying records the reading of the landmark being aimed at. Phaser runs this
        // as soon as the DOM event arrives, between frames, so the aim is worked out from the pointer
        // as it is now rather than taken from the last update (which may predate this move).
        // During recall a click on the map marks where the player believed they were.
        this.input.on(Input.Events.POINTER_DOWN, (pointer: Input.Pointer) => {
            shelfAudio.unlock();

            if (this.phase === 'recall')
            {
                this.markRecall(pointer);
                return;
            }

            if (this.phase !== 'playing' || !this.surveyKey.isDown || this.mapOpen)
            {
                return;
            }

            const aimed = this.aimedLandmark(this.surveyAzimuth ?? bearingOf(this.facing) ?? 0);

            if (aimed)
            {
                this.readings[aimed.index] = aimed.reading;
                this.everRecorded = true;
                this.logEvent('reading', { landmark: LANDMARKS[aimed.index].label, bearing: aimed.reading.bearing, step: round(aimed.reading.step) });

                // Readings that cross well are written onto the map; a rejected set keeps the old fix.
                const fix = this.positionFix();

                if (fix)
                {
                    this.savedFix = fix;
                    this.fixes.push(fix);
                    this.logEvent('fix', { x: round(fix.point.x), y: round(fix.point.y), error: round(Math.hypot(fix.point.x - this.position.x, fix.point.y - this.position.y)) });
                }
                else if (fix === null)
                {
                    this.logEvent('fix-rejected');
                }
            }
        });

        this.input.on(Input.Events.POINTER_MOVE, (pointer: Input.Pointer) => {
            if (this.surveyAzimuth !== null)
            {
                // Surveying: only horizontal movement turns the instrument.
                this.turnInstrument((pointer.x - this.surveyPointerX) * SURVEY_DEGREES_PER_PIXEL);
                this.surveyPointerX = pointer.x;
                return;
            }

            this.lookWithPointer = true;
            this.pointerMoved = true;
        });

        this.debugText = this.add.text(2, 2, '', {
            fontFamily: 'monospace',
            fontSize: '8px',
            color: '#ffffff',
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            padding: { x: 2, y: 2 }
        }).setScrollFactor(0);
        // Added last so the marker stays visible when it walks under the readout.
        this.marker = this.add.rectangle(0, 0, MARKER_SIZE, MARKER_SIZE, 0xff3030);

        // The map is added last so it covers the whole field while open.
        const mapText = { fontFamily: 'monospace', fontSize: '8px', color: '#2a2a2a' };

        // The map is drawn in screen space (scroll factor 0), so it ignores the camera.
        this.mapLayout = fitMap(width, height, { x: 0, y: 0, width: view.width, height: view.height * MAP_HEIGHT_SHARE });

        const mapX = this.mapLayout.x;

        this.mapGraphics = this.add.graphics().setScrollFactor(0).setDepth(20).setVisible(false);
        this.mapLabels = [...LANDMARKS, SHELTER].map(landmark => {
            const { x, y } = toMap(landmark.position, this.mapLayout);

            return this.add.text(x + 5, y - 11, landmark.label, { ...mapText, color: `#${landmark.mapColor.toString(16).padStart(6, '0')}` })
                .setScrollFactor(0).setDepth(21).setVisible(false);
        });
        this.mapLegend = this.add.text(mapX, height * this.mapLayout.scale + 3, '', { ...mapText, color: '#e8e4da' })
            .setScrollFactor(0).setDepth(21).setVisible(false);
        this.mapDebug = this.add.text(mapX + 4, 4, '', { ...mapText, color: '#c00000', backgroundColor: 'rgba(235, 230, 218, 0.85)', padding: { x: 2, y: 2 } })
            .setScrollFactor(0).setDepth(21).setVisible(false);
        this.mapFixLabel = this.add.text(0, 0, 'LAST FIX', { ...mapText, color: `#${FIX_MARK_COLOR.toString(16).padStart(6, '0')}` })
            .setScrollFactor(0).setDepth(21).setVisible(false);

        this.followPlayer();
        this.showState(this.position);
        this.paintFog();
        this.log.sample(0, this.position, true);
        this.logEvent('start', { x: this.position.x, y: this.position.y });

        if (DEV)
        {
            // Development only: the current run's log, for inspection from the browser console.
            (window as unknown as { shelfLog: RunLog }).shelfLog = this.log;
        }
    }

    update (time: number, delta: number)
    {
        this.showMap();

        if (this.phase === 'recall' || this.phase === 'debrief')
        {
            return;
        }

        const seconds = delta / 1000;

        if (this.phase === 'sliding')
        {
            this.advanceSlide(seconds);
            this.revealNearby();
            this.paintFog();
            return;
        }

        if (this.mapOpen)
        {
            // The field is paused behind the map: no movement, looking or surveying.
            this.surveyView.setVisible(false);
            this.surveyAzText.setVisible(false);
            return;
        }

        const held = (keys: Input.Keyboard.Key[]) => keys.some(key => key.isDown);
        const surveying = this.surveyKey.isDown;

        if (!surveying)
        {
            if (this.surveyAzimuth !== null)
            {
                this.lastSurvey = { position: this.position, azimuth: this.surveyAzimuth };
                this.logEvent('survey-close');
            }

            this.surveyAzimuth = null;
        }
        else if (this.surveyAzimuth === null)
        {
            // The instrument starts where it was left if the player has not moved since, else on the direction they face.
            const last = this.lastSurvey;
            const unmoved = last !== null && last.position.x === this.position.x && last.position.y === this.position.y;

            this.surveyAzimuth = unmoved ? last.azimuth : bearingOf(this.facing) ?? 0;
            this.surveyPointerX = this.input.activePointer.x;
            this.logEvent('survey-open');
        }
        else
        {
            this.turnInstrument((Number(held(this.moveKeys.right)) - Number(held(this.moveKeys.left))) * SURVEY_TURN_RATE * seconds);
        }

        // While surveying the player stands still and the movement keys turn the instrument instead.
        const direction = surveying ? { x: 0, y: 0 } : inputDirection({
            left: held(this.moveKeys.left),
            right: held(this.moveKeys.right),
            up: held(this.moveKeys.up),
            down: held(this.moveKeys.down)
        });

        const previous = this.position;
        const step = walk(WORLD_ELEVATION, previous, direction, seconds, this.bounds);

        this.position = step.position;
        this.followPlayer();

        // Readings only combine into a fix if they were taken from the same spot.
        if (step.position.x !== previous.x || step.position.y !== previous.y)
        {
            if (this.readings.some(reading => reading !== null))
            {
                this.notice = {
                    text: this.savedFix
                        ? 'You moved: bearings cleared. Your last fix stays on the map.'
                        : 'You moved: bearings cleared. Take both bearings from one spot.',
                    until: time + NOTICE_MS
                };
            }

            this.readings = LANDMARKS.map(() => null);
        }

        this.log.sample(this.elapsed(), this.position);

        // The map's hazards: the drop ends the run, the slab carries the player down it.
        const hazard = hazardAt(SHELF_HAZARDS, this.position);

        if (hazard?.kind === 'fatal')
        {
            this.endRun('fell');
            return;
        }

        if (hazard?.kind === 'slide')
        {
            this.startSlide(hazard);
            return;
        }

        if (Math.hypot(this.position.x - SHELTER.position.x, this.position.y - SHELTER.position.y) <= SHELTER_REACH)
        {
            this.endRun('arrived');
            return;
        }

        shelfAudio.setWind(clamp(1 - distanceToDrop(this.position) / DROP_WARNING, 0, 1));

        if (this.notice && time > this.notice.until)
        {
            this.notice = null;
        }

        // While surveying the instrument has its own azimuth and field facing is left as it was.
        if (this.lookWithPointer && !surveying)
        {
            const look = this.pointerLook();

            this.facing = look.facing;
            this.lookHeld = look.held;
            this.lookTarget = this.pointerTarget();
            this.pointerMoved = false;
        }
        else
        {
            this.facing = nextFacing(this.facing, direction);
        }

        this.debugText.setVisible(this.debugView);
        this.shading.setVisible(this.debugView && this.showShading);
        this.contours.setVisible(this.debugView && this.showContours);
        this.revealNearby();
        this.showState(previous, step, seconds);
        this.paintFog();
        this.showSurvey();
    }

    /** Milliseconds since this run started: the time base of the run log. */
    private elapsed (): number
    {
        return this.time.now - this.startTime;
    }

    private logEvent (type: string, data: Record<string, unknown> = {})
    {
        this.log.event(this.elapsed(), type, data);
    }

    /** Fades the landmarks and the hut in with distance (see LANDMARK_FIELD_RANGE). */
    private revealNearby ()
    {
        const reveal = (sprite: GameObjects.Graphics, { x, y }: Point) => {
            const distance = Math.hypot(x - this.position.x, y - this.position.y);
            const alpha = this.debugView ? 1 : clamp((LANDMARK_FIELD_RANGE - distance) / (LANDMARK_FIELD_RANGE - LANDMARK_FIELD_SOLID), 0, 1);

            sprite.setVisible(alpha > 0).setAlpha(alpha);
        };

        this.landmarkSprites.forEach((sprite, index) => reveal(sprite, LANDMARKS[index].position));
        reveal(this.hutSprite, SHELTER.position);
    }

    /**
     * The player has stepped onto the slab: work out where it carries them (see slideFrom) and hand
     * control to the slide. Readings are cleared like any other move; the last fix stays.
     */
    private startSlide (zone: HazardZone)
    {
        const slide = slideFrom(WORLD_ELEVATION, SHELF_HAZARDS, this.position);
        const length = (slide.path.length - 1) * 2;

        this.phase = 'sliding';
        this.slide = { path: slide.path, travelled: 0, fatal: slide.fatal };
        this.mapOpen = false;
        this.surveyAzimuth = null;
        this.readings = LANDMARKS.map(() => null);
        this.surveyView.setVisible(false);
        this.surveyAzText.setVisible(false);
        this.surveyText.setVisible(false);
        this.cameras.main.shake(250, 0.004);
        shelfAudio.slide(Math.max(0.6, length / SLIDE_SPEED));
        this.logEvent('slide-start', { x: round(this.position.x), y: round(this.position.y), zone: zone.kind });
    }

    /** Carries the player along the slide's path; on landing, hands control back (or ends the run). */
    private advanceSlide (seconds: number)
    {
        const slide = this.slide;

        if (!slide)
        {
            return;
        }

        slide.travelled += SLIDE_SPEED * seconds;

        // Path points are 2px apart (see slideFrom).
        const index = Math.min(slide.path.length - 1, Math.floor(slide.travelled / 2));

        this.position = slide.path[index];
        this.followPlayer();
        this.marker.setPosition(Math.round(this.position.x), Math.round(this.position.y));
        this.log.sample(this.elapsed(), this.position);

        // Snow thrown up round the player.
        this.spray.clear();
        this.spray.fillStyle(0xffffff, 0.8);

        for (let i = 0; i < 14; i++)
        {
            const angle = Math.random() * Math.PI * 2;
            const distance = 4 + Math.random() * 10;

            this.spray.fillRect(Math.round(this.position.x + Math.cos(angle) * distance), Math.round(this.position.y + Math.sin(angle) * distance), 2, 2);
        }

        if (index < slide.path.length - 1)
        {
            return;
        }

        this.spray.clear();
        this.slide = null;
        this.logEvent('slide-end', {
            x: round(this.position.x),
            y: round(this.position.y),
            path: slide.path.filter((_, i) => i % 5 === 0).map(point => [round(point.x), round(point.y)])
        });

        if (slide.fatal)
        {
            this.endRun('fell');
            return;
        }

        this.phase = 'playing';
        this.notice = { text: 'You slid down the slope.', until: this.time.now + NOTICE_MS };
    }

    /** The run is over: hold the field and open the map for recall, before the debrief. */
    private endRun (ending: 'arrived' | 'fell')
    {
        this.ending = ending;
        this.phase = 'recall';
        this.mapOpen = true;
        this.surveyAzimuth = null;
        this.surveyView.setVisible(false);
        this.surveyAzText.setVisible(false);
        this.surveyText.setVisible(false);
        this.log.sample(this.elapsed(), this.position, true);
        this.logEvent(ending === 'arrived' ? 'arrive' : 'fall', { x: round(this.position.x), y: round(this.position.y) });

        if (ending === 'arrived')
        {
            shelfAudio.arrive();
        }
        else
        {
            shelfAudio.fall();
            this.cameras.main.shake(400, 0.01);
        }
    }

    /** Recall: a click on the map marks where the player believed they were at the current moment. */
    private markRecall (pointer: Input.Pointer)
    {
        const { x, y, scale } = this.mapLayout;
        const point = { x: (pointer.x - x) / scale, y: (pointer.y - y) / scale };

        if (point.x < 0 || point.y < 0 || point.x > gridWidth(WORLD_ELEVATION) || point.y > gridHeight(WORLD_ELEVATION))
        {
            return;
        }

        const moment = RECALL_MOMENTS[this.recallMoment];

        this.recallMarks.set(moment, point);
        this.logEvent('recall-mark', { moment, x: round(point.x), y: round(point.y) });
    }

    /**
     * While SPACE is held: the Survey View, and the bearing of whichever landmark is aimed at and
     * clearly seen. Recorded readings, and the position fix once both exist, stay listed below.
     */
    private showSurvey ()
    {
        const surveying = this.surveyKey.isDown;
        const degrees = (bearing: number | null) => bearing === null ? '---' : `${String(wholeBearing(bearing)).padStart(3, '0')}°`;
        const lines: string[] = [];

        this.surveyView.setVisible(surveying);
        this.surveyAzText.setVisible(surveying);

        if (surveying)
        {
            const azimuth = this.surveyAzimuth ?? 0;
            const aimed = this.aimedLandmark(azimuth);

            this.drawSurveyView(azimuth, aimed?.index ?? null);
            lines.push(aimed
                ? `SURVEY  ${LANDMARKS[aimed.index].label} ${degrees(aimed.reading.bearing)}  click: record`
                : 'SURVEY  ---   mouse left/right or A/D: turn');
        }

        const recorded = this.readings.filter(reading => reading !== null).length;

        if (recorded > 0)
        {
            lines.push(LANDMARKS.map((landmark, index) => `${landmark.label} ${degrees(this.readings[index]?.bearing ?? null)}`).join('   '));
        }

        const fix = this.positionFix();

        if (this.notice)
        {
            lines.push(this.notice.text);
        }
        else if (recorded === 0 && !surveying)
        {
            lines.push(this.everRecorded
                ? 'SPACE + click: take a bearing.  M: map'
                : 'Lost. Reach the HUT. SPACE + click: take a bearing.  M: map');
        }
        else if (recorded === 1)
        {
            lines.push('Now take a bearing to another landmark without moving.');
        }
        else if (recorded >= 2)
        {
            lines.push(fix
                ? 'Your fix is marked on the map (M).'
                : 'These bearings are too close to parallel to fix your position here.');
        }

        if (fix !== undefined && this.debugView)
        {
            lines.push(fix ? `FIX  ${fix.point.x.toFixed(1)}, ${fix.point.y.toFixed(1)}` : 'NO FIX  bearings too close or opposed');
        }

        this.surveyText.setVisible(lines.length > 0).setText(lines);
    }

    /**
     * Draws the Survey View for the instrument's azimuth: the eyepiece (sky, ground, horizon, fixed
     * reticle ticks, red hairline), each landmark at its relative bearing, the brass frame, the
     * turning drum and the azimuth plate. Nothing drawn depends on a landmark's distance except how
     * opaque it is and how coarsely it can be read.
     *
     * A landmark is drawn where the instrument reads it: at its reading (the bearing rounded to the
     * step its visibility allows), not its exact bearing, and a coarse reading is drawn as a soft band
     * as wide as its step. So lining the hairline up on a faint landmark can never give a finer
     * bearing than the reading itself. When the hairline is on a readable landmark, red brackets
     * close round it.
     */
    private drawSurveyView (aim: number, aimedIndex: number | null)
    {
        const g = this.surveyView;
        const { width, height } = this.scale;
        const { x: left, y: top, width: windowWidth, height: windowHeight, radius } = EYEPIECE;
        const right = left + windowWidth;
        const bottom = top + windowHeight;
        const horizon = Math.round(top + windowHeight / 2);
        const centre = width / 2;
        const perDegree = windowWidth / SURVEY_VIEW_FOV;
        const range = this.surveyRange();
        const facing = bearingVector(aim);

        g.clear();

        // Instrument body.
        g.fillStyle(INSTRUMENT_METAL);
        g.fillRect(0, 0, width, height);
        g.lineStyle(1, INSTRUMENT_METAL_EDGE);
        g.strokeRect(6, 6, width - 12, height - 12);

        // Eyepiece: sky above the horizon, cold snow below.
        g.fillStyle(SURVEY_GROUND);
        g.fillRoundedRect(left, top, windowWidth, windowHeight, radius);
        g.fillStyle(SURVEY_SKY);
        g.fillRoundedRect(left, top, windowWidth, horizon - top, { tl: radius, tr: radius, bl: 0, br: 0 });
        g.lineStyle(1, SURVEY_HORIZON);
        g.lineBetween(left, horizon, right, horizon);

        // Fixed reticle: a tick every 5 degrees either side of the hairline, longer every 10.
        for (let degrees = -40; degrees <= 40; degrees += 5)
        {
            const x = Math.round(centre + degrees * perDegree);
            const length = degrees % 10 === 0 ? 6 : 3;

            g.lineStyle(1, SURVEY_TICK, 0.7);
            g.lineBetween(x, horizon + 2, x, horizon + 2 + length);
        }

        // Landmarks, at their readings.
        LANDMARKS.forEach((landmark, index) => {
            const bearing = bearingTo(this.position, landmark.position);
            const seen = visibility(this.position, facing, range, landmark.position);

            if (bearing === null || seen <= 0)
            {
                return;
            }

            const step = readingStep(seen);
            const x = Math.round(centre + angularOffset(relativeBearing(aim, coarseReading(bearing, step)), SURVEY_VIEW_FOV, windowWidth));
            const band = step * perDegree;
            const spriteWidth = landmark.profile[0].length;

            if (x - band / 2 < left + 4 || x + band / 2 > right - 4)
            {
                return;
            }

            if (step > 1.5)
            {
                // Coarse: a soft band as wide as the step, centred on the reading.
                g.fillStyle(landmark.mapColor, 0.18 * seen);
                g.fillRect(Math.round(x - band / 2), horizon - 12, Math.round(band), 12);
            }

            // The landmark's own ground-level profile, standing on the horizon, as opaque as it is seen.
            landmark.profile.forEach((row, py) => {
                Array.from(row).forEach((code, px) => {
                    if (code in landmark.colors)
                    {
                        const [color, alpha] = paintOf(landmark.colors[code]);

                        g.fillStyle(color, alpha * seen);
                        g.fillRect(Math.round(x - spriteWidth / 2) + px, horizon - landmark.profile.length + py, 1, 1);
                    }
                });
            });

            if (index === aimedIndex)
            {
                // Locked: red brackets close round the reading.
                const half = Math.max(band / 2, spriteWidth / 2 + 3);
                const bracketTop = horizon - 16;

                g.lineStyle(1, SURVEY_RED);
                g.lineBetween(x - half, bracketTop, x - half, horizon + 3);
                g.lineBetween(x - half, bracketTop, x - half + 3, bracketTop);
                g.lineBetween(x - half, horizon + 3, x - half + 3, horizon + 3);
                g.lineBetween(x + half, bracketTop, x + half, horizon + 3);
                g.lineBetween(x + half, bracketTop, x + half - 3, bracketTop);
                g.lineBetween(x + half, horizon + 3, x + half - 3, horizon + 3);
            }
        });

        // Hairline: where the reading is taken.
        g.lineStyle(1, SURVEY_RED, 0.9);
        g.lineBetween(centre, top + 4, centre, horizon - 6);
        g.lineBetween(centre, horizon + 10, centre, bottom - 4);
        g.lineBetween(centre - 12, horizon, centre - 4, horizon);
        g.lineBetween(centre + 4, horizon, centre + 12, horizon);

        // Lens edge shading.
        for (let i = 0; i < 4; i++)
        {
            g.lineStyle(2, 0x000000, 0.16 - i * 0.04);
            g.strokeRoundedRect(left + i * 2, top + i * 2, windowWidth - i * 4, windowHeight - i * 4, Math.max(2, radius - i * 2));
        }

        // Brass ring.
        g.lineStyle(6, BRASS);
        g.strokeRoundedRect(left - 3, top - 3, windowWidth + 6, windowHeight + 6, radius + 3);
        g.lineStyle(1, BRASS_LIGHT);
        g.strokeRoundedRect(left - 6, top - 6, windowWidth + 12, windowHeight + 12, radius + 6);
        g.lineStyle(1, BRASS_DARK);
        g.strokeRoundedRect(left - 1, top - 1, windowWidth + 2, windowHeight + 2, radius + 1);

        // Turning drum: knurl marks every 5 degrees of azimuth, moving as the instrument turns.
        const drum = { x: centre - 120, y: bottom + 10, width: 240, height: 10 };

        g.fillStyle(BRASS_DARK);
        g.fillRect(drum.x, drum.y, drum.width, drum.height);
        g.lineStyle(1, BRASS);

        for (let mark = Math.ceil((aim - 70) / 5) * 5; mark <= aim + 70; mark += 5)
        {
            const x = Math.round(centre + (mark - aim) * SURVEY_DRUM_SCALE);

            if (x > drum.x + 1 && x < drum.x + drum.width - 1)
            {
                g.lineBetween(x, drum.y + 1, x, drum.y + drum.height - 1);
            }
        }

        g.lineStyle(1, BRASS_LIGHT);
        g.strokeRect(drum.x, drum.y, drum.width, drum.height);
        // Turn arrows either side of the drum.
        g.fillStyle(BRASS_LIGHT);
        g.fillTriangle(drum.x - 12, drum.y + 5, drum.x - 5, drum.y + 1, drum.x - 5, drum.y + 9);
        g.fillTriangle(drum.x + drum.width + 12, drum.y + 5, drum.x + drum.width + 5, drum.y + 1, drum.x + drum.width + 5, drum.y + 9);
        // Index notch over the drum's centre.
        g.fillStyle(SURVEY_RED);
        g.fillTriangle(centre - 3, drum.y - 4, centre + 3, drum.y - 4, centre, drum.y);

        // Azimuth plate.
        g.fillStyle(INSTRUMENT_METAL_EDGE);
        g.fillRect(centre - 30, top - 22, 60, 15);
        g.lineStyle(1, BRASS);
        g.strokeRect(centre - 30, top - 22, 60, 15);
        this.surveyAzText.setText(`AZ ${String(wholeBearing(aim)).padStart(3, '0')}°`);
    }

    /** Turns the Survey View instrument by `degrees` (clockwise positive), keeping it in [0, 360). */
    private turnInstrument (degrees: number)
    {
        if (this.surveyAzimuth !== null)
        {
            this.surveyAzimuth = ((this.surveyAzimuth + degrees) % 360 + 360) % 360;
        }
    }

    /** How far the Survey View sees under the current whiteout (world px). */
    private surveyRange (): number
    {
        return SURVEY_RANGE_FACTOR * sightDistance(this.whiteout);
    }

    /** Centres the camera on the player's marker (whole pixels, like the marker). */
    private followPlayer ()
    {
        this.cameras.main.centerOn(Math.round(this.position.x), Math.round(this.position.y));
    }

    /**
     * Mouse position in world pixels. Pointer x/y are game pixels (the Scale Manager maps the canvas);
     * the camera is neither zoomed nor rotated, so its scroll is the only offset. Read from the scroll
     * rather than getWorldPoint, whose matrix is only refreshed at render, after update moved the camera.
     */
    private pointerTarget (): Point
    {
        const pointer = this.input.activePointer;
        const camera = this.cameras.main;

        return { x: pointer.x + camera.scrollX, y: pointer.y + camera.scrollY };
    }

    /** Facing from the mouse as it is right now (see lookAt). It counts as moved if any move event arrived or it is somewhere new. */
    private pointerLook (): Look
    {
        const target = this.pointerTarget();
        const moved = this.pointerMoved || target.x !== this.lookTarget.x || target.y !== this.lookTarget.y;

        return lookAt({ facing: this.facing, held: this.lookHeld }, this.position, target, moved);
    }

    /** First landmark the instrument at `azimuth` is aimed at and can read, with its reading (two only both qualify when lined up). */
    private aimedLandmark (azimuth: number): { index: number; reading: Reading } | null
    {
        const distance = this.surveyRange();
        const facing = bearingVector(azimuth);

        for (let index = 0; index < LANDMARKS.length; index++)
        {
            const landmark = LANDMARKS[index];
            const reading = surveyReading(this.position, facing, distance, landmark.position, landmark.radius);

            if (reading !== null)
            {
                return { index, reading };
            }
        }

        return null;
    }

    /**
     * The map overlay: paper, grid, contours, the hazards (the slab hatched, the drop in dark ink),
     * the landmarks and the hut. While playing (M): each recorded reading's line back from its
     * landmark along the reverse bearing, with a faint wedge for its uncertainty, and LAST FIX as the
     * region the readings allow. The player works out where the lines cross; only the development
     * view shows the answer. After the run: recall (the map with no true track, for the player's
     * belief marks), then the debrief (the true track, the slides, every fix and the recall marks).
     */
    private showMap ()
    {
        const open = this.mapOpen || this.phase === 'recall' || this.phase === 'debrief';
        const objects = [this.mapGraphics, this.mapLegend, this.mapDebug, this.mapFixLabel, ...this.mapLabels];

        objects.forEach(object => object.setVisible(open));
        this.mapDebug.setVisible(open && this.debugView);
        this.mapFixLabel.setVisible(open && this.phase === 'playing' && this.savedFix !== null);

        if (!open)
        {
            return;
        }

        const g = this.mapGraphics;
        const bounds = { minX: 0, minY: 0, maxX: gridWidth(WORLD_ELEVATION), maxY: gridHeight(WORLD_ELEVATION) };
        // World geometry is worked out in world pixels and only converted to the map to draw it.
        const at = (point: Point) => toMap(point, this.mapLayout);
        const line = (a: Point, b: Point) => {
            const p = at(a);
            const q = at(b);

            g.lineBetween(p.x, p.y, q.x, q.y);
        };
        const corner = at({ x: bounds.maxX, y: bounds.maxY });
        const degrees = (bearing: number) => `${String(Math.round(bearing) % 360).padStart(3, '0')}°`;

        g.clear();
        g.fillStyle(MAP_BACKDROP);
        g.fillRect(0, 0, this.scale.width, this.scale.height);
        g.fillStyle(MAP_PAPER);
        g.fillRect(this.mapLayout.x, this.mapLayout.y, corner.x - this.mapLayout.x, corner.y - this.mapLayout.y);
        g.lineStyle(1, MAP_GRID);

        for (let x = MAP_GRID_STEP; x < bounds.maxX; x += MAP_GRID_STEP)
        {
            line({ x, y: bounds.minY }, { x, y: bounds.maxY });
        }

        for (let y = MAP_GRID_STEP; y < bounds.maxY; y += MAP_GRID_STEP)
        {
            line({ x: bounds.minX, y }, { x: bounds.maxX, y });
        }

        g.lineStyle(1, MAP_CONTOUR);

        for (const { a, b } of this.contourLines)
        {
            line(a, b);
        }

        this.drawMapHazards(at);

        const legend = [
            this.phase === 'playing'
                ? 'MAP   M: back to the field      Goal: reach the HUT.   Hatched: slab, you will slide.   Dark: the drop.'
                : this.ending === 'arrived' ? 'You reached the hut.' : 'You fell from the edge.'
        ];

        if (this.phase === 'playing')
        {
            const readingsLine: string[] = [];

            LANDMARKS.forEach((landmark, index) => {
                const reading = this.readings[index];

                if (reading === null)
                {
                    return;
                }

                const from = landmark.position;
                const back = reverseBearing(reading.bearing);
                const end = rayExit(from, back, bounds);
                const left = rayExit(from, back - readingHalfWidth(reading), bounds);
                const right = rayExit(from, back + readingHalfWidth(reading), bounds);

                if (left && right)
                {
                    const [a, b, c] = [at(from), at(left), at(right)];

                    g.fillStyle(landmark.mapColor, 0.2);
                    g.fillTriangle(a.x, a.y, b.x, b.y, c.x, c.y);
                }

                if (end)
                {
                    g.lineStyle(1, landmark.mapColor);
                    line(from, end);
                }

                readingsLine.push(`${landmark.label} read ${degrees(reading.bearing)} -> line ${degrees(back)}`);
            });

            const fix = this.positionFix();
            const recorded = readingsLine.length;

            legend.push('Each coloured line runs back from its landmark towards where you stood.');
            legend.push(recorded > 0 ? readingsLine.join('     ') : 'No bearings from here.');

            if (recorded === 0)
            {
                legend.push(this.savedFix
                    ? 'LAST FIX is where you stood when you took your last bearings, not where you are now.'
                    : 'Survey a landmark (SPACE + click) in the field.');
            }
            else if (recorded === 1)
            {
                legend.push('One line: you are somewhere along it. Take another bearing from the same spot.');
            }
            else if (fix === null)
            {
                legend.push('These lines are too close to parallel to cross reliably. LAST FIX is unchanged.');
            }
            else
            {
                legend.push('The lines cross inside LAST FIX: where you stand now, until you move.');
            }
        }

        // The hut: a small hut outline (roof triangle over a square), a destination only.
        {
            const { x, y } = at(SHELTER.position);

            g.fillStyle(SHELTER.mapColor);
            g.fillTriangle(x - 4, y - 1, x + 4, y - 1, x, y - 5);
            g.fillRect(x - 3, y - 1, 6, 4);
        }

        // Landmark symbols on top of the lines: a dark square with the landmark colour inside.
        LANDMARKS.forEach(landmark => {
            const { x, y } = at(landmark.position);

            g.fillStyle(0x2a2a2a);
            g.fillRect(x - 3, y - 3, 6, 6);
            g.fillStyle(landmark.mapColor);
            g.fillRect(x - 2, y - 2, 4, 4);
        });

        if (this.phase === 'playing' && this.savedFix)
        {
            // The last fix as it was written down: it never follows the player.
            const right = this.drawFix(this.savedFix, at);

            this.mapFixLabel.setPosition(right.x + 3, right.y - 4);
        }

        if (this.phase === 'recall')
        {
            const moment = RECALL_MOMENTS[this.recallMoment];

            legend.push(`RECALL  Where did you think you were: "${moment}"?  Click the map to mark it.`);
            legend.push('TAB: next moment      ENTER: show where you really went');
            this.drawRecallMarks(at);
        }

        if (this.phase === 'debrief')
        {
            this.drawDebrief(at);
            legend.push('Red: where you really went.  Blue: slides.  Red outlines: your fixes.  Crosses: where you thought you were.');
            legend.push('R: start again      L: save the run log');
        }

        this.mapLegend.setText(legend);

        if (this.debugView)
        {
            // Development only: the solver's answer and where the player really is.
            const { x, y } = this.position;
            const you = at(this.position);
            const fix = this.positionFix();

            g.fillStyle(0xff3030);
            g.fillRect(Math.round(you.x) - 2, Math.round(you.y) - 2, 4, 4);

            if (fix)
            {
                const p = at(fix.point);

                g.lineStyle(1, 0x000000);
                g.lineBetween(p.x - 4, p.y - 4, p.x + 4, p.y + 4);
                g.lineBetween(p.x - 4, p.y + 4, p.x + 4, p.y - 4);
            }

            const last = this.savedFix ? `  last ${this.savedFix.point.x.toFixed(1)},${this.savedFix.point.y.toFixed(1)}` : '';

            this.mapDebug.setText((fix
                ? `DEBUG  fix ${fix.point.x.toFixed(1)},${fix.point.y.toFixed(1)}  you ${x.toFixed(1)},${y.toFixed(1)}  err ${Math.hypot(fix.point.x - x, fix.point.y - y).toFixed(2)}px`
                : `DEBUG  no fix  you ${x.toFixed(1)},${y.toFixed(1)}`) + last);
        }
    }

    /** The map's hazards: every slide zone filled and hatched, the drop beyond the walkable ground in dark ink. */
    private drawMapHazards (at: (point: Point) => Point)
    {
        const g = this.mapGraphics;
        const { minX, minY, maxX, maxY } = SHELF_INNER;
        const width = gridWidth(WORLD_ELEVATION);
        const height = gridHeight(WORLD_ELEVATION);
        const rect = (x0: number, y0: number, x1: number, y1: number) => {
            const a = at({ x: x0, y: y0 });
            const b = at({ x: x1, y: y1 });

            g.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
        };

        g.fillStyle(MAP_DROP_COLOR, 0.55);
        rect(0, 0, width, minY);
        rect(0, maxY, width, height);
        rect(0, minY, minX, maxY);
        rect(maxX, minY, width, maxY);

        // The edge itself, with short strokes pointing over it, like a cliff line.
        const edge = [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }];

        g.lineStyle(1, MAP_DROP_COLOR);
        edge.forEach((from, i) => {
            const to = edge[(i + 1) % edge.length];
            const length = Math.hypot(to.x - from.x, to.y - from.y);
            const [ux, uy] = [(to.x - from.x) / length, (to.y - from.y) / length];
            const p = at(from);
            const q = at(to);

            g.lineBetween(p.x, p.y, q.x, q.y);

            for (let d = 15; d < length; d += 30)
            {
                // Outward normal of a clockwise rectangle: (uy, -ux).
                const base = at({ x: from.x + ux * d, y: from.y + uy * d });

                g.lineBetween(base.x, base.y, base.x + uy * 3, base.y - ux * 3);
            }
        });

        for (const zone of SHELF_HAZARDS)
        {
            if (zone.kind !== 'slide')
            {
                continue;
            }

            g.fillStyle(MAP_SLIDE_COLOR, 0.18);
            fillPolygon(g, zone.polygon.map(at));
            g.lineStyle(1, MAP_SLIDE_COLOR, 0.9);

            for (const [a, b] of hatch(zone.polygon, MAP_HATCH_STEP / this.mapLayout.scale))
            {
                const p = at(a);
                const q = at(b);

                g.lineBetween(p.x, p.y, q.x, q.y);
            }
        }
    }

    /** Draws a fix as its region (or a small ring when the region cannot be worked out); returns its right-hand edge. */
    private drawFix (fix: Fix, at: (point: Point) => Point): Point
    {
        const g = this.mapGraphics;
        const centre = at(fix.point);

        g.lineStyle(1, FIX_MARK_COLOR);

        if (fix.region)
        {
            const region = fix.region.map(at);

            g.fillStyle(FIX_MARK_COLOR, 0.15);
            fillPolygon(g, region);
            strokePolygon(g, region);

            return { x: Math.max(...region.map(p => p.x)), y: centre.y };
        }

        g.strokeCircle(centre.x, centre.y, 3);

        return { x: centre.x + 3, y: centre.y };
    }

    /** Recall marks: a pencil cross and the moment's label for each mark placed. */
    private drawRecallMarks (at: (point: Point) => Point)
    {
        const g = this.mapGraphics;

        g.lineStyle(1, RECALL_COLOR);

        for (const point of this.recallMarks.values())
        {
            const p = at(point);

            g.lineBetween(p.x - 3, p.y - 3, p.x + 3, p.y + 3);
            g.lineBetween(p.x - 3, p.y + 3, p.x + 3, p.y - 3);
        }
    }

    /** Debrief: the true track (slides in blue), every fix region, the recall marks and where the run ended. */
    private drawDebrief (at: (point: Point) => Point)
    {
        const g = this.mapGraphics;
        const path = this.log.path.map(at);

        g.lineStyle(1, TRACK_COLOR);

        for (let i = 1; i < path.length; i++)
        {
            g.lineBetween(path[i - 1].x, path[i - 1].y, path[i].x, path[i].y);
        }

        g.lineStyle(2, SLIDE_TRACK_COLOR);

        for (const event of this.log.events)
        {
            if (event.type === 'slide-end' && Array.isArray(event.path))
            {
                const points = (event.path as [number, number][]).map(([x, y]) => at({ x, y }));

                for (let i = 1; i < points.length; i++)
                {
                    g.lineBetween(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y);
                }
            }
        }

        this.fixes.forEach(fix => this.drawFix(fix, at));
        this.drawRecallMarks(at);

        const end = at(this.position);

        g.lineStyle(2, TRACK_COLOR);
        g.strokeCircle(end.x, end.y, 3);
    }

    /**
     * Position worked out from the recorded readings and the landmarks' known positions only: the
     * pair of readings whose lines cross most squarely (see bestPair), with the region their
     * uncertainty allows. Undefined while fewer than two readings exist, null when none cross usably.
     */
    private positionFix (): Fix | null | undefined
    {
        const observations = LANDMARKS.flatMap((landmark, index) => {
            const reading = this.readings[index];

            return reading ? [{ landmark: landmark.position, bearing: reading.bearing, halfWidth: readingHalfWidth(reading) }] : [];
        });

        if (observations.length < 2)
        {
            return undefined;
        }

        const pair = bestPair(observations);
        const point = pair && triangulate(pair[0], pair[1]);

        return pair && point ? { point, region: fixRegion(pair[0], pair[1]) } : null;
    }

    private createFog (width: number, height: number)
    {
        if (this.textures.exists(FOG_TEXTURE))
        {
            this.textures.remove(FOG_TEXTURE);
        }

        const texture = this.textures.createCanvas(FOG_TEXTURE, width / FOG_SCALE, height / FOG_SCALE);

        if (!texture)
        {
            throw new Error(`Could not create the ${FOG_TEXTURE} texture.`);
        }

        this.fog = texture;
        this.fogPixels = texture.context.createImageData(texture.width, texture.height);
        // Covers the view: fixed to the screen, with each cell's world position read from the camera.
        this.fogImage = this.add.image(0, 0, FOG_TEXTURE).setOrigin(0, 0).setScale(FOG_SCALE).setScrollFactor(0);
    }

    /** Covers everything the player cannot see with fog. Presentation only: no game rule reads it. */
    private paintFog ()
    {
        const distance = sightDistance(this.whiteout);
        const limited = this.viewLimited || !this.debugView;
        const camera = this.cameras.main;
        const state = [this.position.x, this.position.y, this.facing.x, this.facing.y, distance, limited, camera.scrollX, camera.scrollY].join();

        if (state === this.fogPaintedFor)
        {
            return;
        }

        this.fogPaintedFor = state;
        this.fogImage.setVisible(limited);

        if (!limited)
        {
            return;
        }

        const { width, height } = this.fog;
        const data = this.fogPixels.data;

        for (let cy = 0; cy < height; cy++)
        {
            for (let cx = 0; cx < width; cx++)
            {
                const cell = { x: camera.scrollX + (cx + 0.5) * FOG_SCALE, y: camera.scrollY + (cy + 0.5) * FOG_SCALE };
                const seen = visibility(this.position, this.facing, distance, cell);
                const i = (cy * width + cx) * 4;

                data[i] = FOG_RGB[0];
                data[i + 1] = FOG_RGB[1];
                data[i + 2] = FOG_RGB[2];
                data[i + 3] = Math.round(255 * (1 - seen));
            }
        }

        this.fog.context.putImageData(this.fogPixels, 0, 0);
        this.fog.refresh();
    }

    /** Draws the marker and readout for the current position, having moved from `previous` over `seconds`. */
    private showState (previous: Point, step?: WalkStep, seconds = 0)
    {
        const { x, y } = this.position;

        this.marker.setPosition(Math.round(x), Math.round(y));

        const distance = Math.hypot(x - previous.x, y - previous.y);
        const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
        let directionLine = 'dir     --';
        let slopeLine = 'slope   --  (still)';
        let speedLine = 'speed  0.0px/s';

        if (step && distance > 0 && seconds > 0)
        {
            const trend = step.slope > FLAT_SLOPE ? 'uphill' : step.slope < -FLAT_SLOPE ? 'downhill' : 'flat';
            const per100px = trend === 'flat' ? 0 : step.slope * 100;

            // Direction actually travelled this frame (differs from the input when sliding along an edge).
            directionLine = `dir   ${signed((x - previous.x) / distance)},${signed((y - previous.y) / distance)}`;
            slopeLine = `slope ${per100px >= 0 ? '+' : ''}${per100px.toFixed(3)}/100px ${trend}`;
            speedLine = `speed ${(distance / seconds).toFixed(1)}px/s  x${step.speedMultiplier.toFixed(2)}`;
        }

        this.debugText.setText([
            `x ${x.toFixed(1)}  y ${y.toFixed(1)}`,
            `elev  ${elevationAt(WORLD_ELEVATION, x, y).toFixed(3)}`,
            directionLine,
            slopeLine,
            speedLine,
            `face  ${signed(this.facing.x)},${signed(this.facing.y)}${this.surveyAzimuth === null ? '' : `  az ${this.surveyAzimuth.toFixed(2)}`}`,
            this.viewLimited
                ? `white ${this.whiteout.toFixed(2)} sight ${sightDistance(this.whiteout).toFixed(0)}px`
                : 'view  unlimited',
            this.fixErrorLine(),
            `H player view  E/C/V debug  SPACE survey  L log`
        ]);
    }

    /** Debug only: how far the fix is from where the player actually is. */
    private fixErrorLine (): string
    {
        const fix = this.positionFix();

        if (fix === undefined)
        {
            return 'fix   --';
        }

        return fix ? `fix   err ${Math.hypot(fix.point.x - this.position.x, fix.point.y - this.position.y).toFixed(2)}px` : 'fix   rejected';
    }

    /** Draws the landmark into the scene below the fog; FieldScene decides when it is shown. */
    private drawLandmark (landmark: Landmark): GameObjects.Graphics
    {
        const graphics = this.add.graphics();
        const left = Math.floor(landmark.position.x - landmark.pixels[0].length / 2);
        const top = landmark.position.y - Math.floor(landmark.pixels.length / 2);

        landmark.pixels.forEach((row, y) => {
            Array.from(row).forEach((code, x) => {
                if (code in landmark.colors)
                {
                    graphics.fillStyle(...paintOf(landmark.colors[code]));
                    graphics.fillRect(left + x, top + y, 1, 1);
                }
            });
        });

        return graphics;
    }

    /** Draws contour lines generated from the same elevation model movement samples. */
    private drawContours (): GameObjects.Graphics
    {
        const graphics = this.add.graphics();

        graphics.lineStyle(1, CONTOUR_COLOR);

        for (const { a, b } of this.contourLines)
        {
            graphics.lineBetween(a.x, a.y, b.x, b.y);
        }

        return graphics;
    }

    /**
     * Player-view ground: snow shaded by local form (see SNOW_COLOR), baked once into a world-sized
     * image, with an even rock cast on the rock band (see ROCK_RGB) and the drop beyond the walkable
     * ground darkened. Nothing smaller than the terrain's own form is drawn.
     */
    private drawSnow (width: number, height: number)
    {
        if (this.textures.exists(SNOW_FIELD_TEXTURE))
        {
            this.textures.remove(SNOW_FIELD_TEXTURE);
        }

        const columns = Math.ceil(width / SNOW_CELL);
        const rows = Math.ceil(height / SNOW_CELL);
        const field = this.textures.createCanvas(SNOW_FIELD_TEXTURE, columns, rows);

        if (!field)
        {
            throw new Error(`Could not create the ${SNOW_FIELD_TEXTURE} texture.`);
        }

        const base = [(SNOW_COLOR >> 16) & 0xff, (SNOW_COLOR >> 8) & 0xff, SNOW_COLOR & 0xff];
        const mix = (from: number[], to: number[], t: number) => from.map((value, i) => value + (to[i] - value) * t);
        const smooth = (t: number) => {
            const c = clamp(t, 0, 1);

            return c * c * (3 - 2 * c);
        };
        const image = field.context.createImageData(columns, rows);
        // The rock band is an upright rectangle.
        const band = { left: Math.min(...ROCK_BAND.map(p => p.x)), right: Math.max(...ROCK_BAND.map(p => p.x)), top: Math.min(...ROCK_BAND.map(p => p.y)), bottom: Math.max(...ROCK_BAND.map(p => p.y)) };

        for (let row = 0; row < rows; row++)
        {
            for (let column = 0; column < columns; column++)
            {
                // Only the local form decides the colour: never the elevation itself.
                const x = (column + 0.5) * SNOW_CELL;
                const y = (row + 0.5) * SNOW_CELL;
                const form = surfaceForm(WORLD_ELEVATION, x, y, WORLD_ELEVATION.spacing);
                const bend = surfaceForm(WORLD_ELEVATION, x, y, 2 * WORLD_ELEVATION.spacing).curvature;
                const light = snowLight(form, SNOW_LIGHT_FROM, SNOW_RELIEF);
                const hollow = Math.max(-1, Math.min(1, bend / SNOW_CURVATURE));
                let colour = light >= 0 ? mix(base, SNOW_LIT, light) : mix(base, SNOW_SHADE, -light);

                colour = mix(colour, SNOW_SCOURED, 0.55 * Math.min(1, form.slope / SNOW_STEEP));
                colour = hollow > 0 ? mix(colour, SNOW_DRIFT, 0.25 * hollow) : mix(colour, SNOW_LIT, -0.2 * hollow);

                // Rock showing through the steep face of the rock band, still lit and shaded by its form.
                // Each fade runs across the band's edge, from half its width outside to half inside.
                const sides = smooth(Math.min(x - band.left, band.right - x) / ROCK_FADE_X + 0.5);
                const topAndBottom = smooth(Math.min(y - band.top, band.bottom - y) / ROCK_FADE_Y + 0.5);

                if (sides > 0 && topAndBottom > 0)
                {
                    const steep = smooth((form.slope - ROCK_STEEP_FROM) / (ROCK_STEEP_FULL - ROCK_STEEP_FROM));

                    colour = mix(colour, ROCK_RGB, ROCK_COVER * sides * topAndBottom * steep);
                }

                // Beyond the edge the mountain drops away: dark, deepening over the first 24px.
                if (distanceToDrop({ x, y }) < 0)
                {
                    colour = mix(colour, DROP_RGB, Math.min(1, 0.6 - distanceToDrop({ x, y }) / 24));
                }

                const i = (row * columns + column) * 4;

                image.data[i] = Math.round(colour[0]);
                image.data[i + 1] = Math.round(colour[1]);
                image.data[i + 2] = Math.round(colour[2]);
                image.data[i + 3] = 255;
            }
        }

        field.context.putImageData(image, 0, 0);
        field.refresh();
        this.add.image(0, 0, SNOW_FIELD_TEXTURE).setOrigin(0, 0).setScale(SNOW_CELL);
    }

    /** Bakes the elevation field into a greyscale texture: brighter is higher. */
    private drawElevation (width: number, height: number): GameObjects.Image
    {
        if (this.textures.exists(ELEVATION_TEXTURE))
        {
            this.textures.remove(ELEVATION_TEXTURE);
        }

        const texture = this.textures.createCanvas(ELEVATION_TEXTURE, width, height);

        if (!texture)
        {
            throw new Error(`Could not create the ${ELEVATION_TEXTURE} texture.`);
        }

        const image = texture.context.createImageData(width, height);

        for (let py = 0; py < height; py++)
        {
            for (let px = 0; px < width; px++)
            {
                // Sample at the pixel centre.
                const elevation = elevationAt(WORLD_ELEVATION, px + 0.5, py + 0.5);
                const shade = Math.round(LOW_SHADE + elevation * (HIGH_SHADE - LOW_SHADE));
                const i = (py * width + px) * 4;

                image.data[i] = shade;
                image.data[i + 1] = shade;
                image.data[i + 2] = shade;
                image.data[i + 3] = 255;
            }
        }

        texture.context.putImageData(image, 0, 0);
        texture.refresh();

        return this.add.image(0, 0, ELEVATION_TEXTURE).setOrigin(0, 0);
    }
}
