/**
 * Director's Cut — WatchPartyScreen (Vega RN 0.72 port)
 *
 * Layout avoids overlaying the native video surface entirely (z-order above
 * KeplerVideoSurfaceView is lost once the surface activates on this platform):
 *
 *   ┌────────────────────────────┬──────────────────────┐
 *   │                            │  CAPTION TICKER      │
 *   │        VIDEO SURFACE       ├──────────────────────┤
 *   │      (Big Buck Bunny)      │  AI TRIVIA PANEL     │
 *   │                            │  (up/down + select)  │
 *   ├────────────────────────────┴──────────────────────┤
 *   │  WATCH PARTY BOTS (scores)                        │
 *   └───────────────────────────────────────────────────┘
 */

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useTVEventHandler} from '@amazon-devices/react-native-kepler';
import {Video} from '@amazon-devices/react-native-w3cmedia';
import type {Video as VideoComponent} from '@amazon-devices/react-native-w3cmedia';
import {parseSrt, captionAt, recentCaptions} from '../lib/captions';
import type {Caption} from '../lib/captions';
import {fetchTrivia} from '../lib/ai';
import type {TriviaQuestion} from '../lib/ai';
import {localTrivia} from '../lib/local-trivia';
import {playFmp4ViaMse} from '../lib/mse-player';

const MEDIA_HOSTS = ['http://10.0.2.2:8788', 'http://localhost:8788'];
// Vega OS blocks cleartext HTTP for the native media pipeline (platform policy,
// confirmed by Amazon in the dev community 2026-02) — the MPB open fails with
// code 50004 / MEDIA_ERR_SRC_NOT_SUPPORTED before any request is made. App-JS
// fetch is NOT subject to this. Workaround: pull the file into the device
// filesystem (file:// is accepted by MPB) and serve captions via the engine.
const VIDEO_URL = 'file:///tmp/bbb.mp4';
const FALLBACK_VIDEO_URL = 'file:///tmp/bbb.mp4';
const MP4_FMP4_PATH = '/media/bbb_fmp4_full.mp4';
const VIDEO_PATH = '/media/big_buck_bunny_720p.mp4';
const CAPTIONS_PATH = '/media/big-buck-bunny.srt';
const MOVIE_TITLE = 'Big Buck Bunny (2008)';

const BOTS = [
  {name: 'Rascal', avatar: '🐿️'},
  {name: 'Frank', avatar: '😈'},
  {name: 'Gimera', avatar: '🐀'},
];

interface Bot {
  name: string;
  avatar: string;
}
function firstAvailableMediaUrl(): string {
  return `${MEDIA_HOSTS[0]}${VIDEO_PATH}`;
}

