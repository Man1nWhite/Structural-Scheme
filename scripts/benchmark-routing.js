#!/usr/bin/env node
// Измерение пересчёта плотной схемы при правке (не тест с порогом времени).
const { performance } = require('node:perf_hooks');
const core = require('../src/core.js');

// Воспроизводимый проект из нескольких рядов: он вызывает не только подбор
// зазора, но и повторные проходы исправления совпадающих линий.
let seed = 35;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const state = core.createDefaultState();
state.project = { ...state.project, blocksPerRow: 12, kvmPanel: random() < 0.6 };
state.netCabs = Array.from({ length: 3 }, (_, i) => ({ ...core.ITEM_DEFAULTS.netCabs, id: 'n' + i }));
state.opItems = Array.from({ length: 8 }, (_, i) => ({
  ...core.ITEM_DEFAULTS.opItems, id: 'op' + i, target: 'n' + Math.floor(random() * 3), kvmToPanel: random() < 0.2,
}));
state.racks = Array.from({ length: 3 }, (_, i) => ({
  ...core.ITEM_DEFAULTS.racks, id: 'r' + i, netTarget: 'n' + Math.floor(random() * 3), kvm: random() < 0.2,
}));
state.autoCabs = Array.from({ length: 17 }, (_, i) => ({
  ...core.ITEM_DEFAULTS.autoCabs, id: 'a' + i, netTarget: 'n' + Math.floor(random() * 3),
  rs485Cab: random() < 0.35, rs485Target: 'a' + Math.floor(random() * 17),
}));

const iterations = 300, warmup = 30;
const run = i => {
  state.project.title = 'Структурная схема ' + i;
  const model = core.buildScheme(state);
  core.toSvg(model);
  return model;
};
const initial = run(0);
for (let i = 0; i < warmup; i++) run(i);
const times = [];
for (let i = 0; i < iterations; i++) {
  const start = performance.now();
  run(i);
  times.push(performance.now() - start);
}
times.sort((a, b) => a - b);
const percentile = p => Number(times[Math.ceil(times.length * p) - 1].toFixed(2));
console.log(JSON.stringify({
  node: process.version, platform: process.platform, arch: process.arch,
  blocksPerRow: 12, blocks: initial.blocks.length, connections: initial.conns.length,
  warmup, iterations, p50Ms: percentile(0.5), p95Ms: percentile(0.95),
  p99Ms: percentile(0.99), maxMs: Number(times.at(-1).toFixed(2)),
}, null, 2));
