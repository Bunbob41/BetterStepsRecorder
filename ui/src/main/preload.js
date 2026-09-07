const { contextBridge, ipcRenderer } = require('electron');

// The renderer gets this narrow surface and no Node. Everything that touches
// the filesystem or the capture process stays in the main process.
contextBridge.exposeInMainWorld('bsr', {
  startRecording: (intent) => ipcRenderer.invoke('recording:start', intent),
  listTemplates: () => ipcRenderer.invoke('templates:list'),
  effectiveTemplate: () => ipcRenderer.invoke('templates:effective'),
  revealTemplates: () => ipcRenderer.invoke('templates:reveal'),
  duplicateTemplate: (path) => ipcRenderer.invoke('templates:duplicate', { path }),
  pauseRecording: () => ipcRenderer.invoke('recording:pause'),
  resumeRecording: () => ipcRenderer.invoke('recording:resume'),
  stopRecording: () => ipcRenderer.invoke('recording:stop'),
  restoreWindow: () => ipcRenderer.invoke('ui:restore'),

  getSession: () => ipcRenderer.invoke('session:get'),
  openSession: () => ipcRenderer.invoke('session:open'),

  updateStep: (id, patch) => ipcRenderer.invoke('step:update', { id, patch }),
  addNote: (text, afterId) => ipcRenderer.invoke('step:addNote', { text, afterId }),
  addSection: (text, afterId) => ipcRenderer.invoke('step:addSection', { text, afterId }),
  replaceAll: (query, replacement, options) =>
    ipcRenderer.invoke('steps:replaceAll', { query, replacement, options }),
  cropStep: (id, dataUrl, rect, image) =>
    ipcRenderer.invoke('step:crop', { id, dataUrl, rect, image }),
  removeStep: (id) => ipcRenderer.invoke('step:remove', { id }),
  removeSteps: (ids) => ipcRenderer.invoke('step:removeMany', { ids }),
  rerecordStep: (id) => ipcRenderer.invoke('step:rerecord', { id }),
  reorderStep: (from, to) => ipcRenderer.invoke('step:reorder', { from, to }),
  shotUrl: (screenshot) => ipcRenderer.invoke('shot:url', { screenshot }),
  revealSession: () => ipcRenderer.invoke('session:reveal'),
  exportSteps: (format, title) => ipcRenderer.invoke('export:run', { format, title }),
  redactStep: (id, dataUrl, kind, colour) =>
    ipcRenderer.invoke('step:redact', { id, dataUrl, kind, colour }),
  shotData: (screenshot) => ipcRenderer.invoke('shot:data', { screenshot }),

  listLibrary: () => ipcRenderer.invoke('library:list'),
  openLibrary: (dir) => ipcRenderer.invoke('library:open', { dir }),
  searchLibrary: (query, options) =>
    ipcRenderer.invoke('library:search', { query, options }),
  libraryUsage: () => ipcRenderer.invoke('library:usage'),
  renameSession: (name) => ipcRenderer.invoke('session:rename', { name }),
  undo: () => ipcRenderer.invoke('edit:undo'),
  undoDepth: () => ipcRenderer.invoke('edit:undoDepth'),

  verifySession: () => ipcRenderer.invoke('session:verify'),
  listWindows: () => ipcRenderer.invoke('windows:list'),
  setScope: (pids, label) => ipcRenderer.invoke('scope:set', { pids, label }),
  getScope: () => ipcRenderer.invoke('scope:get'),

  getShortcuts: () => ipcRenderer.invoke('shortcuts:get'),
  setShortcut: (which, accelerator) =>
    ipcRenderer.invoke('shortcuts:set', { which, accelerator }),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  chooseFolder: () => ipcRenderer.invoke('settings:chooseFolder'),
  chooseLogo: () => ipcRenderer.invoke('settings:chooseLogo'),
  chooseTemplate: () => ipcRenderer.invoke('settings:chooseTemplate'),

  onStep:  (fn) => ipcRenderer.on('session:step',  (_e, m) => fn(m)),
  onSaved: (fn) => ipcRenderer.on('session:saved', (_e, m) => fn(m)),
  onReplaced: (fn) => ipcRenderer.on('session:replaced', (_e, m) => fn(m)),
  onReady: (fn) => ipcRenderer.on('sidecar:ready', (_e, m) => fn(m)),
  onError: (fn) => ipcRenderer.on('sidecar:error', (_e, m) => fn(m)),
  onLog:   (fn) => ipcRenderer.on('sidecar:log',   (_e, m) => fn(m)),
  onExit:  (fn) => ipcRenderer.on('sidecar:exit',  (_e, m) => fn(m)),
  onHotkey: (fn) => ipcRenderer.on('hotkey', (_e, m) => fn(m)),
  onMode: (fn) => ipcRenderer.on('mode', (_e, m) => fn(m)),
  onHotkeys: (fn) => ipcRenderer.on('hotkeys', (_e, m) => fn(m)),
  onUndoDepth: (fn) => ipcRenderer.on('undo:depth', (_e, m) => fn(m)),
  onNotice: (fn) => ipcRenderer.on('notice', (_e, m) => fn(m)),
  getBuild: () => ipcRenderer.invoke('app:build'),
});
