import React, { useEffect, useState } from 'react';
import { Activity, Brain, Mic, MicOff, Play, Plus, RotateCcw, Send } from 'lucide-react';
import type { ActionType, AgentId, AgentItem, MemoryItem, ProjectItem, TaskItem } from '../types';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  agentName?: string;
  content: string;
  timestamp: string;
}

interface AgentsChatViewProps {
  token: string;
  agents: AgentItem[];
  projects: ProjectItem[];
  tasks: TaskItem[];
  memories: MemoryItem[];
  emergencyStop: boolean;
  onCreateTask: (payload: {
    title: string;
    description: string;
    projectId: string;
    assignedAgentId: AgentId;
    actionType: ActionType;
  }) => Promise<void>;
  onExecuteTask: (taskId: string) => Promise<void>;
  onRetryTask: (taskId: string) => Promise<void>;
  busyAction: string | null;
}

export const AgentsChatView: React.FC<AgentsChatViewProps> = ({
  token,
  agents,
  projects,
  tasks,
  memories,
  emergencyStop,
  onCreateTask,
  onExecuteTask,
  onRetryTask,
  busyAction,
}) => {
  const [selectedAgentId, setSelectedAgentId] = useState<AgentId>('chief-agent');
  const [selectedProjectId, setSelectedProjectId] = useState<string>(projects[0]?.id || 'palash-ai');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [integrations, setIntegrations] = useState<Array<{ id: string; name: string; connected: boolean; setup?: string; accountName?: string | null }>>([]);
  const [integrationProvider, setIntegrationProvider] = useState('facebook_page');
  const [integrationToken, setIntegrationToken] = useState('');
  const [integrationAccountId, setIntegrationAccountId] = useState('');
  const [integrationBusy, setIntegrationBusy] = useState(false);
  const [integrationError, setIntegrationError] = useState<string | null>(null);

  const [showNewTask, setShowNewTask] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDesc, setTaskDesc] = useState('');
  const [taskAgent, setTaskAgent] = useState<AgentId>('software-engineer');
  const [taskAction, setTaskAction] = useState<ActionType>('code_analysis');
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [taskFilter, setTaskFilter] = useState<string>('all');
  const [liveProgressMap, setLiveProgressMap] = useState<
    Record<string, { progressPercent: number; currentStage: string | null; status: string }>
  >({});

  useEffect(() => {
    let active = true;
    fetch('/api/integrations', { headers: { Authorization: 'Bearer ' + token } })
      .then(async (res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data) setIntegrations(data.providers || data.integrations || []);
      })
      .catch(() => {
        if (active) setIntegrations([]);
      });
    return () => { active = false; };
  }, [token]);

  // Poll live task progress from backend whenever tasks are executing
  useEffect(() => {
    const hasActiveTask = tasks.some((t) => t.status === 'running') || busyAction?.startsWith('exec-');
    if (!hasActiveTask) return;

    const fetchLiveProgress = async () => {
      try {
        const res = await fetch('/api/tasks/live-progress', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          const map: Record<string, { progressPercent: number; currentStage: string | null; status: string }> = {};
          for (const item of data.tasks || []) {
            map[item.id] = {
              progressPercent: item.progressPercent,
              currentStage: item.currentStage,
              status: item.status,
            };
          }
          setLiveProgressMap(map);
        }
      } catch {
        // graceful polling
      }
    };

    fetchLiveProgress();
    const interval = setInterval(fetchLiveProgress, 600);
    return () => clearInterval(interval);
  }, [tasks, busyAction, token]);

  const handleConnectIntegration = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!integrationToken.trim()) return;
    setIntegrationBusy(true);
    setIntegrationError(null);
    try {
      const accountField =
        integrationProvider === 'facebook_page' ? 'pageId'
          : integrationProvider === 'instagram_business' ? 'instagramUserId'
            : integrationProvider === 'whatsapp_business' ? 'phoneNumberId'
              : 'authorUrn';
      const body: Record<string, string> = { accessToken: integrationToken.trim() };
      if (integrationAccountId.trim()) body[accountField] = integrationAccountId.trim();
      const res = await fetch('/api/integrations/' + integrationProvider + '/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Provider verification failed.');
      setIntegrationToken('');
      setIntegrationAccountId('');
      const status = await fetch('/api/integrations', { headers: { Authorization: 'Bearer ' + token } });
      if (status.ok) setIntegrations((await status.json()).providers || []);
    } catch (error) {
      setIntegrationError(error instanceof Error ? error.message : 'Integration connection failed.');
    } finally {
      setIntegrationBusy(false);
    }
  };

  const handleDisconnectIntegration = async (provider: string) => {
    setIntegrationBusy(true);
    setIntegrationError(null);
    try {
      const res = await fetch('/api/integrations/' + provider + '/disconnect', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Disconnect failed.');
      const status = await fetch('/api/integrations', { headers: { Authorization: 'Bearer ' + token } });
      if (status.ok) setIntegrations((await status.json()).providers || []);
    } catch (error) {
      setIntegrationError(error instanceof Error ? error.message : 'Integration disconnect failed.');
    } finally {
      setIntegrationBusy(false);
    }
  };

  const sendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = chatInput.trim();
    if (!trimmed) return;

    const userMsg: ChatMessage = {
      id: `m-${Date.now()}`,
      role: 'user',
      content: trimmed,
      timestamp: new Date().toISOString(),
    };
    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setChatInput('');
    setChatError(null);
    setChatBusy(true);

    try {
      const res = await fetch('/api/agent/command', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: trimmed,
          agentId: selectedAgentId,
          projectId: selectedProjectId,
          history: nextHistory.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setChatError(data.error || 'Agent chat failed.');
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: `m-${Date.now()}-ai`,
            role: 'assistant',
            agentName: data.agentName,
            content: data.reply,
            timestamp: data.timestamp,
          },
        ]);
      }
    } catch {
      setChatError('Network error reaching agent engine.');
    } finally {
      setChatBusy(false);
    }
  };

  const handleVoiceChat = () => {
    const SpeechRecognition =
      (window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setChatError('Browser voice recognition is unavailable in this environment.');
      return;
    }

    const recognition = new SpeechRecognition() as {
      lang: string;
      interimResults: boolean;
      onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
      onerror: () => void;
      onend: () => void;
      start: () => void;
    };
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    setListening(true);
    recognition.onresult = (event) => {
      const t = event.results?.[0]?.[0]?.transcript || '';
      if (t) setChatInput((prev) => (prev ? `${prev} ${t}` : t));
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognition.start();
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim()) return;
    await onCreateTask({
      title: taskTitle.trim(),
      description: taskDesc.trim() || taskTitle.trim(),
      projectId: selectedProjectId,
      assignedAgentId: taskAgent,
      actionType: taskAction,
    });
    setTaskTitle('');
    setTaskDesc('');
    setShowNewTask(false);
  };

  const filteredTasks =
    taskFilter === 'all' ? tasks : tasks.filter((t) => t.status === taskFilter);

  const runningTasks = tasks.filter(
    (t) => t.status === 'running' || busyAction === `exec-${t.id}`,
  );

  return (
    <div className="space-y-8">
      {/* Interactive Agent Chat & Voice Console */}
      <div className="grid gap-6 lg:grid-cols-12">
        <section className="flex flex-col rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:col-span-7">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-5 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Agent Command Chat
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Give PALASH AI a task in Bengali or English. Safe internal work runs automatically; external actions require approval and a connected provider.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap shrink-0">
              <label htmlFor="chat-agent-select" className="sr-only">
                Select Agent
              </label>
              <select
                id="chat-agent-select"
                value={selectedAgentId}
                onChange={(e) => setSelectedAgentId(e.target.value as AgentId)}
                className="min-h-[40px] max-w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>

              <label htmlFor="chat-project-select" className="sr-only">
                Select Project Context
              </label>
              <select
                id="chat-project-select"
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="min-h-[40px] max-w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto p-5 min-h-[280px] max-h-[420px]">
            {messages.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Start an instruction or question in English or Bengali
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Example: &ldquo;Review Saudi Fast Food POS VAT rounding logic and suggest test cases.&rdquo;
                </p>
              </div>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}
                >
                  <span className="mb-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    {m.role === 'user' ? 'Owner' : m.agentName || 'Agent'} ·{' '}
                    {new Date(m.timestamp).toLocaleTimeString()}
                  </span>
                  <div
                    className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-4 py-3 text-sm leading-relaxed ${
                      m.role === 'user'
                        ? 'bg-teal-600 text-white'
                        : 'border border-slate-200 bg-slate-50 text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100'
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))
            )}
          </div>

          {chatError && (
            <div className="mx-5 mb-3 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
              {chatError}
            </div>
          )}

          <form
            onSubmit={sendChat}
            className="flex items-center gap-2 border-t border-slate-200 p-4 dark:border-slate-800"
          >
            <label htmlFor="agent-chat-input" className="sr-only">
              Message to agent
            </label>
            <input
              id="agent-chat-input"
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder={emergencyStop ? 'System halted by Emergency Stop' : 'Tell PALASH AI what to do or ask...'}
              disabled={emergencyStop || chatBusy}
              className="min-h-[44px] flex-1 rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-slate-900 focus:border-teal-600 focus:outline-none disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
            <button
              type="button"
              onClick={handleVoiceChat}
              disabled={emergencyStop}
              aria-label={listening ? 'Stop voice input' : 'Start voice input'}
              className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border transition-colors ${
                listening
                  ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
              }`}
            >
              {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
            <button
              type="submit"
              disabled={chatBusy || !chatInput.trim() || emergencyStop}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-teal-600 px-4 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">{chatBusy ? 'Thinking...' : 'Send'}</span>
            </button>
          </form>
        </section>

        {/* Agent Memory & Context Inspector */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 lg:col-span-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-teal-600 dark:text-teal-400" aria-hidden="true" />
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Agent Memory &amp; Project Context
              </h2>
            </div>
            <span className="font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
              {memories.length} records
            </span>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            {integrations.map((item) => (
              <div key={item.id} className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-800">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-semibold text-slate-800 dark:text-slate-100">{item.name}</span>
                  <span className={item.connected ? "text-[10px] font-semibold text-emerald-600" : "text-[10px] font-semibold text-amber-600"}>{item.connected ? "Connected" : "Setup needed"}</span>
                  {item.connected && ['facebook_page','instagram_business','linkedin','youtube','whatsapp_business'].includes(item.id) && <button type="button" disabled={integrationBusy} onClick={() => handleDisconnectIntegration(item.id)} className="text-[10px] text-red-600 underline">Disconnect</button>
                </div>
                {item.setup && <p className="mt-1 text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">{item.setup}</p>}
              </div>
            ))}
          </div>
          <p className="mt-3 text-[10px] text-slate-500 dark:text-slate-400">Public social posts are never published without your approval.</p>
          <form onSubmit={handleConnectIntegration} className="mt-3 space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">Connect a social account</p>
            <select value={integrationProvider} onChange={(e) => { setIntegrationProvider(e.target.value); setIntegrationAccountId(''); }} className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 text-xs dark:border-slate-700 dark:bg-slate-950">
              <option value="facebook_page">Facebook Page</option>
              <option value="instagram_business">Instagram Business</option>
              <option value="linkedin">LinkedIn</option>
              <option value="youtube">YouTube</option>
              <option value="whatsapp_business">WhatsApp Business</option>
            </select>
            <input type="password" autoComplete="off" value={integrationToken} onChange={(e) => setIntegrationToken(e.target.value)} placeholder="Provider access token" className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 text-xs dark:border-slate-700 dark:bg-slate-950" />
            {integrationProvider !== 'youtube' && <input type="text" autoComplete="off" value={integrationAccountId} onChange={(e) => setIntegrationAccountId(e.target.value)} placeholder={integrationProvider === 'facebook_page' ? 'Facebook Page ID' : integrationProvider === 'instagram_business' ? 'Instagram Business User ID' : integrationProvider === 'whatsapp_business' ? 'WhatsApp Phone Number ID' : 'LinkedIn author URN (optional)'} className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 text-xs dark:border-slate-700 dark:bg-slate-950" />}
            <button type="submit" disabled={integrationBusy || !integrationToken.trim()} className="min-h-[38px] w-full rounded-lg bg-teal-600 px-3 text-xs font-semibold text-white disabled:opacity-50">{integrationBusy ? 'Verifying account...' : 'Verify & Connect'}</button>
            {integrationError && <p className="text-[11px] text-red-600">{integrationError}</p>}
            <p className="text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">Tokens are encrypted before storage and never returned to the browser. Use provider-issued Page, Business, or OAuth tokens only.</p>
          </form>

          <ul className="mt-3 divide-y divide-slate-100 max-h-[380px] overflow-y-auto dark:divide-slate-800">
            {memories.map((mem) => (
              <li key={mem.id} className="py-3">
                <p className="text-xs font-medium text-teal-700 dark:text-teal-400">
                  {mem.category} · {mem.projectId} · {mem.agentId}
                </p>
                <p className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-white">
                  {mem.title}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                  {mem.content}
                </p>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Task Execution Queue */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 border-b border-slate-100 pb-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Task Queue &amp; Execution Reports
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Create specialist tasks, run AI execution, inspect reports, and retry failed jobs.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
              {['all', 'queued', 'awaiting_approval', 'completed', 'failed'].map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setTaskFilter(st)}
                  className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    taskFilter === st
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                  }`}
                >
                  {st === 'all' ? 'All' : st.replace('_', ' ')}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setShowNewTask((v) => !v)}
              className="inline-flex min-h-[40px] items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-teal-600 dark:hover:bg-teal-700"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Assign Task</span>
            </button>
          </div>
        </div>

        {showNewTask && (
          <form
            onSubmit={handleCreateTask}
            className="mt-4 grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950 sm:grid-cols-2 lg:grid-cols-4"
          >
            <div>
              <label htmlFor="new-task-title" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Task Title
              </label>
              <input
                id="new-task-title"
                type="text"
                required
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                placeholder="e.g., Audit API rate limit middleware"
                className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900"
              />
            </div>

            <div>
              <label htmlFor="new-task-agent" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Specialist Agent
              </label>
              <select
                id="new-task-agent"
                value={taskAgent}
                onChange={(e) => setTaskAgent(e.target.value as AgentId)}
                className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900"
              >
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="new-task-action" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Action Type (Policy Gate)
              </label>
              <select
                id="new-task-action"
                value={taskAction}
                onChange={(e) => setTaskAction(e.target.value as ActionType)}
                className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900"
              >
                <option value="research">General Research (Auto)</option>
                <option value="planning">Task Planning (Auto)</option>
                <option value="code_analysis">Code Analysis (Auto)</option>
                <option value="test_execution">Test Execution (Sandbox)</option>
                <option value="branch_code_change">Branch Code Change (Approval)</option>
                <option value="database_migration">Database Migration (Mandatory Approval)</option>
                <option value="production_deploy">Production Deploy (Mandatory Approval)</option>
                <option value="external_message">External Message (Mandatory Approval)</option>
                <option value="social_media_publish">Social Media Publishing (Approval + Connected Account)</option>
              </select>
            </div>

            <div className="flex items-end gap-2">
              <button
                type="submit"
                disabled={busyAction === 'create-task'}
                className="min-h-[40px] flex-1 rounded-lg bg-teal-600 px-4 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
              >
                Queue Task
              </button>
              <button
                type="button"
                onClick={() => setShowNewTask(false)}
                className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
              >
                Cancel
              </button>
            </div>

            <div className="sm:col-span-2 lg:col-span-4">
              <label htmlFor="new-task-desc" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Instructions / Context
              </label>
              <input
                id="new-task-desc"
                type="text"
                value={taskDesc}
                onChange={(e) => setTaskDesc(e.target.value)}
                placeholder="Specific deliverables, constraints, or target files..."
                className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900"
              />
            </div>
          </form>
        )}

        {/* Active Tasks Live Progress Monitor Banner */}
        {runningTasks.length > 0 && (
          <div className="mt-4 space-y-3 rounded-xl border border-teal-200 bg-teal-50/60 p-4 dark:border-teal-900/50 dark:bg-teal-950/30">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-400 opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-teal-600" />
                </span>
                <span className="text-xs font-semibold text-teal-950 dark:text-teal-200">
                  Live Task Execution Progress ({runningTasks.length})
                </span>
              </div>
              <span className="font-mono text-[11px] text-teal-700 dark:text-teal-400">
                Live backend telemetry
              </span>
            </div>

            {runningTasks.map((rt) => {
              const live = liveProgressMap[rt.id];
              const pct = live?.progressPercent ?? rt.progressPercent ?? 20;
              const stage = live?.currentStage ?? rt.currentStage ?? 'Executing specialist agent model...';
              return (
                <div
                  key={rt.id}
                  className="rounded-lg border border-teal-200 bg-white p-3.5 shadow-2xs dark:border-teal-900/40 dark:bg-slate-900"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-slate-900 dark:text-white">
                        {rt.title}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                        {rt.assignedAgentId} · {stage}
                      </p>
                    </div>
                    <span className="font-mono text-xs font-bold tabular-nums text-teal-700 dark:text-teal-300">
                      {pct}%
                    </span>
                  </div>
                  <div className="mt-2.5 relative h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      role="progressbar"
                      aria-valuenow={pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      style={{ width: `${Math.max(5, Math.min(100, pct))}%` }}
                      className="h-full rounded-full bg-teal-600 transition-all duration-300 ease-out dark:bg-teal-500"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
          {filteredTasks.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
              No tasks match this filter.
            </p>
          ) : (
            filteredTasks.map((task) => {
              const live = liveProgressMap[task.id];
              const isRunning = task.status === 'running' || busyAction === `exec-${task.id}`;
              const pct = live?.progressPercent ?? task.progressPercent ?? (task.status === 'completed' ? 100 : 0);
              const stage = live?.currentStage ?? task.currentStage;
              return (
                <div key={task.id} className="py-4 space-y-2">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">
                        {task.title}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {task.assignedAgentId} · {task.projectId} · {task.actionType} · Risk: {task.riskLevel} ·{' '}
                        <span className="font-mono tabular-nums">
                          Attempts {task.attempts}/{task.maxAttempts}
                        </span>
                        {task.status === 'completed' && (
                          <span className="font-mono tabular-nums text-emerald-700 dark:text-emerald-400 ml-1.5 font-medium">
                            · 100% completed
                          </span>
                        )}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <span
                        className={`text-xs font-semibold ${
                          task.status === 'completed'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : task.status === 'failed' || task.status === 'cancelled'
                              ? 'text-red-600 dark:text-red-400'
                              : task.status === 'awaiting_approval'
                                ? 'text-amber-700 dark:text-amber-400'
                                : 'text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {task.status.replace('_', ' ')}
                      </span>

                      {task.status === 'queued' && (
                        <button
                          type="button"
                          disabled={busyAction === `exec-${task.id}` || emergencyStop}
                          onClick={() => onExecuteTask(task.id)}
                          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
                        >
                          <Play className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>{busyAction === `exec-${task.id}` ? 'Running...' : 'Execute'}</span>
                        </button>
                      )}

                      {task.status === 'failed' && task.attempts < task.maxAttempts && (
                        <button
                          type="button"
                          disabled={busyAction === `retry-${task.id}`}
                          onClick={() => onRetryTask(task.id)}
                          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        >
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Retry</span>
                        </button>
                      )}

                      {(task.outputReport || task.errorMessage) && (
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedTaskId((cur) => (cur === task.id ? null : task.id))
                          }
                          className="min-h-[38px] rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          {expandedTaskId === task.id ? 'Hide Report' : 'View Report'}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Real-time Progress Bar for Active Tasks */}
                  {isRunning && (
                    <div className="mt-2 space-y-1.5 rounded-lg border border-teal-200 bg-teal-50/60 p-3 dark:border-teal-900/40 dark:bg-teal-950/20">
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 font-medium text-teal-800 dark:text-teal-300">
                          <Activity className="h-3.5 w-3.5 animate-spin text-teal-600 dark:text-teal-400" aria-hidden="true" />
                          <span>{stage || 'Executing specialist agent task...'}</span>
                        </span>
                        <span className="font-mono text-xs font-bold tabular-nums text-teal-800 dark:text-teal-300">
                          {pct}%
                        </span>
                      </div>
                      <div className="relative h-2 w-full overflow-hidden rounded-full bg-teal-200/60 dark:bg-teal-900/50">
                        <div
                          role="progressbar"
                          aria-valuenow={pct}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          style={{ width: `${Math.max(5, Math.min(100, pct))}%` }}
                          className="h-full rounded-full bg-teal-600 transition-all duration-300 ease-out dark:bg-teal-400"
                        />
                      </div>
                    </div>
                  )}

                  {expandedTaskId === task.id && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed whitespace-pre-wrap text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
                      {task.errorMessage ? `Error: ${task.errorMessage}` : task.outputReport}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
};
