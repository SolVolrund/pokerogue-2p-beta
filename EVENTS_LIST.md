# Mystery Encounter / Event Audit

This is a working 2P audit list for PokeRogue mystery encounters.

Current 2P policy: mystery encounters remain disabled until they are explicitly audited and allowlisted.

Audit labels:

- `Not started`: no 2P work yet.
- `Candidate`: likely easier to port after owner helpers exist.
- `High risk`: touches battle shape, custom capture, party mutation, profile data, or direct modifier/money state.
- `Disabled upstream`: registered in code but commented out of normal biome selection.

Core 2P questions for every event:

- Which player is making the event choice?
- Does the event affect P1, P2, both players independently, or the shared run?
- Does it read party, money, balls, modifiers, or profile data through old global state?
- Does it start a battle, and if so can it stay a forced double battle?
- Does it add, remove, transform, trade, catch, teach moves, or apply held items to Pokemon?
- Does it write dex, candy, egg moves, tickets, vouchers, achievements, or profile unlocks?

## Event List

| Event | Enum | Source | Spawn grouping | 2P audit status | Initial notes |
|---|---|---|---|---|---|
| Mysterious Challengers | `MYSTERIOUS_CHALLENGERS` | `mysterious-challengers-encounter.ts` | Human-transitable biomes | Implemented | 2P rolls a second eligible trainer from the same normal/hard/brutal source, forces a double trainer battle, and queues owned P1/P2 rewards. |
| Mysterious Chest | `MYSTERIOUS_CHEST` | `mysterious-chest-encounter.ts` | Any biome | Implemented | 2P prompts each player, handles split reward/trap outcomes, queues owned rewards, and starts solo or duo Gimmighoul trap battles only for trapped players. Two-chest visual polish still pending. |
| Dark Deal | `DARK_DEAL` | `dark-deal-encounter.ts` | Any biome | Implemented but needs re-pass | 2P prompts each player independently, removes one owned Pokemon per accepting player, grants owned Rogue Balls, and spawns one/two catchable transformed bosses. |
| Fight or Flight | `FIGHT_OR_FLIGHT` | `fight-or-flight-encounter.ts` | Any biome | Implemented | 2P generates two guarded boss Pokemon, queues owned P1/P2 item rewards, and unlocks the steal route if either party has a theft move. |
| Slumbering Snorlax | `SLUMBERING_SNORLAX` | `slumbering-snorlax-encounter.ts` | Plains, Grass, Tall Grass | Implemented | 2P uses shared option voting, spawns two Snorlax for battle, heals both parties on wait, and queues owned Leftovers rewards. |
| Training Session | `TRAINING_SESSION` | `training-session-encounter.ts` | Any biome | Implemented | 2P prompts each player independently, supports one or two training Pokemon, restores owned Pokemon/modifiers, and queues owned rewards. |
| Department Store Sale | `DEPARTMENT_STORE_SALE` | `department-store-sale-encounter.ts` | Civilization biomes | Implemented | 2P prompts each player independently and queues owned reward shops from each selected counter. |
| Shady Vitamin Dealer | `SHADY_VITAMIN_DEALER` | `shady-vitamin-dealer-encounter.ts` | Human-transitable biomes | Implemented | 2P prompts each player independently, spends owned money, applies vitamins to owned selected Pokemon, and queues owned EXP. |
| Field Trip | `FIELD_TRIP` | `field-trip-encounter.ts` | Disabled upstream | Disabled upstream | Commented out of normal biome grouping. Audit later. |
| Safari Zone | `SAFARI_ZONE` | `safari-zone-encounter.ts` | Forest, Swamp, Jungle | Implemented | 2P uses shared entry voting, requires both players to afford entry, spawns three pairs of Safari Pokemon, resolves independent P1/P2 Safari actions, and routes catches to the acting player. |
| Lost at Sea | `LOST_AT_SEA` | `lost-at-sea-encounter.ts` | Sea | Implemented | 2P prompts each player independently, checks Surf/Fly eligibility against each owned party, queues owned guide EXP, and applies wander damage only to the choosing player's party. |
| Fiery Fallout | `FIERY_FALLOUT` | `fiery-fallout-encounter.ts` | Volcano | Implemented | 2P prompts each player independently, supports 2v2, 1v2, and 1v1 source battles, applies owned hunker damage, and queues owned helper/source rewards. |
| The Strong Stuff | `THE_STRONG_STUFF` | `the-strong-stuff-encounter.ts` | Cave | Implemented | 2P prompts each player independently, applies juice stat effects to owned parties, supports 1v1/2v2 Shuckle battles, handles mixed approach/battle ordering, and queues owned rewards. |
| The Pokemon Salesman | `THE_POKEMON_SALESMAN` | `the-pokemon-salesman-encounter.ts` | Human-transitable biomes | Implemented | 2P prompts each player independently, rolls separate P1/P2 offers, checks owned money, spends owned money, and routes purchased Pokemon to the buying player's party/profile. |
| An Offer You Can't Refuse | `AN_OFFER_YOU_CANT_REFUSE` | `an-offer-you-cant-refuse-encounter.ts` | Human-transitable biomes | Implemented - needs testing | 2P prompts each player independently, computes each player's strongest Pokemon and price separately, routes Shiny Charm/money/EXP by owner, and removes only the selling player's Pokemon. Re-enabled in its normal human-transitable biome grouping. |
| Delibirdy | `DELIBIRDY` | `delibirdy-encounter.ts` | Any biome | Implemented | 2P prompts each player independently, checks owned money/items, removes owned donated held items, and queues owned Amulet Coin/Candy Jar/Berry Pouch/Healing Charm rewards. |
| Absolute Avarice | `ABSOLUTE_AVARICE` | `absolute-avarice-encounter.ts` | Grass, Tall Grass, Forest | Implemented | 2P prompts each player independently, tracks stolen berries by owner, supports solo/double Greedent battles, owned berry return, owned party food rewards, and owned Greedent recruitment. |
| A Trainer's Test | `A_TRAINERS_TEST` | `a-trainers-test-encounter.ts` | Any biome | Implemented | 2P rolls two distinct stat trainers, prompts each player independently, supports solo/double trainer battles for accept choices, heals refusing players, and queues owned rare/epic egg rewards. |
| Trash to Treasure | `TRASH_TO_TREASURE` | `trash-to-treasure-encounter.ts` | Any biome | Implemented | 2P prompts each player independently, applies owned dig reward items and Black Sludge debuffs, and supports solo or 2v1 G-Max Garbodor battles for investigating players. |
| Berries Abound | `BERRIES_ABOUND` | `berries-abound-encounter.ts` | Any biome | Implemented | 2P prompts each player independently, checks each player's fastest Pokemon for the race, applies owned berry rewards/EXP, and supports solo or 2v1 boss battles for battling or caught players. |
| Clowning Around | `CLOWNING_AROUND` | `clowning-around-encounter.ts` | Any biome | Implemented | 2P prompts each player independently, applies item/type randomization only to the choosing player's party, preserves the scripted Mr. Mime + Blacephalon double battle for battle choices, and offers owned ability swaps to battling players. Needs later balance pass for solo 1v2 cases. |
| Part-Timer | `PART_TIMER` | `part-timer-encounter.ts` | Civilization biomes | Implemented | 2P prompts each player independently, checks Sales Assistant eligibility against the choosing player's party, applies PP drain/EXP to the selected owned Pokemon, pays owned money with owned money modifiers, and queues owned rewards. |
| Dancing Lessons | `DANCING_LESSONS` | `dancing-lessons-encounter.ts` | Non-extreme plus Badlands, Desert, Volcano, Wasteland, Abyss | Implemented | 2P spawns two Oricorio forms, prompts each player independently, routes Revelation Dance learning and Oricorio recruitment to the choosing player, and supports 2v2, 1v2, or 1v1 battle shapes depending on battle/learn/recruit choices. |
| Weird Dream | `WEIRD_DREAM` | `weird-dream-encounter.ts` | Any biome | Implemented | 2P stores dream transformations per player, prompts each player independently, applies transform/leave effects to the choosing player's team/save data, and supports solo or double alternate-team battles for players who choose to fight. |
| The Winstrate Challenge | `THE_WINSTRATE_CHALLENGE` | `the-winstrate-challenge-encounter.ts` | Human-transitable biomes | Implemented | 2P prompts each player independently, gives refusing players owned heal/Rarer Candy rewards, supports solo gauntlets for one accepting player, and uses paired Winstrate trainer battles for two accepting players. |
| Teleporting Hijinks | `TELEPORTING_HIJINKS` | `teleporting-hijinks-encounter.ts` | Any biome | Implemented | 2P prompts each player independently, uses the shared tie-breaker when biome-change and inspect choices conflict, charges owned money or grants owned helper EXP only when that route wins, and starts a shared double boss battle. |
| Bug-Type Superfan | `BUG_TYPE_SUPERFAN` | `bug-type-superfan-encounter.ts` | Any biome | Implemented | 2P prompts each player independently, keeps the wave-scaled Superfan trainer team logic for battle choices, routes show/gift rewards by owner, removes gifted held items from the choosing player's Pokemon, and runs owned Bug move tutor prompts for battling players. |
| Fun and Games | `FUN_AND_GAMES` | `fun-and-games-encounter.ts` | Civilization biomes | Implemented | 2P prompts each player independently, lets one or both players play, uses one shared Wobbuffet target, and applies the same final reward or KO penalty to every player who paid in. |
| Uncommon Breed | `UNCOMMON_BREED` | `uncommon-breed-encounter.ts` | Any biome | Implemented | 2P generates separate P1/P2 special Pokemon, prompts each player independently, routes food/befriend catches to the choosing player, removes owned berries, grants owned helper EXP, and supports solo or double battles for battle choices. |
| Global Trade System | `GLOBAL_TRADE_SYSTEM` | `global-trade-system-encounter.ts` | Civilization biomes | Implemented | 2P prompts each player independently, generates/checks trade offers per owned party, resolves Wonder Trade and item trades by owner, transfers non-form/stat held items to the received Pokemon, and queues item-trade rewards for the choosing player. |
| The Expert Pokemon Breeder | `THE_EXPERT_POKEMON_BREEDER` | `the-expert-pokemon-breeder-encounter.ts` | Human-transitable biomes, Space | Implemented | 2P prompts each player to pick one owned low-friendship trainee, temporarily isolates each player to that Pokemon, gives the breeder a fourth Pokemon and double-battle config, restores both parties afterward, and queues owned Soothe Bell/egg rewards. |
| Poke Poachers | `POKE_POACHERS` | `poke-poachers-encounter.ts` | Any biome | Implemented - needs testing | Shared vote rescue battle. 1P/2P uses Annie or Oakley with Latias/Latios as an enemy-side ally, while 3P/1P2C uses both poachers and centers the protected legendary. Poachers force Toxic at battle start, add Sticky Web in triple battles, and rewards are queued for rescuing players only if the legendary survives. Vs mode uses both poachers and awards only the player who clears their assigned poacher line. |
| Chefs on Vacation | `CHEFS_ON_VACATION` | `chefs-on-vacation-encounter.ts` | Human-transitable biomes | Implemented - needs testing | Multiplayer-only event. Prompts each player independently, rolls two brothers in 2P or all three in 3P/1P2C, scales each brother's starter team by wave, supports 1v1/2v2/3v3 by accepting players, and offers owned Grass/Fire/Water Pledge tutor rewards to battle winners. AI accepts at medium confidence or higher and teaches the best Pledge move by normal move-learning logic. |

