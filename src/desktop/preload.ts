import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge } from './bridge';

const bridge: DesktopBridge = {
  storage: {
    getItem: (key) => ipcRenderer.invoke('desktop:storage', 'get', key),
    setItem: (key, value) => ipcRenderer.invoke('desktop:storage', 'set', key, value),
    removeItem: (key) => ipcRenderer.invoke('desktop:storage', 'remove', key),
  },
  augments: (cachedOnly) => ipcRenderer.invoke('desktop:augments', cachedOnly),
  openRecording: () => ipcRenderer.invoke('desktop:recording'),
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke('desktop:pin', enabled),
  readerStart: () => ipcRenderer.invoke('desktop:reader:start'),
  readerStop: () => ipcRenderer.invoke('desktop:reader:stop'),
  readerSnapshot: () => ipcRenderer.invoke('desktop:reader:snapshot'),
  battleSnapshot:()=>ipcRenderer.invoke('desktop:battle:snapshot'),
  onBattle(handler){const listener=(_event:Electron.IpcRendererEvent,value:Parameters<typeof handler>[0])=>handler(value);ipcRenderer.on('desktop:battle:update',listener);return ()=>ipcRenderer.removeListener('desktop:battle:update',listener);},
  selectedComp: () => ipcRenderer.invoke('desktop:comp:get'),
  selectComp: (key,directionId) => ipcRenderer.invoke('desktop:comp:select',key,directionId),
  selectTransition:id=>ipcRenderer.invoke('desktop:comp:transition',id),
  advisorPreferences:()=>ipcRenderer.invoke('desktop:advisor:get'),
  configureAdvisor:value=>ipcRenderer.invoke('desktop:advisor:configure',value),
  onAdvisorPreferences(handler){
    const listener=(_event:Electron.IpcRendererEvent,value:Parameters<typeof handler>[0])=>handler(value);
    ipcRenderer.on('desktop:advisor:preferences',listener);
    return ()=>ipcRenderer.removeListener('desktop:advisor:preferences',listener);
  },
  onSelectedComp(handler) {
    const listener=(_event:Electron.IpcRendererEvent,comp:Parameters<typeof handler>[0])=>handler(comp);
    ipcRenderer.on('desktop:comp:update',listener);
    return ()=>{ipcRenderer.removeListener('desktop:comp:update',listener);};
  },
  overlay: (action) => ipcRenderer.invoke('desktop:overlay', action),
  onOverlay(handler) {
    const listener = (_event: Electron.IpcRendererEvent, state: Parameters<typeof handler>[0]) => handler(state);
    ipcRenderer.on('desktop:overlay:state', listener);
    return () => { ipcRenderer.removeListener('desktop:overlay:state', listener); };
  },
  onReader(handler) {
    const listener = (_event: Electron.IpcRendererEvent, status: Parameters<typeof handler>[0]) => handler(status);
    ipcRenderer.on('desktop:reader:update', listener);
    return () => { ipcRenderer.removeListener('desktop:reader:update', listener); };
  },
  reportReady: (report) => ipcRenderer.send('desktop:ready', report),
};
contextBridge.exposeInMainWorld('tftDesktop', bridge);
