# Inventory — mobile

The iOS/Android app for Aicountly Inventory, built with [Expo](https://expo.dev)
and [Expo Router](https://docs.expo.dev/router/introduction/) (React Native +
TypeScript). It talks to the same `server-php` API as [`web/`](../web); see
the root [README](../README.md) for what the product does.

## Why Expo / React Native

The team already ships `web/` as React + TypeScript. React Native keeps the
same language, component model and much of the domain logic (types,
validation, API shapes) shareable in spirit with `web/`, while Expo adds:

- **EAS Build/Submit** — cloud builds and store submission without a local
  Xcode/Android Studio setup.
- **EAS Update** — over-the-air JS updates between store releases.
- **Managed native modules** — camera/barcode scanning (serials, batches),
  secure storage, file/PDF handling — without hand-written native code.

## Getting started

```bash
cd mobile
npm install
cp .env.example .env   # then edit EXPO_PUBLIC_API_BASE_URL etc.
npm start              # opens the Expo dev tools; scan the QR with Expo Go,
                        # or press `a` / `i` for an Android/iOS simulator
```

This is a **managed** Expo project: there is no `ios/`/`android/` folder
checked in. Expo generates them on demand (`npx expo prebuild`) for a
development build; day-to-day work runs in Expo Go or a dev client. Don't
hand-edit generated native folders — configure native behavior through
`app.json` and config plugins instead.

## Scripts

| Script | Purpose |
|---|---|
| `npm start` | Start the Metro dev server |
| `npm run android` / `npm run ios` | Start and open on a connected device/emulator |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | `expo lint` |

## Project structure

```
mobile/
  app.json          # Expo config: name, bundle/package ids, scheme, plugins
  eas.json          # EAS Build/Submit profiles (development/preview/production)
  .env.example       # EXPO_PUBLIC_* template — copy to .env, never commit .env
  assets/            # icons, splash
  src/
    app/             # Expo Router routes — every file here is a screen,
                      # _layout.tsx files define navigators (file-based routing)
    auth/            # portal SSO + ses_key handling (mirrors web/src/auth)
    services/        # typed API client (mirrors web/src/services/api.ts)
    config.ts        # EXPO_PUBLIC_* env plumbing (mirrors web/src/config.ts)
  # added as screens are built:
    features/        # masters, documents, reports... (mirrors web/src/{masters,documents,reports,...})
    components/
    hooks/
    theme/
```

`src/app` (rather than a top-level `app/`) is intentional: Expo Router looks
for `src/app` automatically when a `src/` directory exists, and it keeps
routing colocated with the rest of the app's source instead of sitting apart
at the project root.

## Authentication — not implemented yet

`web/`'s sign-in is a full-page redirect to the AICOUNTLY portal plus a
`.aicountly.com` shared cookie (see
[`docs/auth/AICOUNTLY_AUTH_WORKFLOW.md`](../docs/auth/AICOUNTLY_AUTH_WORKFLOW.md)).
Neither the redirect nor the shared cookie has a mobile equivalent — there's
no browser tab to redirect and no cookie jar shared between apps.

What's scaffolded:

- `src/auth/tokens.ts` — `auth_token` in SecureStore (Keychain/Keystore),
  `ses_key` in memory only, same lifetime rules as web.
- `src/auth/portal.ts` — `ensureSesKey()`, minting a `ses_key` from a stored
  `auth_token` via the same `server-php` relay (`/global/seskey`) web uses.
- `src/services/api.ts` — a typed fetch wrapper that calls `ensureSesKey()`
  and retries once on 401, mirroring `web/src/services/api.ts`.

What's **not** built: the interactive login screen. The plan is to open the
portal's login URL with `expo-web-browser`'s `openAuthSessionAsync`
(ASWebAuthenticationSession on iOS, Custom Tabs on Android) and catch the
redirect back on this app's custom scheme (`inventory://auth/callback`,
configured in `app.json`). That needs the portal
(`my.aicountly.com`) to accept a non-`https` `returnUrl` for this product —
confirm with whoever owns the portal before building the screen around it.

## Notes on generated files

`AGENTS.md` / `CLAUDE.md` / `.claude/` came from the Expo project template
and are kept as-is — they're Expo's own up-to-date guidance for coding
agents working in an Expo project (notably: "Expo ships breaking changes
every SDK release, don't trust training data, check the docs for the
installed major version"), which is worth having given how fast the SDK
moves.
