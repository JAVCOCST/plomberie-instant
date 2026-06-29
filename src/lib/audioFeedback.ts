let sharedAudioCtx: AudioContext | null = null;
let unlocked = false;

export const WHOOSH_DURATION_SECONDS = 1.8;

type WindowWithWebkitAudio = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

const getAudioContext = (): AudioContext | null => {
  try {
    if (typeof window === 'undefined') return null;
    const Ctx = window.AudioContext || (window as WindowWithWebkitAudio).webkitAudioContext;
    if (!Ctx) return null;
    if (!sharedAudioCtx) {
      sharedAudioCtx = new Ctx({ latencyHint: 'interactive' });
    }
    return sharedAudioCtx;
  } catch {
    return null;
  }
};

// ============================================================================
// PRE-ALLOCATED WHOOSH GRAPH
// Stratégie iOS PWA: créer TOUS les oscillateurs au pointerdown (user gesture
// fiable), les démarrer immédiatement avec gain=0, puis "ouvrir" le master gain
// plus tard. Pas de création de node dans pointermove (qui n'est pas un user
// gesture en PWA standalone).
// ============================================================================

type WhooshGraph = {
  ctx: AudioContext;
  master: GainNode;
  sub: OscillatorNode;
  subGain: GainNode;
  harm: OscillatorNode;
  harmGain: GainNode;
  noise: AudioBufferSourceNode;
  noiseGain: GainNode;
  lp: BiquadFilterNode;
  presence: OscillatorNode;
  presenceGain: GainNode;
  ping: OscillatorNode;
  pingGain: GainNode;
};

let pendingWhoosh: WhooshGraph | null = null;

const teardownWhoosh = (g: WhooshGraph | null) => {
  if (!g) return;
  const safeStop = (n: AudioScheduledSourceNode) => { try { n.stop(); } catch { /* ignore */ } };
  const safeDisc = (n: AudioNode) => { try { n.disconnect(); } catch { /* ignore */ } };
  safeStop(g.sub); safeStop(g.harm); safeStop(g.noise); safeStop(g.presence); safeStop(g.ping);
  safeDisc(g.subGain); safeDisc(g.harmGain); safeDisc(g.noiseGain); safeDisc(g.lp);
  safeDisc(g.presenceGain); safeDisc(g.pingGain); safeDisc(g.master);
};

/**
 * À appeler dans pointerdown (user gesture iOS PWA garanti).
 * - Resume le contexte
 * - Joue un tick audible court (débloque iOS)
 * - PRÉ-CRÉE tout le graphe whoosh, démarre les oscillateurs avec gain=0
 *   pour qu'ils soient prêts à être déclenchés depuis n'importe où ensuite.
 */
export const primeAudioInGesture = (): boolean => {
  const ctx = getAudioContext();
  if (!ctx) return false;

  try {
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    try { ctx.destination.channelCount = 1; } catch { /* ignore */ }

    // Tick audible court — confirme l'unlock à iOS PWA
    const t = ctx.currentTime;
    const tick = ctx.createOscillator();
    const tickGain = ctx.createGain();
    tick.type = 'triangle';
    tick.frequency.setValueAtTime(1000, t);
    tickGain.gain.setValueAtTime(0.0001, t);
    tickGain.gain.exponentialRampToValueAtTime(0.05, t + 0.005);
    tickGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    tick.connect(tickGain).connect(ctx.destination);
    tick.start(t);
    tick.stop(t + 0.07);

    // Si un whoosh pending existe déjà (ré-entrée), on le garde
    if (pendingWhoosh && pendingWhoosh.ctx === ctx) {
      unlocked = ctx.state === 'running';
      return true;
    }

    teardownWhoosh(pendingWhoosh);

    // Pré-création complète du graphe whoosh, oscillateurs démarrés à gain=0
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, t);
    master.connect(ctx.destination);

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(40, t);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.0001, t);
    sub.connect(subGain).connect(master);

    const harm = ctx.createOscillator();
    harm.type = 'sine';
    harm.frequency.setValueAtTime(80, t);
    const harmGain = ctx.createGain();
    harmGain.gain.setValueAtTime(0.0001, t);
    harm.connect(harmGain).connect(master);

    const sr = ctx.sampleRate;
    const buf = ctx.createBuffer(1, Math.floor(sr * (WHOOSH_DURATION_SECONDS + 0.5)), sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.5;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(180, t);
    lp.Q.value = 0.7;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.0001, t);
    noise.connect(lp).connect(noiseGain).connect(master);

    const presence = ctx.createOscillator();
    presence.type = 'triangle';
    presence.frequency.setValueAtTime(220, t);
    const presenceGain = ctx.createGain();
    presenceGain.gain.setValueAtTime(0.0001, t);
    presence.connect(presenceGain).connect(master);

    const ping = ctx.createOscillator();
    ping.type = 'sine';
    ping.frequency.setValueAtTime(880, t);
    const pingGain = ctx.createGain();
    pingGain.gain.setValueAtTime(0.0001, t);
    ping.connect(pingGain).connect(master);

    // DÉMARRAGE IMMÉDIAT dans le user gesture — c'est la clé.
    sub.start(t);
    harm.start(t);
    noise.start(t);
    presence.start(t);
    ping.start(t);

    // Auto-stop dans 30s si jamais le whoosh n'est jamais joué
    const stopAt = t + 30;
    sub.stop(stopAt);
    harm.stop(stopAt);
    noise.stop(stopAt);
    presence.stop(stopAt);
    ping.stop(stopAt);

    pendingWhoosh = {
      ctx, master,
      sub, subGain, harm, harmGain,
      noise, noiseGain, lp,
      presence, presenceGain,
      ping, pingGain,
    };

    unlocked = ctx.state === 'running';
    return unlocked;
  } catch {
    return false;
  }
};

