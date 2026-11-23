HAGEMI.css = `
:host { all: initial; }
.stage { position: fixed; left: 0; top: 0; pointer-events: none; will-change: transform; }
.layer { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.hit { position: absolute; pointer-events: auto; cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; }
.hit:active { cursor: grabbing; }

.bubble {
  position: fixed; left: 0; top: 0; max-width: calc(248px * var(--bubble-scale, 1)); min-width: 40px;
  padding: calc(9px * var(--bubble-scale, 1)) calc(13px * var(--bubble-scale, 1)) calc(10px * var(--bubble-scale, 1));
  background: #fffdfb; color: #2a1b3d; border: 2px solid #a78bfa; border-radius: calc(15px * var(--bubble-scale, 1));
  font: 500 calc(13px * var(--bubble-scale, 1))/1.5 "Segoe UI", "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif;
  box-shadow: 0 6px 22px rgba(46, 24, 104, 0.28); pointer-events: auto; cursor: pointer;
  opacity: 0; visibility: hidden; transition: opacity 0.16s ease, visibility 0.16s; word-break: break-word; white-space: pre-wrap;
}
.bubble.show { opacity: 1; visibility: visible; }
.bubble::after {
  content: ''; position: absolute; width: 11px; height: 11px; background: inherit;
  border-right: 2px solid #a78bfa; border-bottom: 2px solid #a78bfa; left: var(--tail-x, 50%); bottom: -7.5px;
  transform: translateX(-50%) rotate(45deg); border-bottom-right-radius: 3px;
}
.bubble[data-side="right"]::after { left: -7.5px; top: 18px; bottom: auto; transform: rotate(135deg); }
.bubble[data-side="left"]::after { left: auto; right: -7.5px; top: 18px; bottom: auto; transform: rotate(-45deg); }
.mark { color: #8b5cf6; font-weight: 700; margin-right: 4px; }
.mark:empty { display: none; }

.hud {
  position: fixed; left: 0; top: 0; min-width: 196px; padding: 8px 11px; display: grid; gap: 5px;
  background: rgba(32, 24, 58, 0.93); color: #efe9ff; border: 1px solid rgba(167, 139, 250, 0.55); border-radius: 11px;
  font: 500 11.5px/1.35 "Segoe UI", "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif;
  box-shadow: 0 6px 22px rgba(10, 4, 30, 0.42); pointer-events: none; opacity: 0; visibility: hidden; transition: opacity 0.14s ease;
}
.hud.show { opacity: 1; visibility: visible; }
.row { display: flex; align-items: center; gap: 7px; white-space: nowrap; }
.label { color: #c3b6ee; flex: 0 0 auto; }
.value { margin-left: auto; font-variant-numeric: tabular-nums; }
.meter { flex: 1 1 42px; min-width: 42px; height: 5px; border-radius: 3px; background: rgba(255, 255, 255, 0.16); overflow: hidden; }
.fill { display: block; height: 100%; border-radius: 3px; background: #fbbf24; }
.fill[data-tone="warn"] { background: #fb923c; }
.fill[data-tone="bad"] { background: #f43f5e; }

.menu {
  position: fixed; left: 0; top: 0; min-width: 220px; padding: 5px; background: #fffdfb; color: #2a1b3d;
  border: 1px solid #c4b5fd; border-radius: 11px; box-shadow: 0 10px 30px rgba(46, 24, 104, 0.32);
  font: 500 12.5px/1.3 "Segoe UI", "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif;
  pointer-events: auto; display: none;
}
.menu.show { display: block; }
.item { display: block; width: 100%; padding: 6px 10px; border: 0; background: none; color: inherit; font: inherit; text-align: left; border-radius: 7px; cursor: pointer; }
.item:hover, .item:focus-visible { background: #ede9fe; outline: none; }
.divider { height: 1px; margin: 4px 6px; background: #e9e3fb; }

.panel {
  position: fixed; left: 0; top: 0; width: 292px; max-height: min(78vh, 620px); overflow: auto; padding: 10px 13px 13px; display: none;
  background: #fffdfb; color: #2a1b3d; border: 1px solid #c4b5fd; border-radius: 13px; box-shadow: 0 12px 36px rgba(46, 24, 104, 0.34);
  font: 500 12.5px/1.35 "Segoe UI", "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif; pointer-events: auto;
}
.panel.show { display: block; }
.panel-head { display: flex; align-items: center; justify-content: space-between; font-size: 13.5px; margin-bottom: 4px; }
.panel-close { border: 0; background: none; color: inherit; font-size: 18px; line-height: 1; padding: 0 4px; cursor: pointer; border-radius: 6px; }
.panel-close:hover { background: #ede9fe; }
.panel-section { margin: 11px 0 5px; font-size: 11px; font-weight: 700; letter-spacing: 0.04em; color: #7c5cd6; }
.field { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 3px 0; }
.field > span { flex: 1 1 auto; }
.field select, .field input[type="number"], .field input[type="text"], .field input[type="password"], .field textarea {
  font: inherit; color: inherit; background: #faf8ff; border: 1px solid #d9cffb; border-radius: 7px; padding: 3px 6px; max-width: 148px;
}
.field input[type="text"], .field input[type="password"] { width: 148px; box-sizing: border-box; }
.field input[type="number"] { width: 70px; }
.field input[type="checkbox"] { accent-color: #8b5cf6; width: 15px; height: 15px; }
.field textarea { width: 148px; resize: vertical; }
.slider-block { margin: 6px 0 10px; }
.slider-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.slider-label { flex: 1 1 auto; font-size: 13px; color: #2a1b3d; }
.slider-val { font-size: 13px; font-variant-numeric: tabular-nums; color: #3b2d56; }
.slider-default { border: 0; background: none; padding: 2px 4px; font: inherit; font-size: 12.5px; color: #5b4b7a; cursor: pointer; border-radius: 5px; }
.slider-default:hover { background: #ede9fe; color: #2a1b3d; }
.slider-track {
  -webkit-appearance: none; appearance: none; width: 100%; height: 6px; border-radius: 999px; outline: none; cursor: pointer;
  background: linear-gradient(to right, #9370c7 0%, #9370c7 var(--pct, 50%), #e2d6f6 var(--pct, 50%), #e2d6f6 100%);
}
.slider-track::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none; width: 16px; height: 16px; border-radius: 50%; background: #9370c7; border: none;
  box-shadow: 0 1px 4px rgba(88, 48, 142, 0.35); cursor: pointer; transition: transform 0.12s ease;
}
.slider-track::-webkit-slider-thumb:hover { transform: scale(1.12); background: #7c56b8; }
.size-reset { border: 1px solid #d9cffb; border-radius: 6px; padding: 2px 7px; background: #faf8ff; color: #5b4390; font: inherit; font-size: 11px; cursor: pointer; }
.size-reset:hover { background: #ede9fe; }
.menu-sliders { padding: 4px 8px 2px; }
.menu-sliders .slider-block { margin: 4px 0 8px; }
.menu-sliders .slider-head { margin-bottom: 6px; }
.balance-panel {
  position: fixed; left: 0; top: 0; width: 280px; max-height: min(72vh, 480px); overflow: auto; padding: 10px 13px 12px; display: none;
  background: #fffdfb; color: #2a1b3d; border: 1px solid #c4b5fd; border-radius: 13px; box-shadow: 0 12px 36px rgba(46, 24, 104, 0.34);
  font: 500 12.5px/1.35 "Segoe UI", "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif; pointer-events: auto;
}
.balance-panel.show { display: block; }
.balance-list { display: grid; gap: 6px; margin: 8px 0 10px; }
.balance-group { margin-top: 4px; font-size: 11px; font-weight: 700; color: #7c5cd6; }
.balance-row { display: flex; align-items: center; gap: 7px; font-size: 12px; }
.balance-row .label { color: #52407a; }
.balance-row .meter { background: #ece6fc; }
.balance-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 6px; }
.balance-meta { font-size: 11px; color: #6b5b95; }
.panel-note { color: #6b5b95; }
.panel-note + .panel-note { margin-top: 5px; }
.panel-link { color: #7c3aed; margin-right: 12px; }
.update-card { margin: 10px 0; padding: 10px; border: 1px solid #dfd3fa; border-radius: 12px; background: linear-gradient(135deg, #f3edff, #fff3f7); }
.update-title { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; }
.update-paw { font-size: 17px; }
.update-version { margin-left: auto; font-size: 10px; color: #786493; }
.update-status { margin: 5px 0 8px; }
.update-reason { margin-bottom: 8px; font-size: 11px; }
.update-button { width: 100%; border: 1px solid #bba0ec; border-radius: 16px; padding: 7px 10px; background: #ede0ff; color: #58308e; font: inherit; font-weight: 700; cursor: pointer; }
.update-button:hover:not(:disabled) { background: #e3cefc; }
.update-button:focus-visible { outline: 2px solid #8b5cf6; outline-offset: 2px; }
.update-button:disabled { cursor: default; opacity: .7; }
`;
