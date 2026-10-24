# Contributing to Director's Cut

Thanks for looking around! This is the hackathon submission for **Director's Cut**, an AI watch-party trivia companion for Fire TV (Vega OS). Contributions, issues, and suggested fixes are all welcome.

## Repo layout

- `main` — the RN 0.72 + MSE Fire TV app and the Fastify/Strands trivia engine (the hackathon submission)
- `monorepo` — the earlier monorepo codebase (Vega TypeScript app, agent + docs), kept for history

## Quick start

See the repo [README](README.md) for the full build path (media fetch + fMP4 remux, engine on :8788, `vega run-app` on the VVD). In short:

1. **Engine**: `cd engine && npm ci && npm start` → Fastify on `:8788` (deterministic MockModel by default; `STRANDS_BEDROCK=1` for Bedrock)
2. **App**: `npx react-native build-vega --build-type Debug` then `vega run-app … -d VirtualDevice`

## Ground rules

- **TypeScript type check** must pass: `npx tsc --noEmit --jsx react-native --esModuleInterop --skipLibCheck --target es2020 --module esnext --moduleResolution node` (CI runs this)
- **Tests** must pass: `npx jest` (CI runs this; the app spec mocks native-only modules — follow that pattern for any screen-level test)
- Don't commit media (`engine/media/`), build output (`build/`), or secrets — the `.gitignore` already covers the first two
- The app targets the **Vega Virtual Device**: test your changes on the VVD before assuming they work

## Where the hard-won knowledge lives

[`FRICTION_LOG.md`](FRICTION_LOG.md) documents every platform/tooling wall hit while building (w3cmedia tourism, Vega's media-pipeline policy, dual-tsconfig landmines…) together with suggested platform fixes. If your change required a workaround, please add an entry — it's the most useful file in this repo.

## Suggested fixes welcome too

Several friction-log entries include concrete "suggested fix" notes for the Vega toolchain and the w3cmedia library. PRs to document or work around any of them are as valuable as code.
