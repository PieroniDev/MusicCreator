import type { EffectPlugin } from '../types';
import type { ParamSpec } from '../params';
import { paramReader } from '../params';
import { disconnectAll } from '../dsp';
import { DryWet, smooth, SYNC_DIVISIONS } from './common';

const params: ParamSpec[] = [
  { id: 'time', name: 'Tempo', min: 0, max: SYNC_DIVISIONS.length - 1, default: 5, options: SYNC_DIVISIONS.map((d) => d.label), group: 'Delay' },
  { id: 'feedback', name: 'Repetições', min: 0, max: 0.95, default: 0.4, unit: '%', group: 'Delay' },
  { id: 'pingPong', name: 'Ping-pong', min: 0, max: 1, default: 1, options: ['Não', 'Sim'], group: 'Delay' },
  { id: 'damping', name: 'Abafar', min: 500, max: 20000, default: 6000, scale: 'log', unit: 'Hz', group: 'Cor' },
  { id: 'lowCut', name: 'Corte grave', min: 20, max: 2000, default: 120, scale: 'log', unit: 'Hz', group: 'Cor' },
  { id: 'mix', name: 'Mix', min: 0, max: 1, default: 0.3, unit: '%', group: 'Saída' },
];

export const delay: EffectPlugin = {
  kind: 'effect',
  id: 'delay',
  name: 'Delay',
  description: 'Delay estéreo sincronizado ao BPM, com ping-pong e filtros na realimentação.',
  params,
  presets: [
    { name: 'Ping-pong 1/8 pont.', params: {} },
    { name: 'Eco 1/4', params: { time: 6, pingPong: 0, feedback: 0.35, mix: 0.25 } },
    { name: 'Slapback', params: { time: 1, pingPong: 0, feedback: 0.1, mix: 0.25, damping: 4000 } },
    { name: 'Dub', params: { time: 5, feedback: 0.75, damping: 2000, lowCut: 300, mix: 0.4 } },
  ],

  create(ctx, values, env) {
    const p = paramReader(params, values);
    const mix = new DryWet(ctx, p('mix'));
    mix.input.channelCount = 2;
    mix.input.channelCountMode = 'explicit';
    mix.input.channelInterpretation = 'speakers';

    const split = ctx.createChannelSplitter(2);
    const merge = ctx.createChannelMerger(2);
    mix.input.connect(split);
    const g = () => ctx.createGain();
    const inLL = g(), inRR = g(), inRL = g();
    const fbLL = g(), fbRR = g(), fbLR = g(), fbRL = g();
    const side = () => {
      const d = ctx.createDelay(8);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      d.connect(lp);
      lp.connect(hp);
      return { d, lp, hp };
    };
    const L = side();
    const R = side();
    split.connect(inLL, 0);
    split.connect(inRL, 1);
    split.connect(inRR, 1);
    inLL.connect(L.d);
    inRL.connect(L.d);
    inRR.connect(R.d);
    L.hp.connect(fbLL).connect(L.d);
    R.hp.connect(fbRR).connect(R.d);
    L.hp.connect(fbLR).connect(R.d);
    R.hp.connect(fbRL).connect(L.d);
    L.hp.connect(merge, 0, 0);
    R.hp.connect(merge, 0, 1);
    merge.connect(mix.wet);

    let bpm = env.bpm;
    const current = { ...values };
    const read = (id: string) => (typeof current[id] === 'number' ? current[id] : p(id));

    const updateTime = (ramp: boolean) => {
      const div = SYNC_DIVISIONS[Math.round(read('time'))] ?? SYNC_DIVISIONS[5];
      const seconds = Math.min(8, (div.beats * 60) / bpm);
      for (const s of [L, R]) {
        if (ramp) smooth(s.d.delayTime, seconds, ctx, 0.05);
        else s.d.delayTime.value = seconds;
      }
    };
    const updateRouting = () => {
      const fb = read('feedback');
      const ping = read('pingPong') >= 0.5;
      inLL.gain.value = ping ? 0.5 : 1;
      inRL.gain.value = ping ? 0.5 : 0;
      inRR.gain.value = ping ? 0 : 1;
      fbLL.gain.value = fbRR.gain.value = ping ? 0 : fb;
      fbLR.gain.value = fbRL.gain.value = ping ? fb : 0;
    };
    const updateFilters = () => {
      for (const s of [L, R]) {
        s.lp.frequency.value = Math.min(read('damping'), ctx.sampleRate / 2 - 100);
        s.hp.frequency.value = read('lowCut');
      }
    };
    updateTime(false);
    updateRouting();
    updateFilters();

    return {
      input: mix.input,
      output: mix.output,
      setParam(id, v) {
        current[id] = v;
        if (id === 'time') updateTime(true);
        else if (id === 'feedback' || id === 'pingPong') updateRouting();
        else if (id === 'damping' || id === 'lowCut') updateFilters();
        else if (id === 'mix') mix.setMix(v);
      },
      setTempo(newBpm) {
        bpm = newBpm;
        updateTime(true);
      },
      dispose() {
        disconnectAll(mix.input, mix.output, mix.dry, mix.wet, split, merge, inLL, inRR, inRL, fbLL, fbRR, fbLR, fbRL);
        for (const s of [L, R]) disconnectAll(s.d, s.lp, s.hp);
      },
    };
  },
};
