import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ConversationalAgent, Exchanges } from '@uipath/uipath-typescript/conversational-agent';
import { APP_CONFIG } from './config';

// Invisible greeting prompt sent automatically on session open.
const OPENING_PROMPT = 'Please introduce yourself to me.';

// Pirate color-commentary attached to thumbs-up / thumbs-down feedback.
const POSITIVE_COMMENTS = [
  'Aarrr, that answer be worth its weight in doubloons!',
  'Shiver me timbers — the Cap\'n nailed it square on the bow.',
  'A fine broadside of an answer, matey. Helpful indeed.',
  'Ye hit the mark dead-center, like a true master gunner.',
  'Clear as a cloudless sky at sea. Well sailed!',
  'That be the kind o\' advice a crew can trust its ship to.',
  'Bang on course — ye saved me a week of chartin\'.',
];

const NEGATIVE_COMMENTS = [
  'Arr, that answer ran us aground. Not quite what I needed.',
  'Cap\'n, that reply missed the mark — wide of the target.',
  'Murky as fog off the Carolinas. Could use more clarity.',
  'Ye wandered off course, matey. The question weren\'t answered.',
  'That be more grog-talk than real guidance, I fear.',
  'Shiver me timbers — not the treasure I was lookin\' for.',
  'Off the map entirely. Try another tack?',
];

function pickComment(rating: 'positive' | 'negative'): string {
  const pool = rating === 'positive' ? POSITIVE_COMMENTS : NEGATIVE_COMMENTS;
  return pool[Math.floor(Math.random() * pool.length)];
}

type AssistantMessage = {
  kind: 'assistant';
  id: string;
  exchangeId: string;
  text: string;
  streaming: boolean;
  feedback: 'positive' | 'negative' | null;
  feedbackComment: string | null;
  feedbackSubmitted: boolean;
  visible: boolean;
};

type UserMessage = {
  kind: 'user';
  id: string;
  text: string;
  visible: boolean;
};

type ToolMessage = {
  kind: 'tool';
  id: string;
  exchangeId: string;
  toolName: string;
  input: string;
  output: string | null;
  status: 'running' | 'done' | 'error';
};

type ChatItem = AssistantMessage | UserMessage | ToolMessage;

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

interface BoothProps {
  agentService: ConversationalAgent;
  exchangesService: Exchanges;
  feedbackRating: { Positive: unknown; Negative: unknown; [k: string]: unknown };
  onSignOut: () => void;
}

