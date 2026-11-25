export type VoiceCommandAction =
  | { type: 'EMERGENCY_STOP'; reason: string }
  | { type: 'RESUME_OPERATIONS' }
  | { type: 'NAVIGATE'; section: 'overview' | 'agents' | 'approvals' | 'projects' | 'finance' | 'github' | 'database' | 'monitoring' }
  | { type: 'TRIGGER_BACKUP' }
  | { type: 'TOGGLE_THEME'; targetMode?: 'dark' | 'light' }
  | { type: 'SIGN_OUT' }
  | { type: 'DISPATCH_PROMPT'; prompt: string };

export interface ParsedVoiceCommand {
  rawTranscript: string;
  action: VoiceCommandAction;
  confidenceDescription: string;
  feedbackSpeech: string;
}

/**
 * Normalizes speech input (removes punctuation, lowercases, trims multiple spaces)
 */
export function normalizeTranscript(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parses a voice transcript into an actionable command for PALASH AI.
 * Supports natural English phrases and Bengali translations.
 */
export function parseVoiceCommand(transcript: string): ParsedVoiceCommand | null {
  const norm = normalizeTranscript(transcript);
  if (!norm) return null;

  // 1. Emergency Stop (Priority 1)
  if (
    norm.includes('stop all operations') ||
    norm.includes('stop operations') ||
    norm.includes('emergency stop') ||
    norm.includes('halt all operations') ||
    norm.includes('halt operations') ||
    norm.includes('halt all agents') ||
    norm.includes('halt agents') ||
    norm.includes('halt system') ||
    norm.includes('kill switch') ||
    norm.includes('abort all') ||
    norm.includes('সব কাজ বন্ধ') ||
    norm.includes('কাজ বন্ধ করো') ||
    norm.includes('জরুরি বন্ধ')
  ) {
    return {
      rawTranscript: transcript,
      action: { type: 'EMERGENCY_STOP', reason: 'Voice Command: Stop all operations' },
      confidenceDescription: 'Emergency Stop: Halted all agents and ongoing tasks',
      feedbackSpeech: 'Emergency stop activated. All operations halted.',
    };
  }

  // 2. Resume Operations
  if (
    norm.includes('resume all operations') ||
    norm.includes('resume operations') ||
    norm.includes('resume agents') ||
    norm.includes('resume system') ||
    norm.includes('start operations') ||
    norm.includes('clear emergency stop') ||
    norm.includes('cancel emergency stop') ||
    norm.includes('কাজ শুরু করো') ||
    norm.includes('পুনরায় চালু করো') ||
    norm.includes('চালু করো')
  ) {
    return {
      rawTranscript: transcript,
      action: { type: 'RESUME_OPERATIONS' },
      confidenceDescription: 'Resume Operations: Cleared emergency stop',
      feedbackSpeech: 'Operations resumed. Agents are ready.',
    };
  }

  // 3. Approvals & Safety
  if (
    norm.includes('pending approvals') ||
    norm.includes('pending approval') ||
    norm.includes('show approvals') ||
    norm.includes('open approvals') ||
    norm.includes('view approvals') ||
    norm.includes('go to approvals') ||
    norm.includes('check approvals') ||
    norm.includes('approval queue') ||
    norm.includes('approvals and safety') ||
    norm.includes('অনুমোদন দেখাও') ||
    norm.includes('অনুমোদন')
  ) {
    return {
      rawTranscript: transcript,
      action: { type: 'NAVIGATE', section: 'approvals' },
      confidenceDescription: 'Navigate to Approvals & Safety Queue',
      feedbackSpeech: 'Opening pending approvals queue.',
    };
  }

  // 4. Command Overview / Dashboard
  if (
    norm.includes('command overview') ||
    norm.includes('show overview') ||
    norm.includes('go to overview') ||
    norm.includes('open overview') ||
    norm.includes('go to dashboard') ||
    norm.includes('open dashboard') ||
    norm.includes('show dashboard') ||
    norm.includes('command center') ||
    norm.includes('home page') ||
    norm === 'overview' ||
    norm === 'dashboard' ||
    norm === 'home' ||
    norm.includes('ড্যাশবোর্ড') ||
    norm.includes('হোম পেজ')
  ) {
    return {
      rawTranscript: transcript,
      action: { type: 'NAVIGATE', section: 'overview' },
      confidenceDescription: 'Navigate to Command Overview',
      feedbackSpeech: 'Navigating to Command Overview.',
    };
  }

  // 5. Agents & Queue / Chat
  if (
    norm.includes('open agents') ||
    norm.includes('show agents') ||
    norm.includes('go to agents') ||
    norm.includes('agents and queue') ||
    norm.includes('agent chat') ||
    norm.includes('open agent chat') ||
    norm.includes('command chat') ||
    norm.includes('task queue') ||
    norm.includes('show tasks') ||
    norm.includes('open tasks') ||
    norm === 'agents' ||
    norm === 'chat' ||
    norm.includes('এজেন্ট দেখাও') ||
    norm.includes('টাস্ক কিউ')
  ) {
    return {
      rawTranscript: transcript,
      action: { type: 'NAVIGATE', section: 'agents' },
      confidenceDescription: 'Navigate to Agents & Queue Console',
      feedbackSpeech: 'Opening Agent Command Chat and Queue.',
    };
  }

  // 6. Projects Center
  if (
    norm.includes('show projects') ||
    norm.includes('open projects') ||
    norm.includes('go to projects') ||
    norm.includes('projects center') ||
    norm.includes('project list') ||
    norm === 'projects' ||
    norm.includes('প্রজেক্ট দেখাও') ||
    norm.includes('প্রজেক্ট')
  ) {
    return {
      rawTranscript: transcript,
      action: { type: 'NAVIGATE', section: 'projects' },
      confidenceDescription: 'Navigate to Projects Center',
      feedbackSpeech: 'Opening Projects Center.',
    };
  }

  // 7. Business & Financial Ledger (P&L)
  if (
    norm.includes('show finance') ||
    norm.includes('open finance') ||
    norm.includes('go to finance') ||
    norm.includes('business and finance') ||
    norm.includes('business p and l') ||
    norm.includes('profit and loss') ||
    norm.includes('show p and l') ||
    norm.includes('financial summary') ||
    norm.includes('ledger') ||
    norm.includes('open ledger') ||
    norm === 'finance' ||
    norm.includes('হিসাব দেখাও') ||
    norm.includes('আর্থিক হিসাব')
  ) {
    return {
      rawTranscript: transcript,
      action: { type: 'NAVIGATE', section: 'finance' },
      confidenceDescription: 'Navigate to Business & Financial Management',
      feedbackSpeech: 'Opening Business and Financial P&L.',
    };
  }

  // 8. GitHub Engineering
  if (
    norm.includes('show github') ||
    norm.includes('open github') ||
    norm.includes('go to github') ||
    norm.includes('github engineering') ||
    norm.includes('engineering') ||
    norm.includes('inspect repository') ||
    norm.includes('code review') ||
    norm === 'github' ||
    norm.includes('গিটহাব দেখাও') ||
    norm.includes('গিটহাব')
  ) {
    return {
      rawTranscript: transcript,
      action: { type: 'NAVIGATE', section: 'github' },
      confidenceDescription: 'Navigate to GitHub Engineering & Code Inspection',
      feedbackSpeech: 'Opening GitHub Engineering.',
    };
  }

  // 9. Database Console
  if (
    norm.includes('open database') ||
    norm.includes('show database') ||
    norm.includes('go to database') ||
    norm.includes('database console') ||
    norm.includes('sql console') ||
    norm.includes('database schema') ||
    norm.includes('show tables') ||
    norm === 'database' ||
    norm === 'db' ||
    norm.includes('ডাটাবেস দেখাও') ||
    norm.includes('ডাটাবেস')
  ) {
    return {
      rawTranscript: transcript,
      action: { type: 'NAVIGATE', section: 'database' },
      confidenceDescription: 'Navigate to Database Schema & SQL Console',
      feedbackSpeech: 'Opening Database Console.',
    };
  }

  // 10. Monitoring & Audit
  if (
    norm.includes('show monitoring') ||
    norm.includes('open monitoring') ||
    norm.includes('go to monitoring') ||
    norm.includes('monitoring and audit') ||
    norm.includes('system reliability') ||
    norm.includes('telemetry') ||
    norm.includes('audit logs') ||
    norm.includes('audit trail') ||
    norm.includes('readiness audit') ||
    norm.includes('system readiness') ||
    norm === 'monitoring' ||
    norm.includes('মনিটরিং দেখাও') ||
    norm.includes('অডিট লগ')
  ) {
    return {
      rawTranscript: transcript,
      action: { type: 'NAVIGATE', section: 'monitoring' },
      confidenceDescription: 'Navigate to Reliability Telemetry & Audit Logs',
      feedbackSpeech: 'Opening Monitoring and Audit Logs.',
    };
  }

  // 11. Trigger Verified Backup Snapshot
  if (
    norm.includes('verify and snapshot backup') ||
    norm.includes('snapshot backup') ||
    norm.includes('take backup') ||
    norm.includes('run backup') ||
    norm.includes('create backup') ||
    norm.includes('verify backup') ||
    norm.includes('backup database') ||
    norm.includes('ব্যাকআপ নাও') ||
    norm.includes('ডাটাবেস ব্যাকআপ')
  ) {
    return {
      rawTranscript: transcript,
      action: { type: 'TRIGGER_BACKUP' },
      confidenceDescription: 'Trigger Verified 7-Table Database Snapshot Backup',
      feedbackSpeech: 'Running verified database backup snapshot.',
    };
  }

  // 12. Theme Toggles
  if (
    norm.includes('switch to dark mode') ||
    norm.includes('switch to dark theme') ||
    norm.includes('dark mode') ||
    norm.includes('dark theme')
  ) {
    return {
      rawTranscript: transcript,
      action: { type: 'TOGGLE_THEME', targetMode: 'dark' },
      confidenceDescription: 'Switch to Dark Theme',
      feedbackSpeech: 'Switched to dark theme.',
    };
  }

  if (
    norm.includes('switch to light mode') ||
    norm.includes('switch to light theme') ||
    norm.includes('light mode') ||
    norm.includes('light theme')
  ) {
    return {
      rawTranscript: transcript,
      action: { type: 'TOGGLE_THEME', targetMode: 'light' },
      confidenceDescription: 'Switch to Light Theme',
      feedbackSpeech: 'Switched to light theme.',
    };
  }

  if (norm.includes('toggle theme') || norm.includes('change theme')) {
    return {
      rawTranscript: transcript,
      action: { type: 'TOGGLE_THEME' },
      confidenceDescription: 'Toggle Theme Appearance',
      feedbackSpeech: 'Theme toggled.',
    };
  }

  // 13. Sign Out
  if (norm === 'sign out' || norm === 'log out' || norm === 'logout' || norm.includes('লগআউট')) {
    return {
      rawTranscript: transcript,
      action: { type: 'SIGN_OUT' },
      confidenceDescription: 'Sign Out of PALASH AI',
      feedbackSpeech: 'Signing out.',
    };
  }

  // 14. Conversational / Instruction Dispatch to Agents
  // If the user speaks an instruction starting with "ask", "tell", "instruct", "plan", "analyze", "create task", "mission"
  const promptMatch = norm.match(/^(?:ask|tell|instruct|plan|analyze|check|review|run|execute|create task|mission)\s+(.+)$/i);
  if (promptMatch && promptMatch[1]) {
    return {
      rawTranscript: transcript,
      action: { type: 'DISPATCH_PROMPT', prompt: transcript },
      confidenceDescription: `Dispatch Instruction to Chief Agent: "${transcript}"`,
      feedbackSpeech: 'Dispatching instruction to Chief Agent.',
    };
  }

  // Fallback: If transcript has substantial text (at least 3 words), treat as an agent instruction
  if (norm.split(' ').length >= 3) {
    return {
      rawTranscript: transcript,
      action: { type: 'DISPATCH_PROMPT', prompt: transcript },
      confidenceDescription: `Dispatch Prompt to Agents: "${transcript}"`,
      feedbackSpeech: 'Dispatching to Agent Command Center.',
    };
  }

  return null;
}
