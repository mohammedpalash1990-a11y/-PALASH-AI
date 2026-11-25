import type { BudgetTarget, LedgerEntry } from './types.ts';

export interface FinancialSummary {
  totalRevenue: number;
  totalExpenses: number;
  operatingExpenses: number;
  staffCosts: number;
  inventorySpend: number;
  netProfit: number;
  profitMarginPct: number;
  staffCostRatioPct: number;
  budgetUtilizationPct: number;
  monthlyBudget: number;
  revenueTarget: number;
  revenueAttainmentPct: number;
  cashFlowProjection30d: number;
  categoryBreakdown: Array<{ category: string; amount: number; type: LedgerEntry['type'] }>;
}

export function computeFinancialSummary(
  entries: LedgerEntry[],
  targets: BudgetTarget[],
  projectIdFilter?: string
): FinancialSummary {
  const scopedEntries = projectIdFilter && projectIdFilter !== 'all'
    ? entries.filter((e) => e.projectId === projectIdFilter)
    : entries;

  const scopedTargets = projectIdFilter && projectIdFilter !== 'all'
    ? targets.filter((t) => t.projectId === projectIdFilter)
    : targets;

  let totalRevenue = 0;
  let operatingExpenses = 0;
  let staffCosts = 0;
  let inventorySpend = 0;

  const categoryTotals = new Map<string, { amount: number; type: LedgerEntry['type'] }>();

  for (const entry of scopedEntries) {
    if (entry.type === 'revenue') {
      totalRevenue += entry.amount;
    } else if (entry.type === 'staff_cost') {
      staffCosts += entry.amount;
    } else if (entry.type === 'inventory') {
      inventorySpend += entry.amount;
    } else {
      operatingExpenses += entry.amount;
    }

    const key = `${entry.type}:${entry.category}`;
    const current = categoryTotals.get(key);
    categoryTotals.set(key, {
      amount: (current?.amount ?? 0) + entry.amount,
      type: entry.type,
    });
  }

  const totalExpenses = operatingExpenses + staffCosts + inventorySpend;
  const netProfit = totalRevenue - totalExpenses;
  const profitMarginPct = totalRevenue > 0 ? Number(((netProfit / totalRevenue) * 100).toFixed(1)) : 0;
  const staffCostRatioPct = totalRevenue > 0 ? Number(((staffCosts / totalRevenue) * 100).toFixed(1)) : 0;

  const monthlyBudget = scopedTargets.reduce((sum, t) => sum + t.monthlyBudget, 0);
  const revenueTarget = scopedTargets.reduce((sum, t) => sum + t.revenueTarget, 0);

  const budgetUtilizationPct = monthlyBudget > 0 ? Number(((totalExpenses / monthlyBudget) * 100).toFixed(1)) : 0;
  const revenueAttainmentPct = revenueTarget > 0 ? Number(((totalRevenue / revenueTarget) * 100).toFixed(1)) : 0;
  const cashFlowProjection30d = Number((netProfit * 1.08).toFixed(2));

  const categoryBreakdown = Array.from(categoryTotals.entries())
    .map(([key, val]) => ({
      category: key.split(':')[1] || key,
      amount: Number(val.amount.toFixed(2)),
      type: val.type,
    }))
    .sort((a, b) => b.amount - a.amount);

  return {
    totalRevenue: Number(totalRevenue.toFixed(2)),
    totalExpenses: Number(totalExpenses.toFixed(2)),
    operatingExpenses: Number(operatingExpenses.toFixed(2)),
    staffCosts: Number(staffCosts.toFixed(2)),
    inventorySpend: Number(inventorySpend.toFixed(2)),
    netProfit: Number(netProfit.toFixed(2)),
    profitMarginPct,
    staffCostRatioPct,
    budgetUtilizationPct,
    monthlyBudget: Number(monthlyBudget.toFixed(2)),
    revenueTarget: Number(revenueTarget.toFixed(2)),
    revenueAttainmentPct,
    cashFlowProjection30d,
    categoryBreakdown,
  };
}
