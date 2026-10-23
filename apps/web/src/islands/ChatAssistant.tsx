import { useEffect, useRef, useState } from 'react';
import type { SubmitEvent } from 'react';

import { INITIAL_SUGGESTIONS, queryAssistant } from '@/lib/assistant-engine';
import type { AssistantResponse } from '@/lib/assistant-engine';
import { cleanAssistantOutput, getOpenRouterConfig } from '@/lib/openrouter';
import type { RegionSummary } from '@jaga-daerah/contracts';

interface SpeechRecognitionEvent extends Event {
  results: {
    length: number;
    [index: number]: {
      [index: number]: {
        transcript: string;
      };
    };
  };
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

interface Message {
  id: string;
  sender: 'user' | 'assistant';
  content: string;
  responsePayload?: AssistantResponse;
}

function renderInline(text: string): (string | React.JSX.Element)[] {
  const parts: (string | React.JSX.Element)[] = [];
  const regex = /(\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_|\[([^\]]+)\]\(([^)]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyIdx = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    if (match[2]) {
      // Bold **...**
      parts.push(
        <strong key={`b-${keyIdx++}`} className="font-semibold text-foreground">
          {match[2]}
        </strong>,
      );
    } else if (match[3] || match[4]) {
      // Italic *...* or _..._
      parts.push(
        <em key={`i-${keyIdx++}`} className="italic">
          {match[3] || match[4]}
        </em>,
      );
    } else if (match[5] && match[6]) {
      // Link [text](url)
      parts.push(
        <a
          key={`l-${keyIdx++}`}
          href={match[6]}
          className="text-primary underline underline-offset-2 hover:opacity-80"
          target="_blank"
          rel="noopener noreferrer"
        >
          {match[5]}
        </a>,
      );
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

interface TableHeaderItem {
  id: string;
  text: string;
}

interface TableRowItem {
  id: string;
  cells: { id: string; text: string }[];
}

interface ListItem {
  id: string;
  text: string;
}

interface ParagraphLineItem {
  id: string;
  text: string;
  isLast: boolean;
}

type ParsedBlock =
  | { id: string; type: 'hr' }
  | { id: string; type: 'table'; headers: TableHeaderItem[]; rows: TableRowItem[] }
  | { id: string; type: 'heading'; text: string }
  | { id: string; type: 'list'; items: ListItem[] }
  | { id: string; type: 'paragraph'; lines: ParagraphLineItem[] };

function parseBlocks(content: string): ParsedBlock[] {
  const rawBlocks = content.split(/\n\s*\n/);
  const result: ParsedBlock[] = [];

  for (let bIdx = 0; bIdx < rawBlocks.length; bIdx++) {
    const raw = rawBlocks[bIdx];
    if (!raw) continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const blockId = `blk-${bIdx}`;

    if (/^[-*_]{3,}$/.test(trimmed)) {
      result.push({ id: blockId, type: 'hr' });
      continue;
    }

    const lines = trimmed
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length >= 2 && lines.some((l) => l.startsWith('|') && l.endsWith('|'))) {
      const tableLines = lines.filter((l) => l.startsWith('|') && l.endsWith('|'));
      const separatorIdx = tableLines.findIndex((l) => /^\|(\s*[-:]+\s*\|)+$/.test(l));

      if (separatorIdx > 0 && tableLines[0]) {
        const rawHeaders = tableLines[0]
          .slice(1, -1)
          .split('|')
          .map((c) => c.trim());
        const headers: TableHeaderItem[] = [];
        for (let hIdx = 0; hIdx < rawHeaders.length; hIdx++) {
          const hText = rawHeaders[hIdx] ?? '';
          headers.push({ id: `${blockId}-h-${hIdx}`, text: hText });
        }

        const rawRows = tableLines.slice(separatorIdx + 1);
        const rows: TableRowItem[] = [];
        for (let rIdx = 0; rIdx < rawRows.length; rIdx++) {
          const rowText = rawRows[rIdx] ?? '';
          const rawCells = rowText
            .slice(1, -1)
            .split('|')
            .map((c) => c.trim());
          const cells = [];
          for (let cIdx = 0; cIdx < rawCells.length; cIdx++) {
            const cText = rawCells[cIdx] ?? '';
            cells.push({ id: `${blockId}-r-${rIdx}-c-${cIdx}`, text: cText });
          }
          rows.push({ id: `${blockId}-r-${rIdx}`, cells });
        }

        result.push({ id: blockId, type: 'table', headers, rows });
        continue;
      }
    }

    if (trimmed.startsWith('#')) {
      const headingText = trimmed.replace(/^#+\s*/, '');
      result.push({ id: blockId, type: 'heading', text: headingText });
      continue;
    }

    const isList = lines.every((line) => /^[-*•]\s+|\d+\.\s+/.test(line));
    if (isList) {
      const items: ListItem[] = [];
      for (let lIdx = 0; lIdx < lines.length; lIdx++) {
        const line = lines[lIdx] ?? '';
        const cleaned = line.replace(/^[-*•]\s+|\d+\.\s+/, '');
        items.push({ id: `${blockId}-li-${lIdx}`, text: cleaned });
      }
      result.push({ id: blockId, type: 'list', items });
      continue;
    }

    const paragraphLines: ParagraphLineItem[] = [];
    for (let lIdx = 0; lIdx < lines.length; lIdx++) {
      const line = lines[lIdx] ?? '';
      paragraphLines.push({
        id: `${blockId}-p-${lIdx}`,
        text: line,
        isLast: lIdx === lines.length - 1,
      });
    }
    result.push({ id: blockId, type: 'paragraph', lines: paragraphLines });
  }

  return result;
}

function FormattedMessage({ content }: { content: string }) {
  const blocks = parseBlocks(content);

  return (
    <div className="space-y-2 leading-relaxed text-xs sm:text-sm">
      {blocks.map((block) => {
        if (block.type === 'hr') {
          return <hr key={block.id} className="my-2 border-border/40" />;
        }

        if (block.type === 'table') {
          return (
            <div
              key={block.id}
              className="my-2 overflow-x-auto rounded-lg border border-border/60 bg-background/60 p-1"
            >
              <table className="w-full text-left text-[11px] sm:text-xs">
                <thead>
                  <tr className="border-b border-border/60 text-muted-foreground">
                    {block.headers.map((h) => (
                      <th key={h.id} className="px-2 py-1.5 font-bold">
                        {renderInline(h.text)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-border/30 last:border-0 hover:bg-secondary/40"
                    >
                      {row.cells.map((cell) => (
                        <td key={cell.id} className="px-2 py-1 text-foreground">
                          {renderInline(cell.text)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        if (block.type === 'heading') {
          return (
            <h4
              key={block.id}
              className="mt-2 text-xs font-bold tracking-tight text-foreground sm:text-sm"
            >
              {renderInline(block.text)}
            </h4>
          );
        }

        if (block.type === 'list') {
          return (
            <ul key={block.id} className="space-y-1 pl-0.5 text-xs sm:text-sm">
              {block.items.map((item) => (
                <li key={item.id} className="flex items-start gap-2">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                  <span className="flex-1">{renderInline(item.text)}</span>
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p key={block.id} className="text-xs leading-relaxed text-foreground sm:text-sm">
            {block.lines.map((line) => (
              <span key={line.id}>
                {renderInline(line.text)}
                {!line.isLast && <br />}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

const STORAGE_KEY_MESSAGES = 'jagadaerah_chat_messages_v1';
const STORAGE_KEY_REGION = 'jagadaerah_chat_region_v1';
const STORAGE_KEY_OPEN = 'jagadaerah_chat_is_open_v1';

const WELCOME_MESSAGE: Message = {
  id: 'welcome',
  sender: 'assistant',
  content:
    'Halo! Saya Asisten JagaDaerah. Tanyakan data resmi APBD, fasilitas publik (RS & sekolah), jumlah penduduk, atau perbandingan antar-daerah di Indonesia.',
  responsePayload: {
    text: '',
    suggestions: [...INITIAL_SUGGESTIONS],
  },
};

export default function ChatAssistant() {
  const isLlmActive = Boolean(getOpenRouterConfig().apiKey);
  const [isOpen, setIsOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem(STORAGE_KEY_OPEN) === 'true';
    } catch {
      return false;
    }
  });

  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>(() => {
    if (typeof window === 'undefined') return [WELCOME_MESSAGE];
    try {
      const savedMessages = localStorage.getItem(STORAGE_KEY_MESSAGES);
      if (savedMessages) {
        const parsed = JSON.parse(savedMessages);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((m: Message) => {
            if (m.sender === 'assistant' && typeof m.content === 'string') {
              m.content = cleanAssistantOutput(m.content);
            }
            return m;
          });
        }
      }
    } catch {
      // Storage unavailable or disabled
    }
    return [WELCOME_MESSAGE];
  });

  const [lastRegion, setLastRegion] = useState<RegionSummary | undefined>(() => {
    if (typeof window === 'undefined') return undefined;
    try {
      const savedRegion = localStorage.getItem(STORAGE_KEY_REGION);
      if (savedRegion) {
        return JSON.parse(savedRegion);
      }
    } catch {
      // Storage unavailable or disabled
    }
    return undefined;
  });

  const [isThinking, setIsThinking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  const isSpeechSupported =
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const counterRef = useRef<number>(
    messages.reduce((max: number, m: Message) => {
      const match = m.id.match(/\d+/);
      return match ? Math.max(max, Number.parseInt(match[0], 10)) : max;
    }, 0),
  );

  // Persist messages whenever they change
  useEffect(() => {
    try {
      if (messages.length > 1 || (messages.length === 1 && messages[0]?.id !== 'welcome')) {
        localStorage.setItem(STORAGE_KEY_MESSAGES, JSON.stringify(messages));
      } else {
        localStorage.removeItem(STORAGE_KEY_MESSAGES);
      }
    } catch {
      // Storage quota or disabled
    }
  }, [messages]);

  // Persist lastRegion whenever it changes
  useEffect(() => {
    try {
      if (lastRegion) {
        localStorage.setItem(STORAGE_KEY_REGION, JSON.stringify(lastRegion));
      } else {
        localStorage.removeItem(STORAGE_KEY_REGION);
      }
    } catch {
      // Storage quota or disabled
    }
  }, [lastRegion]);

  // Persist dialog open/close state
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_OPEN, String(isOpen));
    } catch {
      // Storage quota or disabled
    }
  }, [isOpen]);

  function handleResetChat() {
    setMessages([WELCOME_MESSAGE]);
    setLastRegion(undefined);
    counterRef.current = 0;
    try {
      localStorage.removeItem(STORAGE_KEY_MESSAGES);
      localStorage.removeItem(STORAGE_KEY_REGION);
    } catch {
      // Ignore
    }
  }

  function toggleListening() {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    if (!isSpeechSupported) return;

    try {
      const windowWithSpeech = window as unknown as {
        SpeechRecognition?: new () => SpeechRecognitionInstance;
        webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
      };
      const SpeechConstructor =
        windowWithSpeech.SpeechRecognition || windowWithSpeech.webkitSpeechRecognition;

      if (!SpeechConstructor) return;

      const recognition = new SpeechConstructor();
      recognition.lang = 'id-ID';
      recognition.interimResults = false;
      recognition.continuous = false;

      recognition.addEventListener('start', () => {
        setIsListening(true);
      });

      recognition.addEventListener('result', (event: Event) => {
        const speechEvent = event as SpeechRecognitionEvent;
        const transcript = speechEvent.results[0]?.[0]?.transcript?.trim();
        if (transcript) {
          setInput(transcript);
          void handleSend(transcript);
        }
      });

      recognition.addEventListener('error', () => {
        setIsListening(false);
      });

      recognition.addEventListener('end', () => {
        setIsListening(false);
      });

      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      setIsListening(false);
    }
  }

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
    };
  }, [recognitionRef]);

  // Auto-scroll when dialog opens or message arrives
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isOpen]);

  // Focus input when dialog opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  async function handleSend(userText: string) {
    const trimmed = userText.trim();
    if (!trimmed || isThinking) return;

    const nextId = ++counterRef.current;
    const userMessage: Message = {
      id: `u-${nextId}`,
      sender: 'user',
      content: trimmed,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsThinking(true);
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 40);

    // Multi-turn history preserved for LLM context
    const history = messages
      .filter((m) => m.id !== 'welcome')
      .map((m) => ({
        role: m.sender,
        content: m.sender === 'assistant' ? cleanAssistantOutput(m.content) : m.content,
      }));

    try {
      const assistantResult = await queryAssistant(trimmed, {
        lastRegion,
        history,
      });

      if (assistantResult.activeRegion) {
        setLastRegion(assistantResult.activeRegion);
      }

      const botMessage: Message = {
        id: `a-${nextId}`,
        sender: 'assistant',
        content: assistantResult.text,
        responsePayload: assistantResult,
      };
      setMessages((prev) => [...prev, botMessage]);
    } catch {
      const botMessage: Message = {
        id: `a-${nextId}`,
        sender: 'assistant',
        content: 'Terjadi sedikit kendala saat mengambil data. Silakan coba tanyakan kembali.',
      };
      setMessages((prev) => [...prev, botMessage]);
    } finally {
      setIsThinking(false);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
    }
  }

  function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    void handleSend(input);
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 font-sans print:hidden">
      {/* Floating Toggle Button */}
      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          aria-label="Buka Asisten JagaDaerah"
          className="group flex min-h-12 items-center gap-2.5 rounded-full bg-primary px-4 py-2.5 text-primary-foreground shadow-xl shadow-primary/25 transition-all duration-200 hover:scale-[1.03] hover:bg-primary/95 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <span className="flex size-7 items-center justify-center rounded-full bg-white/20 text-white">
            <svg viewBox="0 0 20 20" className="size-4" fill="currentColor" aria-hidden="true">
              <path d="M10 2a8 8 0 00-6.9 12.06L2.1 17.3a.75.75 0 00.95.95l3.24-1a8 8 0 103.71-15.25zM5.5 9a1 1 0 110-2 1 1 0 010 2zm4.5 1a1 1 0 110-2 1 1 0 010 2zm4.5-1a1 1 0 110-2 1 1 0 010 2z" />
            </svg>
          </span>
          <span className="text-sm font-bold tracking-tight">Tanya Data Daerah</span>
        </button>
      )}

      {/* Chat Window Dialog */}
      {isOpen && (
        <div
          role="dialog"
          aria-label="Asisten JagaDaerah"
          className="flex h-[min(35rem,calc(100vh-3rem))] w-[min(25rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl transition-all duration-200 animate-rise"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border bg-primary px-4 py-3 text-primary-foreground">
            <div className="flex items-center gap-2.5">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/20">
                <svg
                  viewBox="0 0 20 20"
                  className="size-4.5 text-white"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M10 2a8 8 0 00-6.9 12.06L2.1 17.3a.75.75 0 00.95.95l3.24-1a8 8 0 103.71-15.25z" />
                </svg>
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <h2 className="text-sm font-extrabold tracking-tight">Asisten JagaDaerah</h2>
                  {isLlmActive && (
                    <span className="rounded-full bg-white/20 px-1.5 py-0.2 text-[9px] font-bold text-emerald-200">
                      Aktif
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <p className="text-[11px] text-white/80">
                    {lastRegion ? `Fokus: ${lastRegion.name}` : 'Data Resmi Terbuka Pemerintah'}
                  </p>
                  {lastRegion && (
                    <button
                      type="button"
                      onClick={() => setLastRegion(undefined)}
                      title="Reset fokus daerah"
                      className="rounded bg-white/20 px-1.5 py-0.2 text-[9px] font-bold text-white hover:bg-white/30"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleResetChat}
                title="Mulai percakapan baru"
                aria-label="Mulai percakapan baru"
                className="inline-flex size-8 items-center justify-center rounded-full text-white/80 hover:bg-white/20 hover:text-white focus-visible:outline-2 focus-visible:outline-white"
              >
                <svg viewBox="0 0 20 20" className="size-4" fill="currentColor" aria-hidden="true">
                  <path
                    fillRule="evenodd"
                    d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.047a1 1 0 011.885-.666A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.608-1.286z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>

              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Tutup jendela chat"
                className="inline-flex size-8 items-center justify-center rounded-full text-white/80 hover:bg-white/20 hover:text-white focus-visible:outline-2 focus-visible:outline-white"
              >
                <svg
                  viewBox="0 0 20 20"
                  className="size-4.5"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>
          </div>

          {/* Messages Container */}
          <div className="flex-1 space-y-4 overflow-y-auto p-4 text-xs leading-relaxed sm:text-sm">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 shadow-xs ${
                    msg.sender === 'user'
                      ? 'rounded-br-xs bg-primary text-primary-foreground font-medium'
                      : 'rounded-bl-xs border border-border bg-secondary text-foreground'
                  }`}
                >
                  {msg.sender === 'user' ? (
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  ) : (
                    <FormattedMessage content={msg.content} />
                  )}

                  {/* Render metrics card if any */}
                  {msg.responsePayload?.metrics && (
                    <div className="mt-2.5 grid grid-cols-1 gap-1.5 border-t border-border/40 pt-2">
                      {msg.responsePayload.metrics.map((m) => (
                        <div
                          key={m.label}
                          className="flex items-center justify-between rounded-lg bg-background/80 px-2.5 py-1.5 text-xs"
                        >
                          <span className="text-muted-foreground">{m.label}</span>
                          <span className="font-bold text-foreground">{m.value}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Render action links if any */}
                  {msg.responsePayload?.actions && (
                    <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/40 pt-2">
                      {msg.responsePayload.actions.map((act) => (
                        <a
                          key={act.label}
                          href={act.href}
                          className="inline-flex min-h-8 items-center rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground hover:bg-primary/90"
                        >
                          {act.label} &rarr;
                        </a>
                      ))}
                    </div>
                  )}
                </div>

                {/* Suggestions chips right after message */}
                {msg.responsePayload?.suggestions && (
                  <div className="mt-2 flex max-w-full flex-wrap gap-1.5">
                    {msg.responsePayload.suggestions.map((sug) => (
                      <button
                        key={sug}
                        type="button"
                        onClick={() => handleSend(sug)}
                        className="rounded-full border border-border bg-card px-2.5 py-1 text-left text-[11px] font-semibold text-foreground hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        {sug}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {/* Thinking Indicator */}
            {isThinking && (
              <div className="flex items-start">
                <div className="rounded-2xl rounded-bl-xs border border-border bg-secondary px-3.5 py-2.5 shadow-xs">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="size-1.5 animate-bounce rounded-full bg-primary" />
                    <span className="size-1.5 animate-bounce rounded-full bg-primary [animation-delay:150ms]" />
                    <span className="size-1.5 animate-bounce rounded-full bg-primary [animation-delay:300ms]" />
                    <span className="ml-1 text-[11px] font-medium">Menganalisis data daerah…</span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input Form */}
          <form onSubmit={onSubmit} className="border-t border-border bg-card p-3">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  isListening
                    ? 'Mendengarkan suara Anda… Silakan bicara'
                    : lastRegion
                      ? `Tanyakan kelanjutan ${lastRegion.name} atau bandingkan…`
                      : 'Ketik daerah atau pertanyaan…'
                }
                aria-label="Pesan untuk asisten"
                disabled={isThinking}
                className="min-h-11 flex-1 rounded-xl border border-input bg-background px-3.5 text-xs text-foreground outline-hidden focus:border-foreground/40 disabled:opacity-60 sm:text-sm"
              />

              {isSpeechSupported && (
                <button
                  type="button"
                  onClick={toggleListening}
                  disabled={isThinking}
                  title={isListening ? 'Berhenti mendengarkan' : 'Bicara dengan suara (Mikrofon)'}
                  aria-label={
                    isListening ? 'Berhenti mendengarkan' : 'Bicara dengan suara (Mikrofon)'
                  }
                  className={`inline-flex size-11 items-center justify-center rounded-xl border transition-all ${
                    isListening
                      ? 'border-red-500 bg-red-500/15 text-red-500 animate-pulse'
                      : 'border-border bg-secondary/80 text-muted-foreground hover:bg-secondary hover:text-foreground'
                  } disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-ring`}
                >
                  <svg
                    viewBox="0 0 20 20"
                    className="size-4.5"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M7 4a3 3 0 016 0v6a3 3 0 11-6 0V4z" />
                    <path d="M5.5 9.643a.75.75 0 00-1.5 0V10c0 3.06 2.29 5.585 5.25 5.954V17.5h-1.5a.75.75 0 000 1.5h4.5a.75.75 0 000-1.5h-1.5v-1.546A6.001 6.001 0 0016 10v-.357a.75.75 0 00-1.5 0V10a4.5 4.5 0 01-9 0v-.357z" />
                  </svg>
                </button>
              )}

              <button
                type="submit"
                disabled={!input.trim() || isThinking}
                aria-label="Kirim pertanyaan"
                className="inline-flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-opacity hover:bg-primary/90 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-ring"
              >
                <svg viewBox="0 0 20 20" className="size-4" fill="currentColor" aria-hidden="true">
                  <path d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.925A1.5 1.5 0 005.135 9.25h6.115a.75.75 0 010 1.5H5.135a1.5 1.5 0 00-1.442 1.086l-1.414 4.926a.75.75 0 00.826.95 28.896 28.896 0 0015.293-7.154.75.75 0 000-1.115A28.897 28.897 0 003.105 2.289z" />
                </svg>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
