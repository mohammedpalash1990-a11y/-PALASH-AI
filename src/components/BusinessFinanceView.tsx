import React, { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import type { FinanceSummary, LedgerEntryItem, ProjectItem } from '../types';

interface BusinessFinanceViewProps {
  token: string;
  projects: ProjectItem[];
  onRefreshOverview: () => Promise<void>;
}

export const BusinessFinanceView: React.FC<BusinessFinanceViewProps> = ({
  token,
  projects,
  onRefreshOverview,
}) => {
  const [filterProjectId, setFilterProjectId] = useState<string>('all');
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [entries, setEntries] = useState<LedgerEntryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [entryProjectId, setEntryProjectId] = useState(projects[1]?.id || projects[0]?.id || 'musafir-cafe-pos');
  const [type, setType] = useState<'revenue' | 'expense' | 'staff_cost' | 'inventory'>('revenue');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFinance = async (projFilter: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/finance/summary?projectId=${encodeURIComponent(projFilter)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setSummary(data.summary);
        setEntries(data.entries || []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFinance(filterProjectId);
  }, [filterProjectId, token]);

  const handleAddEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const numAmount = Number(amount);
    if (!category.trim() || !Number.isFinite(numAmount) || numAmount <= 0) {
      setError('Enter a valid category and positive numeric amount.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/finance/entries', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          projectId: entryProjectId,
          type,
          category: category.trim(),
          description: description.trim() || category.trim(),
          amount: numAmount,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to record financial entry.');
      } else {
        setCategory('');
        setDescription('');
        setAmount('');
        await loadFinance(filterProjectId);
        await onRefreshOverview();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
            Business &amp; Financial Intelligence (P&amp;L · Cash Flow · Inventory)
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Track revenue, operating expenses, staff payroll, and inventory margins across ventures.
          </p>
        </div>
        <div>
          <label htmlFor="finance-project-filter" className="sr-only">
            Filter by Business Venture
          </label>
          <select
            id="finance-project-filter"
            value={filterProjectId}
            onChange={(e) => setFilterProjectId(e.target.value)}
            className="min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium dark:border-slate-700 dark:bg-slate-950"
          >
            <option value="all">All Ventures Combined</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* P&L Metrics Grid */}
      {loading || !summary ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[1, 2, 3, 4].map((n) => (
            <div
              key={n}
              className="h-28 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
            />
          ))}
        </div>
      ) : (
        <section aria-label="Financial KPIs" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs text-slate-500 dark:text-slate-400">Total Revenue</p>
            <p className="mt-2 font-display text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
              ${summary.totalRevenue.toLocaleString()}
            </p>
            <p className="mt-1 text-xs tabular-nums text-slate-500 dark:text-slate-400">
              {summary.revenueAttainmentPct}% of ${summary.revenueTarget.toLocaleString()} target
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs text-slate-500 dark:text-slate-400">Total Expenses</p>
            <p className="mt-2 font-display text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
              ${summary.totalExpenses.toLocaleString()}
            </p>
            <p className="mt-1 text-xs tabular-nums text-slate-500 dark:text-slate-400">
              {summary.budgetUtilizationPct}% of ${summary.monthlyBudget.toLocaleString()} budget
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs text-slate-500 dark:text-slate-400">Net Profit (P&amp;L)</p>
            <p
              className={`mt-2 font-display text-2xl font-bold tabular-nums ${
                summary.netProfit >= 0
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400'
              }`}
            >
              ${summary.netProfit.toLocaleString()}
            </p>
            <p className="mt-1 text-xs tabular-nums text-slate-500 dark:text-slate-400">
              {summary.profitMarginPct}% net margin · {summary.staffCostRatioPct}% staff ratio
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs text-slate-500 dark:text-slate-400">30-Day Cash Flow Proj.</p>
            <p className="mt-2 font-display text-2xl font-bold tabular-nums text-teal-700 dark:text-teal-400">
              ${summary.cashFlowProjection30d.toLocaleString()}
            </p>
            <p className="mt-1 text-xs tabular-nums text-slate-500 dark:text-slate-400">
              Inventory ${summary.inventorySpend.toLocaleString()} · Staff ${summary.staffCosts.toLocaleString()}
            </p>
          </div>
        </section>
      )}

      {/* Log New Transaction */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
          Record Revenue, Expense, Payroll, or Inventory Entry
        </h3>
        <form onSubmit={handleAddEntry} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label htmlFor="led-project" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Venture / Project
            </label>
            <select
              id="led-project"
              value={entryProjectId}
              onChange={(e) => setEntryProjectId(e.target.value)}
              className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="led-type" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Ledger Type
            </label>
            <select
              id="led-type"
              value={type}
              onChange={(e) => setType(e.target.value as 'revenue' | 'expense' | 'staff_cost' | 'inventory')}
              className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
            >
              <option value="revenue">Revenue</option>
              <option value="expense">Operating Expense</option>
              <option value="staff_cost">Staff Cost</option>
              <option value="inventory">Inventory</option>
            </select>
          </div>

          <div>
            <label htmlFor="led-category" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Category
            </label>
            <input
              id="led-category"
              type="text"
              required
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g., POS Weekend Sales"
              className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div>
            <label htmlFor="led-amount" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Amount (USD)
            </label>
            <input
              id="led-amount"
              type="number"
              step="0.01"
              min="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="1250.00"
              className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm tabular-nums dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex min-h-[42px] w-full items-center justify-center gap-1.5 rounded-lg bg-teal-600 px-4 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>{saving ? 'Recording...' : 'Record Entry'}</span>
            </button>
          </div>

          <div className="sm:col-span-2 lg:col-span-5">
            <label htmlFor="led-desc" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Notes / Settlement Reference
            </label>
            <input
              id="led-desc"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description or invoice number..."
              className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
        </form>
        {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      </section>

      {/* Financial Ledger Table */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
          Financial Ledger ({entries.length} records)
        </h3>
        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3 font-semibold">Date</th>
                <th className="px-4 py-3 font-semibold">Venture</th>
                <th className="px-4 py-3 font-semibold">Type</th>
                <th className="px-4 py-3 font-semibold">Category &amp; Notes</th>
                <th className="px-4 py-3 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {entries.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="px-4 py-3 font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    {row.date}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-white whitespace-nowrap">
                    {row.projectId}
                  </td>
                  <td className="px-4 py-3 capitalize text-slate-600 dark:text-slate-300 whitespace-nowrap">
                    {row.type.replace('_', ' ')}
                  </td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                    <span className="font-medium">{row.category}</span>
                    {row.description && row.description !== row.category && (
                      <span className="text-slate-500 dark:text-slate-400"> · {row.description}</span>
                    )}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-mono font-semibold tabular-nums whitespace-nowrap ${
                      row.type === 'revenue'
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-slate-900 dark:text-slate-100'
                    }`}
                  >
                    {row.type === 'revenue' ? '+' : '-'}${row.amount.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
