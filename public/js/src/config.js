'use strict';
// settings

const settings = Object.assign({ theme: 'dark', mode: 'flip', order: 'weighted', hints: 'show', count: 'all', shuffleAnswers: 'on' }, loadJSON(LS_SETTINGS, {}));
function saveSettings() { saveJSON(LS_SETTINGS, settings); }
function applyTheme() { document.documentElement.setAttribute('data-theme', settings.theme); }

