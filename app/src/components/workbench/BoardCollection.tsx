import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DirectoryBoard } from '../../lib/directory';
import { readBoardThumbnail } from '../../lib/boardFiles';
import { useI18n } from '../../i18n';
import WorkbenchIcon from './WorkbenchIcon';

export type BoardLayout = 'grid' | 'list';
export type BoardAction = 'favorite' | 'rename' | 'move' | 'archive';

export interface BoardEntry {
  board: DirectoryBoard;
  location: string;
  canMove: boolean;
}

interface BoardCollectionProps {
  entries: BoardEntry[];
  theme: 'light' | 'dark';
  layout: BoardLayout;
  busyBoards: ReadonlySet<string>;
  menuId: string | null;
  onMenuChange: (id: string | null) => void;
  onAction: (action: BoardAction, board: DirectoryBoard) => void;
}

function BoardPreview({ boardId, theme }: { boardId: string; theme: 'light' | 'dark' }) {
  const element = useRef<HTMLDivElement>(null);
  const [source, setSource] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    let imageURL: string | undefined;
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const load = async () => {
      try {
        const result = await readBoardThumbnail(boardId, controller.signal, theme);
        if (controller.signal.aborted) return;
        if (result === 'pending' && attempts++ < 6) {
          timer = setTimeout(load, Math.min(500 * 2 ** attempts, 5000));
        } else if (result && result !== 'pending') {
          imageURL = URL.createObjectURL(result);
          setSource(imageURL);
        }
      } catch {
        if (!controller.signal.aborted) setSource(undefined);
      }
    };
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      void load();
    });
    if (element.current) observer.observe(element.current);
    return () => {
      observer.disconnect();
      controller.abort();
      clearTimeout(timer);
      if (imageURL) URL.revokeObjectURL(imageURL);
    };
  }, [boardId, theme]);

  return (
    <div ref={element} className="wb-board-preview" aria-hidden="true">
      {source ? <img src={source} alt="" /> : <span className="wb-file-glyph"><WorkbenchIcon name="board" /></span>}
    </div>
  );
}

export default function BoardCollection({ entries, theme, layout, busyBoards, menuId, onMenuChange, onAction }: BoardCollectionProps) {
  return (
    <ul className={`wb-board-collection wb-layout-${layout}`}>
      {entries.map(({ board, location, canMove }) => (
        <BoardTile
          key={board.id}
          board={board}
          theme={theme}
          location={location}
          canMove={canMove}
          isBusy={busyBoards.has(board.id)}
          menuOpen={menuId === board.id}
          onMenuChange={onMenuChange}
          onAction={onAction}
        />
      ))}
    </ul>
  );
}

interface BoardTileProps {
  board: DirectoryBoard;
  theme: 'light' | 'dark';
  location: string;
  canMove: boolean;
  isBusy: boolean;
  menuOpen: boolean;
  onMenuChange: (id: string | null) => void;
  onAction: (action: BoardAction, board: DirectoryBoard) => void;
}

function BoardTile({ board, theme, location, canMove, isBusy, menuOpen, onMenuChange, onAction }: BoardTileProps) {
  const { formatDate, messages: { workbench: { board: text, directory } } } = useI18n();
  const menuId = useId();
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const updatedLabel = formatDate(board.updatedAt, 'date');
  const owned = board.permission === 'owner';
  const favoriteLabel = board.favorite ? text.removeFavorite(board.name) : text.addFavorite(board.name);
  const archiveLabel = board.archivedAt ? directory.restoreBoard : directory.archiveBoard;

  return (
    <li className="wb-board-tile">
      <Link
        to={`/board/${encodeURIComponent(board.id)}`}
        className="wb-board-link"
        aria-label={text.open(board.name)}
        aria-describedby={`${menuId}-location ${menuId}-detail`}
      >
        <BoardPreview key={`${board.updatedAt}/${theme}`} boardId={board.id} theme={theme} />
        <div className="wb-board-meta">
          <strong title={board.name}>{board.name}</strong>
          <span id={`${menuId}-location`} title={location}>{location}</span>
        </div>
        <div className="wb-board-detail" id={`${menuId}-detail`}>
          <span>{text.permissions[board.permission]}</span>
          {updatedLabel && <time dateTime={board.updatedAt} title={text.updated(updatedLabel)}>{updatedLabel}</time>}
        </div>
      </Link>
      <div className="wb-board-actions" data-wb-board-menu>
        <button
          type="button"
          className="wb-icon-button wb-favorite"
          aria-label={text.favorite(board.name)}
          aria-pressed={board.favorite}
          title={favoriteLabel}
          disabled={isBusy}
          onClick={() => onAction('favorite', board)}
        >
          <WorkbenchIcon name="star" filled={board.favorite} />
        </button>
        {owned && (
          <button
            type="button"
            ref={menuTrigger}
            data-wb-menu-trigger
            className="wb-icon-button"
            aria-label={text.actions(board.name)}
            aria-expanded={menuOpen}
            aria-controls={menuOpen ? menuId : undefined}
            disabled={isBusy}
            onClick={() => onMenuChange(menuOpen ? null : board.id)}
          >
            <WorkbenchIcon name="more" />
          </button>
        )}
        {owned && menuOpen && (
          <div
            id={menuId}
            className="wb-board-menu"
            role="group"
            aria-label={text.actions(board.name)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                onMenuChange(null);
                menuTrigger.current?.focus();
              }
            }}
          >
            <button type="button" onClick={() => onAction('rename', board)}>
              <WorkbenchIcon name="pencil" /> {text.rename}
            </button>
            {canMove && (
              <button type="button" onClick={() => onAction('move', board)}>
                <WorkbenchIcon name="move" /> {directory.moveToProject}
              </button>
            )}
            <button type="button" onClick={() => onAction('archive', board)}>
              <WorkbenchIcon name={board.archivedAt ? 'restore' : 'archive'} /> {archiveLabel}
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
