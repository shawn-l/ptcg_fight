# PTCG Fight

Local-network PTCG battle prototype focused on a strict, testable rules engine.

## Current phase

This repository implements the first engine-first slice:

- TypeScript monorepo using `pnpm` workspaces.
- Pure rules engine in `packages/engine`.
- Card schema, E/F/G sample data, and Simplified Chinese display mapping in `packages/cards`.
- Local authoritative Node server in `apps/server`.
- Browser debug table in `apps/debug-table`.

The current card catalog is intentionally small. It proves the data model, event
log, visibility model, legal action generation, mulligans, bench placement,
trainer effects, energy attachment, retreat, evolution, attack Energy cost
checks, weakness and resistance, knockouts, forced Active promotion, prize
taking, deck search choices, deterministic shuffle events, deck-out loss,
no-Pokemon-in-play loss, win detection, and turn flow. It is not yet a complete
E/F/G card import.

Rule box Pokemon prize counts are data-driven through
`prizeCardsWhenKnockedOut`. Regular Pokemon default to 1 Prize card, while cards
such as Pokemon ex can declare 2 and Pokemon VMAX can declare 3.

## Run

The local environment used for this scaffold has Node 16 and no global `pnpm`, so
these commands use `npx pnpm@8.15.9`.

```bash
npx pnpm@8.15.9 install
npx pnpm@8.15.9 test
npx pnpm@8.15.9 typecheck
npx pnpm@8.15.9 build
```

Start the debug table:

```bash
npx pnpm@8.15.9 --filter @ptcg-fight/debug-table dev --host 0.0.0.0
```

Start the local rules server:

```bash
npx pnpm@8.15.9 --filter @ptcg-fight/server dev
```

Default URLs:

- Debug table: http://localhost:5173/
- Server health: http://localhost:8787/health

## Engine model

`GameAction` is the only input to the engine. `resolveAction` validates the
action, returns a new serializable `GameState`, and emits ordered `GameEvent`
records. Hidden zones are filtered through `serializePublicState`.

Effects are represented by `EffectDefinition` entries and resolved through a
small registry. Common effects should stay declarative; complex card-specific
effects can use typed handlers behind the same resolver path.

Effects that require player input set `GameState.pendingChoice`. While a choice
is pending, the engine rejects all non-`RESOLVE_CHOICE` actions. The debug table
renders the pending options for the owning player. Current choice-backed effects
cover discarding from hand before drawing and searching a filtered card from the
deck into hand before shuffling.
