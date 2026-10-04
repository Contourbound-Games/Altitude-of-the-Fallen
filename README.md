# Altitude of the Fallen

A 2D top-down pixel-art game for desktop browsers, also playable on mobile browsers.

Built with Phaser 4, TypeScript and Vite.

## Requirements

Node.js `^22.12.0` or `>=24` (required by Vitest).

## Commands

| Command | Description |
|---|---|
| `npm install` | Install dependencies |
| `npm run dev` | Start the dev server at http://localhost:8080 |
| `npm run build` | Production build into `dist/` |
| `npm run typecheck` | Type-check with `tsc` |
| `npm test` | Run unit tests once |
| `npm run test:watch` | Run unit tests in watch mode |

## Structure

```
src/
  main.ts           DOM entry point
  game/             Phaser-specific code: game config, scenes, rendering, input
    config.ts       Game config (640x360, Scale.FIT, pixel art)
    main.ts         Creates the Phaser.Game
    scenes/         BootScene -> PreloaderScene -> FieldScene
  core/             Pure TypeScript rules, math and state. Never imports Phaser.
  shared/           Constants used by both core and game. Never imports Phaser.
public/             Static files served as-is (assets go in public/assets/)
```

Unit tests sit next to the code they test as `*.test.ts`.

## Credits

Bootstrapped from [phaserjs/template-vite-ts](https://github.com/phaserjs/template-vite-ts) (MIT, see `LICENSE`).
