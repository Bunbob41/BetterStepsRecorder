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
  addNote: (text, afterId) => ipcRenderer.invoke('step:addNote', { text, afterId }),
  removeStep: (id) => ipcRenderer.invoke('step:remove', { id }),
  rerecordStep: (id) => ipcRenderer.invoke('step:rerecord', { id }),
  reorderStep: (from, to) => ipcRenderer.invoke('step:reorder', { from, to }),
  shotUrl: (screenshot) => ipcRenderer.invoke('shot:url', { screenshot }),
  revealSession: () => ipcRenderer.invoke('session:reveal'),
  exportSteps: (format, title) => ipcRenderer.invoke('export:run', { format, title }),
  redactStep: (id, dataUrl) => ipcRenderer.invoke('step:redact', { id, dataUrl }),
  shotData: (screenshot) => ipcRenderer.invoke('shot:data', { screenshot }),

  listLibrary: () => ipcRenderer.invoke('library:list'),
  openLibrary: (dir) => ipcRenderer.invoke('library:open', { dir }),
  renameSession: (name) => ipcRenderer.invoke('session:rename', { name }),
  undo: () => ipcRenderer.invoke('edit:undo'),
  undoDepth: () => ipcRenderer.invoke('edit:undoDepth'),

  listWindows: () => ipcRenderer.invoke('windows:list'),
  setScope: (pids, label) => ipcRenderer.invoke('scope:set', { pids, label }),
  getScope: () => ipcRenderer.invoke('scope:get'),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  chooseFolder: () => ipcRenderer.invoke('settings:chooseFolder'),
  chooseLogo: () => ipcRenderer.invoke('settings:chooseLogo'),

  onStep:  (fn) => ipcRenderer.on('session:step',  (_e, m) => fn(m)),
  onSaved: (fn) => ipcRenderer.on('session:saved', (_e, m) => fn(m)),
  onReplaced: (fn) => ipcRenderer.on('session:replaced', (_e, m) => fn(m)),
  onReady: (fn) => ipcRenderer.on('sidecar:ready', (_e, m) => fn(m)),
  onError: (fn) => ipcRenderer.on('sidecar:error', (_e, m) => fn(m)),
  onLog:   (fn) => ipcRenderer.on('sidecar:log',   (_e, m) => fn(m)),
  onExit:  (fn) => ipcRenderer.on('sidecar:exit',  (_e, m) => fn(m)),
  onHotkey: (fn) => ipcRenderer.on('hotkey', (_e, m) => fn(m)),
  onMode: (fn) => ipcRenderer.on('mode', (_e, m) => fn(m)),
  onUndoDepth: (fn) => ipcRenderer.on('undo:depth', (_e, m) => fn(m)),
});
