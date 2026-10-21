import type { AugmentTierSnapshot } from '../game/metatft-augments';
import type { ReaderStatus } from '../recognition/status';
import type { SelectedComp } from '../game/selected-comp';
import type {AdvisorPreferences} from '../game/advisor-preferences';
import type {BattleForecast} from '../game/battle-forecast';
export interface DesktopBridge {
  storage: {
    getItem(key: string): Promise<string>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
  };
  augments(cachedOnly: boolean): Promise<AugmentTierSnapshot | null>;
  openRecording(): Promise<{ name: string; text: string } | null>;
  setAlwaysOnTop(enabled: boolean): Promise<void>;
  readerStart(): Promise<ReaderStatus>;
  readerStop(): Promise<void>;
  readerSnapshot(): Promise<ReaderStatus>;
  onReader(handler: (status: ReaderStatus) => void): () => void;
  battleSnapshot():Promise<BattleForecast>;
  onBattle(handler:(forecast:BattleForecast)=>void):()=>void;
  overlay(action: 'show' | 'hide' | 'lock' | 'unlock' | 'collapse' | 'expand' | 'snapshot'): Promise<{ visible: boolean; locked: boolean; collapsed: boolean }>;
  onOverlay(handler: (state: { visible: boolean; locked: boolean; collapsed: boolean }) => void): () => void;
  selectedComp(): Promise<SelectedComp | null>;
  selectComp(key: string | null,directionId?:string): Promise<SelectedComp | null>;
  selectTransition(id:string|null):Promise<SelectedComp|null>;
  advisorPreferences():Promise<AdvisorPreferences>;
  configureAdvisor(value:AdvisorPreferences):Promise<AdvisorPreferences>;
  onAdvisorPreferences(handler:(value:AdvisorPreferences)=>void):()=>void;
  onSelectedComp(handler: (comp: SelectedComp | null) => void): () => void;
  reportReady(report: { set: number; comps: number; champions: number; augments: number; source: string }): void;
}
declare global { interface Window { tftDesktop: DesktopBridge; } }
