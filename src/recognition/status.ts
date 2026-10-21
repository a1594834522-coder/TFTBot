import type { RecognitionView } from './original-events';
export interface ReaderStatus {
  phase: 'stopped' | 'waiting' | 'connected' | 'receiving' | 'error';
  message: string;
  transport: 'original-native';
  testMode: boolean;
  frames: number;
  lastFrameAt: number | null;
  scoreboard?: {phase:'stopped'|'waiting'|'receiving'|'error';message:string;frames:number;lastFrameAt:number|null};
  cards: RecognitionView;
  tracker?: { revision: number; snapshot: import('../game/roster').RosterSnapshot | null };
  gameBounds?: { x: number; y: number; width: number; height: number } | null;
  opponentVision?:{round:string|null;at:number;rows:Array<{id:string;y:number}>;candidates:string[];message:string};
}
