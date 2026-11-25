import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Mic,
  MicOff,
  Radio,
  Send,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { parseVoiceCommand, type ParsedVoiceCommand } from '../utils/voiceCommands';

// Ambient types for browser Web Speech API
interface SpeechRecognitionResultItem {
  transcript: string;
}

interface SpeechRecognitionResultList {
  length: number;
  [index: number]: {
    isFinal: boolean;
    [subIndex: number]: SpeechRecognitionResultItem;
  };
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: { resultIndex: number; results: SpeechRecognitionResultList }) => void) | null;
  onerror: ((event: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

interface VoiceCommandControllerProps {
  onNavigate: (section: 'overview' | 'agents' | 'approvals' | 'projects' | 'finance' | 'github' | 'database' | 'monitoring') => void;
  onEmergencyStop: (active: boolean, reason?: string) => Promise<void> | void;
  isEmergencyStopActive: boolean;
  onTriggerBackup: () => Promise<void> | void;
  onToggleTheme: () => void;
  onSignOut: () => void;
  onDispatchPrompt?: (prompt: string) => void;
  pendingApprovalsCount?: number;
}

const SAMPLE_COMMANDS = [
  { label: 'Stop all operations', category: 'danger', hint: 'Halts all agents & ongoing jobs' },
  { label: 'Resume all operations', category: 'success', hint: 'Clears emergency stop' },
  { label: 'Show pending approvals', category: 'accent', hint: 'Opens mandatory Owner approval gate' },
  { label: 'Show command overview', category: 'default', hint: 'Navigates to dashboard' },
  { label: 'Open agent chat', category: 'default', hint: 'Direct command to Chief Agent' },
  { label: 'Show projects center', category: 'default', hint: 'Project isolation scopes' },
  { label: 'Show business finance', category: 'default', hint: 'Multi-currency P&L ledger' },
  { label: 'Open GitHub engineering', category: 'default', hint: 'Branches, PRs & code review' },
  { label: 'Open database console', category: 'default', hint: 'Schema & safe SQL guard' },
  { label: 'Verify and snapshot backup', category: 'default', hint: 'Checksum verified 7-table snapshot' },
  { label: 'Show system monitoring', category: 'default', hint: 'Readiness audit & telemetry' },
  { label: 'Switch to dark theme', category: 'default', hint: 'Toggle UI appearance' },
  { label: 'সব কাজ বন্ধ করো', category: 'danger', hint: 'Emergency stop (Bengali)' },
  { label: 'অনুমোদন দেখাও', category: 'accent', hint: 'Approvals queue (Bengali)' },
];

export const VoiceCommandController: React.FC<VoiceCommandControllerProps> = ({
  onNavigate,
  onEmergencyStop,
  isEmergencyStopActive,
  onTriggerBackup,
  onToggleTheme,
  onSignOut,
  onDispatchPrompt,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [manualInput, setManualInput] = useState('');
  const [speechFeedbackEnabled, setSpeechFeedbackEnabled] = useState(true);
  const [lastExecuted, setLastExecuted] = useState<ParsedVoiceCommand | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState(true);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  // Initialize Web Speech API detection
  useEffect(() => {
    const SpeechRecognition =
      (window as unknown as { SpeechRecognition?: SpeechRecognitionConstructor }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionConstructor }).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setIsSupported(false);
    }
  }, []);

  // Text-to-speech confirmation helper
  const speakFeedback = useCallback((text: string) => {
    if (!speechFeedbackEnabled || typeof window === 'undefined' || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
    } catch {
      // Speech synthesis optional
    }
  }, [speechFeedbackEnabled]);

  // Execute a parsed command
  const executeCommand = useCallback(
    async (parsed: ParsedVoiceCommand) => {
      setLastExecuted(parsed);
      setVoiceError(null);
      speakFeedback(parsed.feedbackSpeech);

      switch (parsed.action.type) {
        case 'EMERGENCY_STOP':
          await onEmergencyStop(true, parsed.action.reason);
          break;
        case 'RESUME_OPERATIONS':
          await onEmergencyStop(false);
          break;
        case 'NAVIGATE':
          onNavigate(parsed.action.section);
          break;
        case 'TRIGGER_BACKUP':
          await onTriggerBackup();
          break;
        case 'TOGGLE_THEME':
          onToggleTheme();
          break;
        case 'SIGN_OUT':
          onSignOut();
          break;
        case 'DISPATCH_PROMPT':
          onNavigate('agents');
          if (onDispatchPrompt) {
            onDispatchPrompt(parsed.action.prompt);
          }
          break;
      }
    },
    [onEmergencyStop, onNavigate, onTriggerBackup, onToggleTheme, onSignOut, onDispatchPrompt, speakFeedback]
  );

  // Process text input or speech final result
  const handleProcessTranscript = useCallback(
    (text: string) => {
      const parsed = parseVoiceCommand(text);
      if (!parsed) {
        setVoiceError(`Unrecognized command: "${text}". Try "Stop all operations" or "Show pending approvals".`);
        speakFeedback('Command not recognized.');
        return;
      }
      executeCommand(parsed);
    },
    [executeCommand, speakFeedback]
  );

  // Start speech recognition
  const startListening = useCallback(() => {
    setVoiceError(null);
    setTranscript('');
    setInterimTranscript('');

    const SpeechRecognition =
      (window as unknown as { SpeechRecognition?: SpeechRecognitionConstructor }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionConstructor }).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setVoiceError('Web Speech API is not supported in this browser. You can type commands below.');
      setIsOpen(true);
      return;
    }

    try {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // ignore
        }
      }

      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setIsListening(true);
        setIsOpen(true);
      };

      recognition.onresult = (event) => {
        let interim = '';
        let final = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const item = event.results[i];
          const text = item[0]?.transcript || '';
          if (item.isFinal) {
            final += text;
          } else {
            interim += text;
          }
        }

        if (interim) {
          setInterimTranscript(interim);
        }

        if (final) {
          setTranscript(final);
          setInterimTranscript('');
          handleProcessTranscript(final);
        }
      };

      recognition.onerror = (event) => {
        setIsListening(false);
        if (event.error === 'no-speech') {
          setVoiceError('No speech was detected. Please try speaking again.');
        } else if (event.error === 'not-allowed') {
          setVoiceError('Microphone access was denied. Please allow microphone permissions in browser settings.');
        } else {
          setVoiceError(`Microphone error: ${event.error}. You can type voice commands below.`);
        }
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      setIsListening(false);
      setVoiceError(`Could not access microphone: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [handleProcessTranscript]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
    }
    setIsListening(false);
  }, []);

  const toggleListening = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  // Keyboard shortcut: Ctrl + Space or Alt + V, or Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        stopListening();
        setIsOpen(false);
        return;
      }
      if ((e.ctrlKey && e.code === 'Space') || (e.altKey && e.key.toLowerCase() === 'v')) {
        e.preventDefault();
        if (isListening) {
          stopListening();
        } else {
          startListening();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isListening, startListening, stopListening]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualInput.trim()) return;
    setTranscript(manualInput.trim());
    handleProcessTranscript(manualInput.trim());
    setManualInput('');
  };

  return (
    <>
      {/* Header Voice Trigger Button */}
      <button
        type="button"
        onClick={() => {
          setIsOpen((prev) => !prev);
          if (!isOpen && !isListening) {
            startListening();
          }
        }}
        aria-label={isListening ? 'Voice command listening active' : 'Open voice command assistant'}
        title="Voice Command Assistant (Ctrl+Space)"
        className={`relative inline-flex min-h-[40px] items-center gap-2 rounded-lg border px-3 text-xs font-semibold transition-all ${
          isListening
            ? 'border-teal-500 bg-teal-50 text-teal-800 shadow-sm dark:border-teal-500/60 dark:bg-teal-950/50 dark:text-teal-200'
            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
        }`}
      >
        <div className="relative flex items-center justify-center">
          {isListening ? (
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-400 opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-teal-600" />
            </span>
          ) : (
            <Mic className="h-4 w-4 text-teal-600 dark:text-teal-400" aria-hidden="true" />
          )}
        </div>
        <span className="hidden sm:inline">
          {isListening ? 'Listening...' : 'Voice Command'}
        </span>
        <kbd className="hidden lg:inline-block rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          Ctrl+Space
        </kbd>
      </button>

      {/* Voice Assistant Modal / Overlay */}
      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="voice-assistant-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              stopListening();
              setIsOpen(false);
            }
          }}
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/60 p-4 pt-12 backdrop-blur-xs sm:pt-20"
        >
          <div className="relative w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl transition-all dark:border-slate-800 dark:bg-slate-900">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                    isListening
                      ? 'bg-teal-600 text-white'
                      : 'bg-teal-50 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300'
                  }`}
                >
                  <Mic className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h2
                    id="voice-assistant-title"
                    className="font-display text-base font-semibold text-slate-900 dark:text-white"
                  >
                    Voice Command Assistant
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Web Speech API voice-to-text control for PALASH AI
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSpeechFeedbackEnabled((v) => !v)}
                  title={speechFeedbackEnabled ? 'Mute spoken feedback' : 'Enable spoken feedback'}
                  aria-label={speechFeedbackEnabled ? 'Mute spoken feedback' : 'Enable spoken feedback'}
                  className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {speechFeedbackEnabled ? (
                    <Volume2 className="h-4 w-4" />
                  ) : (
                    <VolumeX className="h-4 w-4" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    stopListening();
                    setIsOpen(false);
                  }}
                  aria-label="Close voice assistant"
                  className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Listening Live State & Wave Visualizer */}
            <div className="mt-5 flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-slate-50 p-6 text-center dark:border-slate-800 dark:bg-slate-950">
              <button
                type="button"
                onClick={toggleListening}
                className={`relative flex h-20 w-20 items-center justify-center rounded-full transition-transform active:scale-95 ${
                  isListening
                    ? 'bg-teal-600 text-white ring-8 ring-teal-500/20 shadow-lg shadow-teal-500/25'
                    : 'bg-white text-slate-700 shadow-md hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700'
                }`}
                aria-label={isListening ? 'Stop listening' : 'Start microphone listening'}
              >
                {isListening ? (
                  <Radio className="h-9 w-9 animate-pulse" aria-hidden="true" />
                ) : (
                  <Mic className="h-9 w-9 text-teal-600 dark:text-teal-400" aria-hidden="true" />
                )}
              </button>

              <div className="mt-4">
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  {isListening
                    ? 'Listening... Speak a command now'
                    : 'Microphone is standby. Click to listen'}
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Try saying:{' '}
                  <span className="font-semibold text-teal-700 dark:text-teal-400">
                    &ldquo;Stop all operations&rdquo;
                  </span>{' '}
                  or{' '}
                  <span className="font-semibold text-teal-700 dark:text-teal-400">
                    &ldquo;Show pending approvals&rdquo;
                  </span>
                </p>
              </div>

              {/* Real-time Transcript Bubble */}
              {(isListening || transcript || interimTranscript) && (
                <div className="mt-4 w-full rounded-lg border border-slate-200 bg-white p-3 text-left font-mono text-xs dark:border-slate-800 dark:bg-slate-900">
                  <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                    Speech Transcript:
                  </span>
                  <p className="mt-1 text-slate-900 dark:text-white">
                    {transcript}
                    {interimTranscript && (
                      <span className="text-teal-600 italic dark:text-teal-400">
                        {' '}{interimTranscript}
                      </span>
                    )}
                    {!transcript && !interimTranscript && (
                      <span className="text-slate-400 italic">Waiting for speech input...</span>
                    )}
                  </p>
                </div>
              )}
            </div>

            {/* Error Message */}
            {voiceError && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
              >
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <p className="font-semibold">Voice Input Notice</p>
                  <p className="mt-0.5">{voiceError}</p>
                </div>
              </div>
            )}

            {/* Last Executed Action Banner */}
            {lastExecuted && (
              <div className="mt-4 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  <div>
                    <span className="font-semibold">Executed: </span>
                    <span>{lastExecuted.confidenceDescription}</span>
                  </div>
                </div>
                <span className="font-mono text-[11px] opacity-75">
                  &ldquo;{lastExecuted.rawTranscript}&rdquo;
                </span>
              </div>
            )}

            {/* Text Input Fallback */}
            <form onSubmit={handleManualSubmit} className="mt-5 flex gap-2">
              <label htmlFor="voice-text-command" className="sr-only">
                Type a voice command
              </label>
              <input
                id="voice-text-command"
                type="text"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                placeholder="Or type a command (e.g., Stop all operations, Show pending approvals)..."
                className="min-h-[42px] flex-1 rounded-lg border border-slate-300 bg-white px-3.5 text-xs text-slate-900 focus:border-teal-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
              <button
                type="submit"
                disabled={!manualInput.trim()}
                className="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg bg-teal-600 px-4 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Execute</span>
              </button>
            </form>

            {/* Sample Clickable Voice Commands */}
            <div className="mt-6 border-t border-slate-100 pt-4 dark:border-slate-800">
              <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Quick Voice Commands (Click to test or speak directly):
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {SAMPLE_COMMANDS.map((cmd) => {
                  const isDanger = cmd.category === 'danger';
                  const isSuccess = cmd.category === 'success';
                  const isAccent = cmd.category === 'accent';
                  return (
                    <button
                      key={cmd.label}
                      type="button"
                      onClick={() => {
                        setTranscript(cmd.label);
                        handleProcessTranscript(cmd.label);
                      }}
                      title={cmd.hint}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                        isDanger
                          ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-900/40'
                          : isSuccess
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/40'
                            : isAccent
                              ? 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-900/40'
                              : 'border-slate-200 bg-white text-slate-700 hover:border-teal-500 hover:text-teal-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-teal-500 dark:hover:text-teal-300'
                      }`}
                    >
                      <span>{cmd.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Footer with permission status */}
            <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-3 text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
              <span>
                Web Speech API:{' '}
                <span className={isSupported ? 'text-emerald-700 dark:text-emerald-400 font-medium' : 'text-amber-700 dark:text-amber-400'}>
                  {isSupported ? 'Supported' : 'Not supported in this browser'}
                </span>
                {isEmergencyStopActive && (
                  <span className="ml-2 font-semibold text-red-600 dark:text-red-400">
                    · Emergency Stop Active
                  </span>
                )}
              </span>
              <span>Press Esc or click Close to dismiss</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
