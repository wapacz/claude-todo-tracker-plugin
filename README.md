# todo-sidebar

A Claude Code plugin that docks a live todo list on the right of the transcript. The pane stays
fixed while the conversation scrolls, so the plan is always in view.

```
Implement OAuth scopes

✓ Added Google OAuth provider
✓ Updated callback handling
✓ Configured scope mapping
✓ Added tests for OAuth flow
○ Updating documentation…
    ✓ Wrote docs/oauth.md
    ○ Adding README section…
    ○ Link from CHANGELOG
○ Open pull request

│ Read   auth.provider.ts
│ Edit   src/auth/oauth.ts (+42 -6)
│ Run    npm test
```

## What it does

- Keeps a three-bullet summary of the session at the top. A cheap model (`haiku` by default) is
  asked once every six of your prompts whether the bullets still fit; if not it adds one bullet and
  the oldest drops. Set `summaryEveryPrompts` to 0 in the plugin config to turn it off.
- Shows the title of the current task, every step with a check mark, and the running step in its
  active form. One level of subtasks is supported; a parent is shown running while any subtask runs
  and done once all are done.
- Shows the tool calls the agent makes while it works on the current step (`Read`, `Edit`, `Write`,
  `Run`, with diff counts for edits). The log clears when the turn ends or the step changes.
- Gives the model a `set_todos` tool to keep the list up to date, and mirrors the built-in
  `TodoWrite` tool where a session has it. The list is written for the person, not the model:
  outcomes in plain words, and steps only the person can take carry `forUser: true` and are
  drawn with a yellow flag until done.
- Keeps the statuses current when the agent forgets. After a response in which the agent did not
  update the list, the same cheap model gets the numbered list, the new messages and the tools the
  agent ran, and answers which step statuses changed. It never adds, removes or renames a row, and a
  reply it garbles changes nothing. When the agent rewrites the list while the model is still
  thinking, the answer is dropped. Set `statusKeeper` to false in the plugin config to turn it off;
  `summaryModel` picks the model for both.
- Draws a progress bar for the whole plan just above **Agents**: finished top-level rows out of all
  rows, with the percent, counted the way
  [savvy-progress](https://github.com/JohnnyVizz/claude-kit/tree/main/plugins/savvy-progress)
  counts accepted tasks. A parent counts as finished once all its subtasks are, and subtasks are not
  counted on their own. The bar turns green when the plan is done and is hidden while the list is
  empty.
- Lists the session's subagents under **Agents**, in the style of
  [savvy-progress](https://github.com/JohnnyVizz/claude-kit/tree/main/plugins/savvy-progress):
  running agents first, finished ones behind a `▸ Finished` toggle. Each row shows the agent's type
  (or savvy tier), model and effort, the round when a task is delegated again, a progress bar, the
  context fill, tokens, an estimated cost and the elapsed time; a header sums cost, tokens and time.
  On the desktop app each row is drawn with a pixel builder whose helmet shows the tier (foreman,
  welder, ear defenders, hard hat, bump cap, headlamp); the head nods and the helmet's prop moves
  while the agent runs. The terminal draws the same rows in text. Cost is an estimate from token counts and
  the price table in `hooks/agent-runs.ts`, not a bill.
- Gives subagents a `step` tool to report their own progress (`done`, `total`, `note`). A subagent
  that does not report shows its context fill in grey instead.
- Saves the list per session and restores it when the session is resumed.
- Keeps a finished row's subtasks when a later call resends the row without them, matched by the
  same text or the same position in a list of the same length, so finished detail is not lost to a
  careless rewrite.

## Commands

| Command | Effect |
| --- | --- |
| `/summary` | Open the Summary pane if you closed it |

## Install

For every session, add the folder to the plugin directories in `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "/absolute/path/to/claude-todo-tracker-plugin"
  }
}
```

For one session only:

```sh
claude --plugin-dir /absolute/path/to/claude-todo-tracker-plugin
```

The pane docks on the right in the fullscreen terminal layout at 110 columns or more. It opens on
its own from 144 columns; below that, run `/summary`. In narrower terminals it sits inline above the
prompt.

## Develop

```sh
claude plugin validate .
claude plugin test .
```

In an interactive session the folder is watched: saving a file reloads the plugin.

## Layout

- `.claude-plugin/plugin.json` – manifest
- `hooks/hooks.json` – names the hooks module
- `hooks/register.tsx` – the plugin: commands, the `set_todos` and `step` tools, the activity log, the pane
- `hooks/agent-runs.ts` – agent runs: tokens, cost estimate, steps, rounds, formatting
- `hooks/agent-section.tsx` – the Agents section of the pane, terminal and desktop
- `hooks/agent-drawings.ts` – desktop SVG rows, adapted from savvy-progress (MIT)
- `hooks/builder-heads.ts` – the pixel builder heads, one helmet per tier
- `hooks/plan-progress.tsx` – the plan progress bar, terminal text and desktop drawing
- `hooks/register.test.ts`, `hooks/agent-runs.test.ts`, `hooks/builder-heads.test.ts`, `hooks/plan-progress.test.ts` – tests, run with `claude plugin test`
- `types/index.d.ts` – the plugin's state contract

## License

MIT

`hooks/agent-drawings.ts` is adapted from
[savvy-progress](https://github.com/johnnyvizz/claude-kit/tree/main/plugins/savvy-progress),
MIT License, Copyright (c) 2026 johnnyvizz; the full notice is at the top of that file.
