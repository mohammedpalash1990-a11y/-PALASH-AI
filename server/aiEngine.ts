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
      contents: `Execute the assigned task rigorously and produce a structured Execution Report with:
1. Summary of Analysis / Work Performed
2. Concrete Findings, Code/SQL/Financial Recommendations, or Checklist
3. Verification Steps & Next Gate

Task Title: ${task.title}
Task Description: ${task.description}
Action Classification: ${task.actionType}
Project: ${project.name} (${project.slug})
Scope: ${project.permissionScope}
Project Memory:
${contextLines || 'No prior memory stored.'}`,
      config: {
        systemInstruction: `You are the ${agent.name} (${agent.title}) inside PALASH AI. Specialty: ${agent.specialty}. Be concrete, technical, accurate, and concise. Never claim you executed an external production deploy or database drop without approval.`,
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
    output = data.output_text || data.output?.flatMap((item) => item.content || []).filter((item) => item.type === 'output_text').map((item) => item.text || '').join('');
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

