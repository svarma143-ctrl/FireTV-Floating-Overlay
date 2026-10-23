# Director's Cut — Friction Log

**Project**: Director's Cut — AI watch-party trivia companion for Fire TV (Vega)
**Hackathon**: Amazon "Build, Ship, Shape" (amazonappdev2026.devpost.com)
**Environment**: Apple silicon Mac (macOS 15, no Xcode, no Homebrew, no Java), Vega SDK 0.24.12112, Vega CLI 1.4.7, Virtual Device (VVD).

Format: each entry = tool/SDK name, what we tried, what broke, how we resolved it (or didn't), and impact. This log feeds the hackathon's friction-log bonus and the required product-feedback fields.

---

## 1. Vega CLI installer — interactive prompt defeats `NONINTERACTIVE=true`

- **Tool**: Vega CLI installer (`sdk-installer.vega.labcollab.net/get_vvm.sh`), vega-cli 1.4.7
- **What happened**: With `NONINTERACTIVE=true` the script still calls `vega sdk config setup` interactively and prompts for the "component installation directory". Piping a newline into the script didn't help; it fails with `Error: failed to get SDK path: failed to read input: EOF`, leaving "Vega CLI not set up" (exit 1).
- **Resolution**: The SDK content itself had already downloaded (6 GB under `~/vega/sdk/vega-sdk`). Running the underlying command directly with its own flag worked: `vega sdk config setup --non-interactive`. Also note: the installer never writes the documented `~/vega/env` env-file; we hand-wrote it (`KEPLER_SDK_PATH` + PATH).
- **Suggested fix**: honor `NONINTERACTIVE` end-to-end (the flag covers the download but not the setup step), and print `--non-interactive` in the banner.
- **Impact**: 15 min of debugging + risk of abandoning install thinking it failed.

## 2. Sample repo pins an exact SDK patch version that differs from the installed one

- **Tool**: `AmazonAppDev/react-native-multi-tv-helloworld`, `vega-sdk-requirements.json`
- **What happened**: Repo pins `0.24.9914`; the installer gives `0.24.12112` (newest 0.24 patch). `react-native build-kepler` fails with "SDK version main@0.24.9914 is not installed" even though a compatible SDK is present.
- **Resolution**: Edited `vega-sdk-requirements.json` to `0.24.12112`; build then succeeded. Patch-level tolerance should be allowed (0.24.x ↔ 0.24.x).
- **Suggested fix**: treat patch versions within a minor line as compatible by default (or provide a `--sdk any-0.24` flag).
- **Impact**: blocks every newcomer who installs "latest" and clones a "sample".

## 3. Yarn 4 via Corepack impossible when Node is in a root-owned prefix

- **Tool**: Node 24 (system install in `/usr/local`), Corepack, yarn 4.5.0 (pinned by sample's `packageManager`)
- **What happened**: `corepack enable` fails (writes shims to root-owned `/usr/local/bin`); `npm i -g yarn` fails the same way. `yarn 1.22.22` (classic) refuses to run because `packageManager: yarn@4.5.0` is set.
- **Resolution**: `npm config set prefix ~/.npm-global`, install yarn there, then `corepack enable --install-directory ~/.npm-global/bin` — corepack then reads the project's `packageManager` and activates 4.5.0 automatically.
- **Suggested fix**: none needed for Amazon, but the sample README could mention non-sudo workstations.
- **Impact**: ~20 min.

## 4. No built-in way to screenshot/capture the Virtual Device

- **Tool**: Vega SDK (`vda`, VVD), VVD
- **What happened**: The documented `gwsi-tool-screenshooter` doesn't work on virtual devices (vvrp only), and VVD offers no built-in screen capture. This makes "show the app running" (a hackathon requirement for the demo video) and even basic visual debugging hard.
- **Workarounds found**:
  - Fullscreen `screencapture -x` from macOS works but captures whatever is frontmost; the VVD window cannot be raised programmatically without Accessibility permission (System Events fails with `-1719`).
  - `screencapture -x -l <windowID>` captures the VVD even when it's behind other windows — but obtaining the CGWindowID is the hard part: `osascript` JXA segfaults, Apple `swift` single-file scripts fail with a broken CommandLineTools modulemap, and pyobjc isn't installed. A ~70-line Python `ctypes` wrapper around `CGWindowListCopyWindowInfo` finally worked.
- **Suggested fix**: ship an official `vega virtual-device screenshot --out file.png` command (or make the existing screenshooter work on vvrp). This is the single biggest dev-experience gap we hit.
- **Impact**: ~45 min, plus a recurring tax on every visual iteration.

## 5. Offline documentation DB (buildertools MCP) is temp-dir hosted and got purged

- **Tool**: `@amazon-devices/amazon-devices-buildertools-mcp` (offline Vega docs)
- **What happened**: The docs SQLite DB lives under `$TMPDIR/opencode/...` and was wiped during disk cleanup mid-session; all research had to be redone from the npm packages' own READMEs/type definitions.
- **Resolution**: extracted API contracts directly from installed `.d.ts` files (`@amazon-devices/react-native-w3cmedia`, `@strands-agents/sdk`) — actually faster and more accurate than the docs.
- **Suggested fix**: allow configuring a persistent docs DB location.
- **Impact**: ~10 min.

## 6. App launches then is SIGQUIT-killed by the ANR watchdog (~2s after foreground)

- **Tool**: Vega app runtime (stemd/lcm), our vpkg
- **What happened**: `vega run-app` reports "Successfully launched", the app foregrounds, then goes background ~1.6 s later. `loggingctl log` shows `acr_core_dump: Process 'com.directorscut.app' crashed with signal 3 … Custom reason: AppNotResponding` (ANR watchdog SIGQUIT). No JS error is surfaced in any log — the failure is silent from a developer's perspective.
- **Diagnosis path**: bisect the UI (strip to static Text → add components back one at a time).
- **Status**: root-caused the next morning — see entry #13 for the full chain (LCM "Creating surfaces" transition timeout → SIGQUIT) and the bisect that pinned it to the w3cmedia native module injection on RN 0.83.
- **Suggested fix**: (a) surface ANR reasons in `loggingctl` with the blocking stack, (b) a `vega run-app --console` mode that streams the app's stdout/stderr to the terminal like `adb logcat`.
- **Impact**: active; blocking further visual progress at time of writing.

## 7. `vega run-app` does a full uninstall + reinstall on every launch

- **Tool**: `vega run-app`, pkgmgrd
- **What happened**: Every `run-app` enqueues an uninstall of the same package id and reinstalls (log: `Uninstalling package 'com.directorscut.app' … then installed`), even when the vpkg hash is unchanged. Reinstalls are slower than a no-op launch would be, and leave misleading "Failed to fsync … Input/Output error" noise.
- **Suggested fix**: skip reinstall when digest matches, or offer `vega run-app --skip-install`.
- **Impact**: ~10–15 s per launch × dozens of launches during a hackathon.

## 8. Misleading launch-log noise (system stems exit 255 constantly)

- **Tool**: stemd
- **What happened**: Every launch shows several unrelated background components (`com.amazon.iap.core.AppLifecycleTaskHandler`, `com.amazon.adep.nimh`) spawning and immediately exiting with `exit_code=255`. When your own app also dies, these look like the cause.
- **Resolution**: learned to filter by component id / family (`react_native_kepler_4` stem for RN apps).
- **Suggested fix**: suppress or clearly tag expected-failure background tasks in the default log stream.
- **Impact**: ~20 min of misdirected debugging.

## 9. Public-domain demo content: Google's classic sample bucket now 403s

- **Tool**: Big Buck Bunny MP4 (commondatastorage.googleapis.com / storage.googleapis.com "gtv-videos-bucket")
- **What happened**: The canonical test-media URLs return HTTP 403 in 2026. Archive.org still serves the same film (CC-BY).
- **Resolution**: downloaded `big_buck_bunny_720p_surround.mp4` (61 MB) from archive.org and serve it locally from our AI engine (`/media/…` over the VVD's host gateway `10.0.2.2`), which also makes the demo network-independent and DRM-free.
- **Impact**: 10 min.

## 10. Strands SDK — no runnable "mock provider" shipped

- **Tool**: `@strands-agents/sdk` 1.22.0 (TypeScript)
- **What happened**: The SDK's model layer is great, but there's no offline/deterministic provider out of the box; if you have no Bedrock quota (new AWS accounts frequently have all Bedrock quotas = 0, non-adjustable) you cannot run the docs' quickstart at all.
- **Resolution**: implemented `MockModel extends Model` (emits `modelMessageStartEvent` → `modelContentBlockDeltaEvent{textDelta}` → `modelMessageStopEvent`) — ~90 lines — and wired the same Agent (with `structuredOutputSchema`) over either provider. Bedrock is a one-flag swap (`STRANDS_BEDROCK=1`).
- **Suggested fix**: ship a `MockModel` (or document the streaming contract with a custom-provider recipe) — huge for offline dev, CI, and classrooms.
- **Impact**: ~1 h.

## 11. React Native on Vega: TV input API is undocumented in the main docs

- **Tool**: `@amazon-devices/react-native-kepler` 4.0 (RN 0.83 fork)
- **What happened**: `useTVEventHandler`/`TVEventHandler` and `HWEvent` exist in the fork (`Libraries/TV/`) but are effectively undocumented; the docs we could reach cover WebView key handling, not RN. Also `HWEvent` uses `eventType` (not `evtType`), discovered only from `.d.ts`.
- **Resolution**: read the fork's source; use `import {useTVEventHandler} from '@amazon-devices/react-native-kepler'` with `evt.eventType` ∈ {up,down,left,right,select,back,playpause,…}.
- **Suggested fix**: add an "input events for RN apps on Vega" doc with the event enum table.
- **Impact**: ~30 min.

## 12. Swift one-file scripts broken on a stock Mac (Command Line Tools)

- **Tool**: macOS CommandLineTools (`swift` driver 6.1.2)
- **What happened**: `swift file.swift` fails with `redefinition of module 'SwiftBridging'` — known CLT bug, breaks an otherwise-obvious path for listing CGWindows.
- **Resolution**: Python `ctypes` (see #4).
- **Impact**: 15 min.

## 13. The "app launches but nothing appears" mystery — ANR from surface-creation timeout, invisible to the developer

- **Tool**: Vega runtime (lcm_service, stemd, acr_core_dump), VVD, RN app
- **What happened** (the day's biggest rabbit hole): `vega run-app` reported success and platform logs showed the app reaching all the right states (`Trigger event START in state LAUNCHED`, `Trigger event FOREGROUND in state READY. Completed: true`, display context created on display[0], input-focus session transferred to our pid) — yet **the screen stayed on the launcher**, and ~16–20 s later the app died silently. Screenshots matched the launcher; nothing ever rendered; no JS error, no stderr, no console output anywhere.
- **Diagnosis path**: bisected the whole app down to a *static Text-only UI* (still failed) → captured a full live `loggingctl log -f` during a launcher tile-click launch → finally found the one line that explains everything, buried in `lcm_service` info logs:
  ```
  lcm-transition-monitor:[TransitionMonitor.cpp:68] Transition timed out - appInst[N](com.directorscut.app.main): Creating surfaces
  lcm-server:[Lcm.cpp:7269] Forcefully terminating process N with reason AppNotResponding
  acr_core_dump: Process 'com.directorscut.app' crashed with signal 3  (SIGQUIT)
  ```
  The LCM waits ~16 s for the app process to create its compositor surfaces ("Creating surfaces" state), then ANR-kills it with SIGQUIT and hands the display back to the launcher. The same ANR fingerprint had been in yesterday's logs (`Custom reason: AppNotResponding`, `Toolkit-UI_3`) but looked like an unrelated red herring next to always-failing background system stems.
- **Resolution steps that worked while we dug**:
  1. Isolated the *method of launch*: launching by clicking the app tile with remote keys (`vda shell "inputd-cli button_press KEY_ENTER"`) goes through the normal launcher flow — `run-app`'s own foreground transition is NOT what the screen shows. Useful for demo recording.
  2. Bisect tree established a clean data set: (a) pristine sample identity + static UI → **works**; (b) renamed ids (`com.directorscut.app.*`) + static UI → **works**; (c) rename + `@amazon-devices/react-native-w3cmedia@2.3.2` → **hangs**; (d) rename + `2.3.2-rn-83` (the RN-0.83-specific build) → **hangs**. So the rename was innocent — the w3cmedia native module injection is the trigger.
  3. Added the *documented* `[wants]` services/privileges block (media.server, playersession, audiobuffer, mediatransform, audio.*, accessibility privilege, `[offers] gipc`) + the documented babel `useTransformReactJSXExperimental`/`runtime: automatic` config → still hangs. (These changes are correct per docs and kept.)
- **Root-cause (external confirmation)**: community bug reports describe the identical failure chain on RN 0.83 / SDK 0.24 — `Transition timed out ... Creating surfaces` → `Forcefully terminating with reason AppNotResponding`, plus a verified deadlock in `libkeplerscript-runtime-loader-4` for media/player-service START; "the identical application code plays video correctly on RN 0.72 under both SDK 0.22 and SDK 0.24… A media app currently has no working configuration on RN 0.83."
- **Suggested fix**: (a) the surface-creation ANR should log WHY a stem didn't create surfaces (which module init blocked); the current product surfaces zero diagnostics — we had to correlate three log subsystems by timestamp; (b) actually ship the RN-0.83 media stack or pin the "which RN version works with which runtime" matrix in the docs.
- **Impact**: ~4 hours so far; killed the entire media feature branch twice over. Pivot: generate the RN-0.72 template alongside (RN 0.72 + w3cmedia is community-verified working on SDK 0.24).

## 14. VVD doesn't survive overnight suspension; system state decays between sessions

- **Tool**: `vega virtual-device`, VVD
- **What happened**: After the machine sat overnight, `vega virtual-device status` reported `running:false` but `vda` still claimed a connected device then flip-flopped (`vda: no devices/emulators found` after restart), the window CGWindowID changed from 128 to **511** and the default window size changed (1160×568 vs 1452×704 the day before) — every capture/launch script needs reviving. On-device background services also misbehave after cold starts (community + our own logs: `lcm_service` transition timeouts, stale launcher tiles for already-uninstalled packages — the "App could not be determined" tile).
- **Resolution**: scripted a `virtual-device stop && start` + re-read of the window ID via our ctypes script before any capture; treat stale launcher tiles as ignorable; preload AI engine on the host after every VVD restart (it also dies from nightly tmp cleanup).
- **Suggested fix**: a `vega virtual-device doctor` that KNOWS when its state is stale ("vda daemon linked to a dead QEMU") instead of returning a live-looking port.
- **Impact**: ~30 min every morning session; repeated friction across days.

## 15. `pkill -f` self-matching is a booby trap in scripted sessions

- **Tool**: macOS/POSIX shell tooling (ours), used in Vega launch scripts
- **What happened**: `pkill -f "loggingctl log -f"` in a compound command killed *our own shell* first (the pattern matched the compound command's own argument list), silently aborting the remaining commands — including the screenshot. Lost at least one capture cycle chasing this.
- **Resolution**: store the follow-stream PID in a file and `kill $(cat /tmp/*.pid)` instead of pattern-matching.
- **Impact**: ~10 min + a second repeat occurrence.

## 16. Workspaces stalled mid-sleep: host-side utilities vanish with nightly disk cleanup

- **Tool**: dev environment (macOS `$TMPDIR` cleanup), our helper scripts
- **What happened**: Helper scripts stored in `$TMPDIR` (the ctypes window finder) and background processes (the AI engine on :8788) disappeared overnight; on-device media URLs then failed even though "nothing changed".
- **Resolution**: recreate; also keep canonical copies in the repo (`vega_wininfo.py`) and a `curl localhost:8788/health` preflight before any demo capture.
- **Impact**: ~15 min per session, before we added preflights.

---

## 17. npm install-scripts security gate + Amazon CLI unquoted-path bug both hit in one install

- **Tool**: npm (installer-scripts security model), Amazon's `vega project generate` / `react-native build-vega`
- **What happened**:
  1. `npm install` in the fresh RN 0.72 template silently skipped the `@amazon-devices/react-native-kepler` postinstall (`./scripts/kepler/postinstall.sh`) due to npm's new `npm warn install-scripts` allowlist gate; the build later produced subtle breakage potential, and `fsevents` needed approving too. Nothing *failed loudly* — another silent-skip trap.
  2. Any Amazon CLI subcommand executed inside a project path containing a space (`/Users/Coding/Documents/Fire TV skill/directorscut72`) died with `/bin/sh: /Users/Coding/Documents/Fire: No such file or directory` — their internal tooling shells out without quoting `$PWD`.
- **Resolution**: `npm install-scripts approve <pkg>` (+ `npm rebuild`) for the kepler postinstall; **moved the whole project to a space-free path** (`~/Code/directorscut72`) because patching Amazon's quoting was out of reach.
- **Suggested fix**: (a) approval-skip messages should be prominent errors when a package's postinstall feeds a build system, not a trailing `npm warn`; (b) quote shell invocations inside the CLI.
- **Impact**: ~35 min (incl. a clean `rm -rf node_modules` + reinstall after the move).

## 18. w3cmedia never wires a mount-time `src` prop — video silently never starts

- **Tool**: `@amazon-devices/react-native-w3cmedia` 2.3.2 (RN 0.72 build)
- **What happened**: A `<Video src={url} autoplay>` rendered fine (surface, captions view mounted, `MediaPlayer: play resolved` native logs!) but `currentTime` stayed 0.0 forever, no `loadedmetadata`/`canplay`, and no error surfaced — the app *looked* healthy while showing a black pane. Reading the bundled `Video.js` source (the true ground truth, since the device runs the **prebuilt SystemBundle**, not the dist) revealed it: `componentDidUpdate` only assigns `super.src = props.src` **when the src prop TRANSITIONS between renders** — an initial mount-time `src` is never propagated to the underlying MediaPlayer at all. Autoplay then plays an *empty* player → `MEDIA_ERR_SRC_NOT_SUPPORTED` ("Empty URL not supported") → `waiting`, all conveyed to the app via events nobody reads.
- **Resolution**: flip the src post-mount via the documented `onComponentDidMount` callback + state change → triggers the `componentDidUpdate` src-prop transition... which *still* never reached `MediaPlayer.set src` on-device ("Src URL" never logged). **Final fix: set `src` imperatively through the component ref** (`videoRef.current.src = url`) — the ref path is fully wired and works.
- **Suggested fix**: apply mount-time `src` in `componentDidMount`, or emit the error visibly; a silent black pane is the worst possible debugging surface.
- **Impact**: ~2.5 h across the deploy/bisect/bundle-audit loop; discovered via our on-screen marker HUD (kept as a permanent debug feature).

## 19. Vega OS blocks cleartext HTTP *for the media pipeline only* — and `file://` too, on VVD

- **Tool**: Vega media stack (MPB — `atv::native::mpb`), VVD 0.24.12112, our Strands engine on `http://10.0.2.2:8788`
- **What happened**: After fixing #18, `MediaPlayer.set src` finally ran → native pipeline built → `MPB UNF callback: Creating URL MediaSource → opening... → Open failed -1` → `set_src_uri: MPB Call failed with code: 50004` → user-visible error = bare `MEDIA_ERR_SRC_NOT_SUPPORTED (code 4)` with an **empty message**. Crucially the open failed in ~2 ms *without a single packet reaching the host engine* — instantaneous platform refusal, not a network failure.
- **Root cause (external confirmation)**: Amazon staff in the Amazon Developer Community (2026-02): **"HTTP cleartext traffic is blocked by default on Vega OS (Android-based security policy)"** — the *official* `vega-video-sample` reproduces this with local-network `http` videos. Our own device-side probes confirmed the corollaries: `curl` (app sandbox) reaches `10.0.2.2` fine, but all public HTTPS connects as `000`/`403` (netsim proxy shadows egress), and MPB also rejected `file:///tmp/bbb.mp4` (same 50004; error message: literally `"Error Occurred."`).
- **Resolution**: **MSE (MediaSource Extensions)** — the one standards path where MPB never opens a URL. The w3cmedia library ships the full MSE API (MediaSource/SourceBuffer/appendBuffer). The app fetches merged (fragmented-MP4) bytes with ordinary JS `fetch` (NOT subject to the media-pipeline block) and feeds MPB through `SourceBuffer.appendBuffer`. Range-request chunking (1.2 MB per append, fastify serves byte ranges) keeps JS heap flat for the full 61 MB movie. See #20 for the blob-URL landmine.
- **Suggested fix**: (a) the platform error for policy-blocked schemes must name the scheme ("cleartext http blocked by platform policy"), not "Error Occurred." with an empty MediaError message; (b) an official VVD-support matrix for media transport schemes; (c) allow `file://` for app-packaged media on VVD (the demo story for every hackathon team lives or dies on this).
- **Impact**: ~2 h to isolate (native log chain) + the pivot strategy; but it also became our favorite finding: the app now works fully **offline-capable via MSE** at any scale.

## 20. The blob-url slice bug: `blob:///id` must carry a query suffix or MSE silently never attaches

- **Tool**: w3cmedia internal (`MediaPlayer.setSrcWithCustomHeaders`), discovered while wiring #19's MSE path
- **What happened**: `new MediaSource()` + `video.src = 'blob:///${ms.id}'` produced the error log `invalid media source!!!` on every attach. Cause: MediaPlayer parses the id with `url.indexOf('?')` then `url.slice(prefixLen, endIndex)` — with no `?` in the URL, `indexOf` returns **-1**, `slice(…, -1)` drops the *last character* of the id string, `parseInt('')` → NaN → the `GlobalMediaSources` lookup misses → the pipeline returns **silently** (no srcObject attach, no error event, engine keeps chugging on a dead player).
- **Resolution**: always synthesize the blob address with a query (`blob:///1?offset=0`). After that: `addSourceBuffer('video/mp4; codecs="avc1.42E01E, mp4a.40.2"')` → chunked `appendBuffer` → `endOfStream()` → `play()` — **full 10-minute Big Buck Bunny with audio playing on VVD**, captions synced from the SRT timeline, AI trivia firing per cue.
- **Suggested fix**: `slice(prefixLen, endIndex === -1 ? undefined : endIndex)` in `setSrcWithCustomHeaders`, plus a console.error when the lookup misses rather than a bare return.
- **Impact**: 20 min to pinpoint once the log line surfaced (the previous video plot armor made this one fun rather than painful). Lesson: **read the library source before trusting any RTL-level integration.**

## 21. GitHub's new-repo form: invisible submit feedback and undiscoverable visibility control (via agent-driven browser)

- **Tool**: GitHub repo-creation UI (`github.com/new`) driven by an agent browser (ego-browser) during submission
- **What happened**: On the redesigned form (2026) the visibility control is a segmented button widget: DOM queries for `input[type=radio]` and aria-labelled visibility buttons return **empty**, and the "Choose visibility: Public" button exposes no `aria-pressed`/`role=radio`, so the agent could not confirm selection state before submitting. Clicking the form's real submit button then appeared to do **nothing** (URL still `github.com/new?…`) — no flash error, no inline validation — so three more click/typing fix attempts piled on, and one (keyboard auto-typing into the description field) ate spaces around punctuation (`-demos`, `Strands-AItrivia`).
- **Resolution**: the very first submit had actually navigated (the URL check was simply read before the SPA re-render completed). Confirming by polling `document.title`/`document.body.innerText` (repo page shows "directors-cut-vega / Public") rather than trusting `page.url()` alone fixed all doubt; the description was rewritten with a clear-then-fill API to purge the type-glitched text.
- **Suggested fix**: (a) give the segmented control real form semantics (`role=radiogroup`, `aria-pressed` or proper radios), (b) render a blocking inline validation/flash when repo creation fails, and (c) don't leave form-success indistinguishable from a no-op click.
- **Impact**: ~25 min of agent-browser round-trips plus one mangled description before the repo was confirmed created — the classic SPA "did-it-submit?" ambiguity.

1. **Vega CLI installer**: `NONINTERACTIVE=true` doesn't cover the final config-setup prompt (entry #1).
2. **build-kepler**: exact-patch SDK pinning blocks latest-SDK users (entry #2).
3. **VVD**: no screenshot/capture tooling; official screenshooter doesn't support virtual devices (entry #4).
4. **VVD runtime / LCM**: "Creating surfaces" ANR kills are invisible; app stdout/stderr unreachable; the only failing diagnostic is a single `Transition timed out` info line (entry #6, #13). **RN 0.83 media playback: reported working RN 0.72 + w3cmedia path; needs the RN-version/runtime matrix shipped.**
5. **vega run-app**: full uninstall+reinstall per launch (entry #7).
6. **Logging UX**: unrelated 255-exiting system stems make crash diagnosis misleading (entry #8).
7. **Strands SDK**: needs an official deterministic mock provider + custom-provider docs (entry #10).
8. **RN-on-Vega docs**: TV input events for RN apps are undocumented (entry #11).
9. **VVD lifecycle**: stale/undead state after long suspension; stale launcher tiles for uninstalled packages (entry #14).
10. **Media setup docs**: `[wants]` services and the babel JSX transform for w3cmedia are required but appear in a separate doc page, not the API docs users follow first (entry #13).
11. **w3cmedia library**: mount-time `src` prop never wired to the player (silent black pane); blob-url parse drops a char when no query suffix is present (entries #18, #20).
12. **Platform media policy**: cleartext `http` and `file://` both fail MPB with empty error messages and no docs; MSE is undocumented as the escape hatch (entry #19).
13. **GitHub repo-creation form** (agent-driven): segmented visibility control with no form semantics, a submit-success indistinguishable from a no-op click, and keyboard typing that eats spaces around punctuation (entry #21).
