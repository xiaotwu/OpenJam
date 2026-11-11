import { Link } from 'react-router-dom';
import Markdown from 'react-markdown';
import { useBoardFont } from '../../lib/boardFonts';
import type { DocBlock } from '../../lib/docs';

export default function DocMarkup({ block }: { block: DocBlock }) {
  const fontFamily = useBoardFont(block.fontFamily);

  return <div className="doc-markup" style={{ fontFamily }}>
    {block.text.trim() ? <Markdown skipHtml components={{
      a: ({ href, children }) => href?.startsWith('/') && !href.startsWith('//')
        ? <Link to={href}>{children}</Link>
        : <a href={href} target="_blank" rel="noreferrer">{children}</a>,
      img: ({ alt }) => alt ? <span>{alt}</span> : null,
    }}>{block.text}</Markdown> : null}
  </div>;
}
