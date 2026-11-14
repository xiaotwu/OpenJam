import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  agentRunActive, answerAgentRun, applyAgentRun, changeAgentRun, configureAgent, getAgentRun,
  conversationLink, getAgentSettings, getSharedAgentRun, listAgentRuns, MAX_AGENT_ANSWER_LENGTH, MAX_AGENT_PROMPT_LENGTH,
  MAX_AGENT_SELECTION, setAgentRunSharing, startAgentRun, streamAgentRun, type AgentApplyResult, type AgentChoice,
  type AgentPlacement, type AgentPreview, type AgentRun, type AgentRunAction, type AgentSettings,
  type AgentSettingsInput, type AgentStartRequest, type AgentWorkflow, type SharedAgentRun,
} from '../lib/boardAgent';
import { useI18n, type MessageCatalog } from '../i18n';
import { ApiError } from '../lib/api';
import type { DocumentAck } from '../lib/boardSyncProtocol';
import { newCommandId } from '../lib/boardSyncSession';
import AgentConversation, { type ObservedAgentStage } from './agent/AgentConversation';
import WorkshopIcon from './workshop/WorkshopIcon';

interface BoardAgentPanelProps {
  boardId: string;
  pageId: string;
  pageName?: string;
  pages?: { id: string; name: string }[];
  selectedTextIds: string[];
  pendingCount: number;
  online: boolean;
  clientId?: string;
  sharedRunId?: string;
  agentIdentity?: { name: string; kind: 'ring' | 'glyph' | 'image'; glyph?: string; imageUrl?: string };
  identityVisual?: (status?: AgentRun['status']) => ReactNode;
  onEditIdentity?: () => void;
  renderCanvasPreview?: (preview: AgentPreview) => ReactNode;
  onPreviewChange?: (preview?: AgentPreview) => void;
  onUndo?: (ack: DocumentAck) => boolean | void | Promise<boolean | void>;
  onClose: () => void;
  onApplied: (ack: DocumentAck, pageId: string) => void | Promise<void>;
}

