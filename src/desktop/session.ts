import { createSettingsStore } from '../core/settings-store';
import { dataset } from '../game/tft-data';
import { createTrickController } from '../windows/trick/controller';
import { replayText } from '../core/replay';
import type { RosterSnapshot } from '../game/roster';
import type { DesktopBridge } from './bridge';
import { CURRENT_SET, requireCurrentSeason } from '../game/current-season';
import type { ReaderStatus } from '../recognition/status';
import { currentPool, shopCatalog, normalizeShopHero } from '../game/shop-mechanics';

export async function createDesktopSession(bridge: DesktopBridge) {
  const settings = createSettingsStore({ cube: { io: { localStorage: bridge.storage } }, getOwner: () => 'desktop', local: { getItem: () => null, setItem: () => {} } });
  await settings.load();
  // One-time migration from the previous all-sources default. Later user choices persist.
  if (!await bridge.storage.getItem('tftbot:desktop:primary-source-v1')) {
    await settings.patch({ compsSource: 'metatft' });
    await bridge.storage.setItem('tftbot:desktop:primary-source-v1', '1');
  }
  const set = CURRENT_SET;
  await bridge.storage.removeItem('tftbot:desktop:set');
  let snapshot: RosterSnapshot | null = null;
  let mode: 'live' | 'recording' | null = null;
  let revision = -1;
  const listeners = new Set<(event: { snapshot?: RosterSnapshot; raw: unknown }) => void>();
  const controller = createTrickController({
    core: { snapshot: () => snapshot, onGame: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } },
    getCatalog: () => shopCatalog, getSettings: () => settings.get(), pool: currentPool, normalizeName: normalizeShopHero,
  });
  const off = settings.subscribe(() => controller.refresh());
  return {
    settings, controller,
    applyLiveStatus(status: ReaderStatus) {
      if (!status.tracker || status.tracker.revision === revision) return;
      revision = status.tracker.revision;
      if (status.tracker.snapshot) {
        mode = 'live'; snapshot = status.tracker.snapshot;
        controller.apply(snapshot, status.testMode ? '协议测试' : '原生实时采集');
      } else if (mode === 'live') { snapshot = null; mode = null; controller.apply(null); }
    },
    currentSet: () => set,
    async changeSet(next: number) {
      requireCurrentSeason(next);
    },
    loadRecording(text: string) {
      const result = replayText(text, { catalog: dataset.charactersOf(set) });
      if (!result.final) throw new Error('录像没有有效的玩家快照');
      for (const player of result.final.players) for (const champion of player.champions) {
        const season = /^(?:TFT|DA_)(\d+)_/.exec(champion.name);
        if (season) requireCurrentSeason(Number(season[1]));
      }
      snapshot = result.final;
      mode = 'recording';
      for (const listener of listeners) listener({ snapshot, raw: { key: '录像回放' } });
      return { events: result.events, invalid: result.invalid };
    },
    clearRecording() { snapshot = null; mode = null; controller.apply(null); },
    dispose() { off(); controller.dispose(); listeners.clear(); },
  };
}
