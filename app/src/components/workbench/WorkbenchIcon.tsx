const paths = {
  inbox: 'M4 5h16l2 10v4H2v-4z M2 15h6l2 2h4l2-2h6',
  calendar: 'M4 6h16v14H4z M4 10h16 M8 4v4 M16 4v4 M8 14h2 M13 14h2 M8 17h2',
  graph: 'M7 8l9 3M7 16l9-4M5 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM5 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM18 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  pin: 'M9 3h6l-1 6 3 3v2H7v-2l3-3z M12 14v7',
  send: 'm3 3 18 9-18 9 3-9z M6 12h15',
  message: 'M4 5h16v12h-9l-5 3v-3H4z M8 10h8 M8 13h5',
  previous: 'm15 6-6 6 6 6',
  next: 'm9 6 6 6-6 6',
  text: 'M5 5h14M12 5v14M8 19h8 M5 8V5 M19 8V5',
  link: 'M10 13a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-2 2 M14 11a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l2-2',
  bell: 'M5 16h14l-2-3V9a5 5 0 0 0-10 0v4z M10 19a2 2 0 0 0 4 0',
  task: 'M4 4h16v16H4z m4 8 3 3 5-6',
  trash: 'M4 6h16 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7',
  archive: 'M4 7h16v13H4z M3 3h18v4H3z M10 11h4',
  arrow: 'M7 17 17 7M7 7h10v10',
  board: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M7 8h5v5H7z M15 8h2 M15 12h2 M7 17h10',
  check: 'm5 12 4 4L19 6',
  chevron: 'm6 9 6 6 6-6',
  close: 'm6 6 12 12M18 6 6 18',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  import: 'M12 16V4m-4 4 4-4 4 4M4 16v4h16v-4',
  list: 'M4 6h16 M4 12h16 M4 18h16',
  logout: 'M10 17l5-5-5-5 M15 12H3 M14 4h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5',
  menu: 'M4 6h16M4 12h16M4 18h16',
  monitor: 'M3 5h18v12H3z M12 17v4 M8 21h8',
  moon: 'M20.9 13.4A9 9 0 1 1 10.6 3.1a7 7 0 0 0 10.3 10.3Z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  move: 'M12 3v18 M3 12h18 M9 6l3-3 3 3 M9 18l3 3 3-3 M6 9l-3 3 3 3 M18 9l3 3-3 3',
  organization: 'M3 21h18 M5 21V8l7-4 7 4v13 M9 21v-5h6v5 M9 10h.01M15 10h.01',
  pencil: 'm15 5 4 4 M4 20l1-5L17 3l4 4L9 19z',
  plus: 'M12 5v14M5 12h14',
  recent: 'M12 7v5l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  restore: 'M3 12a9 9 0 1 1 2 5.6 M3 5v7h7',
  search: 'M21 21l-4.5-4.5 M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  settings: 'M4 6h16M4 12h16M4 18h16 M8 4v4M16 10v4M10 16v4',
  shared: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M22 21v-2a4 4 0 0 0-3-3.87 M14 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z M18 3.1a4 4 0 0 1 0 7.8',
  star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9z',
  sun: 'M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5 19 19 M5 19l1.5-1.5 M17.5 6.5 19 5 M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z',
} as const;

export type WorkbenchIconName = keyof typeof paths;

export default function WorkbenchIcon({ name, filled = false }: { name: WorkbenchIconName; filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={name === 'more' ? 3 : 1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