const border = 'border-[var(--glass-border-strong)]';
const muted = 'text-[var(--text-secondary)]';
const action = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-full border border-[var(--glass-border-strong)] px-3 text-sm font-semibold hover:bg-[var(--badge-bg)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-50';
const primary = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-[var(--text-primary)] px-3 text-sm font-semibold text-[var(--surface-canvas)] hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:opacity-50';
const field = 'min-h-10 w-full rounded-lg border border-[var(--glass-border-strong)] bg-[var(--badge-bg)] px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-50';

const workflowOptions: AgentWorkflow[] = ['workshop', 'flowchart', 'organize'];
type AgentText = MessageCatalog['agent'];

const runeLength = (text: string) => Array.from(text).length;
const choiceKey = (choice: { provider?: string; model?: string }) => JSON.stringify([choice.provider, choice.model]);
const errorText = (cause: unknown, fallback: string) => cause instanceof Error ? cause.message : fallback;
const runStatus = (run: AgentRun, text: AgentText) => run.applied ? text.applied : text.states[run.status];
const providerName = (provider: string, text: AgentText) => text.providers[provider] ?? provider;
const choiceName = (choice: AgentChoice, text: AgentText) => choice.label || providerName(choice.provider, text);
const cloudProvider = (provider: string) => provider === 'openai' || provider === 'external';
const inProgress = (run: AgentRun) => agentRunActive(run) || run.status === 'paused' || run.status === 'awaiting_input';

function observeStage(history: Map<string, ObservedAgentStage[]>, run: AgentRun) {
  const previous = history.get(run.id) ?? [];
  const last = previous.at(-1);
  if (last && last.revision >= run.revision) return history;
  const result = new Map(history);
  result.delete(run.id);
  if (last?.status === run.status && last.attempt === run.attempt) {
    result.set(run.id, [...previous.slice(0, -1), { ...last, revision: run.revision }]);
  } else {
    result.set(run.id, [...previous.slice(-19), {
      revision: run.revision, status: run.status, updatedAt: run.updatedAt, attempt: run.attempt,
      question: run.status === 'awaiting_input' ? run.result?.proposal?.question : undefined,
    }]);
  }
  if (result.size > 12) {
    const oldest = result.keys().next().value;
    if (oldest) result.delete(oldest);
  }
  return result;
}

function preferRun(previous: AgentRun | undefined, next: AgentRun) {
  if (previous?.id !== next.id) return next;
  if (previous.revision > next.revision) return previous;
  if (previous.applied && !next.applied) return { ...next, applied: previous.applied };
  return next;
}

export default function BoardAgentPanel(props: BoardAgentPanelProps) {
  return props.sharedRunId ? (
    <SharedConversationPanel key={props.boardId + '/' + props.sharedRunId} boardId={props.boardId} runId={props.sharedRunId} onClose={props.onClose} />
  ) : <PrivateAgentPanel key={props.boardId} {...props} />;
}

function PrivateAgentPanel({
  boardId, pageId, pageName, pages, selectedTextIds, pendingCount, online, clientId, onClose, onApplied,
  agentIdentity, identityVisual, onEditIdentity, renderCanvasPreview, onPreviewChange, onUndo,
}: BoardAgentPanelProps) {
  const { messages: { agent: text }, formatDate } = useI18n();
  const [settings, setSettings] = useState<AgentSettings>();
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const [detail, setDetail] = useState<AgentRun>();
  const [stages, setStages] = useState(() => new Map<string, ObservedAgentStage[]>());
  const [undoable, setUndoable] = useState<DocumentAck>();
  const [undoneId, setUndoneId] = useState<string>();
  const [workflow, setWorkflow] = useState<AgentWorkflow>('workshop');
  const [placement, setPlacement] = useState<AgentPlacement>('new-page');
  const [prompt, setPrompt] = useState('');
  const [includeSelection, setIncludeSelection] = useState(false);
  const [consent, setConsent] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [watch, setWatch] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [loadError, setLoadError] = useState('');
  const [runError, setRunError] = useState('');
  const [actionError, setActionError] = useState('');
  const inFlight = useRef(false);
  const startReceipt = useRef<{ input: string; id: string } | null>(null);
  const configuredChoice = settings?.choices?.find(item => choiceKey(item) === choiceKey(settings));
  const choice = settings?.enabled ? configuredChoice : undefined;
  const current = detail?.id === selectedRunId ? detail : undefined;
  const preview = current?.status === 'succeeded' && !current.applied ? current.result?.preview : undefined;
  const targetPlacement = pageId ? placement : 'new-page';
  const selectedIds = [...new Set(selectedTextIds)];
  const canIncludeSelection = Boolean(choice && (!choice.cloud || settings?.allowBoardContext));
  const wantsSelection = workflow === 'organize' || includeSelection;
  const usedSelection = canIncludeSelection && wantsSelection ? selectedIds : [];
  const promptLength = runeLength(prompt.trim());
  const consentKey = JSON.stringify([choice?.provider, choice?.model, prompt.trim(), usedSelection]);
  const cloudConsent = !choice?.cloud || consent === consentKey;
  const canStart = Boolean(online && choice && !busy && promptLength > 0 && promptLength <= MAX_AGENT_PROMPT_LENGTH &&
    usedSelection.length <= MAX_AGENT_SELECTION && (workflow !== 'organize' || usedSelection.length > 0) && cloudConsent);

  useEffect(() => {
    onPreviewChange?.(preview);
    return () => onPreviewChange?.(undefined);
  }, [onPreviewChange, preview]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.allSettled([
      getAgentSettings(boardId, controller.signal),
      listAgentRuns(boardId, controller.signal),
    ]).then(([policy, history]) => {
      if (controller.signal.aborted) return;
      if (policy.status === 'fulfilled') setSettings(policy.value);
      if (history.status === 'fulfilled') {
        setRuns(previous => history.value.map(run => preferRun(previous.find(row => row.id === run.id), run)));
        setSelectedRunId(previous => previous ?? history.value[0]?.id);
      }
      const message = policy.status === 'rejected'
        ? errorText(policy.reason, text.settingsUnavailable)
        : history.status === 'rejected' ? errorText(history.reason, text.historyUnavailable) : '';
      setLoadError(message);
      setLoading(false);
    });
    return () => controller.abort();
  }, [boardId, refresh, text.historyUnavailable, text.settingsUnavailable]);

  const updateRun = useCallback((run: AgentRun) => {
    setDetail(previous => preferRun(previous, run));
    setStages(previous => observeStage(previous, run));
    setRuns(previous => previous.some(row => row.id === run.id)
      ? previous.map(row => row.id === run.id ? preferRun(row, run) : row)
      : [run, ...previous]);
  }, []);

  useEffect(() => {
    if (!selectedRunId) return;
    const runId = selectedRunId;
    const controller = new AbortController();
    let pollTimer: ReturnType<typeof setTimeout> | undefined;

    const accept = (run: AgentRun) => {
      if (controller.signal.aborted) return false;
      updateRun(run);
      setRunError('');
      return inProgress(run);
    };
    const poll = async () => {
      try {
        const run = await getAgentRun(boardId, runId, controller.signal);
        if (accept(run)) pollTimer = setTimeout(poll, agentRunActive(run) ? 1800 : 4000);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setRunError(errorText(cause, text.stateUnavailable));
          if (cause instanceof ApiError && [401, 403, 404, 410].includes(cause.status)) {
            setDetail(previous => previous?.id === runId ? undefined : previous);
            setStages(previous => {
              const next = new Map(previous);
              next.delete(runId);
              return next;
            });
          } else {
            pollTimer = setTimeout(poll, 4500);
          }
        }
      }
    };
    const observe = async () => {
      try {
        const initial = await getAgentRun(boardId, runId, controller.signal);
        if (!accept(initial)) return;
        if (!agentRunActive(initial)) {
          pollTimer = setTimeout(poll, 4000);
          return;
        }
        const stream = new AbortController();
        const stopStream = () => stream.abort();
        controller.signal.addEventListener('abort', stopStream, { once: true });
        const streamTimer = setTimeout(stopStream, 25_000);
        let active = true;
        try {
          await streamAgentRun(boardId, runId, String(initial.revision), stream.signal, run => {
            active = accept(run);
            return active && agentRunActive(run);
          });
        } finally {
          clearTimeout(streamTimer);
          controller.signal.removeEventListener('abort', stopStream);
        }
        if (!active) return;
      } catch {
        // Use the same authenticated state read when a proxy or browser drops SSE.
      }
      if (!controller.signal.aborted) await poll();
    };
    void observe();
    return () => {
      controller.abort();
      if (pollTimer !== undefined) clearTimeout(pollTimer);
    };
  }, [boardId, selectedRunId, text.stateUnavailable, updateRun, watch]);

  const runAction = async (name: string, work: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(name);
    setActionError('');
    try {
      await work();
    } catch (cause) {
      setActionError(errorText(cause, text.actionFailed));
    } finally {
      inFlight.current = false;
      setBusy('');
    }
  };

  const showRun = (run: AgentRun) => {
    setSelectedRunId(run.id);
    updateRun(run);
    setRunError('');
    setWatch(value => value + 1);
  };

  const start = () => {
    if (!canStart || !choice) return;
    const input: Omit<AgentStartRequest, 'requestId'> = {
      provider: choice.provider, model: choice.model, workflow, prompt: prompt.trim(), placement: targetPlacement,
      ...(targetPlacement === 'current-page' && { pageId }),
      ...(usedSelection.length > 0 && { selectedIds: usedSelection }),
      ...(choice.cloud && { cloudConsent: true }),
    };
    void runAction('start', async () => {
      const key = JSON.stringify(input);
      if (startReceipt.current?.input !== key) startReceipt.current = { input: key, id: newCommandId() };
      const started = await startAgentRun(boardId, { ...input, requestId: startReceipt.current.id });
      startReceipt.current = null;
      setConsent('');
      showRun(started);
    });
  };

  const apply = () => {
    if (!current || current.applied || current.status !== 'succeeded' || !current.result?.preview?.operations.length ||
      !online || pendingCount > 0 || !clientId) return;
    void runAction('apply', async () => {
      const result: AgentApplyResult = await applyAgentRun(boardId, current.id, current.revision, clientId);
      updateRun({ ...current, applied: result });
      await onApplied(result.ack, result.pageId);
      setUndoable(result.ack);
    });
  };

  const undo = current && onUndo && undoable?.commandId === current.applied?.ack.commandId && undoable
    ? () => { void runAction('undo', async () => {
        const result = await onUndo(undoable);
        setUndoable(undefined);
        if (result === false) throw new Error(text.undoUnavailable);
        setUndoneId(current.id);
      }); }
    : undefined;

  const reload = () => {
    setLoading(true);
    setLoadError('');
    setRunError('');
    setRefresh(value => value + 1);
    setWatch(value => value + 1);
  };

  return (
    <AgentPanelFrame title={agentIdentity?.name || text.title} visual={identityVisual?.(current?.status)} onEditIdentity={onEditIdentity} onClose={onClose}>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
        {loading && !settings && <p role="status" className={'text-sm ' + muted}>{text.loading}</p>}
        {!online && <p role="status" className={'text-sm ' + muted}>{text.offline}</p>}
        {loadError && (
          <div className="flex items-center justify-between gap-3">
            <p role="status" className={'text-sm ' + muted}>{loadError}</p>
            <button className="board-action-button" type="button" aria-label={text.refresh} title={text.refreshTitle} onClick={reload}>
              <span className="size-4"><WorkshopIcon name="restore" /></span>
            </button>
          </div>
        )}
        {settings && !choice && (
          <p className={'text-sm ' + muted}>
            {settings.provider && !configuredChoice ? text.unavailableModel : text.disabled}
          </p>
        )}
        {settings?.canConfigure && (
          <AgentSettingsForm
            key={choiceKey(settings) + String(settings.enabled) + String(settings.allowBoardContext)}
            settings={settings}
            disabled={!online || Boolean(busy)}
            saving={busy === 'settings'}
            onSave={input => { void runAction('settings', async () => setSettings(await configureAgent(boardId, input))); }}
          />
        )}

        {choice && (
          <form className="space-y-3" onSubmit={event => { event.preventDefault(); start(); }}>
            <p className={'truncate text-xs ' + muted} title={choice.model}>{text.modelLabel(choiceName(choice, text), choice.model)}</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-xs font-semibold">{text.workflow}
                <select className={field} value={workflow} onChange={event => setWorkflow(event.target.value as AgentWorkflow)}>
                  {workflowOptions.map(value => <option key={value} value={value}>{text.workflows[value].label}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-xs font-semibold">{text.placeDraft}
                <select className={field} value={targetPlacement} onChange={event => setPlacement(event.target.value as AgentPlacement)}>
                  <option value="new-page">{text.newPage}</option>
                  <option value="current-page" disabled={!pageId}>{pageName || pages?.find(page => page.id === pageId)?.name || text.currentPage}</option>
                </select>
              </label>
            </div>
            <label className="block space-y-1 text-xs font-semibold">{text.prompt}
              <textarea value={prompt} onChange={event => setPrompt(event.target.value)} placeholder={text.workflows[workflow].prompt}
                maxLength={MAX_AGENT_PROMPT_LENGTH * 2} rows={3} className={field + ' resize-y'} />
            </label>
            {promptLength > MAX_AGENT_PROMPT_LENGTH && <p role="status" className={'text-xs ' + muted}>{text.promptLimit}</p>}
            {canIncludeSelection && workflow !== 'organize' && (
              <label className={'flex items-start gap-2 text-xs ' + muted}>
                <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={includeSelection && selectedIds.length > 0} disabled={!selectedIds.length} onChange={event => setIncludeSelection(event.target.checked)} />
                <span>{text.includeSelectedText(selectedIds.length)}</span>
              </label>
            )}
            {workflow === 'organize' && (
              <p className={'text-xs ' + muted}>{!canIncludeSelection ? text.contextDisabled :
                selectedIds.length ? text.usesSelectedText(selectedIds.length) : text.selectText}</p>
            )}
            {usedSelection.length > MAX_AGENT_SELECTION && (
              <p role="status" className={'text-xs ' + muted}>{text.selectionLimit(MAX_AGENT_SELECTION)}</p>
            )}
            {choice.cloud && (
              <label className={'flex items-start gap-2 rounded-xl border p-3 text-xs leading-relaxed ' + border}>
                <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={cloudConsent} onChange={event => setConsent(event.target.checked ? consentKey : '')} />
                <span>{text.cloudConsent(choiceName(choice, text), usedSelection.length)}</span>
              </label>
            )}
            <button type="submit" className={primary + ' w-full'} disabled={!canStart}>{busy === 'start' ? text.submitting : text.generate}</button>
          </form>
        )}

        {actionError && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm">{actionError}</p>}
        {runError && <p role="status" className={'text-sm ' + muted}>{runError}</p>}
        {current && (
          <RunDetails
            run={current}
            stages={stages.get(current.id) ?? []}
            pages={pages}
            pendingCount={pendingCount}
            online={online}
            clientId={clientId}
            busy={busy}
            renderCanvasPreview={renderCanvasPreview}
            providerLabel={settings?.choices?.find(item => choiceKey(item) === choiceKey(current))?.label}
            undone={undoneId === current.id}
            onUndo={undo}
            onApply={apply}
            onSharing={shared => { void runAction('share', async () => showRun(await setAgentRunSharing(boardId, current.id, shared))); }}
            onChange={change => { void runAction(change, async () => showRun(await changeAgentRun(boardId, current.id, change))); }}
            onAnswer={answer => { void runAction('answer', async () => showRun(await answerAgentRun(boardId, current.id, current.revision, answer))); }}
          />
        )}
        {runs.length > 0 && (
          <section aria-label={text.history} className={'space-y-2 border-t pt-3 ' + border}>
            <h3 className="text-xs font-semibold">{text.history}</h3>
            <ul className="space-y-1">
              {runs.map(run => (
                <li key={run.id}>
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    aria-pressed={selectedRunId === run.id}
                    className={'flex w-full items-center justify-between gap-2 rounded-full border px-3 py-2 text-left text-xs hover:bg-[var(--badge-bg)] aria-pressed:bg-[var(--badge-bg)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-50 ' + border}
                    onClick={() => { setSelectedRunId(run.id); setRunError(''); setActionError(''); setWatch(value => value + 1); }}
                  >
                    <span className="min-w-0 truncate">
                      <span className="font-semibold">{text.workflows[run.workflow]?.label ?? text.draft}</span>
                      <span className={'block truncate ' + muted}>{formatDate(run.createdAt, 'compact')}</span>
                    </span>
                    <span className={'shrink-0 ' + muted}>{runStatus(run, text)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </AgentPanelFrame>
  );
}

function AgentSettingsForm({
  settings, disabled, saving, onSave,
}: { settings: AgentSettings; disabled: boolean; saving: boolean; onSave: (input: AgentSettingsInput) => void }) {
  const { messages: { agent: text } } = useI18n();
  const [enabled, setEnabled] = useState(settings.enabled);
  const choices = settings.choices ?? [];
  const configured = choices.find(item => choiceKey(item) === choiceKey(settings));
  const [provider, setProvider] = useState(choiceKey(configured ?? choices[0] ?? {}));
  const [allowContext, setAllowContext] = useState(settings.allowBoardContext);
  const choice: AgentChoice | undefined = choices.find(item => choiceKey(item) === provider);

  return (
    <details className={'rounded-xl border ' + border} open={!settings.enabled}>
      <summary className="cursor-pointer px-3 py-2 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
        {settings.organizationId ? text.organizationSettings : text.settings}
      </summary>
      <form className="space-y-2 px-3 pb-3" onSubmit={event => {
        event.preventDefault();
        onSave({
          enabled, allowBoardContext: Boolean(enabled && choice?.cloud && allowContext),
          ...(choice && { provider: choice.provider, model: choice.model }),
        });
      }}>
        <label className="flex items-start gap-2 text-xs">
          <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={enabled} disabled={disabled} onChange={event => setEnabled(event.target.checked)} />
          <span>{text.enable}</span>
        </label>
        {choices.length > 0 ? (
          <label className="block space-y-1 text-xs font-semibold">{text.model}
            <select className={field} value={provider} disabled={disabled} onChange={event => setProvider(event.target.value)}>
              {choices.map(item => <option key={choiceKey(item)} value={choiceKey(item)}>{text.modelLabel(choiceName(item, text), item.model)}</option>)}
            </select>
          </label>
        ) : <p className={'text-xs ' + muted}>{text.configureOnServer}</p>}
        {choice?.cloud && (
          <label className={'flex items-start gap-2 text-xs ' + muted}>
            <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={allowContext} disabled={disabled} onChange={event => setAllowContext(event.target.checked)} />
            <span>{text.allowCloudText}</span>
          </label>
        )}
        <button type="submit" className={action} disabled={disabled || (enabled && !choice)}>{saving ? text.saving : text.saveSettings}</button>
      </form>
    </details>
  );
}

function AgentPanelFrame({ title, visual, readOnly, onEditIdentity, onClose, children }: {
  title: string;
  visual?: ReactNode;
  readOnly?: boolean;
  onEditIdentity?: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const { messages: { agent: text } } = useI18n();
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement;
    closeButton.current?.focus({ preventScroll: true });
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  return (
    <aside
      aria-label={readOnly ? text.sharedTitle : text.title}
      className={'board-side-panel absolute bottom-20 right-3 z-[75] flex w-[min(420px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border ' + border + ' text-[var(--text-primary)] shadow-2xl sm:bottom-6'}
      onKeyDown={event => {
        if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header className={'flex items-center justify-between gap-3 border-b px-4 py-2 ' + border}>
        <div className="flex min-w-0 items-center gap-2">
          {visual}
          <h2 className="truncate text-sm font-semibold" title={title}>{title}</h2>
        </div>
        <div className="flex items-center">
          {onEditIdentity && (
            <button type="button" className="board-action-button" aria-label={text.identity} title={text.identity} onClick={onEditIdentity}>
              <span className="size-4"><WorkshopIcon name="pencil" /></span>
            </button>
          )}
          <button ref={closeButton} type="button" className="board-action-button" aria-label={text.close} title={text.closeTitle} onClick={onClose}>
            <span className="size-4"><WorkshopIcon name="close" /></span>
          </button>
        </div>
      </header>
      {children}
    </aside>
  );
}

function SharedConversationPanel({ boardId, runId, onClose }: { boardId: string; runId: string; onClose: () => void }) {
  const { messages: { agent: text } } = useI18n();
  const [result, setResult] = useState<{ runId: string; run?: SharedAgentRun }>();
  const [refresh, setRefresh] = useState(0);
  const current = result?.runId === runId ? result : undefined;

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try {
        const run = await getSharedAgentRun(boardId, runId, controller.signal);
        if (controller.signal.aborted) return;
        setResult({ runId, run });
        timer = setTimeout(read, 6000);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setResult({ runId });
        if (!(cause instanceof ApiError && [401, 403, 404, 410].includes(cause.status))) timer = setTimeout(read, 6000);
      }
    };
    void read();
    return () => {
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [boardId, refresh, runId]);

  return (
    <AgentPanelFrame title={text.sharedTitle} readOnly onClose={onClose}>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {!current && <p role="status" className={'text-sm ' + muted}>{text.sharedLoading}</p>}
        {current && !current.run && (
          <div className="space-y-3">
            <p role="status" className={'text-sm ' + muted}>{text.sharedUnavailable}</p>
            <button type="button" className={action} onClick={() => { setResult(undefined); setRefresh(value => value + 1); }}>{text.refreshTitle}</button>
          </div>
        )}
        {current?.run && <AgentConversation run={current.run} stages={[]} readOnly />}
      </div>
    </AgentPanelFrame>
  );
}

interface RunDetailsProps {
  run: AgentRun;
  stages: ObservedAgentStage[];
  pages?: { id: string; name: string }[];
  pendingCount: number;
  online: boolean;
  clientId?: string;
  busy: string;
  undone?: boolean;
  providerLabel?: string;
  renderCanvasPreview?: (preview: AgentPreview) => ReactNode;
  onApply: () => void;
  onUndo?: () => void;
  onAnswer: (answer: string) => void;
  onChange: (action: AgentRunAction) => void;
  onSharing: (shared: boolean) => void;
}

function RunDetails({
  run, stages, pages, pendingCount, online, clientId, busy, undone, providerLabel, renderCanvasPreview, onApply, onUndo, onAnswer, onChange, onSharing,
}: RunDetailsProps) {
  const { messages: { agent: text } } = useI18n();
  const preview = run.result?.preview;
  const missingPage = preview?.placement === 'current-page' && Boolean(pages && !pages.some(page => page.id === preview.pageId));
  const canApply = online && pendingCount === 0 && Boolean(clientId) && !busy && !missingPage;
  const canPause = run.status === 'queued' || (run.status === 'running' && !cloudProvider(run.provider));
  const canRetry = (run.status === 'failed' || run.status === 'cancelled') && run.manualRetries < 2;
  const disabled = !online || Boolean(busy);
  const canPublish = run.status === 'succeeded' || run.status === 'awaiting_input';

  return (
    <section aria-label={text.run} className={'space-y-3 rounded-xl border p-3 ' + border}>
      <div className="flex items-center justify-between gap-2">
        <p role="status" className="text-sm font-semibold">{runStatus(run, text)}</p>
        <div className="flex shrink-0 items-center">
          {canPause && <RunControl icon="pause" label={text.pause} disabled={disabled} onClick={() => onChange('pause')} />}
          {run.status === 'paused' && <RunControl icon="resume" label={text.resume} disabled={disabled} onClick={() => onChange('resume')} />}
          {inProgress(run) && <RunControl icon="stop" label={text.stop} disabled={disabled} onClick={() => onChange('cancel')} />}
          {canRetry && (
            <button type="button" className="board-action-button" disabled={disabled} onClick={() => onChange('retry')} aria-label={text.retry} title={text.retryTitle}>
              <span className="size-4"><WorkshopIcon name="restore" /></span>
            </button>
          )}
        </div>
      </div>
      {run.status === 'failed' && (
        <p className={'text-xs ' + muted}>{text.errors[run.errorCode ?? ''] ?? text.generationFailed}</p>
      )}
      <AgentConversation
        run={run}
        stages={stages}
        preview={preview}
        pages={pages}
        appliedSequence={run.applied?.ack.seq}
        undone={undone}
        renderCanvasPreview={renderCanvasPreview}
      />
      {run.status === 'awaiting_input' && (
        <Clarification key={run.id + ':' + run.revision}
          cloudProvider={cloudProvider(run.provider) ? providerLabel || providerName(run.provider, text) : undefined}
          disabled={disabled} answering={busy === 'answer'} onAnswer={onAnswer} />
      )}
      {run.status === 'succeeded' && Boolean(preview?.operations.length) && !run.applied && (
        <>
          <button className={primary + ' w-full'} type="button" disabled={!canApply} onClick={onApply}>
            {busy === 'apply' ? text.applying : text.apply}
          </button>
          {missingPage ? <p className={'text-xs ' + muted}>{text.pageRemoved}</p> :
            online && (pendingCount > 0 || !clientId) && <p className={'text-xs ' + muted}>{text.waitForSync}</p>}
        </>
      )}
      {onUndo && (
        <button className={action} type="button" disabled={disabled} onClick={onUndo}>
          <span className="size-4"><WorkshopIcon name="restore" /></span>
          {busy === 'undo' ? text.undoing : text.undo}
        </button>
      )}
      {(canPublish || run.shared) && (
        <RunSharing key={run.id} boardId={run.boardId} runId={run.id} shared={Boolean(run.shared)}
          canPublish={canPublish} disabled={disabled} onSharing={onSharing} />
      )}
    </section>
  );
}

const runIconPaths = {
  pause: 'M9 5v14M15 5v14',
  resume: 'm8 5 12 7-12 7Z',
  stop: 'M6 6h12v12H6z',
  share: 'M12 15V3m-4 4 4-4 4 4M6 12H4v8h16v-8h-2',
  link: 'M9 15l6-6m-7 2-2 2a3.5 3.5 0 0 0 5 5l2-2m-2-8 2-2a3.5 3.5 0 1 1 5 5l-2 2',
} as const;

function RunIcon({ name }: { name: keyof typeof runIconPaths }) {
  return <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={runIconPaths[name]} /></svg>;
}

function RunControl({ icon, label, disabled, onClick }: {
  icon: keyof typeof runIconPaths;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="board-action-button" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      <RunIcon name={icon} />
    </button>
  );
}

function RunSharing({ boardId, runId, shared, canPublish, disabled, onSharing }: {
  boardId: string;
  runId: string;
  shared: boolean;
  canPublish: boolean;
  disabled: boolean;
  onSharing: (shared: boolean) => void;
}) {
  const { messages: { agent: text } } = useI18n();
  const [copyStatus, setCopyStatus] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const link = shared ? conversationLink(boardId, runId) : '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopyStatus(text.copied);
    } catch {
      input.current?.focus();
      input.current?.select();
      setCopyStatus(text.manualCopy);
    }
  };

  return (
    <details className={'rounded-xl border ' + border}>
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
        <RunIcon name="share" />
        {text.share}
      </summary>
      <div className="space-y-2 px-3 pb-3">
        <p className={'text-xs leading-relaxed ' + muted}>{shared ? text.publishedHint : text.shareHint}</p>
        {shared && (
          <div className="flex min-w-0 items-center gap-1">
            <input ref={input} aria-label={text.link} value={link} readOnly className={field + ' min-w-0 text-xs'} onFocus={event => event.currentTarget.select()} />
            <RunControl icon="link" label={text.copyLink} onClick={() => { void copy(); }} />
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {canPublish && !shared && (
            <button className={action} type="button" disabled={disabled} onClick={() => { setCopyStatus(''); onSharing(true); }}>
              {text.publish}
            </button>
          )}
          {shared && (
            <button className={action} type="button" disabled={disabled} onClick={() => { setCopyStatus(''); onSharing(false); }}>{text.unshare}</button>
          )}
        </div>
        {copyStatus && <p role="status" className={'text-xs ' + muted}>{copyStatus}</p>}
      </div>
    </details>
  );
}

function Clarification({ cloudProvider, disabled, answering, onAnswer }: {
  cloudProvider?: string;
  disabled: boolean;
  answering: boolean;
  onAnswer: (answer: string) => void;
}) {
  const { messages: { agent: text } } = useI18n();
  const [answer, setAnswer] = useState('');
  const input = answer.trim();
  const tooLong = runeLength(input) > MAX_AGENT_ANSWER_LENGTH;
  return (
    <form className="space-y-2" onSubmit={event => { event.preventDefault(); if (!disabled && input && !tooLong) onAnswer(input); }}>
      <label className="block space-y-1 text-sm">
        {text.answer}
        <textarea value={answer} onChange={event => setAnswer(event.target.value)} className={field} rows={2}
          maxLength={MAX_AGENT_ANSWER_LENGTH * 2} disabled={disabled} />
      </label>
      {tooLong && <p role="status" className={'text-xs ' + muted}>{text.answerLimit}</p>}
      <button type="submit" className={action} disabled={disabled || !input || tooLong}>
        {answering ? text.submitting : cloudProvider ? text.sendAnswer(cloudProvider) : text.submitAnswer}
      </button>
    </form>
  );
}