## Suggested Port Order

1. Add event owner plumbing and keep the allowlist limited to audited events.
2. Port one simple money/shop event first, likely `PART_TIMER`, `DEPARTMENT_STORE_SALE`, or `SHADY_VITAMIN_DEALER`.
3. Port item-only reward events next: `DELIBIRDY`, `TRASH_TO_TREASURE`, `BERRIES_ABOUND`.
4. Port simple battle events only after mystery battles can remain 2P double battles.
5. Leave custom capture, trade, transformation, and temporary-party-removal events for last.

## 2P Allowlist

- `MYSTERIOUS_CHEST`
- `MYSTERIOUS_CHALLENGERS`
- `DARK_DEAL`
- `FIGHT_OR_FLIGHT`
- `SLUMBERING_SNORLAX`
- `TRAINING_SESSION`
- `DEPARTMENT_STORE_SALE`
- `SHADY_VITAMIN_DEALER`
- `SAFARI_ZONE`
- `LOST_AT_SEA`
- `FIERY_FALLOUT`
- `THE_STRONG_STUFF`
- `THE_POKEMON_SALESMAN`
- `AN_OFFER_YOU_CANT_REFUSE`
- `DELIBIRDY`
- `ABSOLUTE_AVARICE`
- `A_TRAINERS_TEST`
- `TRASH_TO_TREASURE`
- `BERRIES_ABOUND`
- `CLOWNING_AROUND`
- `PART_TIMER`
- `DANCING_LESSONS`
- `WEIRD_DREAM`
- `THE_WINSTRATE_CHALLENGE`
- `TELEPORTING_HIJINKS`
- `BUG_TYPE_SUPERFAN`
- `FUN_AND_GAMES`
- `UNCOMMON_BREED`
- `GLOBAL_TRADE_SYSTEM`
- `THE_EXPERT_POKEMON_BREEDER`
- `POKE_POACHERS`
- `CHEFS_ON_VACATION`

