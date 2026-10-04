import { Scene } from 'phaser';
import { PreloaderScene } from './PreloaderScene';

/**
 * First scene to run. Reserved for setup that must happen before the Preloader,
 * such as loading the few assets the loading screen itself needs.
 * There is no such work yet, so it hands straight over.
 */
export class BootScene extends Scene
{
    static readonly KEY = 'BootScene';

    constructor ()
    {
        super(BootScene.KEY);
    }

    create ()
    {
        this.scene.start(PreloaderScene.KEY);
    }
}
