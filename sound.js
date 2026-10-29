/* Medieval sound effects for the Chronicle of Bohemia companion.
 * Everything is synthesised with the Web Audio API, so there are no audio files
 * to download. Mute state is remembered per browser.
 */
(function () {
  "use strict";

  const MUTE_KEY = "kcd2-companion-muted";
  let ctx = null;
  let master = null;
  let muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === "1"; } catch (e) { /* ignore */ }

  // Browsers only allow audio after a user gesture; every sound here follows a tap.
  function audio() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function tone({ freq, type = "sine", start = 0, dur = 0.3, vol = 0.3, attack = 0.005, filter, glideTo }) {
    const t = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = osc;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = filter;
      osc.connect(f);
      node = f;
    }
    node.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  function noise({ start = 0, dur = 0.2, vol = 0.2, from = 800, to = 3000, q = 1.2 }) {
    const t = ctx.currentTime + start;
    const len = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = q;
    bp.frequency.setValueAtTime(from, t);
    bp.frequency.exponentialRampToValueAtTime(to, t + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + dur * 0.3);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp);
    bp.connect(gain);
    gain.connect(master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  // A plucked lute-like note: bright attack, quick decay.
  const pluck = (freq, start, vol = 0.25) => {
    tone({ freq, type: "triangle", start, dur: 0.5, vol, filter: 2400 });
    tone({ freq: freq * 2, type: "sine", start, dur: 0.25, vol: vol * 0.3 });
  };

  // Brass-ish horn note for fanfares.
  const horn = (freq, start, dur, vol = 0.18) => {
    tone({ freq, type: "sawtooth", start, dur, vol, attack: 0.04, filter: 1400 });
    tone({ freq: freq * 1.003, type: "sawtooth", start, dur, vol: vol * 0.6, attack: 0.05, filter: 1200 });
  };

  // Church bell: inharmonic partials with a long decay.
  const bell = (freq, start = 0, vol = 0.22) => {
    [[1, 1], [2.0, 0.5], [2.4, 0.35], [3.0, 0.25], [4.2, 0.15]].forEach(([m, v]) =>
      tone({ freq: freq * m, type: "sine", start, dur: 2.4 / Math.sqrt(m), vol: vol * v, attack: 0.002 }));
  };

  const SOUNDS = {
    // card turning over: a papery swish
    flip: () => { noise({ dur: 0.18, vol: 0.25, from: 600, to: 4000 }); noise({ start: 0.12, dur: 0.12, vol: 0.12, from: 3000, to: 1200 }); },
    // Groschen landing in a purse
    coins: () => [0, 0.07, 0.15, 0.2].forEach((s, i) => { tone({ freq: 2600 + i * 310, type: "triangle", start: s, dur: 0.18, vol: 0.12 }); tone({ freq: 4100 + i * 170, type: "sine", start: s, dur: 0.1, vol: 0.06 }); }),
    // coins leaving: a dull purse thump and a single falling clink
    loss: () => { tone({ freq: 140, type: "sine", dur: 0.25, vol: 0.35, glideTo: 70 }); tone({ freq: 1900, type: "triangle", start: 0.08, dur: 0.25, vol: 0.08, glideTo: 1200 }); },
    // Glory: a short herald's call
    glory: () => { horn(392, 0, 0.16); horn(523.25, 0.15, 0.16); horn(659.25, 0.3, 0.42); },
    // a clue found: two lute plucks
    clue: () => { pluck(587.33, 0); pluck(880, 0.12); pluck(783.99, 0.26, 0.18); },
    // chapter change: a church bell
    bell: () => bell(220),
    // campaign success: full fanfare over a bell
    triumph: () => { bell(196, 0, 0.15); [[392, 0, 0.18], [392, 0.2, 0.12], [523.25, 0.34, 0.18], [659.25, 0.54, 0.18], [783.99, 0.74, 0.7]].forEach(([f, s, d]) => horn(f, s, d, 0.16)); },
    // unresolved: a slow, low minor toll
    lament: () => { bell(110, 0, 0.2); tone({ freq: 220, type: "triangle", start: 0.4, dur: 1.6, vol: 0.12, attack: 0.3, filter: 900 }); tone({ freq: 261.63, type: "triangle", start: 0.4, dur: 1.6, vol: 0.1, attack: 0.3, filter: 900 }); },
    // undo: a quill being dragged back
    undo: () => noise({ dur: 0.25, vol: 0.12, from: 5000, to: 1500, q: 3 }),
  };

  function play(name, delay = 0) {
    if (muted || !SOUNDS[name]) return;
    const run = () => { try { if (audio()) SOUNDS[name](); } catch (e) { /* audio is optional */ } };
    if (delay) setTimeout(run, delay); else run();
  }

  function setMuted(m) {
    muted = !!m;
    try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch (e) { /* ignore */ }
  }

  window.SFX = { play, setMuted, isMuted: () => muted };
})();
