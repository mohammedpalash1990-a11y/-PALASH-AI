import React, { useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, Cloud, Github, Instagram, Linkedin, Mail, Youtube } from 'lucide-react';

interface IntegrationItem {
  id: string;
  name: string;
  category: string;
  credentialsPresent: boolean;
  required: string[];
  status: string;
  readyForApiCall: boolean;
}

interface IntegrationsViewProps {
  token: string;
}

const icons: Record<string, React.ComponentType<{ className?: string }>> = {
  github: Github,
  cloudflare: Cloud,
  meta: CircleAlert,
  instagram: Instagram,
  youtube: Youtube,
  linkedin: Linkedin,
  gmail: Mail,
};

export const IntegrationsView: React.FC<IntegrationsViewProps> = ({ token }) => {
  const [items, setItems] = useState<IntegrationItem[]>([]);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/integrations', { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not load integration status.');
        if (active) {
          setItems(data.integrations || []);
          setNote(data.note || '');
        }
      })
      .catch((err) => {
        if (active) setError(err.message || 'Integration status unavailable.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [token]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Connected Services</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Provider readiness for project operations and social publishing. Secrets are never displayed here.
        </p>
      </div>

      {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">{error}</div>}
      {loading && <p className="text-sm text-slate-500">Checking provider configuration...</p>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => {
          const Icon = icons[item.id] || CircleAlert;
          return (
            <article key={item.id} className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="rounded-lg bg-slate-100 p-2.5 text-slate-700 dark:bg-slate-800 dark:text-slate-200"><Icon className="h-5 w-5" /></span>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{item.name}</h3>
                    <p className="text-xs capitalize text-slate-500">{item.category}</p>
                  </div>
                </div>
                {item.credentialsPresent
                  ? <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600"><CircleAlert className="h-3.5 w-3.5" /> Credentials present</span>
                  : <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500"><CircleAlert className="h-3.5 w-3.5" /> Not configured</span>}
              </div>
              <p className="mt-4 text-xs leading-5 text-slate-500 dark:text-slate-400">
                {item.credentialsPresent
                  ? 'Credentials are present. Live API access and required OAuth scopes still need verification.'
                  : 'Provider credentials are not configured in the server environment.'}
              </p>
              <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Required server settings</p>
                <p className="mt-1 break-words font-mono text-[11px] text-slate-600 dark:text-slate-300">{item.required.join(' · ')}</p>
              </div>
            </article>
          );
        })}
      </div>

      {!loading && items.length === 0 && <p className="text-sm text-slate-500">No provider records returned.</p>}
      {note && <p className="rounded-lg bg-slate-100 p-3 text-xs leading-5 text-slate-600 dark:bg-slate-900 dark:text-slate-400">{note}</p>}
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
        A provider is not treated as connected just because a token exists. PALASH AI must verify the account, permissions, token expiry, and a safe test API call before enabling publishing or other external actions.
      </div>
    </div>
  );
};
