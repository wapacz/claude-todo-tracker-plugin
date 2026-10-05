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
- Saves the list per session and restores it when the session is resumed.
- Keeps a finished row's subtasks when a later call resends the row without them, matched by the
  same text or the same position in a list of the same length, so finished detail is not lost to a
  careless rewrite.

## Commands

| Command | Effect |
| --- | --- |
| `/todos` | Open the pane if you closed it |
| `/todos-demo` | Fill the pane with the example above |

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
its own from 144 columns; below that, run `/todos`. In narrower terminals it sits inline above the
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
- `hooks/register.tsx` – the plugin: commands, the `set_todos` tool, the activity log, the pane
- `hooks/register.test.ts` – tests, run with `claude plugin test`
- `types/index.d.ts` – the plugin's state contract

## License

MIT
