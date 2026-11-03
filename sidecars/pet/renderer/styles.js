HAGEMI.css = `
:host { all: initial; }
.stage { position: fixed; left: 0; top: 0; pointer-events: none; will-change: transform; }
.layer { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.hit { position: absolute; pointer-events: auto; cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; }
.hit:active { cursor: grabbing; }

.bubble {
  position: fixed; left: 0; top: 0; max-width: 248px; min-width: 40px; padding: 9px 13px 10px;
  background: #fffdfb; color: #2a1b3d; border: 2px solid #a78bfa; border-radius: 15px;
  font: 500 13px/1.5 "Segoe UI", "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif;
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
  position: fixed; left: 0; top: 0; min-width: 176px; padding: 5px; background: #fffdfb; color: #2a1b3d;
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
.field select, .field input[type="number"], .field textarea {
  font: inherit; color: inherit; background: #faf8ff; border: 1px solid #d9cffb; border-radius: 7px; padding: 3px 6px; max-width: 148px;
}
.field input[type="number"] { width: 70px; }
.field input[type="checkbox"] { accent-color: #8b5cf6; width: 15px; height: 15px; }
.field textarea { width: 148px; resize: vertical; }
.panel-note { color: #6b5b95; }
`;
