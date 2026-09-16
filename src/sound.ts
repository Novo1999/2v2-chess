/**
 * Move, capture and check sounds.
 *
 * Synthesised with Web Audio instead of shipped as recordings: the familiar
 * board sounds from the big chess sites are their own non-free assets, so this
 * builds a wooden knock from scratch — a sliver of band-passed noise for the
 * click of wood on wood, and a short falling tone for the hollow body of the
 * board. A check adds a bright two-note ping over the knock, so it is heard as
 * a warning without looking. Nothing to license, nothing to download, and it
 * plays instantly.
 *
 * To use recordings instead, put `move.mp3`, `capture.mp3` and `check.mp3` in
 * `public/sounds/`. They are picked up automatically when present.
 */

export type MoveSound = 'move' | 'capture' | 'check';

const MUTE_KEY = 'consultation-chess:muted';

interface Voice {
  /** Offsets of each tap. A capture is a piece knocking a piece, then the board. */
  taps: number[];
  band: number;
  q: number;
  body: number;
  gain: number;
  decay: number;
  /** A pitched ping over the knock, one note per partial, rising. */
  ping?: { partials: number[]; gain: number; decay: number };
}

const VOICES: Record<MoveSound, Voice> = {
  move: { taps: [0], band: 1500, q: 1.4, body: 150, gain: 0.55, decay: 0.055 },
  capture: { taps: [0, 0.03], band: 2300, q: 1.1, body: 185, gain: 0.8, decay: 0.07 },
  check: {
    taps: [0],
    band: 1900,
    q: 1.3,
    body: 170,
    gain: 0.65,
    decay: 0.06,
    ping: { partials: [1175, 1760], gain: 0.16, decay: 0.32 },
  },
};

const noiseByContext = new WeakMap<BaseAudioContext, AudioBuffer>();

/** A fixed noise sample, seeded, so every knock has the same grain. */
function noiseBuffer(ac: BaseAudioContext): AudioBuffer {
  let buffer = noiseByContext.get(ac);
  if (!buffer) {
    buffer = ac.createBuffer(1, Math.ceil(ac.sampleRate * 0.12), ac.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 0x2f6b4d1;
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = seed / 0x80000000 - 1;
    }
    noiseByContext.set(ac, buffer);
  }
  return buffer;
}

/** An envelope with a 2ms attack, so the knock is crisp without a digital pop. */
function envelope(ac: BaseAudioContext, at: number, level: number, decay: number): GainNode {
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.linearRampToValueAtTime(level, at + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + decay);
  return gain;
}

/**
 * Schedule one synthesised sound. Exported so it can be rendered offline and
 * measured in a test, which is the closest a test gets to listening.
 */
export function scheduleKnock(
  ac: BaseAudioContext,
  out: AudioNode,
  at: number,
  kind: MoveSound,
): void {
  const voice = VOICES[kind];
  voice.taps.forEach((offset, i) => {
    const t = at + offset;
    const level = voice.gain * (i === 0 ? 1 : 0.6);

    const click = ac.createBufferSource();
    click.buffer = noiseBuffer(ac);
    const band = ac.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = voice.band;
    band.Q.value = voice.q;
    click.connect(band).connect(envelope(ac, t, level, voice.decay)).connect(out);
    click.start(t);
    click.stop(t + voice.decay + 0.01);

    const body = ac.createOscillator();
    body.type = 'sine';
    body.frequency.setValueAtTime(voice.body * 1.6, t);
    body.frequency.exponentialRampToValueAtTime(voice.body, t + 0.03);
    body.connect(envelope(ac, t, level * 0.7, voice.decay * 1.4)).connect(out);
    body.start(t);
    body.stop(t + voice.decay * 1.4 + 0.01);
  });

  voice.ping?.partials.forEach((freq, i) => {
    const { gain, decay } = voice.ping!;
    // Each note a beat after the last: a quick rising "ding-ding".
    const t = at + 0.012 + i * 0.07;
    const tone = ac.createOscillator();
    tone.type = 'triangle';
    tone.frequency.value = freq;
    tone.connect(envelope(ac, t, gain, decay)).connect(out);
    tone.start(t);
    tone.stop(t + decay + 0.01);
  });
}

// ---------------------------------------------------------------------------

let context: AudioContext | null = null;
const recordings = new Map<MoveSound, AudioBuffer | null>();

function audio(): AudioContext | null {
  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') {
    return null;
  }
  context ??= new AudioContext();
  return context;
}

async function loadRecording(ac: AudioContext, kind: MoveSound): Promise<void> {
  if (recordings.has(kind)) return;
  recordings.set(kind, null);
  try {
    const res = await fetch(`/sounds/${kind}.mp3`);
    // Firebase Hosting and the Vite dev server both answer an unknown path with
    // index.html and a 200, so the status alone proves nothing — the content
    // type is what says a recording is really there.
    if (res.ok && res.headers.get('content-type')?.startsWith('audio/')) {
      recordings.set(kind, await ac.decodeAudioData(await res.arrayBuffer()));
    }
  } catch {
    /* no recording; the synthesised sound is used */
  }
}

/**
 * Browsers keep audio suspended until the page has been interacted with. Every
 * player clicks something — a seat, a square — before a move sound matters, so
 * the first gesture unlocks audio and warms up any recordings.
 */
export function unlockAudioOnFirstGesture(): void {
  if (typeof window === 'undefined') return;
  const unlock = () => {
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    const ac = audio();
    if (!ac) return;
    void ac.resume();
    void loadRecording(ac, 'move');
    void loadRecording(ac, 'capture');
    void loadRecording(ac, 'check');
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

export function isMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    /* the preference just will not persist */
  }
}

export function playMoveSound(kind: MoveSound): void {
  if (isMuted()) return;
  const ac = audio();
  if (!ac) return;

  const requested = performance.now();
  const play = () => {
    // A resume that only succeeds on some much later click must not replay a
    // stale move sound at that moment.
    if (performance.now() - requested > 300) return;
    const recording = recordings.get(kind);
    if (recording) {
      const source = ac.createBufferSource();
      source.buffer = recording;
      source.connect(ac.destination);
      source.start();
    } else {
      scheduleKnock(ac, ac.destination, ac.currentTime + 0.005, kind);
    }
  };

  if (ac.state === 'running') play();
  else void ac.resume().then(play, () => {});
}
