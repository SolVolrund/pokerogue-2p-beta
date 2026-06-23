# PokeRogue 2P TODO Plan

## Goal

Build a local two-player PokeRogue prototype where both players share one linear run and one double battle, while each player owns their own party, money, balls, rewards, modifiers, unlocks, dex progress, eggs, vouchers, and other account/profile progression.

Core rule:

```ts
left player field slot = player 0
right player field slot = player 1
```

Do not infer ownership from combined party indexes. Track player ownership explicitly.

## Current Source Layout

- `pokerogue-beta`: most up-to-date PokeRogue game source. Do 2P game logic work here first.
- `Pokerogue-2P`: Electron app wrapper copy. Use later to package/load the modified game.
- `Pokerogue-App-main`: original/offline app wrapper reference.
- `HOW_TO_GET_SPLIT_PLAYERS.md`: older multiplayer porting notes. Useful for state ownership lessons, but ignore parts about simultaneous separate fights and branching paths.

## Target State Shape

Two layers need to be separated:

1. Shared run/session state: one adventure, one wave path, one battle.
2. Per-player profile/system state: two sets of unlocks, dex data, eggs, vouchers, tickets, stats, and progression.

The host/local player owns player 0's local system save. The guest account should provide player 1's system save/profile data.

One shared session save/run shell should contain two player run states:

```ts
sessionSave: {
  seed,
  playTime,
  gameMode,
  waveIndex,
  battleType,
  enemyParty,
  arena,
  score,
  activePlayerIndex,
  fieldSlotOwners: [0, 1],
  players: [
    {
      party,
      money,
      pokeballCounts,
      modifiers,
      rewardQueue,
    },
    {
      party,
      money,
      pokeballCounts,
      modifiers,
      rewardQueue,
    },
  ],
}
```

Avoid separate run/session files like `sessionSaves[0]` and `sessionSaves[1]`. The run is shared, so save one session containing two player run states.

Do keep two system/profile save states:

```ts
systemSaves: [
  localPlayerSystemSave,
  guestPlayerSystemSave,
]
```

These should back player-specific unlocks, dex progress, eggs, tickets/vouchers, and account progression.

## Battle Size Modes

Primary mode:

- Both players have 6 Pokemon.
- NPC trainers generate with roughly twice the normal number of Pokemon to compensate.
- When a trainer supports a normal double/duo variant, 2P mode should preserve that trainer's double name, sprite, dialogue, and flavor instead of treating every trainer as visually single.
- Named partner trainers, such as Tate/Liza, Piers/Marnie, Red/Blue, Steven/Wallace, and Alder/Iris, need a deliberate 2P pass so their partner names, sprites, dialogue, trainer slots, and party generation remain coherent.

Current implementation status:

- Full 2P mode now forces named partner trainers to use their `TrainerVariant.DOUBLE` presentation when that trainer is selected.
- Named partner trainer parties now generate from each trainer's solo party logic and interleave the results, preserving guaranteed slots, small-list slots, special forms, boss flags, abilities, custom moves, and balls.
- Generated partner Pokemon are retagged as `TrainerSlot.TRAINER_PARTNER`; main trainer Pokemon remain `TrainerSlot.TRAINER`.
- Named partner modifier and AI generation now run against each trainer's own generated sub-party.
- Native double-only trainer pairs now scale in Full 2P mode:
  - waves 1-50: 2 total enemy Pokemon
  - waves 51-80: 4 total enemy Pokemon
  - waves 81-110: 6 total enemy Pokemon
  - waves 111+: 8 total enemy Pokemon
- Native double-only trainer pairs with curated left/right pools now reuse the left pool for even slots and the right pool for odd slots, with a fresh seed per pair.
- Half Mode keeps normal trainer party sizing.

Named partner follow-up list:

- Tate/Liza are tentatively complete after the named-pair update pass. They still need playtesting to confirm Solrock/Lunatone identity, guaranteed slots, partner sprite/dialogue, and replacement behavior all hold in 2P.

Alternate mode:

- Both players have 3 Pokemon.
- NPC trainers generate normally.
- This can be useful as a simpler balance/test mode.

## Phase 0: Make It Runnable

