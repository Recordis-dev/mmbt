import test from "node:test";
import assert from "node:assert/strict";

import { calculateBetSize, evaluateAdmission } from "../src/core/budgetEngine.js";
import { evaluateCircuitBreaker } from "../src/core/circuitBreaker.js";
import { runParallelSecurityChecks } from "../src/core/securityEngine.js";
import { extractTokenAddress } from "../src/core/tokenParser.js";
import { calculateTrailingStop } from "../src/core/trailingStop.js";
import { analyzeLocally } from "../src/core/riskEngine.js";
import {
  buildLearningFeatures,
  buildPatternKey,
  labelOutcome,
  scorePattern,
  updatePatternStats
} from "../src/core/learningEngine.js";

test("extracts a Solana token address from noisy text", () => {
  const address = "So11111111111111111111111111111111111111112";
  assert.equal(extractTokenAddress(`new signal ${address} ape?`), address);
});

test("halts when daily loss limit is reached", () => {
  assert.deepEqual(calculateBetSize({ dailyPnL: -15, consecutiveLosses: 0 }), {
    action: "HALT",
    reason: "Circuit breaker activated",
    betSizeUsd: 0
  });
});

test("reduces bet size during a losing streak", () => {
  assert.equal(calculateBetSize({ dailyPnL: -11, consecutiveLosses: 6 }).betSizeUsd, 0.12);
});

test("queues when concurrent exposure is full", () => {
  assert.deepEqual(evaluateAdmission({ openPositions: 3 }), { status: "queue" });
});

test("security engine requires at least two providers", async () => {
  const result = await runParallelSecurityChecks([
    { run: async () => ({ source: "rugcheck", score: 100, token: { liquidityBurned: true } }) },
    { run: async () => { throw new Error("down"); } },
    { run: async () => { throw new Error("down"); } }
  ]);

  assert.equal(result.status, "abort");
  assert.equal(result.reason, "Insufficient security data");
});

test("security engine passes when all responding providers pass", async () => {
  const tokenAddress = "Token111111111111111111111111111111111111111";
  const result = await runParallelSecurityChecks([
    { run: async () => ({ source: "rugcheck", score: 100, token: { liquidityBurned: true } }) },
    { run: async () => ({ source: "goplus", tokenAddress, data: { is_mintable: "0", is_freezable: "0", is_honeypot: "0" } }) },
    { run: async () => ({ source: "solsniffer", topHolders: { top10Percentage: 20 } }) }
  ]);

  assert.equal(result.status, "safe");
});

test("local risk engine counts negative confluences", () => {
  const result = analyzeLocally(
    { volume24h: 40, holdersCount: 80, sellPressure: 400, buyPressure: 100, networkFees: 200000 },
    { avgVolume: 100, peakHolders: 100 }
  );

  assert.equal(result.negativeCount, 4);
});

test("trailing stop returns partial take profit at 2x", () => {
  const result = calculateTrailingStop({ entryPrice: 1, highestPrice: 2 }, 2);
  assert.equal(result.type, "partial_take_profit");
  assert.equal(result.action, "partial_exit");
});

test("trailing stop exits below hard stop", () => {
  const result = calculateTrailingStop({ entryPrice: 1, highestPrice: 1 }, 0.33);
  assert.equal(result.type, "hard_stop_loss");
  assert.equal(result.action, "full_exit");
});

test("circuit breaker halts stale positions", () => {
  const result = evaluateCircuitBreaker({ oldestOpenPositionAgeMs: 46 * 60 * 1000 });
  assert.equal(result.status, "halted");
  assert.equal(result.reason, "Position timeout risk");
});

test("learning engine creates stable pattern keys", () => {
  const features = buildLearningFeatures({
    securityScore: { rugcheck: true, goplus: true, solsniffer: true },
    market: {
      liquidityUsd: 8000,
      volume5mUsd: 3000,
      holderCount: 100,
      top10HolderPercentage: 22,
      buyPressure: 100,
      sellPressure: 200,
      tokenAgeMinutes: 20
    },
    risk: { negativeCount: 1, source: "local_engine" }
  });

  assert.equal(
    buildPatternKey(features),
    "liq:lte_10000|vol5:lte_5000|holders:lte_150|top10:lte_25|age:lte_30|sellbuy:lte_2|risk:lte_1"
  );
});

test("learning engine labels moonshot outcomes", () => {
  assert.equal(labelOutcome({ finalMultiplier: 3, maxMultiplier: 12, pnlUsd: 1 }), "moonshot");
});

test("learning engine stays neutral with few samples", () => {
  const score = scorePattern({ sampleCount: 3, winCount: 3, totalPnlUsd: 1, avgMaxMultiplier: 4 });
  assert.equal(score.action, "neutral");
  assert.equal(score.reason, "Insufficient samples");
});

test("learning engine updates aggregate pattern stats", () => {
  const updated = updatePatternStats(
    { sampleCount: 4, winCount: 1, totalPnlUsd: -1, avgMaxMultiplier: 1.5 },
    { wasWinner: true, pnlUsd: 2, maxMultiplier: 5, outcomeLabel: "winner" }
  );

  assert.equal(updated.sampleCount, 5);
  assert.equal(updated.winCount, 2);
  assert.equal(updated.lossCount, 3);
  assert.equal(updated.totalPnlUsd, 1);
});
