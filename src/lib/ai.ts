/**
 * Director's Cut — AI engine client.
 *
 * Talks to the Strands-based ai-engine (default host inside the VVD is 10.0.2.2,
 * the QEMU host gateway; localhost works on physical devices / direct launches).
 * If the engine is unreachable the caller falls back to the bundled
 * deterministic generator so the demo NEVER breaks on screen.
 */

export interface TriviaRequest {
  movieTitle?: string;
  playheadMs: number;
  recentLines: string[];
}

export interface TriviaQuestion {
  id: string;
  movieTitle: string;
  playheadMs: number;
  sceneLabel: string;
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
  source: string;
}

const ENGINE_HOSTS = ['http://10.0.2.2:8788', 'http://localhost:8788'];

export async function fetchTrivia(req: TriviaRequest, timeoutMs = 2500): Promise<TriviaQuestion> {
  let lastError: unknown = null;
  for (const host of ENGINE_HOSTS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(`${host}/trivia`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          movieTitle: req.movieTitle,
          playheadMs: req.playheadMs,
          recentLines: req.recentLines,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const json = (await res.json()) as TriviaQuestion;
        if (json && typeof json.question === 'string' && Array.isArray(json.options)) {
          return json;
        }
      }
    } catch (err) {
      lastError = err;
    }
  }
  void lastError;
  throw new Error('AI engine unreachable');
}

export async function fetchCaptions(reasoner: () => Promise<string>): Promise<string> {
  return reasoner();
}