- Install dependencies in `pokerogue-beta`.
- Start the Vite dev server.
- Open the game in the Codex side browser for quick testing.
- Current known status:
  - Node is installed.
  - `pokerogue-beta` has `pnpm-lock.yaml`.
  - `node_modules` is installed after running `corepack pnpm install`, but the install postscript fails because `pokerogue-beta` is not a git repository.
  - `pnpm` is not globally available.
  - Corepack exists, but needs a workspace-local cache or permission because default cache writes outside the workspace.
  - `assets` and `locales` are empty submodule folders in this source snapshot. They need to be cloned/populated before Vite can start.

## Phase 1: Add 2P State Shape

- Add a prototype flag, such as `?twoPlayer=1`.
- Add a battle size mode flag later, such as `?twoPlayerPartySize=3` or `?twoPlayerMode=short`.
- Add player state storage:

```ts
players: [
  { party, money, pokeballCounts, modifiers },
  { party, money, pokeballCounts, modifiers },
]
activePlayerIndex: 0 | 1
```

- Keep existing single-player fields and behavior working while the 2P code is introduced.
- This phase does not need to fully split system/profile saves yet, but it should avoid designs that make that impossible later.

Current implementation status:

- `src/battle-scene.ts` has a first-pass 2P scaffold:
  - `twoPlayerMode`
  - `twoPlayerPartySize`
  - `activePlayerIndex`
  - `fieldSlotOwners`
  - `players[0]` and `players[1]`
  - owner-aware accessors for party, money, balls, modifiers, field slot owner, and Pokemon owner
- `twoPlayerMode` and `twoPlayerPartySize` can now be configured at runtime by the new-game menu instead of only being fixed by URL parameters.
- The URL parameters still act as development defaults:
  - `?twoPlayer=1`
  - `?twoPlayerPartySize=3`
- `New Game` now has a first-pass selection flow:
  - `Classic / Daily Run / Cancel`
  - `1P / 2P / Cancel`
  - for 2P, `Full Mode / Half Mode / Cancel`
- Classic 1P starts a normal one-player classic run.
- Classic 2P Full starts a two-player classic run with 6 Pokemon per player.
- Classic 2P Half starts a two-player classic run with 3 Pokemon per player.
- Daily 1P starts the existing daily run flow.
- Daily 2P is visible as a placeholder but does not start yet; it shows a short "not ready" message because daily starter generation still builds one shared party directly.
- `addMoney(amount)` now delegates through `addMoneyForPlayer(amount, playerIndex)`.
- Normal single-player behavior remains the compatibility path.

## Phase 2: Add Owner-Aware Accessors

Create controlled access paths before rewriting call sites:

```ts
getPlayerParty(playerIndex = activePlayerIndex)
getPlayerMoney(playerIndex = activePlayerIndex)
getPlayerPokeballCounts(playerIndex = activePlayerIndex)
getPlayerModifiers(playerIndex = activePlayerIndex)
addModifierForPlayer(modifier, playerIndex)
addMoneyForPlayer(amount, playerIndex)
getPlayerIndexForPokemon(pokemon)
getPlayerIndexForFieldSlot(slot)
```

Use these to migrate away from direct global reads like:

```ts
globalScene.getPlayerParty()
globalScene.money
globalScene.pokeballCounts
globalScene.modifiers
```

## Phase 3: Starter Select Twice

- P1 chooses starters.
- Store P1 starters into `players[0].party`.
- P2 chooses starters.
- Store P2 starters into `players[1].party`.
- Start wave 1 only after both parties are chosen.

First visible milestone:

- P1 and P2 can select different starter teams.

Current implementation status:

- `src/phases/select-starter-phase.ts` now has a first-pass two-player starter flow:
  - P1 chooses starters and save slot.
  - P2 is prompted to choose starters.
  - P1 starters are stored in `players[0].party`.
  - P2 starters are stored in `players[1].party`.
  - The old `initBattle(starters)` entry point remains for tests/helpers.

## Phase 4: Shared Double Battle Field

- Force 2P encounters to double battles.
- In 2P mode, `getPlayerField()` should return:

```ts
[
  players[0].party[0],
  players[1].party[0],
]
```

- Preserve normal single-player behavior when the 2P flag is off.
- Disable or skip mystery encounters in the first 2P prototype because they often force non-double behavior and touch global party/money/modifier state.

Current implementation status:

