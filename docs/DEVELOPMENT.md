# How Hagemi works

Notes for anyone who wants to change her. For what she does and how to install her, see the [README](../README.md).

## How it works

```
Antigravity
├── language server ──┐  session list, quota, model list, one-line completions
├── brain/*/transcript.jsonl ──┤  tool activity (read from the side)
│                      ▼
│              sidecars/pet/main.mjs   monitor → director → brain
│                      │
│                      ▼  Chrome DevTools Protocol, isolated world
└── app window ── closed shadow DOM ── WebGL mesh rig + canvas particles + bubble
```

- **Rendering:** each pose is one texture on a dense mesh. Soft weights derived from per-pose landmarks bend hair, ears, head and legs, with springs for follow-through and a head-turn parallax. The tail is cut along its ink into its own layer, so swishing it never drags the hair beside it, and what it was covering is painted in with [LaMa](https://huggingface.co/Carve/LaMa-ONNX), then refined with [Animagine XL 4.0](https://huggingface.co/cagliostrolab/animagine-xl-4.0) on most poses. Gems keep their own outlines when the tail moves. Blinks are painted patches warped through the same mesh, and pose changes are short crossfades.
- **Behavior:** the sidecar polls every 2 seconds while agents run and every 4 seconds otherwise, and only reads the new bytes of active transcripts. She pauses rendering while the window is hidden.
- **Isolation:** the pet runs in an isolated world inside a closed shadow root, so she cannot touch the app's JavaScript or styles, and it is removed cleanly when the sidecar stops.

### Why not plugin hooks or a side panel?

Antigravity documents hooks and sidecars, but no way for a plugin to draw over the app, and hooks run a process inside the agent loop for every tool call. So this plugin:

- reads activity from the side, so it can never slow your agent down;
- enters the window over the DevTools port the app already opens for itself, without patching any app files;
- uses undocumented local APIs: `GetAllCascadeTrajectories`, `RetrieveUserQuotaSummary`, `GetModelResponse` and others.

**An Antigravity update could break any of this.** Nothing else in the app depends on it, so the failure mode is that she stops appearing or stops reacting. Tested on Antigravity 2.28.2 on Windows. The macOS and Linux paths are implemented but have not been tried on a real machine.

### Remote Control

She lives in the desktop app only, and does not appear in the Remote Control web client. That client runs in your other browser, out of reach of the DevTools port, and Antigravity turns plugin panes off there. The sidecar keeps running on the host, so she is caught up when you return to the desktop window.

## Development

Needs Node 22 or later. There are no runtime dependencies and no build step.

To install your checkout into the app, changes included, and to remove it again:

```bash
npm run install:local
```

```bash
npm run uninstall:local
```

```bash
npm test
```

```bash
npm run preview
```

`preview` opens a rehearsal stage at http://127.0.0.1:7891 with a button for every state, gesture and line, so you do not need Antigravity. `npm run dev` runs the sidecar against a running app without installing anything, with verbose logs.

The README animations and screenshots are recorded from that stage, never from the real app, so only made-up data is on screen. Rerun them after changing art or lines. This needs Edge or Chrome, and Python with Pillow:

```bash
npm run media
npm run media -- --lang zhs
npm run media -- --lang zhs touch stills
```

English goes to `docs/media/`, Chinese to `docs/media/zhs/`. Name scenes to redo only those: hello, reactions, work, subagents, quota, touch, drag, dock, language and stills.

After changing poses or landmarks (`tools/landmarks.json`), regenerate the rig data. This needs Python with Pillow and numpy:

```bash
npm run build:rig
```

That resets the layers under the tail, so paint them again afterwards. This also needs `opencv-python-headless`, `onnxruntime` and the model file, which is not in this repo:

```bash
npm run build:under -- --model path/to/lama_fp32.onnx
```

It finishes by proving that with the tail at rest every layer composites back to the original pose. Run that check alone with `npm run build:under -- --check`.

To repaint those layers with a larger model, `tools/colab_inpaint.ipynb` runs [Animagine XL 4.0](https://huggingface.co/cagliostrolab/animagine-xl-4.0) on a Colab GPU, starting from the LaMa result. This step is optional. The shipped art uses it on 37 poses:

```bash
npm run build:under -- --export crops.zip
```

Upload `crops.zip` to the notebook and bring back the zip it downloads. `--import` rewrites only the layers under the tail and repeats the same check:

```bash
npm run build:under -- --import results.zip --variant s050_a
```

## AI comment limits

A model call has to pass every check below. Small moments stay scripted and free.

| Limit | Default | Setting |
| --- | --- | --- |
| Model | `Gemini 3.8 Flash (Low)`, the cheapest variant | any model in your list |
| Which moments | finished turns, failures, subagents, quota changes, late nights and more, scaled by chattiness | chattiness |
| Minimum gap between calls | 2 minutes | yes |
| Calls per hour / per day | 30 / 300 | yes |
| Estimated tokens per day | 200,000, about 500 per call | yes |
| Pause when the comment model's quota is low | below 5% | yes |
| Only when you are looking | window focused and visible | yes |
| The same situation twice | never within 6 hours | |
| After a failure | backs off for 2 to 60 minutes, then uses a scripted line | |

Calls go through Antigravity's own local language server with your signed-in account, so there is no API key, and they count toward your normal quota. Token counts are estimates, because the endpoint does not report usage. Comments made by AI are marked with ✦, and today's tally is in the settings panel.

Calls go through Antigravity's own local language server with your signed-in account, so there is no API key, and they count toward your normal quota. Token counts are estimates, because the endpoint does not report usage. Comments made by AI are marked with ✦, and today's tally is in the settings panel.

Settings are saved to `~/.gemini/antigravity/sidecar_data/hagemi-pet-agy/pet/data/settings.json`.
