/**
 * Director's Cut — in-app trivia fallback.
 *
 * Mirrors the ai-engine's deterministic generator in case the Strands engine
 * is unreachable (e.g. engine not started in standalone demos). Contents are
 * family-friendly and specific to Big Buck Bunny (2008, Blender Foundation).
 */

import type { TriviaQuestion } from './ai';

interface BankEntry {
  question: string;
  options: [string, string, string, string];
  answerIndex: number;
  explanation: string;
}

const SCENES: { startMs: number; label: string }[] = [
  { startMs: 0, label: 'Opening — a peach and a butterfly' },
  { startMs: 30_000, label: 'Frank, Rascal and Gimera scout the forest' },
  { startMs: 120_000, label: 'The rodents plan the ambush' },
  { startMs: 180_000, label: 'Bunny wakes up' },
  { startMs: 240_000, label: 'Bunny prepares for revenge' },
  { startMs: 320_000, label: 'The traps fire' },
  { startMs: 420_000, label: 'Frank fights back' },
  { startMs: 540_000, label: 'The final duel' },
  { startMs: 640_000, label: 'Sundance — credits' },
];

const BANK: Record<number, BankEntry[]> = {
  0: [
    {
      question: 'Which studio created Big Buck Bunny?',
      options: ['Blender Foundation', 'Pixar', 'Studio Ghibli', 'DreamWorks'],
      answerIndex: 0,
      explanation: 'Big Buck Bunny (2008) was directed by Sacha Goedegebure at the Blender Foundation.',
    },
  ],
  1: [
    {
      question: 'Which rodent is the gang leader in Big Buck Bunny?',
      options: ['Frank', 'Rascal', 'Gimera', 'The baboon'],
      answerIndex: 0,
      explanation: 'Frank is the bearded gang boss; the trio torments the butterfly early on.',
    },
  ],
  4: [
    {
      question: 'What does Bunny build in his tree before revenge?',
      options: ['A slingshot', 'A wooden trap mechanism', 'A net', 'A catapult'],
      answerIndex: 1,
      explanation: 'Bunny rigs the rodents\' own prank traps back at them.',
    },
  ],
  6: [
    {
      question: 'Film fact: Big Buck Bunny was released under which license?',
      options: ['Proprietary', 'CC-BY 3.0', 'No license', 'Commercial only'],
      answerIndex: 1,
      explanation: 'The film is Creative Commons Attribution 3.0.',
    },
  ],
};

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function localTrivia(req: { playheadMs: number; recentLines: string[]; movieTitle?: string }): TriviaQuestion {
  const playheadMs = Math.max(0, Math.floor(req.playheadMs || 0));
  let index = 0;
  for (let i = SCENES.length - 1; i >= 0; i--) {
    if (playheadMs >= SCENES[i].startMs) {
      index = i;
      break;
    }
  }
  const sceneLabel = SCENES[index].label;
  const pool = BANK[index] ?? BANK[0] ?? BANK[4] ?? Object.values(BANK)[0];
  const hash = hashString(`${playheadMs}|${req.recentLines.join('|')}`);
  const q = pool[hash % pool.length];

  return {
    id: `dc-local-${playheadMs}-${hash}`,
    movieTitle: req.movieTitle ?? 'Big Buck Bunny',
    playheadMs,
    sceneLabel,
    question: q.question,
    options: q.options,
    answerIndex: q.answerIndex,
    explanation: q.explanation,
    source: 'fallback-local',
  };
}
