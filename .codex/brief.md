# Codex Brief: SweeperLab

You are working on SweeperLab, a mobile-first Minesweeper trainer built with Expo, React Native, and TypeScript.

## Current goals

1. Keep the game stable and playable.
2. Align UI with the SweeperLab logo palette:
   - `#E6F9FF`, `#E7F4FD`, `#C0D2E1`, `#B9DCF8`, `#297ECB`.
3. Preserve semantic colors:
   - Red only for mines/danger/destructive actions.
   - White/navy for text contrast.
4. Keep database credentials out of the mobile app.
5. Add tests around pure game logic before making major gameplay changes.

## Validation

Run before completing any task:

```bash
npm run typecheck
```

For UI changes, also run the Expo app and manually verify:

- Beginner board fits without awkward clipping.
- Expert/custom boards can pan and zoom.
- Hint/coach states remain visible.
- Win/loss overlay text has readable contrast.
