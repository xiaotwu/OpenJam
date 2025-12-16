export interface Point {
  x: number;
  y: number;
}

export interface User {
  id: string;
  email: string;
  displayName: string;
  avatarColor: string;
}

export interface Cursor {
  userId: string;
  x: number;
  y: number;
  color: string;
  name: string;
  lastUpdate: number;
}

export type Tool = 'pointer' | 'pan' | 'draw' | 'erase';

export interface ToolState {
  tool: Tool;
  color: string;
  width: number;
}

export interface ViewState {
  offsetX: number;
  offsetY: number;
  scale: number;
}
