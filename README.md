# SweeperLab

A mobile-first Minesweeper trainer built with Expo and React Native.

## Preview on your phone with Expo Go

Extract the beta branch ZIP and open the folder containing `package.json`. On Windows, type `cmd` in File Explorer's address bar and press Enter. With Node.js installed, run these commands one at a time:

```sh
npm ci
npm run go
```

Connect the phone and computer to the same Wi-Fi and keep the terminal open. Scan its QR code using Camera on iPhone or Expo Go on Android. Use an SDK 58 build of Expo Go from https://expo.dev/go?sdkVersion=58 if your installed version reports a mismatch. If Wi-Fi isolates devices, stop Metro and run `npx expo start --go --tunnel`; accept the tunnel helper installation if prompted.

## Run locally

```bash
npm install
npm start
```

Scan the Expo QR code with Expo Go, or press `a` for Android emulator / `i` for iOS simulator when available.

## Quality checks

```bash
npm run typecheck
npm test
npm run check
```

## Included

- Beginner, Intermediate, Expert, and bounded Custom boards.
- First-click-safe mine placement.
- Tap to open, long-press or Flag mode to flag, tap revealed clues to chord.
- Compact gameplay HUD with setup, flag, hint, and restart controls.
- Free-pan board viewport with zoom controls for large Expert and Custom maps.
- Timer, mine counter, open progress, score, and match history.
- Local persistent progress using AsyncStorage.
- Coach tab with pattern scanning, hints, risk reads, and post-match feedback.
- SweeperLab blue brand palette documented in `docs/BRAND.md`.
- CI typecheck workflow in `.github/workflows/ci.yml`.
- EAS build profiles in `eas.json`.

## GitHub setup

Recommended repository name: `sweeperlab`.

```bash
git init
git add .
git commit -m "Initial SweeperLab mobile app"
git branch -M main
git remote add origin https://github.com/<your-username>/sweeperlab.git
git push -u origin main
```

Do not commit `node_modules`, `.expo`, logs, local `.env` files, or native build outputs.

## Database direction

Local storage is enough for the first playable prototype. Add Neon only when the app needs accounts, cloud sync, leaderboards, or cross-device progress.

Important: never expose Neon credentials inside the Expo mobile client. Use a backend/API layer for database writes and reads.

See `docs/ROADMAP.md` for suggested tables.

## Testing direction

Start with pure game logic tests: board generation, first-click safety, reveal flood-fill, flagging, chording, scoring, and win/loss detection. Then use Kilo/Codex for structured bug hunts and UI test plans.

## Publishing direction

Use Expo EAS preview builds before production store submission:

```bash
npm install -g eas-cli
eas login
eas build:configure
eas build --profile preview --platform android
eas build --profile production --platform all
```

Use `eas submit` only after store listings, screenshots, support URL, and privacy policy are ready.
