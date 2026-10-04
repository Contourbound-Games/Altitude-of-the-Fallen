import { AUTO, Scale, Types } from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../shared/constants';
import { BootScene } from './scenes/BootScene';
import { PreloaderScene } from './scenes/PreloaderScene';
import { FieldScene } from './scenes/FieldScene';

export const gameConfig: Types.Core.GameConfig = {
    // WebGL when available, Canvas fallback otherwise.
    type: AUTO,
    backgroundColor: '#000000',
    // pixelArt already implies roundPixels in Phaser 4; set explicitly for clarity.
    pixelArt: true,
    roundPixels: true,
    scale: {
        width: GAME_WIDTH,
        height: GAME_HEIGHT,
        mode: Scale.FIT,
        autoCenter: Scale.CENTER_BOTH
    },
    scene: [BootScene, PreloaderScene, FieldScene]
};
