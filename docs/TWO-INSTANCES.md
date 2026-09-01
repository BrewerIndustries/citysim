# Two instances: play and dev

So a game can be played while the next feature is being built on the same machine,
without one disturbing the other.

| | Checkout | Branch | URL |
|---|---|---|---|
| **Play** | `citysim-play/` | `play` | http://localhost:5174 |
| **Dev** | `citysim/` | `dev` | http://localhost:5173 |

`citysim-play` is a **git worktree** — a second working copy of the same repository
checked out to a different branch. It shares the repo's history and remote, so nothing
needs cloning or syncing by hand, but its files are entirely separate: edits on `dev`
cannot restart the play server or reload the page mid-city.

Different ports are different browser origins, which means **each instance keeps its own
saves**. Testing on the dev instance can never clobber a game in progress on the play one.

## Running them

```bash
cd citysim      && npm run dev        # dev  → localhost:5173
cd citysim-play && npm run dev:play   # play → localhost:5174
```

## Promoting dev to play

When a batch of work is ready to try:

```bash
cd citysim-play && git merge dev --ff-only && npm install
```

`--ff-only` is deliberate: `play` should never diverge from `dev`, it should only ever be
a point on it, so a merge that would create a commit means something is wrong.

Vite watches the files, so source changes appear on their own. **A new dependency does
not.** Vite resolves and pre-bundles dependencies when it starts, so a merge that adds a
package leaves the running server unable to resolve it — every module importing it 500s,
and the page loads its markup with none of its behaviour. Restart the play server after
any merge that touched `package.json`:

```bash
cd citysim-play && npm run dev:play
```

A save made before the merge still loads afterwards, because the save format is
versioned and older versions are migrated rather than rejected. If a change ever does
break compatibility, that is a bug in the migration, not in the save.

## Why not just one instance

Vite hot-reloads on every file change. Building a feature while someone is playing means
their city reloads from its last autosave every few seconds — and worse, a half-finished
edit that throws would take the running game down with it.