## Fraction / Vs Event Matrix

`Fraction modes` means limited-party multiplayer: `3/3` for two players or `2/2/2` for three players. Unless a row says otherwise, these modes use the same event flow as full co-op, with rewards and party edits still routed by owner.

Generated mystery encounter trainer parties are capped per enemy trainer in fraction modes: `3/3` keeps each trainer's 3 strongest Pokemon, while `2/2/2` keeps each trainer's 2 strongest Pokemon. Hand-authored event parties keep their event-specific shape unless noted.

| Event | Fraction modes | Vs mode |
|---|---|---|
| Mysterious Challengers | Generated trainers use the fraction trainer cap. | Native lane trainer battle; each player's chosen lane reward remains owner-scoped. |
| Mysterious Chest | Same shared chest/greed flow as full co-op. | Competitive shared; opponents can leave extra chests available for greed. |
| Dark Deal | Same owner-scoped sacrifice/capture flow as full co-op. | Special scripted; transformed targets remain across from the sacrificing player, with normal Vs lane safeguards. |
| Fight or Flight | Same per-player steal/fight/run flow as full co-op. | Split PvE battle; each player should resolve against their own generated offer/guardian. |
| Slumbering Snorlax | Same per-player option flow as full co-op. | Split PvE battle; battle choices should generate lane-safe Snorlax targets. |
| Training Session | Same per-player training flow as full co-op. | Split PvE battle; battle choices should resolve lane-safe training opponents. |
| Department Store Sale | Same independent reward-shop flow as full co-op. | Owner-scoped non-battle; each player uses their own money/rewards. |
| Shady Vitamin Dealer | Same independent vitamin flow as full co-op. | Owner-scoped non-battle; each player uses their own money and party. |
| Field Trip | Disabled upstream. | Disabled. |
| Safari Zone | Same ticket/reservation/action flow as full co-op. | Disabled because the Safari state machine is delicate and capture routing is event-specific. |
| Lost at Sea | Same independent helper/wander flow as full co-op. | Owner-scoped non-battle; each player resolves only their own party effects/rewards. |
| Fiery Fallout | Same calm/fight/hunker flow as full co-op. | Split PvE battle; Volcarona pressure should be lane-safe. |
| The Strong Stuff | Same juice/battle flow as full co-op. | Split PvE battle; Shuckle battles should be lane-safe. |
| The Pokemon Salesman | Same per-player offers as full co-op. | Owner-scoped non-battle; each player buys only their own offer. |
| An Offer You Can't Refuse | Same per-player refuse/steal/sell flow as full co-op. | Owner-scoped non-battle; AI/human ownership remains isolated. |
| Delibirdy | Same independent trade-in flow as full co-op. | Owner-scoped non-battle; donations and rewards stay owner-scoped. |
| Absolute Avarice | Same independent feed/reason/battle flow as full co-op. | Competitive shared; event can remain shared/greedy. |
| A Trainer's Test | Generated trainers use the fraction trainer cap. | Native lane trainer battle; each accepting player keeps their own trainer/reward lane. |
| Trash to Treasure | Same dig/investigate flow as full co-op. | Split PvE battle; shared Garbodor-style danger should be split or lane-safe. |
| Berries Abound | Same race/battle flow as full co-op. | Split PvE battle; shared single-boss pressure should be split or lane-safe. |
| Clowning Around | Same provoke/insult/ignore flow as full co-op. | Split PvE battle; scripted clown opponents should be lane-safe. |
| Part-Timer | Same independent job flow as full co-op. | Owner-scoped non-battle; stat checks, money, and rewards stay per player. |
| Dancing Lessons | Same dance/learn/battle flow as full co-op. | Split PvE battle; Oricorio battles should be lane-safe. |
| Weird Dream | Uses each player's own transformed party; ace preservation still applies. | Special scripted; rerolls and alternate-team battles remain per player. |
| The Winstrate Challenge | Generated Winstrate trainers use the fraction trainer cap. | Solo sequence trainer battle; Vs should use the 1P Winstrate order rather than the co-op multi-family lineup. |
| Teleporting Hijinks | Same vote/result flow as full co-op. | Competitive shared; votes/tiebreak decide the shared biome outcome. AI biome preferences are deferred. |
| Bug-Type Superfan | Generated Superfan trainer uses the fraction trainer cap. | Native lane trainer battle; owner-scoped move tutor rewards remain per player. |
| Fun and Games | Same pay-in/shared target flow as full co-op. | Competitive shared; shared Wobbuffet stakes remain acceptable for Vs. |
| Uncommon Breed | Same generated-offer flow as full co-op. | Split PvE battle; each player's generated Pokemon/reward remains owner-scoped. |
| Global Trade System | Same owner-scoped trade flow as full co-op. | Owner-scoped non-battle; trades stay within the acting player's party. |
| GTS Malfunction | Same party-shuffle battle flow as full co-op. | Disabled because shuffling with an opponent is not desirable. |
| The Expert Pokemon Breeder | Exempt from fraction trainer cap; breeder keeps its intended 3-Pokemon team shape. | Native lane trainer battle; AI always participates if eligible. |
| Shiny Badge | Same duel flow as full co-op. | Special scripted; suppresses generic Vs victory while event heals losers and awards the badge. |
| Legendary Conflict | Same mixed-alliance rescue battle as full co-op. | Special scripted; player vote decides the allied legendary and hostile legendary. |
| Poke Poachers | Same rescue battle as full co-op. | Special scripted; both poachers appear, and only the first player to clear their assigned poacher line gets Eon Flute. |
| Chefs on Vacation | Generated brother trainers use the fraction trainer cap. | Disabled because Pledge rewards are co-op-oriented. |
| It Is Dangerous to Go Alone | Same ally-recruit rules as full co-op where eligible. | Disabled because Vs should not add co-op partners. |
| Faraway Island Treasure | Same shared/owner-routed treasure flow as full co-op. | Competitive shared. |
| Contest Hall | Same contest progress flow as full co-op. | Special scripted; needs dedicated contest-specific Vs review if issues appear. |
| Mining | Same owned mining flow as full co-op. | Owner-scoped non-battle. |

