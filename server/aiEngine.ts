import { GoogleGenAI, Type } from '@google/genai';
import type { ActionType, AgentId, AgentRecord, MemoryRecord, ProjectRecord, TaskRecord } from './core/types.ts';

const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || 'gemini-3.8-flash';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY is not configured. Add a valid key in Settings > Secrets.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function formatGeminiError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || 'Gemini API request failed');
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string; code?: number; status?: string } };
    if (parsed?.error?.message) {
      return `${parsed.error.message} (HTTP ${parsed.error.code || 503})`;
    }
  } catch {
    // not JSON, inspect substring
  }
  if (raw.includes('RESOURCE_EXHAUSTED') || raw.includes('429')) {
    return 'Free-tier AI quota temporarily reached (HTTP 429). Retry shortly or upgrade key in Settings > Secrets.';
  }
  if (raw.includes('PERMISSION_DENIED') || raw.includes('API_KEY_INVALID')) {
    return 'Gemini API key is invalid or unauthorized. Verify GEMINI_API_KEY in Settings > Secrets.';
  }
  return raw;
}

async function withGeminiRetry<T>(operation: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient = /503|UNAVAILABLE|429|ECONNRESET|ETIMEDOUT/i.test(msg);
      if (!isTransient || attempt === maxRetries) {
        throw new Error(formatGeminiError(err));
      }
      const delayMs = 700 * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error(formatGeminiError(lastErr));
}

export interface PlannedSubtask {
  title: string;
  description: string;
  assignedAgentId: AgentId;
  actionType: ActionType;
}

export interface ChiefPlanResult {
  executiveSummary: string;
  tasks: PlannedSubtask[];
}

export async function generateChiefAgentPlan(
  objective: string,
  project: ProjectRecord,
  agents: AgentRecord[],
  memories: MemoryRecord[]
): Promise<ChiefPlanResult> {
  const ai = getGeminiClient();
  const agentList = agents.map((a) => `- ${a.id} (${a.name}): ${a.specialty}`).join('\n');
  const memoryText = memories
    .slice(0, 6)
    .map((m) => `[${m.category}] ${m.title}: ${m.content}`)
    .join('\n');

  const response = await withGeminiRetry(() =>
    ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: `Project: ${project.name} (${project.slug})
Permission Scope: ${project.permissionScope}
Deployment Policy: ${project.deploymentPolicy}
DB Context: ${project.dbIsolationLabel}

Available Specialist Agents:
${agentList}

Relevant Memory Context:
${memoryText || 'None recorded yet.'}

Owner Objective:
${objective}

Decompose this objective into 2 to 4 concrete, sequential, non-overlapping tasks assigned to the best agents. Use realistic actionType values from: research, planning, code_analysis, test_execution, branch_code_change, production_deploy, database_migration, payment_purchase, external_message, social_media_publish.`,
      config: {
        systemInstruction:
          'You are the Chief Agent of PALASH AI, an autonomous multi-agent engineering and business operations system. Never fabricate results, always enforce project isolation, and mark risky code changes, database migrations, or production deployments with their exact actionType so human approval policies engage.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            executiveSummary: {
              type: Type.STRING,
              description: 'Concise 2-sentence orchestration strategy from the Chief Agent.',
            },
            tasks: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                  assignedAgentId: { type: Type.STRING },
                  actionType: { type: Type.STRING },
                },
                required: ['title', 'description', 'assignedAgentId', 'actionType'],
              },
            },
          },
          required: ['executiveSummary', 'tasks'],
        },
      },
    })
  );

  const parsed = JSON.parse((response.text ?? '{}').trim()) as ChiefPlanResult;
  const validAgentIds = new Set(agents.map((a) => a.id));
  const validActions = new Set<ActionType>([
    'research',
    'planning',
    'code_analysis',
    'test_execution',
    'branch_code_change',
    'production_deploy',
    'database_migration',
    'database_deletion',
    'payment_purchase',
    'external_message',
    'social_media_publish',
  ]);

  const sanitizedTasks: PlannedSubtask[] = (parsed.tasks || []).slice(0, 5).map((t) => ({
    title: String(t.title || 'Untitled Agent Task').slice(0, 120),
    description: String(t.description || objective).slice(0, 500),
    assignedAgentId: validAgentIds.has(t.assignedAgentId as AgentId)
      ? (t.assignedAgentId as AgentId)
      : 'software-engineer',
    actionType: validActions.has(t.actionType as ActionType)
      ? (t.actionType as ActionType)
      : 'planning',
  }));

  return {
    executiveSummary: parsed.executiveSummary || 'Chief Agent decomposed the mission across specialist agents.',
    tasks: sanitizedTasks.length > 0 ? sanitizedTasks : [
      {
        title: `Analyze objective for ${project.name}`,
        description: objective,
        assignedAgentId: 'chief-agent',
        actionType: 'planning',
      },
    ],
  };
}