export const WatchPartyScreen = () => {
  const videoRef = useRef<VideoComponent>(null);
  const [playing, setPlaying] = useState(true);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [srcUrl, setSrcUrl] = useState('');
  const [dbg, setDbg] = useState('boot');
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [currentCaption, setCurrentCaption] = useState<Caption | undefined>(undefined);
  const [question, setQuestion] = useState<TriviaQuestion | undefined>(undefined);
  const [questionLoading, setQuestionLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [answeredIdx, setAnsweredIdx] = useState<number | undefined>(undefined);
  const [userScore, setUserScore] = useState(0);
  const [botScores, setBotScores] = useState<Record<string, number>>({Rascal: 0, Frank: 0, Gimera: 0});
  const lastCueKey = useRef<string>('');
  const retiredRef = useRef(false);
  const markersRef = useRef<string[]>([]);
  const pushMarker = useCallback((m: string) => {
    /* once MSE playback is properly running, retire the breadcrumb trail so the
       final demo screen stays clean — the friction log preserved the journey */
    if (m === 'playing' && !retiredRef.current) {
      retiredRef.current = true;
      setTimeout(() => {
        markersRef.current = ['mse ✅'];
      }, 15000);
    }
    markersRef.current = [...markersRef.current.slice(-4), m];
    setDbg(`${(playheadMs / 1000).toFixed(1)}s | ${markersRef.current.join(' |')}`);
  }, [playheadMs]);

  /* Load captions once */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const host of MEDIA_HOSTS) {
        try {
          const res = await fetch(`${host}${CAPTIONS_PATH}`);
          if (res.ok && !cancelled) {
            setCaptions(parseSrt(await res.text()));
            return;
          }
        } catch {}
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* Poll playhead; advance caption + cued trivia */
  useEffect(() => {
    const timer = setInterval(() => {
      const v = videoRef.current as unknown as {currentTime?: number; error?: {code?: number; message?: string} | null} | null;
      if (v && typeof v.currentTime === 'number') {
        const ms = Math.round(v.currentTime * 1000);
        setPlayheadMs(ms);
        const err = v.error ? `ERR${v.error.code ?? '?'}:${(v.error.message ?? '').slice(0, 24)}` : 'noerr';
        setDbg(`t=${(ms / 1000).toFixed(1)}s caps=${captions.length} ${err} | ${markersRef.current.join(' |')}`);
      } else if (v) {
        setDbg(`ref-ok no-time caps=${captions.length} | ${markersRef.current.join(' |')}`);
      } else {
        setDbg(`no-ref caps=${captions.length} | ${markersRef.current.join(' |')}`);
      }
    }, 400);
    return () => clearInterval(timer);
  }, [captions.length]);

  useEffect(() => {
    const cap = captionAt(captions, playheadMs);
    setCurrentCaption(prev => (prev?.text === cap?.text ? prev : cap));
  }, [playheadMs, captions]);

  /* Ask the AI engine when a new caption cue starts */
  useEffect(() => {
    const key = currentCaption ? `${currentCaption.startMs}` : '';
    if (!key || key === lastCueKey.current || playheadMs < 3000) {
      return;
    }
    lastCueKey.current = key;
    setQuestionLoading(true);
    setAnsweredIdx(undefined);
    setSelectedIdx(0);
    (async () => {
      let q: TriviaQuestion | undefined;
      try {
        q = await fetchTrivia({
          movieTitle: MOVIE_TITLE,
          playheadMs,
          recentLines: recentCaptions(captions, playheadMs, 6),
        });
      } catch {
        q = localTrivia({playheadMs, recentLines: recentCaptions(captions, playheadMs, 6), movieTitle: MOVIE_TITLE});
      }
      if (q) {
        setQuestion(q);
        botsAnswer(q);
      }
      setQuestionLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCaption]);

  /* Fake watch-party bots: Rascal is sharp, Gimera is solid, Frank is the chaos agent */
  const botsAnswer = (q: TriviaQuestion) => {
    const odds: Record<string, number> = {Rascal: 0.75, Frank: 0.25, Gimera: 0.65};
    const updates: Record<string, number> = {};
    BOTS.forEach(bot => {
      const roll = ((q.playheadMs + bot.name.length * 997) % 100) / 100;
      updates[bot.name] = roll < odds[bot.name] ? 100 : 0;
    });
    setTimeout(() => setBotScores(prev => {
      const next = {...prev};
      Object.entries(updates).forEach(([k, v]) => (next[k] = prev[k] + v));
      return next;
    }), 2200);
  };

  const togglePlay = useCallback(() => {
    const v = videoRef.current as unknown as {play?: () => void; pause?: () => void} | null;
    if (!v) return;
    if (playing) {
      v.pause?.();
      setPlaying(false);
    } else {
      v.play?.();
      setPlaying(true);
    }
  }, [playing]);

  /* Src rescue: prop-transition wiring never reaches MediaPlayer.set src on this
     build (verified: 'Src URL' never logged), so set it imperatively via the ref.
     Primary path: MSE (Vega blocks cleartext http + file:// for MPB).
     Fallback: file:///tmp/bbb.mp4 (if MSE stack is missing). */
  useEffect(() => {
    if (!srcUrl) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const v = videoRef.current as unknown as {
        src?: string; play?: () => void; pause?: () => void; paused?: boolean;
      } | null;
      if (!v || cancelled) return;
      try {
        await playFmp4ViaMse(v as never, `${MEDIA_HOSTS[0]}${MP4_FMP4_PATH}`, (step, detail) =>
          pushMarker(`${step}${detail ? ':' + detail : ''}`),
        );
      } catch (e) {
        pushMarker(`mse-throw:${(e as Error)?.message?.slice(0, 28) ?? '?'}`.slice(0, 48));
        try {
          v.src = FALLBACK_VIDEO_URL;
          pushMarker('file-fallback');
        } catch (e2) {
          pushMarker(`file-throw:${(e2 as Error)?.message?.slice(0, 20) ?? '?'}`.slice(0, 44));
        }
        setTimeout(() => {
          const v2 = videoRef.current as unknown as {play?: () => void; paused?: boolean} | null;
          if (v2 && v2.paused) {
            v2.play?.();
            pushMarker('post-play');
          }
        }, 1200);
      }
    }, 1600);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [srcUrl]);

  const submitAnswer = useCallback(() => {
    if (!question || answeredIdx !== undefined) return;
    setAnsweredIdx(selectedIdx);
    if (selectedIdx === question.answerIndex) {
      setUserScore(s => s + 100);
    }
  }, [question, answeredIdx, selectedIdx]);

  /* Remote keys */
  const onTVEvent = useCallback(
    (evt: {eventType: string}) => {
      pushMarker(`key:${evt.eventType}`);
      if (!question || answeredIdx !== undefined) {
        if (evt.eventType === 'playpause') togglePlay();
        return;
      }
      switch (evt.eventType) {
        case 'up':
          setSelectedIdx(i => (i + question.options.length - 1) % question.options.length);
          break;
        case 'down':
          setSelectedIdx(i => (i + 1) % question.options.length);
          break;
        case 'select':
        case 'enter':
          submitAnswer();
          break;
        case 'playpause':
          togglePlay();
          break;
        default:
          break;
      }
    },
    [question, answeredIdx, selectedIdx, submitAnswer, togglePlay],
  );
  useTVEventHandler(onTVEvent);

  const progressPct = Math.min(100, (playheadMs / 600_000) * 100);

  return (
    <View style={styles.root}>
      {/* top row: video + right column */}
      <View style={styles.topRow}>
        <View style={styles.videoPane}>
          <Video
            ref={videoRef}
            src={srcUrl || undefined}
            autoplay
            loop
            scalingmode="fit"
            width={1280}
            height={720}
            onComponentDidMount={() => {
              pushMarker('surface-mounted');
              setSrcUrl(VIDEO_URL);
            }}
            onLoadedMetadata={() => pushMarker('loadedmetadata')}
            onCanPlay={() => pushMarker('canplay')}
            onPlaying={() => pushMarker('playing')}
            onWaiting={() => pushMarker('waiting')}
            onStalled={() => pushMarker('stalled')}
            onError={() => {
              const err = videoRef.current?.error;
              pushMarker(`ERROR:code${err?.code ?? '?'}:${(err?.message ?? 'unknown').slice(0, 30)}`);
            }}
            style={styles.video}
          />
          {!playing && (
            <View style={styles.pausedBadge} pointerEvents="none">
              <Text style={styles.pausedText}>⏸ paused</Text>
            </View>
          )}
        </View>

        <View style={styles.chatPane}>
          <View style={styles.captionsBox}>
            <Text style={styles.boxLabel}>CC · synced captions</Text>
            <Text style={styles.captionText}>
              {currentCaption ? currentCaption.text : 'Captions will appear as the movie plays…'}
            </Text>
            <Text style={styles.dbgText} numberOfLines={1}>
              {dbg}
            </Text>
          </View>

          <View style={styles.triviaBox}>
            <Text style={styles.boxLabel}>🎬 Director's Cut AI</Text>
            {questionLoading && <Text style={styles.aiStatus}>AI is watching the scene…</Text>}
            {!questionLoading && !question && (
              <Text style={styles.aiStatus}>Waiting for the movie to reach a juicy moment…</Text>
            )}
            {!questionLoading && question && (
              <View>
                <Text style={styles.sceneLabel}>{question.sceneLabel}</Text>
                <Text style={styles.questionText}>{question.question}</Text>
                {question.options.map((opt, i) => {
                  const isAnswer = i === question.answerIndex;
                  const isSelected = i === selectedIdx;
                  const revealed = answeredIdx !== undefined;
                  let bg = '#1b2330';
                  if (revealed && isAnswer) bg = '#1d4023';
                  else if (revealed && isSelected) bg = '#401d1d';
                  else if (isSelected) bg = '#24304a';
                  return (
                    <Text key={i} style={[styles.option, {backgroundColor: bg}]}>
                      {isSelected ? '▸ ' : '  '}
                      {opt}
                      {revealed && isAnswer ? ' ✓' : ''}
                    </Text>
                  );
                })}
                {answeredIdx !== undefined && (
                  <Text style={styles.explanation} numberOfLines={2}>
                    {answeredIdx === question.answerIndex ? '✅ +100! ' : '❌ '}
                    {question.explanation}
                  </Text>
                )}
              </View>
            )}
          </View>
        </View>
      </View>

      {/* bottom row: party */}
      <View style={styles.partyRow}>
        <Text style={styles.you}>You · {userScore}</Text>
        {BOTS.map(b => (
          <Text key={b.name} style={styles.bot}>
            {b.avatar} {b.name} · {botScores[b.name]}
          </Text>
        ))}
        <View style={styles.progressWrap}>
          <View style={[styles.progressFill, {width: `${progressPct}%`}]} />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#0b0e14', paddingTop: 4, paddingBottom: 4, paddingHorizontal: 8},
  topRow: {flex: 11, flexDirection: 'row'},
  videoPane: {flex: 7, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center'},
  video: {width: '100%', aspectRatio: 16 / 9},
  pausedBadge: {position: 'absolute', left: 12, bottom: 10},
  pausedText: {color: '#ffd77a', backgroundColor: '#00000099', paddingVertical: 2, paddingHorizontal: 8, borderRadius: 6},
  chatPane: {flex: 4, paddingLeft: 10},
  captionsBox: {backgroundColor: '#11161f', borderRadius: 10, padding: 10, marginBottom: 10},
  boxLabel: {color: '#67839f', fontSize: 13, marginBottom: 6},
  captionText: {color: '#ffe8b0', fontSize: 17, lineHeight: 24},
  dbgText: {color: '#5a7186', fontSize: 11, marginTop: 4},
  triviaBox: {flex: 1, backgroundColor: '#11161f', borderRadius: 10, padding: 10},
  aiStatus: {color: '#8aa3bd', fontSize: 15},
  sceneLabel: {color: '#7ee2a8', fontSize: 13, marginBottom: 4},
  questionText: {color: '#ffffff', fontSize: 17, fontWeight: 'bold', marginBottom: 8},
  option: {color: '#dbe7f3', fontSize: 15, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 8, marginBottom: 4},
  explanation: {color: '#8aa3bd', fontSize: 13, marginTop: 4},
  partyRow: {flex: 1.4, flexDirection: 'row', alignItems: 'center', paddingLeft: 6},
  you: {color: '#ffd77a', fontSize: 16, fontWeight: 'bold', marginRight: 18},
  bot: {color: '#9fb4c8', fontSize: 16, marginRight: 16},
  progressWrap: {flex: 1, height: 6, backgroundColor: '#1b2330', borderRadius: 3, marginLeft: 8},
  progressFill: {height: 6, backgroundColor: '#ff6b3d', borderRadius: 3},
});