function stringifyToolData(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function Booth({ agentService, exchangesService, feedbackRating, onSignOut }: BoothProps) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [connection, setConnection] = useState<ConnectionStatus>('connecting');
  const [isWaitingForResponse, setIsWaitingForResponse] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const sessionReadyRef = useRef(false);
  const greetingSentRef = useRef(false);
  const conversationIdRef = useRef<string | null>(null);
  const sessionRef = useRef<unknown>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Scroll to bottom when items change.
  useLayoutEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [items]);

  const attachExchangeHandlers = useCallback((exchange: any) => {
    exchange.onMessageStart((message: any) => {
      if (!message.isAssistant) return;

      const assistantId = `asst-${crypto.randomUUID()}`;
      const exchangeId = exchange.exchangeId;

      setItems((prev) => [
        ...prev,
        {
          kind: 'assistant',
          id: assistantId,
          exchangeId,
          text: '',
          streaming: true,
          feedback: null,
          feedbackComment: null,
          feedbackSubmitted: false,
          visible: true,
        } satisfies AssistantMessage,
      ]);

      message.onContentPartStart((part: any) => {
        part.onChunk((chunk: any) => {
          const data = chunk?.data ?? '';
          if (!data) return;
          setItems((prev) =>
            prev.map((it) =>
              it.kind === 'assistant' && it.id === assistantId
                ? { ...it, text: it.text + data }
                : it,
            ),
          );
        });
      });

      if (typeof message.onToolCallStart === 'function') {
        message.onToolCallStart((toolCall: any) => {
          const toolId = `tool-${crypto.randomUUID()}`;
          const startEvt = toolCall?.startEvent ?? {};
          const toolName: string = startEvt.toolName ?? 'tool';
          const inputStr = stringifyToolData(startEvt.input ?? startEvt.arguments ?? {});

          setItems((prev) => [
            ...prev,
            {
              kind: 'tool',
              id: toolId,
              exchangeId,
              toolName,
              input: inputStr,
              output: null,
              status: 'running',
            } satisfies ToolMessage,
          ]);

          toolCall.onToolCallEnd?.((end: any) => {
            const outputStr = stringifyToolData(end?.output ?? end?.result ?? '');
            setItems((prev) =>
              prev.map((it) =>
                it.kind === 'tool' && it.id === toolId
                  ? { ...it, output: outputStr, status: 'done' }
                  : it,
              ),
            );
          });
        });
      }

      message.onCompleted?.(() => {
        setItems((prev) =>
          prev.map((it) =>
            it.kind === 'assistant' && it.id === assistantId
              ? { ...it, streaming: false }
              : it,
          ),
        );
      });
    });

    exchange.onExchangeEnd?.(() => {
      setIsWaitingForResponse(false);
      // Ensure nothing is left in a streaming state.
      setItems((prev) =>
        prev.map((it) => (it.kind === 'assistant' && it.streaming ? { ...it, streaming: false } : it)),
      );
    });

    exchange.onErrorStart?.((err: any) => {
      setError(err?.message ?? 'Exchange error');
      setIsWaitingForResponse(false);
    });
  }, []);

  // One-time session setup.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const agents = await agentService.getAll();
        const agent = agents.find((a: any) => a.name === APP_CONFIG.agentName);
        if (!agent) {
          throw new Error(
            `Agent "${APP_CONFIG.agentName}" not found. Make sure it is deployed to this tenant.`,
          );
        }

        const conversation = await agent.conversations.create({ label: 'Virtual Booth Chat' });
        const conversationId: string =
          (conversation as any).id ?? (conversation as any).conversationId;
        conversationIdRef.current = conversationId;

        if (cancelled) return;

        // Use the SERVICE method — per CLAUDE.md guidance.
        const session: any = agentService.conversations.startSession(conversationId);
        sessionRef.current = session;

        if (typeof agentService.onConnectionStatusChanged === 'function') {
          agentService.onConnectionStatusChanged((status: any) => {
            const normalized = String(status).toLowerCase();
            if (normalized.startsWith('connect') && normalized !== 'connected') setConnection('connecting');
            else if (normalized === 'connected') setConnection('connected');
            else setConnection('disconnected');
          });
        }

        session.onExchangeStart?.((exchange: any) => {
          attachExchangeHandlers(exchange);
        });

        session.onSessionStarted?.(() => {
          sessionReadyRef.current = true;
          setReady(true);
          setConnection('connected');
          // Send the invisible greeting — user experience is that the agent speaks first.
          if (!greetingSentRef.current) {
            greetingSentRef.current = true;
            setIsWaitingForResponse(true);
            try {
              const exchange: any = session.startExchange();
              attachExchangeHandlers(exchange);
              exchange.sendMessageWithContentPart({ data: OPENING_PROMPT });
            } catch (e) {
              console.error(e);
              setIsWaitingForResponse(false);
            }
          }
        });

        session.onSessionEnd?.(() => {
          sessionReadyRef.current = false;
          setReady(false);
          setConnection('disconnected');
        });
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
      const convId = conversationIdRef.current;
      if (convId) {
        try {
          (agentService as any).conversations.endSession?.(convId);
        } catch {
          /* ignore */
        }
      }
    };
  }, [agentService, attachExchangeHandlers]);

  const onSend = useCallback(async () => {
    const text = input.trim();
    if (!text || !sessionRef.current || !sessionReadyRef.current) return;

    const userId = `user-${crypto.randomUUID()}`;
    setItems((prev) => [
      ...prev,
      { kind: 'user', id: userId, text, visible: true } satisfies UserMessage,
    ]);
    setInput('');
    setIsWaitingForResponse(true);
    setError(null);

    try {
      const session: any = sessionRef.current;
      const exchange: any = session.startExchange();
      attachExchangeHandlers(exchange);
      await exchange.sendMessageWithContentPart({ data: text });
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : String(err));
      setIsWaitingForResponse(false);
    }
  }, [input, attachExchangeHandlers]);

  const submitFeedback = useCallback(
    async (msg: AssistantMessage, rating: 'positive' | 'negative') => {
      const convId = conversationIdRef.current;
      if (!convId || !msg.exchangeId) return;

      const comment = pickComment(rating);

      // Optimistic UI update.
      setItems((prev) =>
        prev.map((it) =>
          it.kind === 'assistant' && it.id === msg.id
            ? { ...it, feedback: rating, feedbackComment: comment, feedbackSubmitted: true }
            : it,
        ),
      );

      try {
        const ratingValue = rating === 'positive' ? feedbackRating.Positive : feedbackRating.Negative;
        await exchangesService.createFeedback(convId, msg.exchangeId, {
          rating: ratingValue,
          comment,
        } as any);
      } catch (err) {
        console.error('Feedback submission failed', err);
        // Roll back.
        setItems((prev) =>
          prev.map((it) =>
            it.kind === 'assistant' && it.id === msg.id
              ? { ...it, feedback: null, feedbackComment: null, feedbackSubmitted: false }
              : it,
          ),
        );
        setError('Couldn\'t send that feedback. Try again in a moment.');
      }
    },
    [exchangesService, feedbackRating],
  );

  const onComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void onSend();
    }
  };

  return (
    <div className="booth">
      <aside className="booth-sidebar">
        <h2>OpenArrrI</h2>
        <p className="subtitle">Virtual Recruiting Booth #523</p>
        <dl>
          <dt>Host</dt>
          <dd>Capt. Reginald "Redbeard" Blackwater</dd>
          <dt>Mission</dt>
          <dd>Honest, transparent AI for every crew</dd>
          <dt>Hiring</dt>
          <dd>Research & Forward-Deployed Engineers, PMs, Designers, DevRel Lead</dd>
          <dt>HQ</dt>
          <dd>A refitted frigate in SF Bay (fully remote)</dd>
        </dl>
        <div className="status">
          <span
            className={`status-dot ${
              connection === 'connected' ? '' : connection === 'connecting' ? 'connecting' : 'disconnected'
            }`}
          />
          <span>
            {connection === 'connected'
              ? ready
                ? 'Aboard & chattin\''
                : 'Connected'
              : connection === 'connecting'
                ? 'Hoisting the sails…'
                : 'Cast adrift'}
          </span>
        </div>
        <button className="signout" onClick={onSignOut}>
          Leave the booth
        </button>
      </aside>

      <main className="chat">
        <div className="chat-header">
          <h1>Chat with the Recruiter</h1>
          <span className="booth-number">Booth 523 · OpenArrrI</span>
        </div>

        {error && <div className="error-banner">{error}</div>}

        <div className="messages">
          {items.filter((it) => ('visible' in it ? it.visible : true)).map(renderItem)}
          {isWaitingForResponse && items.every((it) => !(it.kind === 'assistant' && it.streaming)) && (
            <TypingBubble />
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="composer">
          <textarea
            placeholder={
              ready ? 'Ask about the company, roles, or culture…' : 'Waiting to connect…'
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onComposerKeyDown}
            disabled={!ready || isWaitingForResponse}
            rows={1}
          />
          <button
            className="send-btn"
            onClick={() => void onSend()}
            disabled={!ready || isWaitingForResponse || !input.trim()}
          >
            Send
          </button>
        </div>
      </main>
    </div>
  );

  function renderItem(item: ChatItem) {
    if (item.kind === 'tool') {
      return (
        <div key={item.id} className="tool-block">
          <div className="tool-header">
            <span className="tool-icon" />
            <span>Tool · {item.toolName}</span>
            <span className="tool-status">
              {item.status === 'running' ? 'running…' : item.status === 'error' ? 'error' : 'done'}
            </span>
          </div>
          {item.input && (
            <details open>
              <summary>Input</summary>
              <div className="tool-body">{item.input}</div>
            </details>
          )}
          {item.output && (
            <details>
              <summary>Result</summary>
              <div className="tool-body">{item.output}</div>
            </details>
          )}
        </div>
      );
    }

    if (item.kind === 'user') {
      return (
        <div key={item.id} className="message-row user">
          <div className="avatar user">Ye</div>
          <div className="message-content">
            <span className="message-name">You</span>
            <div className="message-bubble">{item.text}</div>
          </div>
        </div>
      );
    }

    // Assistant
    const feedbackLocked = item.feedbackSubmitted;
    return (
      <div key={item.id} className="message-row assistant">
        <div className="avatar">🏴‍☠️</div>
        <div className="message-content">
          <span className="message-name">Capt. Redbeard</span>
          {item.text.length === 0 && item.streaming ? (
            <div className="message-bubble">
              <div className="typing" style={{ padding: 0 }}>
                <span />
                <span />
                <span />
              </div>
            </div>
          ) : (
            <div className="message-bubble">{item.text}</div>
          )}
          {!item.streaming && item.text.length > 0 && (
            <div className={`feedback-bar ${item.feedback ? 'has-feedback' : ''}`}>
              <button
                className={`feedback-btn ${item.feedback === 'positive' ? 'selected positive' : ''}`}
                onClick={() => void submitFeedback(item, 'positive')}
                disabled={feedbackLocked}
                title="Helpful"
                aria-label="Thumbs up"
              >
                👍
              </button>
              <button
                className={`feedback-btn ${item.feedback === 'negative' ? 'selected negative' : ''}`}
                onClick={() => void submitFeedback(item, 'negative')}
                disabled={feedbackLocked}
                title="Not helpful"
                aria-label="Thumbs down"
              >
                👎
              </button>
              {item.feedback && item.feedbackComment && (
                <span className="feedback-note">
                  "{item.feedbackComment}" — sent to the logbook
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }
}

function TypingBubble() {
  return (
    <div className="message-row assistant">
      <div className="avatar">🏴‍☠️</div>
      <div className="message-content">
        <span className="message-name">Capt. Redbeard</span>
        <div className="message-bubble" style={{ padding: 0 }}>
          <div className="typing">
            <span />
            <span />
            <span />
          </div>
        </div>
      </div>
    </div>
  );
}