- `getPlayerField()` returns P1 lead plus P2 lead when `twoPlayerMode` is on.
- Initial player summon maps field slot 0 to P1 party slot 0 and field slot 1 to P2 party slot 0.
- Player switch summon now uses the field slot owner's party in 2P mode.
- Player switch summon now writes the incoming Pokemon back to the owner's active party slot instead of using the field slot as a party index. This fixes the P2 bug where switching could overwrite another party member, such as Chimchar being replaced by Charmander.
- The party menu now uses a single-active-slot layout for 2P owner-specific party screens even though the battle itself is double. This keeps bench Pokemon out of the phantom second-active slot.
- `checkIsDouble()` forces all non-mystery 2P battles to double.
- Standard mystery encounter generation is enabled in 2P only for allowlisted events.

Milestone:

- Wave 1 starts as a double battle.
- Left player slot uses P1's lead Pokemon.
- Right player slot uses P2's lead Pokemon.

## Phase 5: Command Ownership

- Route move, switch, item, ball, and target selection through the acting Pokemon's owner.
- Track field slot ownership explicitly:

```ts
fieldSlotOwners[0] = 0
fieldSlotOwners[1] = 1
```

- Do not assume field slot or party index alone determines ownership.
- Repurpose Window Type as an active-player command indicator:
  - Window Type 1 while P1 is selecting.
  - Window Type 2 while P2 is selecting.

Current implementation status:

- `CommandPhase` sets `activePlayerIndex` from the acting field slot owner in 2P mode.
- `CommandPhase` calls `updateWindowType(playerIndex + 1)` so the UI border switches to type 1 for P1 and type 2 for P2 during command selection.
- The Pokemon command party menu opens the acting player's party and treats only that player's active slot as on-field in 2P mode.
- P1 and P2 can switch from their own party without showing the other player's party.
- Faint replacement, forced switch, illegal-Pokemon auto-switch, encounter startup, continue/load startup, and retry startup now use owner-aware party checks in 2P mode.
- `ToggleDoublePositionPhase` is skipped in 2P mode so the fixed left/right ownership layout is not collapsed into vanilla single-player double-battle positioning.

Known remaining audit items:

- Rewards, shops, named partner trainer variants, modifier application, and profile/dex writes still need owner-aware passes.

## Phase 6: Capture And Balls

Current capture code spends from one global ball bag and adds to one global party. Change capture to include the capturing player:

```ts
players[capturingPlayer].pokeballCounts[ball]--
players[capturingPlayer].party.push(caughtPokemon)
```

Needed behavior:

- P1 ball use only spends P1 balls.
- P2 ball use only spends P2 balls.
- P1 capture adds to P1 party.
- P2 capture adds to P2 party.
- Party-full UI checks the capturing player's party of 6.
- Dex/caught data gained from capture should eventually apply to the capturing player's system save, not both players.

Current implementation status:

- Ball commands now store the acting `playerIndex` on the turn command.
- The ball menu reads and validates the acting player's ball counts.
- `AttemptCapturePhase` receives the capturing player index.
- Capture spends the capturing player's ball.
- Capture checks the capturing player's party size.
- Enemy Pokemon `addToParty()` can now add to an explicit player party.

Known remaining gaps:

- Captured enemy held-item modifiers still need owner-aware transfer.
- Dex/caught/profile updates still write through the single current `gameData` path.
- The party-full replacement UI needs a full owner audit before it is safe for P2.
- Vanilla double-battle capture rules still prevent ball use while multiple enemies are active.

## Phase 7: Rewards, Shops, And Money

After battle, reward distribution alternates by player:

1. Generate/snapshot P1 reward options.
2. Set active player to P1.
3. Apply P1 reward to P1 state.
4. Generate/snapshot P2 reward options.
5. Set active player to P2.
6. Apply P2 reward to P2 state.
7. Continue to the next wave.

If a reward source grants multiple reward picks, distribute them in alternating order:

```ts
P1, P2, P1, P2, P1, P2
```

Example: if the base flow gives "3 rewards," both players should receive 3 picks, alternating one pick at a time.

Owner-aware behavior:

- P1 reward only changes P1 party/items.
- P2 reward only changes P2 party/items.
- P1 money spending only changes P1 money.
- P2 money spending only changes P2 money.
- Ball rewards go to the active reward owner.
- Whole-party item rewards only affect the player who picked the reward.
- Each player's luck only affects that player's reward generation/options.

Current implementation status:

