"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { MAX_QUESTION_CHARS, MAX_TURNS, type ChatError } from "@/lib/chat-limits";
import { Inline } from "./RichText";

/** The window's texts, filled in on the server (email addresses are Markdown links) */
export interface ChatTexts {
  open: string;
  title: string;
  close: string;
  intro: string;
  placeholder: string;
  send: string;
  thinking: string;
  disclaimer: string;
  error: string;
  busy: string;
  unavailable: string;
  tooLong: string;
}

interface Entry {
  role: "user" | "assistant" | "error";
  content: string;
  /** Left out of the conversation sent to the server, because no full answer came back */
  failed?: boolean;
}

/** An odd number, so the conversation sent always starts with a question */
const HISTORY = MAX_TURNS % 2 === 0 ? MAX_TURNS - 1 : MAX_TURNS;

const ERROR_TEXT: Record<ChatError, keyof ChatTexts> = {
  busy: "busy",
  unavailable: "unavailable",
  tooLong: "tooLong",
  invalid: "error",
  failed: "error",
};

/** A request the server turned down, with the text to show for it */
class ChatFailure extends Error {
  constructor(readonly text: keyof ChatTexts) {
    super(text);
  }
}

async function failure(response: Response): Promise<ChatFailure> {
  try {
    const body = (await response.json()) as { error?: ChatError };
    return new ChatFailure((body.error && ERROR_TEXT[body.error]) || "error");
  } catch {
    return new ChatFailure("error");
  }
}

export default function ChatPanel({
  texts,
  open,
  onClose,
}: {
  texts: ChatTexts;
  open: boolean;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [announce, setAnnounce] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  useEffect(() => () => request.current?.abort(), []);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [entries]);

  function update(index: number, change: Partial<Entry>) {
    setEntries((list) => list.map((entry, i) => (i === index ? { ...entry, ...change } : entry)));
  }

  async function ask(event: FormEvent) {
    event.preventDefault();
    const text = question.trim();
    if (!text || pending) return;

    const history = [
      ...entries.filter((entry) => entry.role !== "error" && !entry.failed),
      { role: "user" as const, content: text },
    ].slice(-HISTORY);
    const userIndex = entries.length;
    const answerIndex = userIndex + 1;
    setEntries([...entries, { role: "user", content: text }]);
    setQuestion("");
    setPending(true);
    setAnnounce(texts.thinking);

    const controller = new AbortController();
    request.current = controller;
    let answer = "";
    try {
      const response = await fetch("/api/support-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map(({ role, content }) => ({ role, content })),
        }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw await failure(response);

      setEntries((list) => [...list, { role: "assistant", content: "" }]);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += decoder.decode(value, { stream: true });
        update(answerIndex, { content: answer });
      }
      answer += decoder.decode();
      update(answerIndex, { content: answer });
      setAnnounce(answer);
    } catch (error) {
      if (controller.signal.aborted) return;
      const key = error instanceof ChatFailure ? error.text : "error";
      setEntries((list) => [
        ...list.map((entry, i) => (i >= userIndex ? { ...entry, failed: true } : entry)),
        { role: "error", content: texts[key] },
      ]);
      setAnnounce(texts[key]);
    } finally {
      if (request.current === controller) request.current = null;
      setPending(false);
    }
  }

  return (
    <div
      className="chat-panel"
      role="dialog"
      aria-labelledby={titleId}
      hidden={!open}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div className="chat-head">
        <h2 id={titleId} style={{ fontSize: "1rem", margin: 0 }}>
          {texts.title}
        </h2>
        <button type="button" className="chat-close" onClick={onClose} aria-label={texts.close}>
          ×
        </button>
      </div>

      <div className="chat-log" ref={log}>
        <p className="chat-msg chat-msg-assistant">{texts.intro}</p>
        {entries.map((entry, index) => (
          <p
            key={index}
            className={`chat-msg ${entry.role === "user" ? "chat-msg-user" : "chat-msg-assistant"}`}
          >
            {entry.role === "user" ? entry.content : <Inline text={entry.content} />}
          </p>
        ))}
        {pending && entries.at(-1)?.role === "user" && (
          <p className="chat-msg chat-msg-assistant muted">{texts.thinking}</p>
        )}
      </div>

      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      <form className="chat-form" onSubmit={ask}>
        <label className="sr-only" htmlFor={`${titleId}-input`}>
          {texts.placeholder}
        </label>
        <input
          ref={input}
          id={`${titleId}-input`}
          className="chat-input"
          value={question}
          maxLength={MAX_QUESTION_CHARS}
          placeholder={texts.placeholder}
          autoComplete="off"
          onChange={(event) => setQuestion(event.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={pending || !question.trim()}>
          {texts.send}
        </button>
      </form>
      <p className="chat-note">
        <Inline text={texts.disclaimer} />
      </p>
    </div>
  );
}
