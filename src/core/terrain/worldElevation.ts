import { createElevationGrid } from './elevation';

/** World pixels between samples: 32 x 18 cells of 60px cover the 1920x1080 world. */
const SPACING = 60;

/**
 * Hand-authored navigation test world, three screens wide and three high. One digit per sample,
 * 0 = elevation 0 and 9 = elevation 1. Column c is at x = 60c, row r at y = 60r.
 *
 * - South-west (around column 7, row 14): a low basin at 1, where a run starts.
 * - Centre-west (around column 14, row 8.6): a broad rise to 5; the two landmarks stand on its west side.
 * - North-east (columns 24-25, rows 4-6): the summit, a flat top at 9.
 * - The summit's west face (rows 2-8) is an escarpment, 2 -> 6 -> 9 in two samples, behind a
 *   low trough at 2. Its south flank is a long gentle ramp, so from the landmarks there is a
 *   short steep route and a longer gentle one.
 *
 * The outer band (x < 320 or > 1600, y < 180 or > 900) is outside the walkable area: FieldScene
 * keeps the player half a screen from every edge so the camera never has to stop at a world edge.
 */
const ROWS = [
    '222222222222222222222224555543322',
    '222222222222222222222225666554322',
    '222222222222222222222225777655432',
    '222222222222222222222226888765432',
    '222222222222222222222226998765432',
    '222222222223333333222226998765432',
    '222222222233344433322226998765432',
    '222222222233444443322226887765432',
    '222222222334455544332226777665432',
    '222222222334455544334566776654332',
    '222222222234444444334556666554322',
    '222222111233344433333455555543322',
    '222221111123333333223344554433222',
    '222211111112222222222334444332222',
    '222211111112222222222233333322222',
    '222211111112222222222222222222222',
    '222221111122222222222222222222222',
    '222222111222222222222222222222222',
    '222222222222222222222222222222222'
];

export const WORLD_ELEVATION = createElevationGrid(
    SPACING,
    ROWS.map(row => Array.from(row, digit => Number(digit) / 9))
);
