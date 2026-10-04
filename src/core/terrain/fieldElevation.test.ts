import { describe, expect, it } from 'vitest';
import { GAME_HEIGHT, GAME_WIDTH } from '../../shared/constants';
import { elevationAt, gridHeight, gridWidth, slopeBetween } from './elevation';
import { FIELD_ELEVATION } from './fieldElevation';

describe('FIELD_ELEVATION', () => {
    it('covers the whole 640x360 field', () => {
        expect(gridWidth(FIELD_ELEVATION)).toBe(GAME_WIDTH);
        expect(gridHeight(FIELD_ELEVATION)).toBe(GAME_HEIGHT);
    });

    it('uses the full normalized range', () => {
        expect(Math.min(...FIELD_ELEVATION.samples)).toBe(0);
        expect(Math.max(...FIELD_ELEVATION.samples)).toBe(1);
    });

    it('has a flat plateau in the west, a peak in the centre and low ground in the east', () => {
        expect(slopeBetween(FIELD_ELEVATION, { x: 20, y: 40 }, { x: 100, y: 320 })).toBeCloseTo(0);
        expect(elevationAt(FIELD_ELEVATION, 340, 180)).toBe(1);
        expect(elevationAt(FIELD_ELEVATION, 640, 180)).toBe(0);
    });
});
