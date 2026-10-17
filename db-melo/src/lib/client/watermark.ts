// Filigrane sonore de la pré-écoute : petite signature « ding-dong » jouée par-dessus l'extrait.
export function playWatermarkChime(ctx: AudioContext, volume = 0.18) {
  const now = ctx.currentTime;
  [1318.5, 987.8].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const t = now + i * 0.22;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 1);
  });
}
