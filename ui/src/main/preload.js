const { contextBridge, ipcRenderer } = require('electron');

// The renderer gets this narrow surface and no Node. Everything that touches
// the filesystem or the capture process stays in the main process.
contextBridge.exposeInMainWorld('bsr', {
  startRecording: () => ipcRenderer.invoke('recording:start'),
  pauseRecording: () => ipcRenderer.invoke('recording:pause'),
  resumeRecording: () => ipcRenderer.invoke('recording:resume'),
  stopRecording: () => ipcRenderer.invoke('recording:stop'),

  getSession: () => ipcRenderer.invoke('session:get'),
  openSession: () => ipcRenderer.invoke('session:open'),

  updateStep: (id, patch) => ipcRenderer.invoke('step:update', { id, patch }),
  removeStep: (id) => ipcRenderer.invoke('step:remove', { id }),
  reorderStep: (from, to) => ipcRenderer.invoke('step:reorder', { from, to }),
  shotUrl: (screenshot) => ipcRenderer.invoke('shot:url', { screenshot }),
  revealSession: () => ipcRenderer.invoke('session:reveal'),

  onStep:  (fn) => ipcRenderer.on('session:step',  (_e, m) => fn(m)),
  onSaved: (fn) => ipcRenderer.on('session:saved', (_e, m) => fn(m)),
  onReady: (fn) => ipcRenderer.on('sidecar:ready', (_e, m) => fn(m)),
  onError: (fn) => ipcRenderer.on('sidecar:error', (_e, m) => fn(m)),
  onLog:   (fn) => ipcRenderer.on('sidecar:log',   (_e, m) => fn(m)),
  onExit:  (fn) => ipcRenderer.on('sidecar:exit',  (_e, m) => fn(m)),
});