export const isAudioFeedbackUnlocked = () =>
  unlocked || sharedAudioCtx?.state === 'running';

// Backward-compat
export const unlockAudioFeedback = async (): Promise<AudioContext | null> => {
  const ctx = getAudioContext();
  if (!ctx) return null;
  try {
    if (ctx.state === 'suspended') await ctx.resume();
    unlocked = ctx.state === 'running';
  } catch { /* ignore */ }
  return ctx;
};

/**
 * Joue le whoosh. Si un graphe pré-créé existe, on module ses gains —
 * AUCUN nouveau node créé. Sinon (desktop, Safari normal), on en crée des frais.
 */
export const playWhooshFromGesture = (): boolean => {
  const ctx = getAudioContext();
  if (!ctx) return false;

  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }

  if (!pendingWhoosh || pendingWhoosh.ctx !== ctx) {
    return scheduleFreshWhoosh(ctx);
  }

  try {
    const g = pendingWhoosh;
    const t0 = ctx.currentTime + 0.01;
    const dur = WHOOSH_DURATION_SECONDS;

    // Master enveloppe
    g.master.gain.cancelScheduledValues(t0);
    g.master.gain.setValueAtTime(0.0001, t0);
    g.master.gain.exponentialRampToValueAtTime(1, t0 + 0.08);
    g.master.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    // Sub
    g.sub.frequency.cancelScheduledValues(t0);
    g.sub.frequency.setValueAtTime(40, t0);
    g.sub.frequency.linearRampToValueAtTime(55, t0 + dur);
    g.subGain.gain.cancelScheduledValues(t0);
    g.subGain.gain.setValueAtTime(0.0001, t0);
    g.subGain.gain.exponentialRampToValueAtTime(0.45, t0 + 0.4);
    g.subGain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    // Harm
    g.harm.frequency.cancelScheduledValues(t0);
    g.harm.frequency.setValueAtTime(80, t0);
    g.harm.frequency.linearRampToValueAtTime(110, t0 + dur);
    g.harmGain.gain.cancelScheduledValues(t0);
    g.harmGain.gain.setValueAtTime(0.0001, t0);
    g.harmGain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.5);
    g.harmGain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    // Noise sweep
    g.lp.frequency.cancelScheduledValues(t0);
    g.lp.frequency.setValueAtTime(180, t0);
    g.lp.frequency.exponentialRampToValueAtTime(400, t0 + dur * 0.6);
    g.noiseGain.gain.cancelScheduledValues(t0);
    g.noiseGain.gain.setValueAtTime(0.0001, t0);
    g.noiseGain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.3);
    g.noiseGain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    // Présence
    g.presence.frequency.cancelScheduledValues(t0);
    g.presence.frequency.setValueAtTime(220, t0);
    g.presence.frequency.exponentialRampToValueAtTime(520, t0 + dur * 0.55);
    g.presence.frequency.exponentialRampToValueAtTime(180, t0 + dur);
    g.presenceGain.gain.cancelScheduledValues(t0);
    g.presenceGain.gain.setValueAtTime(0.0001, t0);
    g.presenceGain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.08);
    g.presenceGain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    // Ping
    g.ping.frequency.cancelScheduledValues(t0 + 0.08);
    g.ping.frequency.setValueAtTime(880, t0 + 0.08);
    g.ping.frequency.exponentialRampToValueAtTime(1320, t0 + 0.32);
    g.pingGain.gain.cancelScheduledValues(t0 + 0.08);
    g.pingGain.gain.setValueAtTime(0.0001, t0 + 0.08);
    g.pingGain.gain.exponentialRampToValueAtTime(0.09, t0 + 0.14);
    g.pingGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.75);

    // Cleanup
    const cleanup = pendingWhoosh;
    pendingWhoosh = null;
    window.setTimeout(() => teardownWhoosh(cleanup), (dur + 0.3) * 1000);

    unlocked = true;
    return true;
  } catch {
    teardownWhoosh(pendingWhoosh);
    pendingWhoosh = null;
    return false;
  }
};

