import { createElevationGrid } from './elevation';

/** World pixels between samples: 16 x 9 cells of 40px cover the 640x360 field. */
const SPACING = 40;

/**
 * Hand-authored test field. One digit per sample, 0 = elevation 0 and 9 = elevation 1.
 * West: flat plateau at 3. Centre: hill peaking at 9. East: slope falling to 0 at the edge.
 *
 * Route-choice test feature (rows 4-5, deliberately artificial): a flat gully at level 2 cuts
 * into the hill from the east and ends in a headwall (2 -> 9 within 40px) directly below the summit.
 * Going straight up the gully is the short, steep route; climbing the gentle ridge beside it
 * (row 3, y = 120) is the longer, gentler one.
 */
const ROWS = [
    '33333333444321000',
    '33333345565432100',
    '33333456776543210',
    '33334567887654320',
    '33334578992222220',
    '33334578992222220',
    '33334567887654320',
    '33333456776543210',
    '33333345565432100',
    '33333333444321000'
];

export const FIELD_ELEVATION = createElevationGrid(
    SPACING,
    ROWS.map(row => Array.from(row, digit => Number(digit) / 9))
);
