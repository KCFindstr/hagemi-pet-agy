# Changelog

## 0.1.1

- Fixed: she vanished about 90 seconds after the app left its home page, such as opening a conversation or Customizations.
- Fixed: swishing her tail no longer distorts the hair next to it. The tail is now cut into its own layer in 48 of 55 poses; in the other 7 it holds still.
- The hair behind her tail is now painted in, so a swinging tail no longer reveals a bite out of her silhouette. With the tail at rest the image is unchanged.
- The art behind her tail is sharper, refined with an anime model on most poses, and her gems keep their outlines when the tail moves.
- Fixed: white patches in the gap between her tail and hair, visible on dark themes.
- Fixed: AI comments paused when the model selected for your agent ran out, even though the comment model still had quota.
- Docked at a window edge, she now peeks out only when the cursor is over her, not from far away.
- The README is shorter and skips the technical details, which moved to docs/DEVELOPMENT.md.
- Install with the Antigravity CLI: `agy plugin install`. Node.js is no longer needed.
- Fixed: uninstalling her while she ran left her half removed. She now leaves as soon as her files are gone, so a second try finishes. Disabling her first avoids it.
- Fixed: the status panel could pop up while you dragged her or behind the right-click menu.
- The README now shows her in action, with recordings of each feature. The Chinese README has its own recordings in Chinese.
- The status panel says "1 running" instead of "1 + 0 subagents" when no subagents are out.
- The status panel now names the model group its quota rows belong to.
- Fixed: her tail shook violently after dragging and state changes, and worse the longer she ran. It also no longer twitches while she talks.
- Chinese text now uses full-width punctuation throughout, including AI comments.
- She always calls you big cat (大号猫猫) now, and her lines no longer use em dashes.
- Settings now show credits and licenses, including CrossPet.
- Quota is now 小鱼干 (dried fish) instead of honey, with a new dish illustration where the pile is the meter.
- Much more generous AI defaults: every 2 minutes, 30 an hour, 300 a day, about 200,000 tokens a day, pausing below 5% quota. More moments get real comments.
- Settings files now store only what you changed, so future default improvements reach you. Limits you never touched move to the new defaults.

## 0.1.0

First release.

- A chibi Gemini catgirl in the Antigravity app window, using 55 painted poses on a mesh rig with spring physics.
- Reacts to agent turns, tool activity, subagents, waiting on the user, parallel sessions, context size and failures.
- Reacts to quota level, upcoming resets and refills, the time of day, festivals and the selected model.
- Drag, throw, shake, poke, pet and dock at window edges.
- English and Simplified Chinese.
- Scripted lines for free, with model comments behind configurable budgets. Defaults to Gemini 3.8 Flash (Low).