- Normal post-battle item rewards in 2P mode now queue two `SelectModifierPhase` instances:
  - P1 reward selection first.
  - P2 reward selection second.
- Fixed `ModifierRewardPhase` rewards now carry an explicit player owner.
- Fixed wave/milestone rewards in 2P mode now queue one reward for P1 and one reward for P2, including:
  - classic fixed battle event rewards
  - Lock Capsule
  - daily EXP Charm / Golden Pokeball
  - Endless EXP Share
  - Classic wave 10 EXP Charm
  - EXP Charm / Super EXP Charm milestones
  - Golden Pokeball milestones
  - Endless voucher milestones
- Trainer config modifier rewards now queue one fixed reward per player in 2P mode.
- Boss trainer voucher rewards now account for 2P:
  - repeat voucher rewards queue one reward per player
  - first-time voucher unlocks still use the existing profile unlock path, then queue a second visible voucher reward so the shared prototype profile receives two total vouchers
- `SelectModifierPhase` now carries a player owner.
- Reward option generation uses the owner player's party, so owner luck and party eligibility are used for that player's reward options.
- Reward/shop party menus opened from `SelectModifierPhase` use the owner player's party.
- Reroll and shop purchase money checks/spending use the owner player's money.
- Adding a chosen modifier runs while the owner player is active, so first-pass modifier storage lands in that player's modifier list.
- Reward item party menus, such as Protein or Potion selection, now use the single-owner party layout in 2P mode instead of the vanilla double-battle party layout.
- Reward/shop selection and reward item party menus now use the active player's window type indicator:
  - P1 uses window type 1.
  - P2 uses window type 2.
- Trainer prize money / `MoneyRewardPhase` now pays both players in 2P mode.
- Switching active players refreshes the visible money display to that player's money.
- Reward/shop screens re-sync the active player before opening so reroll/shop cost displays use the current player's money.

Known remaining gaps:

- Voucher/profile rewards still write to the single current `gameData` profile until true P1/P2 system saves exist.
- Game-over ribbon/voucher rewards are owner-capable at the phase level, but the classic clear/profile progression flow still needs a full 2P profile ownership pass before it should be duplicated automatically.
- Money achievement/profile writes still use the single current `gameData` path.
- If players eventually have different money multipliers, the shared money reward message may need clearer per-player text.
- Modifier effects themselves still need deeper owner audits, especially run-wide/passive effects.
- Reward UI text does not yet explicitly label "Player 1 reward" versus "Player 2 reward" beyond the window border/player state.
- Shop inventory/reroll lock state is still shared and may need per-player handling.

## Phase 7.5: EXP Ownership

- EXP should apply to both players' eligible parties after enemy defeats.
- EXP display, level-up, learn-move, and evolution follow-up phases must keep the same player owner as the Pokemon receiving EXP.
- Owner-specific EXP modifiers should apply only for the owner player's modifier list.

Current implementation status:

- `applyPartyExp()` now runs once for each player in 2P mode.
- EXP calculation uses the target owner's party.
- EXP modifier application runs while the target owner is active, so first-pass owner modifier lists are respected.
- `ExpPhase`, `ShowPartyExpBarPhase`, `LevelUpPhase`, `LearnMovePhase`, and the shared `PlayerPartyMemberPokemonPhase` now carry a player owner.

Known remaining gaps:

- Profile stats/achievements from level-up still write through the single current `gameData` path.
- Evolution and form-change paths that search `globalScene.getPlayerParty()` directly still need a deeper 2P ownership audit.
- EXP balancing should be playtested for whether shared double-battle participation should split between both players exactly like vanilla multi-participant EXP.

## Phase 8: Modifiers / Passive Items

- Split player modifier storage by owner:

```ts
players[0].modifiers
players[1].modifiers
enemyModifiers
```

- Held items are likely easier because many already attach to Pokemon by `pokemonId`.
- Run-wide/passive modifiers are trickier because they currently assume one global player modifier list.
- Modifier application should be routed by:
  - affected Pokemon owner,
  - active reward/shop player,
  - or explicit player owner passed by the phase.

Needed behavior:

- P1 passive items affect only P1-owned Pokemon/state unless intentionally shared.
- P2 passive items affect only P2-owned Pokemon/state unless intentionally shared.
- One player's held item stack should not block or merge with the other player's stack unless explicitly intended.
- Whole-party passive items must only affect the owner player's party unless explicitly designed as shared.

