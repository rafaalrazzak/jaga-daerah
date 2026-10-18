import { useEffect, useRef, useState } from 'react';
import type { SubmitEvent } from 'react';

import { INITIAL_SUGGESTIONS, queryAssistant } from '@/lib/assistant-engine';
import type { AssistantResponse } from '@/lib/assistant-engine';

interface Message {
  id: string;
  sender: 'user' | 'assistant';
  content: string;
  responsePayload?: AssistantResponse;
}

export default function ChatAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      content:
        'Halo! Saya Asisten JagaDaerah. Tanyakan data resmi APBD, fasilitas publik (RS & sekolah), jumlah penduduk, atau perbandingan antar-daerah di Indonesia.',
      responsePayload: {
        text: '',
        suggestions: [...INITIAL_SUGGESTIONS],
      },
    },
  ]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const counterRef = useRef(0);

  // Auto-scroll when dialog opens
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

  function handleSend(userText: string) {
    const trimmed = userText.trim();
    if (!trimmed) return;

    const nextId = ++counterRef.current;
    const userMessage: Message = {
      id: `u-${nextId}`,
      sender: 'user',
      content: trimmed,
    };

    const assistantResult = queryAssistant(trimmed);
    const botMessage: Message = {
      id: `a-${nextId}`,
      sender: 'assistant',
      content: assistantResult.text,
      responsePayload: assistantResult,
    };

    setMessages((prev) => [...prev, userMessage, botMessage]);
    setInput('');
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
  }

  function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    handleSend(input);
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
          <span className="hidden rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-extrabold uppercase sm:inline-block">
            Gratis
          </span>
        </button>
      )}

      {/* Chat Window Dialog */}
      {isOpen && (
        <div
          role="dialog"
          aria-label="Asisten JagaDaerah"
          className="flex h-[min(34rem,calc(100vh-3rem))] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl transition-all duration-200 animate-rise"
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
                <h2 className="text-sm font-extrabold tracking-tight">Asisten JagaDaerah</h2>
                <p className="text-[11px] text-white/80">Data Resmi DJPK, BNPB, BPK & BPS</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="Tutup jendela chat"
              className="inline-flex size-9 items-center justify-center rounded-full text-white/80 hover:bg-white/20 hover:text-white focus-visible:outline-2 focus-visible:outline-white"
            >
              <svg viewBox="0 0 20 20" className="size-5" fill="currentColor" aria-hidden="true">
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
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
                  <p className="whitespace-pre-wrap">{msg.content}</p>

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
                placeholder="Ketik daerah atau pertanyaan…"
                aria-label="Pesan untuk asisten"
                className="min-h-11 flex-1 rounded-xl border border-input bg-background px-3.5 text-xs text-foreground outline-hidden focus:border-foreground/40 sm:text-sm"
              />
              <button
                type="submit"
                disabled={!input.trim()}
                aria-label="Kirim pertanyaan"
                className="inline-flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-opacity hover:bg-primary/90 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-ring"
              >
                <svg viewBox="0 0 20 20" className="size-4" fill="currentColor" aria-hidden="true">
                  <path d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.925A1.5 1.5 0 005.135 9.25h6.115a.75.75 0 010 1.5H5.135a1.5 1.5 0 00-1.442 1.086l-1.414 4.926a.75.75 0 00.826.95 28.896 28.896 0 0015.293-7.154.75.75 0 000-1.115A28.897 28.897 0 003.105 2.289z" />
                </svg>
              </button>
            </div>
            <div className="mt-1 text-center">
              <span className="text-[10px] text-muted-foreground">
                In-house engine · Data resmi terbuka pemerintah
              </span>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