// Path "fresh" — desktop, Safari mobile normal, etc.
const scheduleFreshWhoosh = (ctx: AudioContext): boolean => {
  try {
    const t0 = ctx.currentTime + 0.01;
    const dur = WHOOSH_DURATION_SECONDS;

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(40, t0);
    sub.frequency.linearRampToValueAtTime(55, t0 + dur);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.0001, t0);
    subGain.gain.exponentialRampToValueAtTime(0.45, t0 + 0.4);
    subGain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    sub.connect(subGain).connect(ctx.destination);
    sub.start(t0); sub.stop(t0 + dur + 0.05);

    const harm = ctx.createOscillator();
    harm.type = 'sine';
    harm.frequency.setValueAtTime(80, t0);
    harm.frequency.linearRampToValueAtTime(110, t0 + dur);
    const harmGain = ctx.createGain();
    harmGain.gain.setValueAtTime(0.0001, t0);
    harmGain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.5);
    harmGain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    harm.connect(harmGain).connect(ctx.destination);
    harm.start(t0); harm.stop(t0 + dur + 0.05);

    const sr = ctx.sampleRate;
    const buf = ctx.createBuffer(1, Math.floor(sr * dur), sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.5;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(180, t0);
    lp.frequency.exponentialRampToValueAtTime(400, t0 + dur * 0.6);
    lp.Q.value = 0.7;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.0001, t0);
    noiseGain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.3);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    noise.connect(lp).connect(noiseGain).connect(ctx.destination);
    noise.start(t0); noise.stop(t0 + dur + 0.05);

    const presence = ctx.createOscillator();
    presence.type = 'triangle';
    presence.frequency.setValueAtTime(220, t0);
    presence.frequency.exponentialRampToValueAtTime(520, t0 + dur * 0.55);
    presence.frequency.exponentialRampToValueAtTime(180, t0 + dur);
    const presenceGain = ctx.createGain();
    presenceGain.gain.setValueAtTime(0.0001, t0);
    presenceGain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.08);
    presenceGain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    presence.connect(presenceGain).connect(ctx.destination);
    presence.start(t0); presence.stop(t0 + dur + 0.05);

    const ping = ctx.createOscillator();
    const pingGain = ctx.createGain();
    ping.type = 'sine';
    ping.frequency.setValueAtTime(880, t0 + 0.08);
    ping.frequency.exponentialRampToValueAtTime(1320, t0 + 0.32);
    pingGain.gain.setValueAtTime(0.0001, t0 + 0.08);
    pingGain.gain.exponentialRampToValueAtTime(0.09, t0 + 0.14);
    pingGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.75);
    ping.connect(pingGain).connect(ctx.destination);
    ping.start(t0 + 0.08); ping.stop(t0 + 0.8);

    unlocked = true;
    return true;
  } catch {
    return false;
  }
};

export const playWhoosh = async (): Promise<boolean> => {
  const ctx = await unlockAudioFeedback();
  if (!ctx || ctx.state !== 'running') return false;
  return scheduleFreshWhoosh(ctx);
};

// Petit tick swipe (optionnel)
export const playSwipeTick = (freq = 880, duration = 0.08, gain = 0.18): boolean => {
  const ctx = getAudioContext();
  if (!ctx || ctx.state !== 'running') return false;
  try {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.7, t + duration);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration + 0.02);
    return true;
  } catch {
    return false;
  }
};
