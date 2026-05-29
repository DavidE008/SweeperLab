# SweeperLab Roadmap

## 1. Foundation

- Keep the game playable offline with AsyncStorage-backed local progress.
- Refactor the single `App.tsx` file into `src/game`, `src/ui`, `src/storage`, and `src/screens` after the visual refresh is stable.
- Add CI with `npm ci` and `npm run typecheck` on every pull request.

## 2. UI polish

- Keep all visual styling tied to the SweeperLab blue palette in `docs/BRAND.md`.
- Add a proper home screen/onboarding screen before first game.
- Add accessibility labels for every board cell, HUD button, and tab.
- Test compact, standard, and large board scales on small phones.

## 3. Database phase

Do not connect the mobile app directly to Neon. Keep the Neon connection string on a backend/API layer.

Suggested first schema:

- `users`: id, display_name, created_at
- `matches`: id, user_id, level, rows, cols, mines, won, time_seconds, clicks, chords, hints, score, created_at
- `leaderboard_entries`: id, user_id, level, best_score, best_time_seconds, updated_at
- `coach_events`: id, user_id, match_id, category, action, confidence, created_at

Use Neon when accounts, cloud sync, leaderboards, or cross-device progress become real MVP needs. Local storage is enough for the first prototype.

## 4. Testing phase

- Unit tests for board generation, first-click safety, reveal flood-fill, flagging, chording, scoring, and win/loss detection.
- Component tests for HUD state and setup controls.
- Manual/Kilo-assisted test prompts for game-play edge cases and visual regression checks.
- E2E smoke tests later for starting a game, winning/losing, saving stats, and resetting stats.

## 5. Publish phase

- Use Expo EAS preview builds first.
- Ship to Android internal testing before production.
- Prepare App Store Connect/TestFlight only after store assets, screenshots, privacy policy, and support URL are ready.
