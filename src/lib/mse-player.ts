/**
 * Director's Cut — MSE (MediaSource Extensions) playback for Vega w3cmedia.
 *
 * Vega OS blocks cleartext http:// for the native media pipeline (platform
 * policy, confirmed by Amazon staff in the dev community, Feb 2026 — even the
 * official video sample hits MEDIA_ERR_SRC_NOT_SUPPORTED / MPB code 50004 with
 * "Open failed -1"). file:// is also rejected by MPB on the VVD 0.24 sim.
 *
 * Escape hatch: the w3cmedia library implements the W3C MediaSource API (see
 * its README section "Media Source Extension (MSE mode)"). We fetch the fMP4
 * bytes over app-JS fetch (NOT subject to the media-pipeline block), then feed
 * them to the player through MediaSource/SourceBuffer. MPB never opens a URL,
 * so the cleartext policy is never consulted.
 *
 * Usage pattern straight from the w3cmedia README (MSE section):
 *   1. const ms = new MediaSource();
 *   2. blob url: `blob:///${ms.id}`  (the lib parses this prefix and resolves
 *      the instance via GlobalMediaSources — it has no URL.createObjectURL,
 *      so we synthesize the address ourselves)
 *   3. video.src = blobUrl   (imperative — the prop-transition path never
 *      reaches MediaPlayer.set src on this build)
 *   4. const sb = ms.addSourceBuffer('video/mp4; codecs="avc1..., mp4a..."');
 *   5. sb.appendBuffer(bytes) x N   (sync call, may throw typed errors)
 *   6. ms.endOfStream(); video.play();
 *
 * `stepped` gives the caller a breadcrumb logger for the on-screen HUD.
 */

import {MediaSource} from '@amazon-devices/react-native-w3cmedia';
import type {SourceBuffer} from '@amazon-devices/react-native-w3cmedia';

export type MseLogger = (step: string, detail?: string) => void;

interface MseVideo {
  src: string;
  play?: () => void;
  pause?: () => void;
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const CHUNK = 1_200_000; // 1.2 MB per append — avoids native quota blowups

async function waitUntilOpen(ms: unknown, timeoutMs = 4000): Promise<boolean> {
  for (let i = 0; i < timeoutMs / 100; i++) {
    const state = String((ms as {readyState?: string}).readyState ?? '');
    if (state === 'open') return true;
    await sleep(100);
  }
  return false;
}

export async function playFmp4ViaMse(
  video: MseVideo,
  videoUrl: string,
  stepped: MseLogger,
): Promise<void> {
  stepped('mse-create');
  const ms = new (MediaSource as unknown as new () => unknown)() as {
    id: number;
    readyState?: string;
    addSourceBuffer?: (type: string) => SourceBuffer;
    endOfStream?: () => void;
    addEventListener?: (type: string, fn: (e: unknown) => void) => void;
  };

  // NOTE: MediaPlayer parses the id via url.indexOf('?') + slice — the query
  // suffix is REQUIRED ('blob:///1' would slice off the trailing char and
  // parseInt('') → NaN → "invalid media source!!!").
  const blobUrl = `blob:///${ms.id}?offset=0`;
  video.src = blobUrl;
  stepped('mse-setsrc', `id=${ms.id}`);

  const opened = await waitUntilOpen(ms);
  if (!opened) {
    throw new Error(`not open (.readyState=${String(ms.readyState)})`);
  }
  stepped('mse-open');

  const sb = ms.addSourceBuffer?.('video/mp4; codecs="avc1.42E01E, mp4a.40.2"');
  if (!sb) throw new Error('addSourceBuffer returned nothing');
  stepped('sb-added');

  const appended = sb as unknown as {
    appendBuffer: (d: Uint8Array) => void;
    updating?: boolean;
    addEventListener?: (t: string, f: () => void) => void;
    removeEventListener?: (t: string, f: () => void) => void;
  };

  /* Range-fetch + append in chunks (fastify serves byte ranges; app-JS fetch
     is not subject to the media-pipeline cleartext block). Memory stays flat
     because only one chunk ArrayBuffer lives at a time. */
  const head = await fetch(videoUrl, {method: 'HEAD'});
  const totalRaw = head.headers.get('content-length');
  const total = Number(totalRaw || '0');
  if (!total) throw new Error('no content-length (HEAD)');
  stepped('size', `${Math.round(total / 1_000_000)}MB`);

  const appendChunk = async (piece: Uint8Array): Promise<void> => {
    let thrown: unknown = null;
    try {
      appended.appendBuffer(piece);
    } catch (e) {
      thrown = e;
    }
    if (thrown && thrown !== null) {
      // one retry after a settling pause (native may briefly report pending)
      await sleep(400);
      appended.appendBuffer(piece);
    }
    // give the demuxer a beat; appendBuffer is sync but notifies native async
    await sleep(120);
  };

  let done = 0;
  let playing = false;
  while (done < total) {
    const end = Math.min(done + CHUNK, total);
    const res = await fetch(videoUrl, {
      headers: {Range: `bytes=${done}-${end - 1}`},
    });
    if (!res.ok && res.status !== 206) throw new Error(`fetch ${res.status} @${done}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    await appendChunk(bytes);
    done = end;
    if ((done / CHUNK) % 4 === 0 || done >= total) {
      stepped('append', `${Math.round((done / total) * 100)}%`);
    }
    /* start playback once a healthy prefix is buffered, keep filling after */
    if (!playing && done >= Math.min(total, CHUNK * 6)) {
      playing = true;
      stepped('early-play', `${Math.round((done / total) * 100)}%`);
      if ((video as {paused?: boolean}).paused !== false) {
        await video.play?.();
      }
    }
  }

  /* if we're only filling the tail of a seek-ish start, ensure play */
  if (!playing) {
    await video.play?.();
  }
  ms.endOfStream?.();
  stepped('mse-eos');
  stepped('mse-play');
}
