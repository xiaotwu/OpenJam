import { lazy, Suspense, type ReactNode } from 'react';
import { useI18n } from '../../i18n';
import type { AgentPreview, AgentProposal, AgentRunStatus, SharedAgentRun } from '../../lib/boardAgent';

const AgentMarkdown = lazy(() => import('./AgentMarkdown').catch(() => ({ default: PlainResponse })));
const muted = 'text-[var(--text-secondary)]';

function PlainResponse({ content }: { content: string }) {
  return <p className="whitespace-pre-wrap break-words text-sm">{content}</p>;
}

export interface ObservedAgentStage {
  revision: number;
  status: AgentRunStatus;
  updatedAt: string;
  attempt?: number;
  question?: string;
}

interface AgentConversationProps {
  run: SharedAgentRun;
  stages: ObservedAgentStage[];
  preview?: AgentPreview;
  pages?: { id: string; name: string }[];
  appliedSequence?: number;
  undone?: boolean;
  readOnly?: boolean;
  renderCanvasPreview?: (preview: AgentPreview) => ReactNode;
}

export default function AgentConversation({
  run, stages, preview, pages, appliedSequence, undone, readOnly, renderCanvasPreview,
}: AgentConversationProps) {
  const { messages: { agent: text }, formatNumber } = useI18n();
  const proposal = run.result?.proposal;
  const question = run.conversation?.question || proposal?.question || stages.find(stage => stage.question)?.question;
  const answer = run.conversation?.answer;
  const response = run.result?.externalReply;
  const knownStages = stages.length ? stages : [run];
  const questionIndex = knownStages.findIndex(stage => stage.status === 'awaiting_input');
  const split = questionIndex >= 0 ? questionIndex + 1 : knownStages.length - (answer ? 1 : 0);

  const stageEntry = (stage: ObservedAgentStage) => {
    const attempt = stage.attempt ?? 0;
    return (
      <TranscriptEntry key={'stage-' + stage.revision} title={text.steps[stage.status]} at={stage.updatedAt}>
        {attempt > 1 && <p className={'text-xs ' + muted}>{text.attempt(formatNumber(attempt))}</p>}
      </TranscriptEntry>
    );
  };

  return (
    <ol aria-label={text.conversation} className="ml-1">
      <TranscriptEntry title={text.request} at={run.createdAt}>
        {run.conversation?.prompt && <p className="whitespace-pre-wrap break-words text-sm">{run.conversation.prompt}</p>}
      </TranscriptEntry>
      {knownStages.slice(0, split).map(stageEntry)}
      {question && <TranscriptEntry title={text.question}><p className="whitespace-pre-wrap break-words text-sm">{question}</p></TranscriptEntry>}
      {answer && <TranscriptEntry title={text.submittedAnswer}><p className="whitespace-pre-wrap break-words text-sm">{answer}</p></TranscriptEntry>}
      {knownStages.slice(split).map(stageEntry)}
      {response?.markdown && (
        <TranscriptEntry title={response.source || text.externalReply}>
          <Suspense fallback={<p role="status" className={'text-xs ' + muted}>{text.responseLoading}</p>}>
            <AgentMarkdown content={response.markdown} />
          </Suspense>
        </TranscriptEntry>
      )}
      {run.status === 'succeeded' && proposal?.title && (
        <TranscriptEntry title={text.preview}>
          <ProposalPreview proposal={proposal} preview={preview} pages={pages}>
            {preview && renderCanvasPreview?.(preview)}
          </ProposalPreview>
        </TranscriptEntry>
      )}
      {readOnly && run.status === 'succeeded' && !proposal?.title && !response?.markdown && (
        <li className={'py-2 pl-3 text-xs ' + muted}>{text.sharedContentOmitted}</li>
      )}
      {appliedSequence !== undefined && (
        <TranscriptEntry title={text.appliedAs(formatNumber(appliedSequence))}>
          {undone && <p role="status" className={'text-xs ' + muted}>{text.undone}</p>}
        </TranscriptEntry>
      )}
    </ol>
  );
}

function TranscriptEntry({ title, at, children }: { title: string; at?: string; children?: ReactNode }) {
  const { formatDate } = useI18n();
  return (
    <li className="relative space-y-1.5 border-l border-[var(--glass-border-strong)] pb-3 pl-4 before:absolute before:top-1.5 before:-left-[4px] before:size-[7px] before:rounded-full before:bg-[var(--accent)]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <span className="min-w-0 break-words text-xs font-semibold">{title}</span>
        {at && <time dateTime={at} className={'text-xs ' + muted}>{formatDate(at, 'compact')}</time>}
      </div>
      {children}
    </li>
  );
}

function ProposalPreview({ proposal, preview, pages, children }: {
  proposal: AgentProposal;
  preview?: AgentPreview;
  pages?: { id: string; name: string }[];
  children?: ReactNode;
}) {
  const { messages: { agent: text } } = useI18n();
  const labels = new Map((proposal.nodes ?? []).map(node => [node.id, node.label]));
  const target = preview && (preview.placement === 'new-page'
    ? text.newPage
    : pages?.find(page => page.id === preview.pageId)?.name ?? text.selectedPage);

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h3 className="break-words text-base font-semibold">{proposal.title}</h3>
        {target && <p className={'text-xs ' + muted}>{text.target(target)}</p>}
        {proposal.summary && <p className={'whitespace-pre-wrap break-words text-sm ' + muted}>{proposal.summary}</p>}
      </div>
      {children}
      {proposal.groups?.map((group, index) => (
        <section key={group.title + ':' + index} className="rounded-xl border border-[var(--glass-border-strong)] p-3">
          <h4 className="mb-2 break-words text-sm font-semibold">{group.title}</h4>
          <ul className="space-y-1.5">
            {group.items.map((item, index) => <li key={index} className="whitespace-pre-wrap break-words rounded-lg bg-[var(--badge-bg)] px-2 py-1.5 text-xs">{item}</li>)}
          </ul>
        </section>
      ))}
      {Boolean(proposal.nodes?.length) && (
        <ul aria-label={text.nodes} className="grid grid-cols-2 gap-2">
          {proposal.nodes?.map(node => <li key={node.id} className="grid min-h-10 place-content-center break-words rounded-lg border border-[var(--glass-border-strong)] p-2 text-center text-xs font-medium">{node.label}</li>)}
        </ul>
      )}
      {Boolean(proposal.edges?.length) && (
        <ul aria-label={text.connections} className="space-y-1">
          {proposal.edges?.map((edge, index) => (
            <li key={index} className="rounded-lg bg-[var(--badge-bg)] p-2 text-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                <span>{labels.get(edge.from) ?? edge.from}</span>
                <svg className="size-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 12h17m-6-6 6 6-6 6" /></svg>
                <span>{labels.get(edge.to) ?? edge.to}</span>
              </div>
              {edge.label && <p className={'mt-1 ' + muted}>{edge.label}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
