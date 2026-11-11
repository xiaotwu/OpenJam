import type { CSSProperties } from 'react';
import type { AgentProfile, CharacterPose } from '../../lib/agentIdentity';

const petRow: Record<CharacterPose, number> = { idle: 0, working: 1, waiting: 2, reviewing: 3 };

export default function AgentCharacter({ profile, pose = 'idle' }: { profile?: AgentProfile; pose?: CharacterPose }) {
  const image = profile?.imagePng ? 'data:image/png;base64,' + profile.imagePng : undefined;
  if (image && profile?.kind === 'pet') {
    return <span aria-hidden="true" className="agent-character agent-character-pet" data-pose={pose} style={{
      backgroundImage: `url("${image}")`, '--pet-row': petRow[pose],
    } as CSSProperties} />;
  }
  if (image && profile?.kind === 'image') {
    return <img className="agent-character agent-character-picture" data-pose={pose} src={image} alt="" />;
  }
  const glyph = profile?.kind === 'glyph' ? profile.glyph : undefined;
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="agent-character agent-character-mark" data-pose={pose} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {glyph === 'orbit' ? <><ellipse cx="12" cy="12" rx="10" ry="5" transform="rotate(-38 12 12)" /><circle cx="12" cy="12" r="2.1" fill="currentColor" stroke="none" /></>
        : glyph === 'diamond' ? <path d="m12 3 9 9-9 9-9-9z" />
        : glyph === 'dot' ? <circle cx="12" cy="12" r="4.2" fill="currentColor" stroke="none" />
        : glyph === 'sparkle' ? <path d="M12 2.5 14.5 9.5 21.5 12 14.5 14.5 12 21.5 9.5 14.5 2.5 12 9.5 9.5Z" />
        : <circle cx="12" cy="12" r="8.1" />}
    </svg>
  );
}