export async function runSpecialistAgentExecution(
  task: TaskRecord,
  agent: AgentRecord,
  project: ProjectRecord,
  memories: MemoryRecord[]
): Promise<string> {
  const ai = getGeminiClient();
  const contextLines = memories
    .filter((m) => m.projectId === project.id)
    .slice(0, 5)
    .map((m) => `- ${m.title}: ${m.content}`)
    .join('\n');

  const response = await withGeminiRetry(() =>
    ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: `You are preparing an auditable work package for the Owner. Produce a rigorous, implementation-oriented report with these sections:
1. Objective and Scope
2. Work Actually Performed (reasoning and analysis only in this execution environment)
3. Findings, ordered by severity and impact
4. Exact Next Actions, ordered and independently verifiable
5. Verification Plan with concrete commands, expected outcomes, and failure handling
6. Resume Checkpoint: completed steps, remaining steps, blockers, and the precise next step

Task Title: ${task.title}
Task Description: ${task.description}
Action Classification: ${task.actionType}
Project: ${project.name} (${project.slug})
Repository: ${project.slug}
Permission Scope: ${project.permissionScope}
Project Memory:
${contextLines || 'No prior memory stored.'}

Execution requirements:
- For code_analysis: identify concrete defects, affected files only when known, severity, and reproducible evidence.
- For test_execution: provide exact test/lint/build commands and distinguish tests actually run from tests merely recommended.
- For branch_code_change: provide a unified diff proposal with exact repository-relative paths, followed by tests and rollback notes. Do not claim the diff was applied.
- For research or planning: provide evidence-based findings, decision criteria, dependencies, and a sequenced implementation plan.
- For any task too large for one pass: split it into small checkpoints and preserve enough detail in the Resume Checkpoint for another run to continue without repeating completed analysis.
- If repository contents, shell execution, credentials, or external tools are unavailable, state that limitation explicitly and do not invent file contents, test results, commits, deployments, or external actions.
- Never mark a recommendation, generated patch, or proposed command as an action already executed.`,
      config: {
        systemInstruction: `You are the ${agent.name} (${agent.title}) inside PALASH AI. Specialty: ${agent.specialty}. Act as a senior autonomous engineering and operations specialist: be precise, evidence-led, technically detailed, and execution-oriented. This call has no repository write, shell, browser, or external-service tools; you can analyze and prepare work packages only. Never claim code was changed, tests were run, a commit was created, or an external action succeeded unless a tool result in this execution proves it. Never bypass Owner approval for restricted actions.`,
      },
    })
  );

  const output = response.text?.trim();
  if (!output) {
    throw new Error('Model returned an empty execution report.');
  }
  return output;
}

export async function runInteractiveAgentChat(
  message: string,
  agent: AgentRecord,
  project: ProjectRecord,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  memories: MemoryRecord[]
): Promise<string> {
  const ai = getGeminiClient();
  const contextLines = memories
    .filter((m) => m.projectId === project.id)
    .slice(0, 6)
    .map((m) => `- [${m.category}] ${m.title}: ${m.content}`)
    .join('\n');

  const recentTranscript = history
    .slice(-6)
    .map((h) => `${h.role === 'user' ? 'Owner' : agent.name}: ${h.content}`)
    .join('\n');

  const prompt = `Project Context: ${project.name} (${project.slug}) · Policy: ${project.deploymentPolicy} · DB: ${project.dbIsolationLabel}
Memory:
${contextLines || 'None'}

Recent Conversation:
${recentTranscript || 'New session'}

Owner Message:
${message}`;
  const systemInstruction = `You are the ${agent.name} (${agent.title}) of PALASH AI. Specialty: ${agent.specialty}. Respond clearly, practically, and concisely. You can reply in English or Bengali matching the owner's language. Respect all approval gates: never bypass human approval for production deployment, database migration/deletion, payments, or external messages.`;
  let output = '';
  try {
    const response = await withGeminiRetry(() => ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: { systemInstruction },
    }));
    output = response.text?.trim() || '';
  } catch (geminiError) {
    const openaiKey = process.env.OPENAI_API_KEY?.trim();
    if (!openaiKey) throw geminiError;
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + openaiKey },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL?.trim() || 'gpt-4.1-mini', instructions: systemInstruction, input: prompt }),
      signal: AbortSignal.timeout(20_000),
    });
    const data = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }>; error?: { message?: string } };
    if (!response.ok) throw new Error(data.error?.message || 'OpenAI API request failed.');
    output = String(data.output_text || data.output?.flatMap((item) => item.content || []).filter((item) => item.type === 'output_text').map((item) => item.text || '').join('') || '');
  }
  const text = output.trim();
  if (!text) {
    throw new Error('Agent returned an empty chat response.');
  }
  return text;
}

export async function analyzeSourceCodeWithAgent(
  repoSlug: string,
  filePath: string,
  sourceCode: string
): Promise<string> {
  const ai = getGeminiClient();
  const snippet = sourceCode.slice(0, 14_000);

  const response = await withGeminiRetry(() =>
    ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: `Repository: ${repoSlug}
File: ${filePath}

\`\`\`
${snippet}
\`\`\`

Perform a Software Engineer & Quality Auditor inspection:
1. Architectural Role & Key Logic
2. Potential Bugs, Edge Cases, or Security Risks
3. Recommended Automated Tests & Suggested Branch Improvement`,
      config: {
        systemInstruction:
          'You are the Quality Auditor and Software Engineer inside PALASH AI. Provide exact, actionable code findings based solely on the provided file. Never invent line contents not visible in the source.',
      },
    })
  );

  const text = response.text?.trim();
  if (!text) {
    throw new Error('Source code analysis returned empty output.');
  }
  return text;
}