## Mystery Encounter Battle Groups

These groups are for future `3/3`, `2/2/2`, and Vs compatibility passes. They classify events by the battle shape they can create in multiplayer, so an event that can scale from one boss to several bosses is grouped as `Multi Boss Battle`.

`Special Battle` is intentionally separate from the five normal buckets because those events use field ownership, empty enemy parties, or mixed-alliance targeting rules that need their own Vs-mode attention.

Limited-party trainer battle helper: generated mystery encounter trainer teams are capped per enemy trainer in limited co-op modes. `3/3` keeps each trainer's 3 strongest template slots, while `2/2/2` keeps each trainer's 2 strongest template slots. Hand-authored `pokemonConfigs` remain event-owned for now, and The Expert Pokemon Breeder is exempt because its 3-Pokemon breeder team is already its intended battle shape.

### Trainer Battle

- Mysterious Challengers - `MYSTERIOUS_CHALLENGERS`
- A Trainer's Test - `A_TRAINERS_TEST`
- Weird Dream - `WEIRD_DREAM`
- The Winstrate Challenge - `THE_WINSTRATE_CHALLENGE`
- Bug-Type Superfan - `BUG_TYPE_SUPERFAN`
- The Expert Pokemon Breeder - `THE_EXPERT_POKEMON_BREEDER`
- Deja Vu - `DEJA_VU`
- Chefs on Vacation - `CHEFS_ON_VACATION`

