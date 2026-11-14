import { boardFonts } from '../../lib/boardFonts';
import type { SlideObject } from '../../lib/slides';
import WorkshopIcon from '../workshop/WorkshopIcon';

const sizes = [16, 20, 24, 28, 32, 36, 40, 44, 48, 56, 64, 72, 80, 96, 120];

interface SlideToolbarProps {
  editable: boolean;
  canInsert: boolean;
  canUndo: boolean;
  canRedo: boolean;
  selected?: SlideObject;
  background: string;
  onUndo: () => void;
  onRedo: () => void;
  onAddText: () => void;
  onAddImage: () => void;
  onEditText: () => void;
  onReplaceImage: () => void;
  onDelete: () => void;
  onPatch: (changes: Record<string, unknown>) => void;
  onBackground: (color: string) => void;
  onCopyLink: () => void;
}

export default function SlideToolbar({
  editable, canInsert, canUndo, canRedo, selected, background, onUndo, onRedo, onAddText, onAddImage,
  onEditText, onReplaceImage, onDelete, onPatch, onBackground, onCopyLink,
}: SlideToolbarProps) {
  const text = selected?.type === 'text' ? selected : undefined;
  const fontOptions = text && !boardFonts.some(font => font.family === text.fontFamily)
    ? [{ label: text.fontFamily, family: text.fontFamily }, ...boardFonts] : boardFonts;
  const fontSizes = text && !sizes.includes(text.fontSize) ? [...sizes, text.fontSize].sort((a, b) => a - b) : sizes;
  return <div className="slide-toolbar" aria-label="Presentation Tools">
    <div className="slide-tool-group">
      {editable && <>
        <button type="button" className="doc-tool" aria-label="Undo" title="Undo" onClick={onUndo} disabled={!canUndo}><WorkshopIcon name="undo" /></button>
        <button type="button" className="doc-tool" aria-label="Redo" title="Redo" onClick={onRedo} disabled={!canRedo}><WorkshopIcon name="redo" /></button>
        <span className="doc-tools-divider" />
        <button type="button" className="doc-tool" aria-label="Add Text Box" title="Add Text Box" onClick={onAddText}
          disabled={!canInsert}><WorkshopIcon name="text" /></button>
        <button type="button" className="doc-tool" aria-label="Add Image" title="Add Image" onClick={onAddImage}
          disabled={!canInsert}><WorkshopIcon name="image" /></button>
        <label className="slide-color" title="Slide Background">
          <input type="color" aria-label="Slide Background" value={background} onChange={event => onBackground(event.target.value)} />
        </label>
        <span className="doc-tools-divider" />
      </>}
      <button type="button" className="doc-tool" aria-label="Copy Slide Link" title="Copy Slide Link" onClick={onCopyLink}><WorkshopIcon name="link" /></button>
    </div>
    {editable && selected && <div className="slide-tool-group" aria-label="Selected Object Tools">
      {text ? <>
        <button type="button" className="doc-tool" aria-label="Edit Text" title="Edit Text" onClick={onEditText}><WorkshopIcon name="pencil" /></button>
        <select className="doc-select" aria-label="Font Family" value={text.fontFamily} onChange={event => onPatch({ fontFamily: event.target.value })}>
          {fontOptions.map(font => <option key={font.family} value={font.family}>{font.label}</option>)}
        </select>
        <select className="doc-select slide-font-size" aria-label="Font Size" value={text.fontSize}
          onChange={event => onPatch({ fontSize: Number(event.target.value) })}>
          {fontSizes.map(size => <option key={size} value={size}>{Math.round(size)} px</option>)}
        </select>
        <button type="button" className="doc-tool" aria-label="Bold" title="Bold" aria-pressed={text.fontWeight === 'bold'}
          onClick={() => onPatch({ fontWeight: text.fontWeight === 'bold' ? 'normal' : 'bold' })}><WorkshopIcon name="bold" /></button>
        <button type="button" className="doc-tool" aria-label="Italic" title="Italic" aria-pressed={text.fontStyle === 'italic'}
          onClick={() => onPatch({ fontStyle: text.fontStyle === 'italic' ? 'normal' : 'italic' })}><WorkshopIcon name="italic" /></button>
        <select className="doc-select slide-align" aria-label="Text Alignment" value={text.textAlign}
          onChange={event => onPatch({ textAlign: event.target.value })}>
          <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
        </select>
        <label className="slide-color" title="Text Color">
          <input type="color" aria-label="Text Color" value={text.color} onChange={event => onPatch({ color: event.target.value })} />
        </label>
      </> : <button type="button" className="doc-edit-action" onClick={onReplaceImage} title="Replace Image">
        <WorkshopIcon name="restore" /><span>Replace</span>
      </button>}
      <button type="button" className="doc-tool" aria-label="Delete Object" title="Delete Object" onClick={onDelete}><WorkshopIcon name="trash" /></button>
    </div>}
  </div>;
}
