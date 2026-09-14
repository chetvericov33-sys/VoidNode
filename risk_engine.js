'use strict';

// Deterministic, auditable portfolio risk model.
// Inputs are percentages; output is always 0..100.

function clamp(n, min, max) {
  n = Number(n);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function concentrationScore(top, weights) {
  // 50% is the product threshold. Concentration risk starts at 20%.
  // Up to three largest positions contribute, with the largest position weighted most.
  var ws = Array.isArray(weights) ? weights.map(Number).filter(Number.isFinite).sort(function(a,b){return b-a;}) : [];
  if (!ws.length && Number.isFinite(Number(top))) ws = [Number(top)];
  // Primary concentration driver: 42% => 18 points, while 50% remains a clear
  // threshold and extreme concentration can consume most of the 50-point cap.
  var score = 0;
  if (ws.length) score = clamp((Math.max(0, ws[0]) - 20) * (18 / 22), 0, 50);
  return clamp(score, 0, 50);
}

function reserveScore(stable, target) {
  stable = Math.max(0, Number(stable) || 0);
  target = Math.max(0, Number(target) || 20);
  return clamp((target - stable) * 0.75, 0, 15);
}

function altScore(alts, target) {
  alts = Math.max(0, Number(alts) || 0);
  target = Math.max(0, Number(target) || 30);
  return clamp((alts - target) * 0.50, 0, 15);
}

function diversificationScore(meaningful) {
  meaningful = Math.max(0, Number(meaningful) || 0);
  if (meaningful >= 5) return 0;
  if (meaningful === 4) return 4;
  if (meaningful === 3) return 4;
  if (meaningful === 2) return 7;
  if (meaningful === 1) return 10;
  return 10;
}

function dataQualityScore(coverageComplete) {
  return coverageComplete ? 0 : 10;
}

function calculateRiskBreakdown(input) {
  input = input || {};
  var targets = input.targets || {};
  var breakdown = {
    concentration: Math.round(concentrationScore(input.top, input.weights) * 100) / 100,
    reserve: Math.round(reserveScore(input.stable, targets.USDT == null ? 20 : targets.USDT) * 100) / 100,
    alt_exposure: Math.round(altScore(input.alts, targets.ALTS == null ? 30 : targets.ALTS) * 100) / 100,
    diversification: Math.round(diversificationScore(input.meaningful) * 100) / 100,
    data_quality: Math.round(dataQualityScore(input.coverageComplete !== false) * 100) / 100
  };
  var score = clamp(Object.keys(breakdown).reduce(function(sum,k){return sum + breakdown[k];},0), 0, 100);
  score = Math.round(score);

  var labels = {
    concentration: 'Concentration',
    reserve: 'Liquidity reserve',
    alt_exposure: 'Altcoin exposure',
    diversification: 'Diversification',
    data_quality: 'Data quality'
  };
  var drivers = Object.keys(breakdown)
    .filter(function(k){ return breakdown[k] > 0; })
    .sort(function(a,b){ return breakdown[b] - breakdown[a]; })
    .map(function(k){ return { key:k, label:labels[k], points:breakdown[k] }; });

  return { score: score, breakdown: breakdown, drivers: drivers };
}

module.exports = { calculateRiskBreakdown: calculateRiskBreakdown };