### Wild Battle

- Safari Zone - `SAFARI_ZONE`
- Fiery Fallout - `FIERY_FALLOUT`
- Fun and Games - `FUN_AND_GAMES`
- Uncommon Breed - `UNCOMMON_BREED`
- GTS Malfunction - `GTS_MALFUNCTION`

### Boss Battle

- Trash to Treasure - `TRASH_TO_TREASURE`
- Berries Abound - `BERRIES_ABOUND`

### Multi Boss Battle

- Mysterious Chest - `MYSTERIOUS_CHEST`
- Dark Deal - `DARK_DEAL`
- Fight or Flight - `FIGHT_OR_FLIGHT`
- Slumbering Snorlax - `SLUMBERING_SNORLAX`
- Training Session - `TRAINING_SESSION`
- The Strong Stuff - `THE_STRONG_STUFF`
- Absolute Avarice - `ABSOLUTE_AVARICE`
- Clowning Around - `CLOWNING_AROUND`
- Dancing Lessons - `DANCING_LESSONS`
- Teleporting Hijinks - `TELEPORTING_HIJINKS`

### Special Battle

- Shiny Badge - `SHINY_BADGE`
- Legendary Conflict - `LEGENDARY_CONFLICT`
- Poke Poachers - `POKE_POACHERS`

