import { Game } from 'phaser';
import { gameConfig } from './config';

export function startGame (parent: string): Game
{
    return new Game({ ...gameConfig, parent });
}
