# core

Pure TypeScript game rules, math and state.

- Never import `phaser` (directly or indirectly) from this folder.
- Code here must run under plain Node so Vitest can test it without a browser.
- Phaser scenes in `src/game/` read core state and translate it to rendering and input.
