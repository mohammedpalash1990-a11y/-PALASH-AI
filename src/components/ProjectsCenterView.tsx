import React, { useState } from 'react';
import { Plus, Search, FolderKanban, AlertCircle, Wrench, CheckCircle2 } from 'lucide-react';
import type { ProjectItem } from '../types';

interface ProjectsCenterViewProps {
  projects: ProjectItem[];
  onCreateProject: (payload: {
    name: string;
    repoOwner: string;
    repoName: string;
    category: 'platform' | 'pos' | 'marketplace' | 'saas';
    deadline: string;
    description: string;
  }) => Promise<void>;
  onUpdateProject: (id: string, patch: { progress?: number; status?: ProjectItem['status'] }) => Promise<void>;
}

export const ProjectsCenterView: React.FC<ProjectsCenterViewProps> = ({
  projects,
  onCreateProject,
  onUpdateProject,
}) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ProjectItem['status']>('all');
  const [showAdd, setShowAdd] = useState(false);

  const [name, setName] = useState('');
  const [repoOwner, setRepoOwner] = useState('mohammedpalash1990-a11y');
  const [repoName, setRepoName] = useState('');
  const [category, setCategory] = useState<'platform' | 'pos' | 'marketplace' | 'saas'>('saas');
  const [deadline, setDeadline] = useState('2027-01-31');
  const [description, setDescription] = useState('');

  const filtered = projects.filter((p) => {
    const matchesQuery =
      !search.trim() ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.slug.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || p.status === statusFilter;
    return matchesQuery && matchesStatus;
  });

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !repoOwner.trim() || !repoName.trim()) return;
    await onCreateProject({
      name: name.trim(),
      repoOwner: repoOwner.trim(),
      repoName: repoName.trim(),
      category,
      deadline,
      description: description.trim(),
    });
    setName('');
    setRepoName('');
    setDescription('');
    setShowAdd(false);
  };

  const activeCount = projects.filter((project) => project.status === 'active').length;
  const attentionCount = projects.filter((project) => project.status === 'attention').length;
  const maintenanceCount = projects.filter((project) => project.status === 'maintenance').length;

  return (
    <div className="space-y-5 sm:space-y-6">
      <section aria-label="Project summary" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: 'All projects', value: projects.length, icon: FolderKanban },
          { label: 'Active', value: activeCount, icon: CheckCircle2 },
          { label: 'Needs attention', value: attentionCount, icon: AlertCircle },
          { label: 'Maintenance', value: maintenanceCount, icon: Wrench },
        ].map((item) => {
          const Icon = item.icon;
          return <div key={item.label} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-50 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300"><Icon className="h-4 w-4" aria-hidden="true" /></span><span><span className="block text-xl font-bold tabular-nums text-slate-900 dark:text-white">{item.value}</span><span className="block text-[10px] font-medium text-slate-500 dark:text-slate-400">{item.label}</span></span></div>;
        })}
      </section>
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <label htmlFor="project-search" className="sr-only">
            Search projects
          </label>
          <input
            id="project-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by project name or repo..."
            className="min-h-[42px] w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-950"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            {(['all', 'active', 'attention', 'maintenance'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium capitalize transition-colors ${
                  statusFilter === st
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
                }`}
              >
                {st}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setShowAdd((v) => !v)}
            className="inline-flex min-h-[42px] items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg bg-teal-600 px-4 text-xs font-semibold text-white hover:bg-teal-700"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>Add project</span>
          </button>
        </div>
      </div>

      {showAdd && (
        <form
          onSubmit={handleAddSubmit}
          className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-2 lg:grid-cols-3"
        >
          <div>
            <label htmlFor="proj-name" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Project Name
            </label>
            <input
              id="proj-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Riyadh Delivery Hub"
              className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div>
            <label htmlFor="proj-owner" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              GitHub Owner
            </label>
            <input
              id="proj-owner"
              type="text"
              required
              value={repoOwner}
              onChange={(e) => setRepoOwner(e.target.value)}
              className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div>
            <label htmlFor="proj-repo" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Repository Name
            </label>
            <input
              id="proj-repo"
              type="text"
              required
              value={repoName}
              onChange={(e) => setRepoName(e.target.value)}
              placeholder="repo-slug"
              className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div>
            <label htmlFor="proj-cat" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Category
            </label>
            <select
              id="proj-cat"
              value={category}
              onChange={(e) => setCategory(e.target.value as 'platform' | 'pos' | 'marketplace' | 'saas')}
              className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
            >
              <option value="pos">POS System</option>
              <option value="saas">SaaS Platform</option>
              <option value="marketplace">Marketplace</option>
              <option value="platform">Core Platform</option>
            </select>
          </div>

          <div>
            <label htmlFor="proj-deadline" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Target Deadline
            </label>
            <input
              id="proj-deadline"
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div className="flex items-end gap-2">
            <button
              type="submit"
              className="min-h-[42px] flex-1 rounded-lg bg-teal-600 px-4 text-xs font-semibold text-white hover:bg-teal-700"
            >
              Add project
            </button>
            <button
              type="button"
              onClick={() => setShowAdd(false)}
              className="min-h-[42px] rounded-lg border border-slate-300 px-3 text-xs font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
            >
              Cancel
            </button>
          </div>

          <div className="sm:col-span-2 lg:col-span-3">
            <label htmlFor="proj-desc" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Scope &amp; Isolation Notes
            </label>
            <input
              id="proj-desc"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional notes about this project..."
              className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
        </form>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-12 text-center dark:border-slate-700 dark:bg-slate-900">
          <FolderKanban className="mx-auto h-7 w-7 text-slate-400" aria-hidden="true" />
          <p className="mt-3 text-sm font-semibold text-slate-800 dark:text-slate-100">{projects.length ? 'No matching projects' : 'No projects added yet'}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{projects.length ? 'Change the search or status filter.' : 'Add a project to manage its work from PALASH AI.'}</p>
          {!projects.length && <button type="button" onClick={() => setShowAdd(true)} className="mt-4 min-h-[38px] rounded-lg bg-teal-700 px-4 text-xs font-semibold text-white hover:bg-teal-800">Add your first project</button>}
        </div>
      ) : (
      <div className="grid gap-3 xl:grid-cols-2">
        {filtered.map((proj) => (
          <article
            key={proj.id}
            className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  {proj.name}
                </h3>
                <p className="mt-0.5 font-mono text-xs text-slate-500 dark:text-slate-400">
                  {proj.slug} · {proj.category.toUpperCase()}
                </p>
              </div>

              <select
                aria-label={`Status for ${proj.name}`}
                value={proj.status}
                onChange={(e) =>
                  onUpdateProject(proj.id, { status: e.target.value as ProjectItem['status'] })
                }
                className="min-h-[36px] rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-semibold capitalize text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                <option value="active">Active</option>
                <option value="attention">Attention</option>
                <option value="maintenance">Maintenance</option>
              </select>
            </div>

            {proj.description && <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">{proj.description}</p>}

            <details className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
              <summary className="cursor-pointer text-[11px] font-semibold text-teal-700 dark:text-teal-400">Project settings and access details</summary>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
              <div>
                <dt className="text-slate-500 dark:text-slate-400">Database Boundary</dt>
                <dd className="mt-0.5 font-mono text-[11px] font-medium text-slate-900 dark:text-slate-100">
                  {proj.dbIsolationLabel}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500 dark:text-slate-400">Permission Scope</dt>
                <dd className="mt-0.5 font-mono text-[11px] font-medium text-slate-900 dark:text-slate-100">
                  {proj.permissionScope}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500 dark:text-slate-400">Deployment Policy</dt>
                <dd className="mt-0.5 font-mono text-[11px] font-medium text-slate-900 dark:text-slate-100">
                  {proj.deploymentPolicy}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500 dark:text-slate-400">Target Deadline</dt>
                <dd className="mt-0.5 font-mono text-[11px] tabular-nums font-medium text-slate-900 dark:text-slate-100">
                  {proj.deadline}
                </dd>
              </div>
            </dl>
            </details>

            <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-600 dark:text-slate-400">Completion Progress</span>
                <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-white">
                  {proj.progress}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={proj.progress}
                aria-label={`Progress for ${proj.name}`}
                onChange={(e) => onUpdateProject(proj.id, { progress: Number(e.target.value) })}
                className="mt-2 w-full accent-teal-600"
              />
            </div>
          </article>
        ))}
      </div>
      )}
    </div>
  );
};
