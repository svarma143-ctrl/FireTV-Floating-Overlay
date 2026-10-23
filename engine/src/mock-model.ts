/**
 * Director's Cut AI Engine — deterministic mock model provider for Strands SDK.
 *
 * Implements the Strands `Model` interface so the Agent talks to a scripted,
 * fully deterministic "director" instead of a live Bedrock model. This keeps the
 * demo reproducible and zero-cost. Swapping in `BedrockModel` is a one-line
 * change once Bedrock quota is available on the AWS account (see server.ts).
 */
import type {
  BaseModelConfig,
  CountTokensOptions,
  Message,
  ModelStreamEvent,
  StopReason,
  StreamOptions,
} from '@strands-agents/sdk';
import { Model } from '@strands-agents/sdk';
import {
  ModelMessageStartEvent,
  ModelContentBlockStartEvent,
  ModelContentBlockDeltaEvent,
  ModelContentBlockStopEvent,
  ModelMessageStopEvent,
  ModelMetadataEvent,
} from '@strands-agents/sdk';
import { generateTrivia, type TriviaRequest } from './trivia-engine.js';

export interface MockModelConfig extends BaseModelConfig {
  modelId: string;
}

/** Emits the given text as a complete Strands-style streaming message. */
async function* emitText(text: string): AsyncGenerator<ModelStreamEvent> {
  yield new ModelMessageStartEvent({ type: 'modelMessageStartEvent', role: 'assistant' });
  yield new ModelContentBlockStartEvent({ type: 'modelContentBlockStartEvent' });

  // Stream in small chunks to emulate token-level streaming.
  const chunkSize = 24;
  for (let i = 0; i < text.length; i += chunkSize) {
    yield new ModelContentBlockDeltaEvent({
      type: 'modelContentBlockDeltaEvent',
      delta: { type: 'textDelta', text: text.slice(i, i + chunkSize) },
    });
  }

  yield new ModelContentBlockStopEvent({ type: 'modelContentBlockStopEvent' });
  yield new ModelMessageStopEvent({ type: 'modelMessageStopEvent', stopReason: 'endTurn' as StopReason });
  yield new ModelMetadataEvent({
    type: 'modelMetadataEvent',
    usage: { inputTokens: 0, outputTokens: text.length, totalTokens: text.length },
    metrics: { latencyMs: 4 },
  });
}

export class MockModel extends Model<MockModelConfig> {
  private _config: MockModelConfig;

  constructor(config: Partial<MockModelConfig> = {}) {
    super();
    this._config = { modelId: 'directors-cut-deterministic-mock-v1', ...config };
  }

  updateConfig(modelConfig: MockModelConfig): void {
    this._config = { ...this._config, ...modelConfig };
  }

  getConfig(): MockModelConfig {
    return this._config;
  }

  async *stream(messages: Message[], options?: StreamOptions): AsyncGenerator<ModelStreamEvent> {
    // Pull the user turn's text out of the message list.
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    let promptText = '';
    if (lastUser) {
      for (const block of lastUser.content) {
        const data = (block as unknown as { toJSON?: () => { text?: string } }).toJSON;
        const json = typeof data === 'function' ? data.call(block) : (block as { text?: string });
        if (json && typeof json.text === 'string') promptText += json.text;
      }
    }

    let request: TriviaRequest;
    try {
      request = JSON.parse(promptText) as TriviaRequest;
    } catch {
      request = { playheadMs: 0, recentLines: [], movieTitle: 'Big Buck Bunny' };
    }

    const trivia = generateTrivia(request);
    yield* emitText(JSON.stringify(trivia));
  }

  async countTokens(messages: Message[], _options?: CountTokensOptions): Promise<number> {
    return 10 * messages.length;
  }
}
