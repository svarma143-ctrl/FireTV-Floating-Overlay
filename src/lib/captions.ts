/**
 * Director's Cut — SRT caption parsing for the AI context and on-screen captions.
 */

export interface Caption {
  startMs: number;
  endMs: number;
  text: string;
}

function parseTimestamp(ts: string): number {
  const m = ts.trim().match(/^(\d+):(\d{1,2}):(\d{1,2})[,.](\d{1,3})$/);
  if (!m) return 0;
  return (
    Number(m[1]) * 3_600_000 + Number(m[2]) * 60_000 + Number(m[3]) * 1_000 + Number(m[4])
  );
}

export function parseSrt(srt: string): Caption[] {
  const normalized = srt.replace(/^\uFEFF/, '');
  const captions: Caption[] = [];
  const blocks = normalized.split(/\r?\n\r?\n/);
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length < 2) continue;
    const timeLineIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeLineIdx === -1) continue;
    const [startRaw, endRaw] = lines[timeLineIdx].split('-->');
    const startMs = parseTimestamp(startRaw);
    const endMs = parseTimestamp(endRaw);
    const text = lines.slice(timeLineIdx + 1).join('\n').trim();
    if (text) captions.push({ startMs, endMs, text });
  }
  return captions;
}

export function captionAt(captions: Caption[], ms: number): Caption | undefined {
  return captions.find((c) => ms >= c.startMs && ms <= c.endMs);
}

/** Most recent distinct caption texts up to `ms`. */
export function recentCaptions(captions: Caption[], ms: number, count = 6): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = captions.length - 1; i >= 0 && out.length < count; i--) {
    if (captions[i].startMs <= ms && !seen.has(captions[i].text)) {
      seen.add(captions[i].text);
      out.push(captions[i].text);
    }
  }
  return out.reverse();
}
