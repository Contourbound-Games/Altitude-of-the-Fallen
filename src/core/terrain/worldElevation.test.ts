import { describe, expect, it } from 'vitest';
import { GAME_HEIGHT, GAME_WIDTH } from '../../shared/constants';
import { elevationAt, gridHeight, gridWidth } from './elevation';
import { WORLD_ELEVATION } from './worldElevation';

const WIDTH = gridWidth(WORLD_ELEVATION);
const HEIGHT = gridHeight(WORLD_ELEVATION);

describe('WORLD_ELEVATION', () => {
    it('covers 1920x1080: three screens each way, so the screen cannot show the whole world', () => {
        expect(WIDTH).toBe(1920);
        expect(HEIGHT).toBe(1080);
        expect(WIDTH).toBe(GAME_WIDTH * 3);
        expect(HEIGHT).toBe(GAME_HEIGHT * 3);
    });

    it('samples exactly at the world corners and reads the nearest edge beyond them', () => {
        const corners = [[0, 0], [WIDTH, 0], [0, HEIGHT], [WIDTH, HEIGHT]] as const;

        for (const [x, y] of corners)
        {
            const value = elevationAt(WORLD_ELEVATION, x, y);

            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThanOrEqual(1);
            expect(elevationAt(WORLD_ELEVATION, x + Math.sign(x - 1) * 500, y + Math.sign(y - 1) * 500)).toBe(value);
        }

        expect(elevationAt(WORLD_ELEVATION, WIDTH, 300)).toBeCloseTo(2 / 9);
        expect(elevationAt(WORLD_ELEVATION, 420, HEIGHT)).toBeCloseTo(2 / 9);
    });

    it('has one summit: everything above the top contour level (8.5 / 9) is on the north-east top', () => {
        let highest = 0;

        for (let y = 0; y <= HEIGHT; y += 5)
        {
            for (let x = 0; x <= WIDTH; x += 5)
            {
                const value = elevationAt(WORLD_ELEVATION, x, y);

                highest = Math.max(highest, value);

                if (value >= 8.5 / 9)
                {
                    expect(x).toBeGreaterThan(1400);
                    expect(x).toBeLessThan(1540);
                    expect(y).toBeGreaterThan(200);
                    expect(y).toBeLessThan(400);
                }
            }
        }

        expect(highest).toBe(1);
        expect(elevationAt(WORLD_ELEVATION, 1470, 300)).toBe(1);
    });
});
