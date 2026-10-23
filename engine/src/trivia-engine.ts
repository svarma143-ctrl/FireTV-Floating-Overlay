/**
 * Director's Cut — deterministic trivia engine.
 *
 * The "AI" in mock mode: hashes the playhead into scene buckets, reads the
 * recent caption lines for context, and selects/produces a themed question
 * from a curated director's-commentary question bank for Big Buck Bunny.
 * Output is fully deterministic for a given (playheadMs, recentLines) pair,
 * so demos rewind and replay identically.
 */

export interface TriviaRequest {
  movieTitle?: string;
  playheadMs: number;
  recentLines?: string[];
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
  source: 'strands-mock';
}

/** Scene buckets for Big Buck Bunny (blend of public knowledge + caption cues). */
const SCENES: { startMs: number; label: string; cue: RegExp }[] = [
  { startMs: 0, label: 'Opening — a peach and a butterfly', cue: /peach|morning|wings|butterfl/i },
  { startMs: 30_000, label: 'Frank, Rascal and Gimera scout the forest', cue: /rodent|squirrel|frank|rascal|gimera|laugh/i },
  { startMs: 120_000, label: 'The third rodent appears', cue: /third|gang|bull/i },
  { startMs: 180_000, label: 'Bunny wakes up — butterfly encounter', cue: /bunny|wake|butterfl|flower/i },
  { startMs: 240_000, label: 'Bunny prepares for revenge', cue: /trap|revenge|plan|wood/i },
  { startMs: 320_000, label: 'The ambush among the trees', cue: /ambush|arrow|trap|scream|fall/i },
  { startMs: 420_000, label: 'Frank the rodent boss fights back', cue: /frank|attack|boss|chase/i },
  { startMs: 540_000, label: 'The Baboon — final duel', cue: /baboon|fight|final|duel/i },
  { startMs: 640_000, label: 'Sundance scene — credits', cue: /credit|dance|sundance|ending/i },
];

function sceneAt(ms: number, recentLines: string[]): { label: string; index: number } {
  let best = 0;
  let bestIdx = 0;
  const text = recentLines.join(' ');
  for (let i = SCENES.length - 1; i >= 0; i--) {
    if (ms >= SCENES[i].startMs) {
      if (best === 0) {
        best = i;
        bestIdx = i;
      }
      // Capture-line cue matching can refine the guess inside the same window.
      if (SCENES[i].cue.test(text)) {
        bestIdx = i;
        break;
      }
    }
  }
  return { label: SCENES[bestIdx].label, index: bestIdx };
}

/** Curated director's-commentary question bank, one per scene bucket (multiple per bucket). */
const BANK: Record<number, { question: string; options: [string, string, string, string]; answerIndex: number; explanation: string }[]> = {
  0: [
    {
      question: "Which studio created Big Buck Bunny?",
      options: ["Blender Foundation", "Pixar", "Studio Ghibli", "DreamWorks"],
      answerIndex: 0,
      explanation: "Big Buck Bunny (2008) was made by Sacha Goedegebure and the Blender Foundation as an open movie.",
    },
    {
      question: "Big Buck Bunny was released under which license?",
      options: ["Proprietary", "Creative Commons Attribution 3.0", "GPL for video only", "No license"],
      answerIndex: 1,
      explanation: "The film is CC-BY 3.0: anyone may reuse the footage, even commercially.",
    },
  ],
  1: [
    {
      question: "What do Frank, Rascal and Gimera first test on the butterfly?",
      options: ["Water", "Rocks", "Acorns", "Seeds"],
      answerIndex: 2,
      explanation: "The rodents torment the butterfly by throwing acorns — the first act of graphic cruelty in the film.",
    },
  ],
  2: [
    {
      question: "Who does the third rodent get ready to ambush?",
      options: ["A tortoise", "Bunny", "A bird", "A deer"],
      answerIndex: 1,
      explanation: "Frank, Rascal and Gimera are plotting against the big rabbit — Bunny.",
    },
  ],
  3: [
    {
      question: "What wakes Bunny up and lands on his nose?",
      options: ["A bird", "A petal", "A butterfly", "A leaf"],
      answerIndex: 2,
      explanation: "The butterfly, freshly tortured by the rodents, rests on Bunny's nose before blinking away.",
    },
  ],
  4: [
    {
      question: "What does Bunny carve secretly in his tree?",
      options: ["A slingshot", "A bow and arrow", "A wooden trap mechanism", "A net"],
      answerIndex: 2,
      explanation: "Bunny builds a wooden trap mechanism in his tree — payback time.",
    },
  ],
  5: [
    {
      question: "The rodents' traps fired acorns at Bunny — where do the identical traps show up next?",
      options: ["Their own paths home", "On top of the peach tree", "At the credits", "Right behind Bunny"],
      answerIndex: 0,
      explanation: "Bunny re-rigs the rodents' own prank traps — classic poetic justice.",
    },
  ],
  6: [
    {
      question: "Which rodent takes charge of the gang?",
      options: ["Frank", "Rascal", "Gimera", "The Baboon"],
      answerIndex: 0,
      explanation: "Frank is the gang leader who dreams up the traps.",
    },
  ],
  8: [
    {
      question: "Which bigger antagonist faces Bunny at the end?",
      options: ["A bear", "A baboon", "A wolf", "A moose"],
      answerIndex: 1,
      explanation: "A giant baboon is the closing antagonist on Bunny's path to Sundance.",
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

export function generateTrivia(req: TriviaRequest): TriviaQuestion {
  const playheadMs = Math.max(0, Math.floor(req.playheadMs || 0));
  const recentLines = Array.isArray(req.recentLines) ? req.recentLines.filter((l) => typeof l === 'string') : [];
  const { label, index } = sceneAt(playheadMs, recentLines);
  const pool = BANK[index] ?? BANK[0] ?? [
    {
      question: "Which studio created Big Buck Bunny?",
      options: ["Blender Foundation", "Pixar", "Studio Ghibli", "DreamWorks"],
      answerIndex: 0,
      explanation: "Big Buck Bunny (2008) was created by the Blender Foundation.",
    },
  ];

  const hash = hashString(`${playheadMs}|${recentLines.join('|')}|${label}`);
  const q = pool[hash % pool.length];

  return {
    id: `dc-${playheadMs}-${hash}`,
    movieTitle: req.movieTitle || 'Big Buck Bunny',
    playheadMs,
    sceneLabel: label,
    question: q.question,
    options: q.options,
    answerIndex: q.answerIndex,
    explanation: q.explanation,
    source: 'strands-mock',
  };
}
