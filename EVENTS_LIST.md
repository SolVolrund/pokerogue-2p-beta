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
