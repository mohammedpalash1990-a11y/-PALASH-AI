import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFinancialSummary } from './finance.ts';
import type { BudgetTarget, LedgerEntry } from './types.ts';

function entry(partial: Partial<LedgerEntry> & Pick<LedgerEntry, 'type' | 'amount'>): LedgerEntry {
  return {
    id: partial.id ?? Math.random().toString(36).slice(2),
    projectId: partial.projectId ?? 'musafir',
    type: partial.type,
    category: partial.category ?? 'General',
    description: partial.description ?? '',
    amount: partial.amount,
    currency: 'USD',
    date: partial.date ?? '2026-11-20',
    createdAt: partial.createdAt ?? '',
  };
}

const targets: BudgetTarget[] = [
  { projectId: 'musafir', monthlyBudget: 10_000, revenueTarget: 20_000, staffCostCap: 3_000 },
];

test('30-day cash flow projection is straight-line from the observed daily net', () => {
  // One single-day sample: projection = netProfit for that day * 30.
  const singleDay = computeFinancialSummary(
    [
      entry({ type: 'revenue', amount: 1_000, date: '2026-11-20' }),
      entry({ type: 'expense', amount: 400, date: '2026-11-20' }),
    ],
    targets
  );
  assert.equal(singleDay.netProfit, 600);
  assert.equal(singleDay.projectionBasisDays, 1);
  assert.equal(singleDay.cashFlowProjection30d, 18_000);

  // Ten-day window with net 600/day: projection stays 600 * 30.
  const tenDays = Array.from({ length: 10 }, (_, i) =>
    [
      entry({ type: 'revenue', amount: 1_000, date: `2026-11-${String(i + 1).padStart(2, '0')}` }),
      entry({ type: 'expense', amount: 400, date: `2026-11-${String(i + 1).padStart(2, '0')}` }),
    ]
  ).flat();
  const tenDaySummary = computeFinancialSummary(tenDays, targets);
  assert.equal(tenDaySummary.projectionBasisDays, 10);
  assert.equal(tenDaySummary.cashFlowProjection30d, 18_000);
});

test('projection de-annualises a 30-day window instead of multiplying it by 1.08', () => {
  const month = Array.from({ length: 30 }, (_, i) =>
    entry({ type: 'revenue', amount: 100, date: `2026-11-${String(i + 1).padStart(2, '0')}` })
  );
  const summary = computeFinancialSummary(month, targets);
  assert.equal(summary.projectionBasisDays, 30);
  assert.equal(summary.cashFlowProjection30d, 3_000);
});

test('projection is zero (not NaN) when there is no ledger data', () => {
  const summary = computeFinancialSummary([], targets);
  assert.equal(summary.cashFlowProjection30d, 0);
  assert.equal(summary.projectionBasisDays, 0);
});

test('project filtering keeps other projects out of every figure', () => {
  const summary = computeFinancialSummary(
    [
      entry({ type: 'revenue', amount: 500, projectId: 'musafir' }),
      entry({ type: 'revenue', amount: 9_999, projectId: 'deenverse' }),
      entry({ type: 'staff_cost', amount: 200, projectId: 'musafir' }),
    ],
    targets,
    'musafir'
  );
  assert.equal(summary.totalRevenue, 500);
  assert.equal(summary.staffCosts, 200);
  assert.equal(summary.netProfit, 300);
  assert.equal(summary.staffCostRatioPct, 40);
});

test('division-by-zero guards keep percentages finite', () => {
  const summary = computeFinancialSummary([entry({ type: 'expense', amount: 250 })], [
    { projectId: 'musafir', monthlyBudget: 0, revenueTarget: 0, staffCostCap: 0 },
  ]);
  for (const value of [
    summary.profitMarginPct,
    summary.staffCostRatioPct,
    summary.budgetUtilizationPct,
    summary.revenueAttainmentPct,
    summary.cashFlowProjection30d,
  ]) {
    assert.ok(Number.isFinite(value), `expected finite number, got ${value}`);
  }
});