### Non Battle

- Department Store Sale - `DEPARTMENT_STORE_SALE`
- Shady Vitamin Dealer - `SHADY_VITAMIN_DEALER`
- Field Trip - `FIELD_TRIP`
- Lost at Sea - `LOST_AT_SEA`
- The Pokemon Salesman - `THE_POKEMON_SALESMAN`
- An Offer You Can't Refuse - `AN_OFFER_YOU_CANT_REFUSE`
- Delibirdy - `DELIBIRDY`
- Part-Timer - `PART_TIMER`
- Global Trade System - `GLOBAL_TRADE_SYSTEM`
- It Is Dangerous to Go Alone - `IT_IS_DANGEROUS_TO_GO_ALONE`
- Faraway Island Treasure - `FARAWAY_ISLAND_TREASURE`
- Contest Hall - `CONTEST_HALL`
- Mining - `MINING`

## Vs Compatibility Variants

These are the event-flow variants used by the Vs compatibility helper. The Vs allowlist currently excludes only the `Disabled` bucket; the other buckets are labels for event code to choose its Vs-specific flow.

### Disabled

- Field Trip - `FIELD_TRIP`
- GTS Malfunction - `GTS_MALFUNCTION`
- Safari Zone - `SAFARI_ZONE`
- Chefs on Vacation - `CHEFS_ON_VACATION`
- It Is Dangerous to Go Alone - `IT_IS_DANGEROUS_TO_GO_ALONE`

### Owner-Scoped Non-Battle

- Department Store Sale - `DEPARTMENT_STORE_SALE`
- Shady Vitamin Dealer - `SHADY_VITAMIN_DEALER`
- Lost at Sea - `LOST_AT_SEA`
- The Pokemon Salesman - `THE_POKEMON_SALESMAN`
- An Offer You Can't Refuse - `AN_OFFER_YOU_CANT_REFUSE`
- Delibirdy - `DELIBIRDY`
- Part-Timer - `PART_TIMER`
- Global Trade System - `GLOBAL_TRADE_SYSTEM`
- Mining - `MINING`

### Native Lane Trainer Battle

- Mysterious Challengers - `MYSTERIOUS_CHALLENGERS`
- A Trainer's Test - `A_TRAINERS_TEST`
- Bug-Type Superfan - `BUG_TYPE_SUPERFAN`
- The Expert Pokemon Breeder - `THE_EXPERT_POKEMON_BREEDER`

### Solo Sequence Trainer Battle

- The Winstrate Challenge - `THE_WINSTRATE_CHALLENGE`

### Split PvE Battle

- Fight or Flight - `FIGHT_OR_FLIGHT`
- Slumbering Snorlax - `SLUMBERING_SNORLAX`
- Training Session - `TRAINING_SESSION`
- Fiery Fallout - `FIERY_FALLOUT`
- The Strong Stuff - `THE_STRONG_STUFF`
- Trash to Treasure - `TRASH_TO_TREASURE`
- Berries Abound - `BERRIES_ABOUND`
- Clowning Around - `CLOWNING_AROUND`
- Dancing Lessons - `DANCING_LESSONS`
- Uncommon Breed - `UNCOMMON_BREED`

### Competitive Shared

- Mysterious Chest - `MYSTERIOUS_CHEST`
- Absolute Avarice - `ABSOLUTE_AVARICE`
- Fun and Games - `FUN_AND_GAMES`
- Teleporting Hijinks - `TELEPORTING_HIJINKS`
- Faraway Island Treasure - `FARAWAY_ISLAND_TREASURE`

### Special Scripted

- Dark Deal - `DARK_DEAL`
- Weird Dream - `WEIRD_DREAM`
- Deja Vu - `DEJA_VU`
- Shiny Badge - `SHINY_BADGE`
- Legendary Conflict - `LEGENDARY_CONFLICT`
- Poke Poachers - `POKE_POACHERS`
- Contest Hall - `CONTEST_HALL`

Special-case notes:

- Shiny Badge suppresses the generic Vs victory phase while its duel cleanup is awarding/healing players.
- Deja Vu ghosts are keyed by run shape so full co-op, limited-party, solo, and Vs ghosts do not consume each other.
- Poke Poachers Vs keeps both players in the shared rescue scene, but each player can only win the Eon Flute reward by clearing their assigned poacher line first.