Current implementation status:

- `BattleScene` now has owner-aware modifier helpers:
  - player-specific modifier lookup/application
  - Pokemon-owner modifier lookup/application
  - player-specific modifier updates/removal
- Battle EXP modifier paths now use the EXP recipient player's modifier list:
  - EXP Share
  - EXP Balance
  - Multiple Participant EXP Bonus
  - Pokemon EXP held-item boosters
  - global EXP boosters during EXP display phases
- Money reward calculation now applies each player's own money modifiers independently.
- Common battle passive effects now use the acting/affected Pokemon's owner:
  - berries
  - turn-end healing/status effects
  - turn-held-item transfer effects
  - multi-hit held items
  - flinch held items
  - damage-to-money held items
  - hit-heal held items
  - crit/stat/base-stat/vitamin/nature/friendship modifiers
  - survival/endure-style held effects
- Party item management now searches the current party owner's modifier list for transfer, discard, release, form-change, and max-stack checks.
- Capture held-item transfer now adds captured held items to the capturing player's modifier list and only clears held items from the caught enemy Pokemon.
- The top-left player modifier/item bar now refreshes from the active player's modifier list when active control changes.
- Reward/shop UI redraws now use the active player's modifier list for the item bar instead of reading the legacy shared modifier reference directly.

Known remaining gaps:

- Many profile/dex/achievement writes still use the single current `gameData` path.
- Encounter generation modifiers like shiny/hidden-ability charms still need a design pass because wild Pokemon do not have a player owner yet.
- Some battle helpers still use active-player modifier lookups where the intended owner is shared or ambiguous, such as map/biome effects, IV scanner, and some retry/run-info paths.
- Map item logic needs a dedicated 2P pass. It should not expose or apply route/biome/map effects from the wrong player's modifier list, and the visible item bar should continue to reflect the active player.
- Fixed reward phases, trainer victory rewards, voucher rewards, and special milestone rewards still need explicit player ownership.
- Mystery encounters are enabled in 2P only through an explicit allowlist and still need per-event owner audits.

## Phase 8.5: Eggs, Tickets, Vouchers, And Profile Ownership

- Tickets/vouchers must have an owning player.
- Egg purchases must remember which player spent the ticket/voucher.
- Eggs must hatch/unlock against the owning player's system save.
- Dex unlocks, candies, egg moves, passive unlocks, gacha progress, and similar progression must apply to the owning player only.
- Guest player profile data should come from the guest account's save/profile, not from player 0's local profile.

Current implementation status:

- `BattleScene` now supports two system/profile save objects in 2P mode:

```ts
systemSaves: [
  localPlayerSystemSave,
  guestPlayerSystemSave,
]
```

- P1's `systemSaves[0]` is the normal loaded `gameData` object.
- P2's `systemSaves[1]` is currently created lazily as a fresh local `GameData` object the first time P2 profile data is needed, acting as the placeholder guest save.
- P2's placeholder guest profile is persisted locally under a separate 2P guest-profile key after it is first changed. It is not recreated on every launch unless no guest profile exists yet or the stored guest profile cannot be parsed.
- `globalScene.gameData` now acts as the active-player profile alias in 2P mode when `setActivePlayerIndex()` changes control.
- New accessors:
  - `getPlayerGameData(playerIndex)`
  - `savePlayerSystemSave(playerIndex)`
  - `savePlayerSystemSaveLocal(playerIndex)`
  - `validateVoucherForPlayer(voucher, playerIndex, args?)`
- Loading the placeholder guest profile no longer writes guest profile settings, such as gender, back into the global/local settings store.
- Trainer boss voucher unlock/reward logic now checks P1 and P2 profiles independently.
- Voucher reward modifiers add vouchers to the active/owning player's profile and persist P2's placeholder guest profile when P2 receives one.
- Egg gacha voucher counts, egg capacity checks, voucher spending, egg creation, pity counters, and egg-pull statistics now use the active/owning player's profile.
- Eggs created through gacha carry their owner through creation and are stored on that player's profile save.
- Egg lapse/hatch phases now check both players' egg lists in 2P mode.
- Egg hatching removes the egg from the owning player's profile and applies dex, candy, egg move, and hatch progression to that owner's profile.
- Capture dex/IV/candy progression now writes to the capturing player's profile.
- Friendship candy progression now writes to the owning Pokemon's player profile.
- `GameData` self-updates for caught forms, IVs, and ribbon counters now use the `GameData` instance being modified instead of always reading `globalScene.gameData`.

