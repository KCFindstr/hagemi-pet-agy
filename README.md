<div align="center">

<img src="assets/logo.png" width="128" alt="Hagemi">

# Hagemi Pet for Antigravity

A chibi Gemini catgirl who floats in your [Antigravity](https://antigravity.google) window, watches your agents work, and has opinions about it.

**English** · [简体中文](README.zh-CN.md)

</div>

![Hagemi's poses](docs/poses.webp)

Hagemi (哈基米) is a pun: the Chinese community's nickname for Gemini, a word for honey water, and a meme about cats, all at once. So quota is her honey, she wilts as the jar empties, and subagents are tiny clones of her.

## What she does

**She follows your agents.** Every state is its own painted pose:

| When | She |
| --- | --- |
| An agent is thinking | taps her cheek, and frets if it takes too long |
| Reading files, editing, running commands, searching | reads a book, writes in a notebook, works her paws, peers through a magnifier |
| Generating an image | paints with a Nano Banana brush |
| Subagents are running | gets one tiny clone orbiting her per subagent |
| The agent is waiting on you | calls you over |
| A turn finishes | cheers, or takes a victory spin with confetti after a big job |
| A turn fails | apologizes on reflex, then wonders if it was even her fault |
| 2 sessions at once, then 3+ | juggles laptops, then panics |
| The context gets huge or compacts | sits on the suitcase to squeeze it shut |

**She feels your quota and the clock.**

- Quota low: she droops and a honey jar appears. Critical: she begs you to be gentle. Empty: she floats, drained.
- Reset coming up while you are low: she perks up and counts it down. When the honey comes back: a gift box and a shower of honey.
- Time of day: a greeting for each part of the day, a nudge if you are up at 3am, a stretch reminder after two hours, festival outfits on the right days.
- Switch to Claude or GPT and she gets jealous. Switch back and she forgives you.

**She lives in your window.**

- Drag her anywhere. Hair and tail trail behind her with spring physics. Throw her and she coasts in zero gravity and bumps off the walls.
- Shake her and she gets dizzy. Poke her too much and she escalates from annoyed to puffed to red-hot to sulking. A head pat makes it better.
- Drop her on a window edge and she docks there, peeking out as your cursor approaches.
- She watches your cursor, and clicks in the empty parts of her box go straight through to the app.
- Double-click to make her say something. Hover for quota and agent status. Right-click for the menu and settings.

## Install

Needs the Antigravity **desktop app**. Sidecars, which the pet runs on, are not available in the CLI or the IDE extensions.

```bash
git clone https://github.com/KCFindstr/hagemi-pet-agy.git
cd hagemi-pet-agy
npm run install:local
```

She appears in the bottom right within about 30 seconds. If she does not, restart Antigravity once.

To remove her:

```bash
npm run uninstall:local
```

## Comments, and what they cost

Most of what she says is scripted and costs nothing. A model call only happens for moments worth one, and has to pass every check below. Turn AI off and she keeps every scripted line.

| Limit | Default | Setting |
| --- | --- | --- |
| Model | `Gemini 3.8 Flash (Low)`, the cheapest variant | any model in your list |
| Which moments | big jobs, failures, late nights and a few others, scaled by chattiness | chattiness |
| Minimum gap between calls | 10 minutes | yes |
| Calls per hour / per day | 4 / 24 | yes |
| Estimated tokens per day | 12,000, about 500 per call | yes |
| Pause when quota is low | below 15% | yes |
| Only when you are looking | window focused and visible | yes |
| The same situation twice | never within 6 hours | |
| After a failure | backs off for 2 to 60 minutes, then uses a scripted line | |

Calls go through Antigravity's own local language server with your signed-in account, so there is no API key, and they count toward your normal quota. Token counts are estimates, because the endpoint does not report usage. Comments made by AI are marked with ✦, and today's tally is in the settings panel.

### What the model sees

Set this under *What she can see*:

- **Only numbers and tool names:** counts, durations, quota and the time.
- **Also chat titles.**
- **Also short excerpts** (default): up to about 100 characters of your last message and 130 of the agent's. Code blocks, links, file paths, long blobs and anything shaped like a credential are removed first.

Excerpts go to the model you selected, which may not be the one the conversation uses. Keystroke *timing* is used to avoid talking over you; the keys themselves are never read. Nothing is stored except her settings and the daily tally.

## Settings

Right-click her and choose **Settings…**. You can set language (English, 简体中文, or follow the app), size, animation quality, chattiness, cursor tracking, the AI limits above, and extra persona notes. Settings are saved to `~/.gemini/antigravity/sidecar_data/hagemi-pet-agy/pet/data/settings.json`.

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

- **Rendering:** each pose is one texture on a dense mesh. Soft weights derived from per-pose landmarks bend hair, tail, ears, head and legs, with springs for follow-through and a head-turn parallax. Blinks are painted patches warped through the same mesh, and pose changes are short crossfades.
- **Behavior:** the sidecar polls every 2 seconds while agents run and every 4 seconds otherwise, and only reads the new bytes of active transcripts. She pauses rendering while the window is hidden.
- **Isolation:** the pet runs in an isolated world inside a closed shadow root, so she cannot touch the app's JavaScript or styles, and it is removed cleanly when the sidecar stops.

### Why not plugin hooks or a side panel?

Antigravity documents hooks and sidecars, but no way for a plugin to draw over the app, and hooks run a process inside the agent loop for every tool call. So this plugin:

- reads activity from the side, so it can never slow your agent down;
- enters the window over the DevTools port the app already opens for itself, without patching any app files;
- uses undocumented local APIs: `GetAllCascadeTrajectories`, `RetrieveUserQuotaSummary`, `GetModelResponse` and others.

**An Antigravity update could break any of this.** Nothing else in the app depends on it, so the failure mode is that she stops appearing or stops reacting. Tested on Antigravity 2.28.2 on Windows. The macOS and Linux paths are implemented but have not been tried on a real machine.

## Development

Needs Node 22 or later. There are no runtime dependencies and no build step.

```bash
npm test
```

```bash
npm run preview
```

`preview` opens a rehearsal stage at http://127.0.0.1:7891 with a button for every state, gesture and line, so you do not need Antigravity. `npm run dev` runs the sidecar against a running app without installing anything, with verbose logs.

After changing poses or landmarks (`tools/landmarks.json`), regenerate the rig data. This step alone needs Python with Pillow and numpy:

```bash
npm run build:rig
```

## License

- **Code:** [MIT](LICENSE).
- **Art:** [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/), from [CrossPet](https://github.com/lokicorvus/crosspet). This is **non-commercial and share-alike**, so distributing this plugin with its art must stay non-commercial. See [NOTICE.md](NOTICE.md) for credits and details.

This is an unofficial fan project, not affiliated with Google. Thanks to lokicorvus and the CrossPet contributors for the art, and to the Bilibili creators whose Gemini-musume made her who she is.
