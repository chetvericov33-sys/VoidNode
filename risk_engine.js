'use strict';

// Void Node deterministic, auditable risk engine.
// Read-only: this module calculates risk only and never executes exchange actions.

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, Number(n) || 0));
}

function calculateRiskBreakdown(input) {
  input = input || {};
  var top = clamp(input.top, 0, 100);
  var stable = clamp(input.stable, 0, 100);
  var alts = clamp(input.alts, 0, 100);
  var meaningful = Math.max(0, Number(input.meaningful) || 0);
  var coverageComplete = input.coverageComplete !== false;
  var targets = input.targets || { BTC: 50, USDT: 20, ALTS: 30 };
  var stableTarget = Number(targets.USDT || 20);
  var altTarget = Number(targets.ALTS || 30);

  // Factor caps: concentration 50, reserve 15, alt exposure 15,
  // diversification 10, data quality 10. Total = 100.
  var concentration = top <= 50 ? 0 : top <= 60 ? 20 : top <= 70 ? 30 : 50;
  var reserveGap = Math.max(0, stableTarget - stable);
  var reserve = reserveGap <= 5 ? 5 : reserveGap <= 10 ? 10 : 15;
  if (reserveGap === 0) reserve = 0;

  var altGap = Math.max(0, alts - altTarget);
  var altExposure = altGap === 0 ? 0 : altGap <= 10 ? 5 : altGap <= 20 ? 10 : 15;

  var diversification = meaningful >= 3 ? 0 : meaningful === 2 ? 5 : 10;
  var dataQuality = coverageComplete ? 0 : 10;

  var breakdown = [
    { key: 'concentration', labelRu: 'Концентрация', labelEn: 'Concentration', points: concentration,
      subFactors: [{ weight: top, points: concentration }] },
    { key: 'reserve', labelRu: 'Ликвидный резерв', labelEn: 'Liquidity reserve', points: reserve },
    { key: 'alt_exposure', labelRu: 'Доля альткоинов', labelEn: 'Alt exposure', points: altExposure },
    { key: 'diversification', labelRu: 'Диверсификация', labelEn: 'Diversification', points: diversification },
    { key: 'data_quality', labelRu: 'Качество данных', labelEn: 'Data quality', points: dataQuality }
  ];

  var score = clamp(breakdown.reduce(function(sum, f) { return sum + f.points; }, 0), 0, 100);
  var drivers = breakdown.filter(function(f) { return f.points > 0; }).map(function(f) { return f.key; });

  return { score: Math.round(score), drivers: drivers, breakdown: breakdown };
}

module.exports = { calculateRiskBreakdown: calculateRiskBreakdown };
