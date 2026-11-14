import Markdown from 'react-markdown';

function safeHttpLink(value: string) {
  try {
    const url = new URL(value);
    if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password) return url.href;
  } catch {
    // Only explicit, complete web links are actionable in external responses.
  }
  return '';
}

export default function AgentMarkdown({ content }: { content: string }) {
  return (
    <div className="space-y-2 overflow-hidden break-words text-sm leading-relaxed">
      <Markdown
        skipHtml
        disallowedElements={['img']}
        urlTransform={(url, attribute) => attribute === 'href' ? safeHttpLink(url) : ''}
        components={{
          h1: ({ children }) => <h4 className="text-base font-semibold">{children}</h4>,
          h2: ({ children }) => <h4 className="text-base font-semibold">{children}</h4>,
          h3: ({ children }) => <h5 className="font-semibold">{children}</h5>,
          h4: ({ children }) => <h5 className="font-semibold">{children}</h5>,
          h5: ({ children }) => <h6 className="font-semibold">{children}</h6>,
          h6: ({ children }) => <h6 className="font-semibold">{children}</h6>,
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children, start }) => <ol start={start} className="list-decimal space-y-1 pl-5">{children}</ol>,
          blockquote: ({ children }) => <blockquote className="border-l-2 border-[var(--glass-border-strong)] pl-3 text-[var(--text-secondary)]">{children}</blockquote>,
          pre: ({ children }) => <pre className="overflow-x-auto rounded-lg bg-[var(--badge-bg)] p-2">{children}</pre>,
          code: ({ children }) => <code className="font-mono text-xs">{children}</code>,
          a: ({ href, children }) => href
            ? <a href={href} target="_blank" rel="noopener noreferrer nofollow" referrerPolicy="no-referrer" className="font-medium underline underline-offset-2">{children}</a>
            : <span>{children}</span>,
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}