Known remaining gaps:

- P2's guest profile is still a local placeholder. It is not yet imported from a connected client or exported/returned to that client after play.
- Many old calls to `gameData.saveSystem()` still assume one local profile. New 2P-aware call sites should use `savePlayerSystemSave(playerIndex)` or `savePlayerSystemSaveLocal(playerIndex)`.
- Starter select/dex availability still mostly reads the active profile and needs deeper review for P2 starter legality.
- Achievements, unlocks, run history, end-of-run ribbons, and classic clear progression still need player ownership passes. Some hatch/capture paths work by temporarily making the owner profile active, but this is still not a complete achievement ownership model.
- Profile UI screens still assume one active profile.

## Phase 9: Save / Load

- Extend `SessionSaveData` with per-run `players`.
- Extend or wrap system/profile save handling to support player 0's local system save and player 1's guest system save.
- Save per-player:
  - party
  - money
  - pokeballCounts
  - modifiers
  - reward/shop pending state as needed
- Save shared:
  - seed
  - play time
  - game mode
  - wave
  - battle type
  - enemy party
  - arena
  - score
  - active player
  - field slot owners

Legacy compatibility:

```ts
if (!session.players) {
  session.players = [
    {
      party: session.party,
      modifiers: session.modifiers,
      pokeballCounts: session.pokeballCounts,
      money: session.money,
    },
    createEmptyPlayerSave(),
  ];
}
```

Current implementation status:

- `SessionSaveData` has optional per-player run save data.
- 2P session saves now write:
  - each player's party
  - each player's money
  - each player's Pokeballs
  - each player's modifiers
- 2P session loading restores both player parties before summoning.
- 2P modifier loading restores player modifier lists per active player.
- Legacy/non-2P session saves get a temporary fallback so P2 is not empty and continue does not freeze. This fallback is only a bridge for old test saves; proper 2P saves should include `players[]`.

## Phase 10: Mystery Encounters

- Keep mystery encounters disabled/skipped unless they are explicitly audited and allowlisted.
- Track event audit and porting status in `EVENTS_LIST.md`.
- Re-enable only after normal battle, reward, capture, and save/load behavior are stable.
- Audit each encounter for global party, money, ball, and modifier assumptions before enabling it.
- Add an explicit 2P compatibility checklist for each mystery encounter:
  - Does it force a single battle?
  - Does it add/remove Pokemon from only one global party?
  - Does it spend or grant money/balls/items from only one global player state?
  - Does it apply modifiers to one global modifier list?
  - Does it write dex/unlock/progression changes to the correct player profile?
  - Should the encounter apply to P1, P2, both players independently, or the shared run?
- Re-enable mystery encounters one at a time behind an allowlist once each is audited.

Current allowlist:

- `MYSTERIOUS_CHEST`: v1 ported. Each player is prompted separately, rewards are owned per player, and trap rolls create one or two Gimmighoul enemies. Dedicated two-chest intro visuals are still pending.

## Basic Test Checklist

- P1 and P2 can select different starters.
- P1 profile unlocks/dex/tickets load from P1 system save.
- P2 profile unlocks/dex/tickets load from guest system save.
- Every encounter in 2P mode is a double battle, except intentionally skipped/disabled content.
- P1's lead Pokemon appears in the left player field slot.
- P2's lead Pokemon appears in the right player field slot.
- P1 can choose commands for P1-owned Pokemon.
- P2 can choose commands for P2-owned Pokemon.
- P1 reward only changes P1 party/items.
- P2 reward only changes P2 party/items.
- Multi-reward flow alternates P1, P2, P1, P2.
- P1 luck only affects P1 rewards.
- P2 luck only affects P2 rewards.
- P1 money spending only changes P1 money.
- P2 money spending only changes P2 money.
- P1 ball capture adds to P1 party.
- P2 ball capture adds to P2 party.
- P1 capture updates P1 dex/progression only.
- P2 capture updates P2 dex/progression only.
- Egg purchases and hatches update the owner player's profile only.
- EXP goes to both players' eligible participating Pokemon.
- Fainted Pokemon remain fainted after battle unless healed by normal game logic.
- Save/continue restores both parties and the correct double-battle shape.
