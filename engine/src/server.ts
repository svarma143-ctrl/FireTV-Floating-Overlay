/**
 * Director's Cut AI Engine.
 *
 * Fastify server: a Strands Agent (https://github.com/strands-agents) wraps the
 * question generation; the TV app calls it at `http://10.0.2.2:8788/trivia`.
 *
 * Model providers:
 *  - default: MockModel (deterministic, zero-cost, always works)
 *  - opt-in:  BedrockModel via STRANDS_BEDROCK=1 + AWS_BEDROCK_MODEL (AWS SDK will
 *             resolve credentials from env/default chain)
 */
import { Agent, BedrockModel, Message, type ModelStreamEvent } from '@strands-agents/sdk';
import { z } from 'zod';
import fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { MockModel } from './mock-model.js';
import { generateTrivia, type TriviaQuestion } from './trivia-engine.js';
import { existsSync, statSync, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8788);
const USE_BEDROCK = process.env.STRANDS_BEDROCK === '1';

const TriviaSchema = z.object({
  movieTitle: z.string(),
  sceneLabel: z.string(),
  playheadMs: z.number(),
  question: z.string().describe('One engaging, family-friendly trivia question about the scene'),
  options: z.array(z.string()).length(4).describe('Four answer options, one correct'),
  answerIndex: z.number().min(0).max(3),
  explanation: z.string(),
});

/** System prompt: the "AI director" persona. */
const SYSTEM_PROMPT = `You are "The Director", the AI host of a family-friendly watch-party trivia game.
You live inside a Fire TV app called Director's Cut alongside the movie Big Buck Bunny (2008, Blender Foundation, CC-BY).
Given the viewer's current playhead (in ms), the scene label, and the most recent subtitle/caption lines,
produce ONE trivia question connecting what the viewer just watched to the film's production or story facts.
Keep it playful, family-friendly, and accurate to Big Buck Bunny lore. Answer JSON only.`;

function makeAgent(): { agent: Agent; providerLabel: string } {
  if (USE_BEDROCK) {
    const modelId = process.env.AWS_BEDROCK_MODEL ?? 'us.anthropic.claude-3-5-haiku-20241022-v1:0';
    const bedrock = new BedrockModel({ modelId });
    return { agent: new Agent({ model: bedrock, systemPrompt: SYSTEM_PROMPT, structuredOutputSchema: TriviaSchema }), providerLabel: `bedrock:${modelId}` };
  }
  return {
    agent: new Agent({ model: new MockModel(), systemPrompt: SYSTEM_PROMPT, structuredOutputSchema: TriviaSchema }),
    providerLabel: 'strands-mock:deterministic',
  };
}

const built = makeAgent();
let agent = built.agent;
let providerLabel = built.providerLabel;

/* --------------------------- HTTP server --------------------------- */

const app = fastify({ logger: false });

app.register(fastifyStatic, {
  root: path.resolve(__dirname, '..', 'media'),
  prefix: '/media/',
});

app.get('/health', async () => ({
  ok: true,
  engine: "Director's Cut AI",
  provider: providerLabel,
  bedrockOptIn: USE_BEDROCK,
}));

app.post('/trivia', async (request, reply) => {
  const body = request.body as { playheadMs?: number; recentLines?: string[]; movieTitle?: string };
  const playheadMs = Math.max(0, Math.floor(Number(body.playheadMs ?? 0)));
  const recentLines = Array.isArray(body.recentLines) ? body.recentLines : [];

  const fallback: TriviaQuestion = generateTrivia({ playheadMs, recentLines, movieTitle: body.movieTitle });

  if (USE_BEDROCK) {
    try {
      const prompt = JSON.stringify({
        instructions: 'Ask one family-friendly trivia question about this exact moment in Big Buck Bunny.',
        movieTitle: body.movieTitle ?? 'Big Buck Bunny',
        playheadMs,
        sceneHint: fallback.sceneLabel,
        recentCaptionLines: recentLines.slice(-6),
        requiredFormat: 'JSON with movieTitle, sceneLabel, playheadMs, question, options[4], answerIndex, explanation',
      });
      const result = await agent.invoke(prompt);
      const structured = result.structuredOutput as TriviaQuestion | undefined;
      if (structured && typeof structured.question === 'string') {
        return { ...structured, playheadMs, id: `dc-b${playheadMs}`, source: 'strands-bedrock' };
      }
    } catch (err) {
      app.log.warn(`Bedrock agent failed, using mock: ${err}`);
    }
  }

  // Mock path is determinstic and instant — still routed through the Strands Agent.
  if (!USE_BEDROCK) {
    const prompt = JSON.stringify({ playheadMs, recentCaptionLines: recentLines.slice(-6), movieTitle: body.movieTitle ?? 'Big Buck Bunny' });
    try {
      const result = await agent.invoke(prompt);
      const structured = result.structuredOutput as TriviaQuestion;
      if (structured && typeof structured.question === 'string') {
        return { ...structured, playheadMs, id: `dc-b${playheadMs}`, source: providerLabel };
      }
    } catch (err) {
      app.log.warn(`Strands agent failed, pure fallback: ${err}`);
    }
  }

  return fallback;
});

app.listen({ port: PORT, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
