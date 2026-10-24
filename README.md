# Director's Cut 🎬 trivia-party

**AI watch-party trivia companion for Fire TV (Vega OS).**
Watch a movie with a panel of AI movie-critic friends: Director's Cut streams **Big Buck Bunny** with perfectly synced captions, generates live trivia from the film's own dialogue/captions using a [Strands Agents](https://github.com/strands-agents) powered engine, and lets three critic bots (Rascal, Frank, Gimera) race to answer while you keep score from the couch.

Built for the **Fire TV Vega hackathon** — developed entirely against the **Vega Virtual Device (VVD)**.

![app](docs/app-running.png)

*(screenshot placeholder — replace with your own capture, or run the app per instructions below)*

---

## How it works

```
┌──────────────────────────────┐        range-fetch fMP4 chunks         ┌─────────────────────────┐
│  Fire TV app (RN 0.72 Vega)  │ ◀────────── http://10.0.2.2:8788 ───── │   AI engine (Fastify)   │
│                              │                                        │                         │
│  ┌────────┐  ┌────────────┐  │   POST /trivia {cues, playhead}        │  Strands Agent          │
│  │ Video  │  │   right    │  │ ─────────────────────────────────────▶ │   - MockModel (default) │
│  │ (MSE)  │  │ captions ↑ │  │   ◀── 1 question + 4 options ───────── │   - BedrockModel (opt)  │
│  │        │  │   trivia ↓ │  │                                        │                         │
│  └────────┘  └────────────┘  │   GET /captions (SRT, parsed client)   │  GET /media/*.mp4/.srt  │
│  [ Rascal ][ Frank ][ Gim..] │                                        │  (Byte-range capable)   │
└──────────────────────────────┘                                        └─────────────────────────┘
```

- **Video**: streamed as fragmented MP4 over **MSE (MediaSource Extensions)** — `MediaSource` + `SourceBuffer.appendBuffer`, fed by ordinary JS `fetch` of range-chunked fMP4 (1.2 MB chunks, starts playing at ~25 % buffered). The blob URL must carry a query suffix (`blob:///${id}?offset=0`) — see FRICTION_LOG entry #20.
- **Captions**: the engine serves the film's SRT; the app parses it, syncs cues to `currentTime`, and shows a caption ticker in the right column.
- **Trivia**: every few caption cues the app posts recent cues + playhead to the engine; a Strands Agent answers with one 4-option question (deterministic MockModel by default, so demos are reproducible; swap in Bedrock with `STRANDS_BEDROCK=1`).
- **Critic bots**: three local bots answer with different skill instincts and race on a bottom scoreboard.
- **TV remote support**: D-pad ⇆ focus between trivia options, Select to answer, Play/Pause via the media-playback keys.

## Why MSE instead of a plain video URL?

Vega OS blocks cleartext `http://` **for the native media pipeline** (MPB) — and `file://` on the VVD as well — returning a bare `MEDIA_ERR_SRC_NOT_SUPPORTED` with an empty message. Ordinary app-JS `fetch` is *not* subject to that policy, which keeps the MSE path open. This platform behavior is fully chronicled (with evidence) in [`FRICTION_LOG.md`](FRICTION_LOG.md) entries #18–#20.

> **Branches**: `main` is this RN 0.72 + MSE app (the hackathon submission). The `monorepo` branch contains the earlier monorepo codebase of the same project (Vega TypeScript app, agent + docs included) — kept for history.

## Repo layout
```
directorscut72/
├── src/               # RN 0.72 Vega app (TypeScript)
│   ├── screens/WatchPartyScreen.tsx   # the whole show: video pane, captions, trivia, bots, HUD
│   ├── lib/mse-player.ts             # MSE pipeline: blob URL (?offset=0), ranged fetch+append, early play
│   ├── lib/captions.ts               # SRT → timed cues
│   ├── lib/ai.ts                     # engine client (trivia + captions)
│   ├── lib/local-trivia.ts           # offline fallback questions
│   └── assets/                       # template art we customized
├── engine/            # Fastify + Strands Agent trivia engine (:8788)
│   └── src/
│       ├── server.ts        # /health /trivia /captions /media (byte ranges)
│       ├── trivia-engine.ts # cue → question generation via Strands Agent
│       └── mock-model.ts    # deterministic MockModel (zero-cost demo mode)
├── manifest.toml      # Vega package manifest (packageId + [wants] privileges)
├── FRICTION_LOG.md    # 20 head-preserving entries of every wall we hit + suggested fixes
├── babel.config.js    # w3cmedia-friendly JSX transform config
└── index.js           # RN root
```

## Running it yourself

### 0. Prereqs
- macOS + [Vega SDK](https://amazon-vega.github.io/) (we used SDK 0.24) and the Vega Virtual Device app
- Node ≥ 18

### 1. Fetch media (CC-BY)

The Big Buck Bunny media is **not** committed (129 MB). Download the 720p MP4 from [archive.org](https://archive.org/details/BigBuckBunny_124) into `engine/media/`, then remux to fragmented MP4 for MSE:

```bash
mkdir -p engine/media
curl -Lo engine/media/big_buck_bunny_720p.mp4 \
  "https://archive.org/download/BigBuckBunny_124/big_buck_bunny_720p_surround.mp4"

# remux (no re-encode) to fMP4 — required by the MSE path
ffmpeg -i engine/media/big_buck_bunny_720p.mp4 -c copy \
  -movflags frag_keyframe+empty_moov+default_base_moof engine/media/bbb_fmp4_full.mp4

# short preview cut, handy for quick smoke tests
ffmpeg -i engine/media/big_buck_bunny_720p.mp4 -t 60 -c copy \
  -movflags frag_keyframe+empty_moov+default_base_moof engine/media/bbb_fmp4_60s.mp4

# captions (fetch SRT or bake with the film)
```

*(Big Buck Bunny © Blender Foundation — [CC BY 3.0](https://peach.blender.org)* → *all credits and applause to the Peach open-movie project.*

### 2. Start the AI engine

```bash
cd engine
npm ci
npm start          # Fastify on :8788 (health: curl localhost:8788/health)
```

### 3. Build + run the Fire TV app on the VVD

```bash
source ~/vega/env
cd directorscut72
npm ci
npx react-native build-vega --build-type Debug
vega run-app build/aarch64-debug/directorscut72_aarch64.vpkg com.directorscut.app72.main -d VirtualDevice
```

The app discovers the engine at `http://10.0.2.2:8788` (VVD's host gateway). Start watching — the debug HUD self-cleans ~15 s after first `playing`; captions tick, trivia fires every few cues, bots race.

### 4. Use the remote
- **D-pad Down/Up**: move trivia-option focus
- **Select**: answer (correct → green reveal, bot scores update)
- **Media play/pause** key: toggle the film

## Submission notes

- [`FRICTION_LOG.md`](FRICTION_LOG.md) — every wall the tools/pipeline gave us (SDK ANRs, blocked media schemes, w3cmedia quirks, blob-URL landmines, SSE browser-day friction) and what we'd suggest Amazon fix. Bonus-track fodder written as encountered, not reconstructed.
- Everything was built and demoed on the **Vega Virtual Device**, per the hackathon's VVD guidance.

## License

MIT (see [`LICENSE`](LICENSE)). Big Buck Bunny media remains © Blender Foundation under CC BY 3.0 and is not redistributed here.
