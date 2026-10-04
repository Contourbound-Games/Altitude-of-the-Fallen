import { Loader, Scene } from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../../shared/constants';
import { FieldScene } from './FieldScene';

const BAR_WIDTH = 200;
const BAR_HEIGHT = 4;

/** Owns all asset loading, then starts the FieldScene. */
export class PreloaderScene extends Scene
{
    static readonly KEY = 'PreloaderScene';

    constructor ()
    {
        super(PreloaderScene.KEY);
    }

    preload ()
    {
        const x = (GAME_WIDTH - BAR_WIDTH) / 2;
        const y = (GAME_HEIGHT - BAR_HEIGHT) / 2;
        const bar = this.add.graphics();

        this.load.on(Loader.Events.PROGRESS, (progress: number) => {
            bar.clear();
            bar.fillStyle(0x333333);
            bar.fillRect(x, y, BAR_WIDTH, BAR_HEIGHT);
            bar.fillStyle(0xffffff);
            bar.fillRect(x, y, Math.round(BAR_WIDTH * progress), BAR_HEIGHT);
        });

        // Game assets are queued here as they are added to public/assets.
    }

    create ()
    {
        this.scene.start(FieldScene.KEY);
    }
}
