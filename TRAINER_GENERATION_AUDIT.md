# Trainer Generation Audit

Generated from `pokerogue-beta/src/data/trainers/trainer-config.ts`, biome trainer pools, fixed battle configs, and mystery encounter references.

This is an implementation map for 2P trainer scaling. It classifies how each trainer config appears to generate Pokemon; it does not decide balance yet.

## Summary

- Curated Trainer: 192
- Generic Filtered: 25
- Pool Based: 34
- Template / Event / Default: 21

## Category Meanings

- Pool Based: uses `setSpeciesPools(...)`; team slots are generated from a trainer-specific species list or rarity pool.
- Generic Filtered: uses `setSpeciesFilter(...)`; team slots are generated from the global species generator with a rule such as type, move access, regional form, or BST.
- Curated Trainer: uses explicit party slot functions or helper initializers for gym leaders, Elite Four, champions, rivals, evil admins/bosses, etc.
- Template / Event / Default: has no obvious direct pool/filter/slot rule in the config block; may rely on default template behavior or be adjusted by an event encounter.

## Pool Based

| TrainerType | Seen In | Generation Notes |
|---|---|---|
| ``AETHER_GRUNT`` | Fixed battle | species pool refs: 35 |
| ``AQUA_GRUNT`` | Fixed battle | species pool refs: 27 |
| ``AROMA_LADY`` | Biome pool | species pool refs: 30 |
| ``ARTIST`` | Biome pool | species pool refs: 1 |
| ``BACKPACKER`` | Biome pool | species pool refs: 23; filter: `s => s.isOfType(PokemonType.FLYING) \|\| s.isOfType(PokemonType.ROCK))` |
| ``BEAUTY`` | Biome pool | species pool refs: 29 |
| ``BIKER`` | Biome pool | species pool refs: 15 |
| ``BIRD_KEEPER`` | Biome pool | species pool refs: 44 |
| ``BLACK_BELT`` | Biome pool | species pool refs: 28 |
| ``BREEDER`` | Biome pool | species pool refs: 37 |
| ``CLERK`` | Biome pool | species pool refs: 15 |
| ``CYCLIST`` | Biome pool | species pool refs: 18 |
| ``DANCER`` | Config only / indirect | species pool refs: 13 |
| ``FISHERMAN`` | Biome pool | species pool refs: 33 |
| ``FLARE_GRUNT`` | Fixed battle | species pool refs: 33 |
| ``GALACTIC_GRUNT`` | Fixed battle | species pool refs: 25 |
| ``HIKER`` | Biome pool | species pool refs: 29 |
| ``MACRO_GRUNT`` | Fixed battle | species pool refs: 29 |
| ``MAGMA_GRUNT`` | Fixed battle | species pool refs: 23 |
| ``OFFICER`` | Biome pool | species pool refs: 17 |
| ``PLASMA_GRUNT`` | Fixed battle | species pool refs: 30 |
| ``PRESCHOOLER`` | Config only / indirect | species pool refs: 23 |
| ``PSYCHIC`` | Biome pool | species pool refs: 25 |
| ``RANGER`` | Biome pool | species pool refs: 33 |
| ``RICH`` | Biome pool | species pool refs: 24 |
| ``ROCKET_GRUNT`` | Fixed battle | species pool refs: 37 |
| ``RUIN_MANIAC`` | Biome pool | species pool refs: 37 |
| ``SCHOOL_KID`` | Biome pool | species pool refs: 16 |
| ``SCIENTIST`` | Biome pool | species pool refs: 33 |
| ``SCUBA_DIVER`` | Biome pool | species pool refs: 35 |
| ``SKULL_GRUNT`` | Fixed battle | species pool refs: 30 |
| ``STAR_GRUNT`` | Fixed battle | species pool refs: 43 |
| ``WAITER`` | Biome pool | species pool refs: 13 |
| ``YOUNGSTER`` | Biome pool, Fixed battle, Mystery/event | species pool refs: 13 |

## Generic Filtered

| TrainerType | Seen In | Generation Notes |
|---|---|---|
| ``BAKER`` | Biome pool | custom species filter |
| ``BUG_CATCHER`` | Biome pool | filter: `s => s.isOfType(PokemonType.BUG)),` |
| ``CAMPER`` | Biome pool | custom species filter |
| ``COLLECTOR`` | Biome pool | filter: `s => s.isRegional()),` |
| ``DEPOT_AGENT`` | Biome pool | filter: `s => s.isOfType(PokemonType.GROUND)),` |
| ``DOCTOR`` | Config only / indirect | filter: `s => !!s.getLevelMoves().find(plm => plm[1] === MoveId.HEAL_PULSE)),` |
| ``DRAGON_TAMER`` | Biome pool | filter: `s => s.isOfType(PokemonType.DRAGON)),` |
| ``FAIRY_TALE_GIRL`` | Biome pool | filter: `s => s.isOfType(PokemonType.FAIRY)),` |
| ``FIREBREATHER`` | Biome pool | filter: `s => !!s.getLevelMoves().find(plm => plm[1] === MoveId.SMOG) \|\| s.i...` |
| ``GUITARIST`` | Biome pool | filter: `s => s.isOfType(PokemonType.ELECTRIC)),` |
| ``HARLEQUIN`` | Mystery/event | filter: `s => s.canLearnTm(MoveId.TRICK_ROOM)),` |
| ``HEX_MANIAC`` | Biome pool | filter: `s => s.isOfType(PokemonType.GHOST) \|\| s.isOfType(PokemonType.PSYCHI...` |
| ``HOOLIGANS`` | Biome pool | filter: `s => s.isOfType(PokemonType.POISON) \|\| s.isOfType(PokemonType.DARK)),` |
| ``INTERVIEWERS`` | Config only / indirect | filter: `s => s.isOfType(PokemonType.NORMAL) \|\| s.isOfType(PokemonType.ELECT...` |
| ``MUSICIAN`` | Biome pool | filter: `s => !!s.getLevelMoves().find(plm => plm[1] === MoveId.SING)),` |
| ``PARASOL_LADY`` | Biome pool | custom species filter |
| ``PILOT`` | Biome pool | filter: `s => s.canLearnTm(MoveId.FLY)),` |
| ``POKEFAN`` | Biome pool | filter: `s => s.canLearnTm(MoveId.HELPING_HAND)),` |
| ``RICH_KID`` | Biome pool | filter: `s => s.baseTotal <= 460),` |
| ``ROUGHNECK`` | Biome pool | filter: `s => s.isOfType(PokemonType.DARK)),` |
| ``SAILOR`` | Biome pool | filter: `s => s.isOfType(PokemonType.WATER) \|\| s.isOfType(PokemonType.FIGHTI...` |
| ``SNOW_WORKER`` | Biome pool | filter: `s => s.isOfType(PokemonType.ICE) \|\| s.isOfType(PokemonType.STEEL)),` |
| ``SWIMMER`` | Biome pool | filter: `s => s.isOfType(PokemonType.WATER)),` |
| ``VETERAN`` | Biome pool | filter: `s => s.baseTotal >= 500),` |
| ``WORKER`` | Biome pool | filter: `s => s.isOfType(PokemonType.ROCK) \|\| s.isOfType(PokemonType.STEEL)),` |

## Curated Trainer

| TrainerType | Seen In | Generation Notes |
|---|---|---|
| ``AARON`` | Fixed battle | Elite Four helper; explicit slot funcs: 5 |
| ``ACEROLA`` | Fixed battle | Elite Four helper; explicit slot funcs: 5 |
| ``AGATHA`` | Fixed battle | Elite Four helper; explicit slot funcs: 5 |
| ``ALDER`` | Fixed battle | Champion helper; explicit slot funcs: 6 |
| ``ALIANA`` | Fixed battle | Evil admin helper; explicit slot funcs: 2 |
| ``ALLISTER`` | Biome pool | Gym Leader helper |
| ``ALLISTER_ELITE`` | Fixed battle | Elite Four helper; explicit slot funcs: 5 |
| ``AMARYS`` | Fixed battle | Elite Four helper; explicit slot funcs: 5 |
| ``ARCHER`` | Fixed battle | Evil admin helper; explicit slot funcs: 3 |
| ``ARCHIE`` | Fixed battle | Evil boss helper; explicit slot funcs: 6 |
| ``ARCHIE_2`` | Fixed battle | Evil boss helper; explicit slot funcs: 6 |
| ``ARIANA`` | Fixed battle | Evil admin helper; explicit slot funcs: 3 |
| ``ATTICUS`` | Fixed battle | Evil admin helper; explicit slot funcs: 3 |
| ``BEA`` | Biome pool | Gym Leader helper |
| ``BEA_ELITE`` | Fixed battle | Elite Four helper; explicit slot funcs: 5 |
| ``BEDE`` | Biome pool | Gym Leader helper |
| ``BEDE_ELITE`` | Fixed battle | Elite Four helper; explicit slot funcs: 5 |
| ``BERTHA`` | Fixed battle | Elite Four helper; explicit slot funcs: 5 |
| ``BLAINE`` | Biome pool | Gym Leader helper |
| ``BLUE`` | Fixed battle | Champion helper; explicit slot funcs: 6 |
| ``BRASSIUS`` | Biome pool | Gym Leader helper |
| ``BRAWLY`` | Biome pool | Gym Leader helper |
| ``BROCK`` | Biome pool | Gym Leader helper |
| ``BRUNO`` | Fixed battle | Elite Four helper; explicit slot funcs: 5 |
| ``BRYCEN`` | Biome pool | Gym Leader helper |
| ``BRYONY`` | Fixed battle | Evil admin helper; explicit slot funcs: 2 |
| ``BUCK`` | Mystery/event | explicit slot funcs: 6 |
| ``BUGSY`` | Biome pool | Gym Leader helper |
| ``BURGH`` | Biome pool | Gym Leader helper |
| ``BYRON`` | Biome pool | Gym Leader helper |
| ``CAITLIN`` | Fixed battle | Elite Four helper; explicit slot funcs: 5 |
| ``CANDICE`` | Biome pool | Gym Leader helper |
| ``CELOSIA`` | Fixed battle | Evil admin helper; explicit slot funcs: 2 |
| ``CHEREN`` | Biome pool | Gym Leader helper |
| ``CHERYL`` | Mystery/event | explicit slot funcs: 6 |
| ``CHILI`` | Biome pool | Gym Leader helper |
| ``CHUCK`` | Biome pool | Gym Leader helper |
| ``CILAN`` | Biome pool | Gym Leader helper |
| ``CLAIR`` | Biome pool | Gym Leader helper |
| ``CLAY`` | Biome pool | Gym Leader helper |
| ``CLEMONT`` | Biome pool | Gym Leader helper |
| ``COLRESS`` | Fixed battle | Evil admin helper; explicit slot funcs: 3 |
| ``COURTNEY`` | Fixed battle | Evil admin helper; explicit slot funcs: 3 |
| ``CRASHER_WAKE`` | Biome pool | Gym Leader helper |
| ``CRESS`` | Biome pool | Gym Leader helper |
| ``CRISPIN`` | Fixed battle | Elite Four helper; explicit slot funcs: 5 |
| ``CYNTHIA`` | Fixed battle | Champion helper; explicit slot funcs: 6 |
| ``CYRUS`` | Fixed battle | Evil boss helper; explicit slot funcs: 6 |
| ``CYRUS_2`` | Fixed battle | Evil boss helper; explicit slot funcs: 6 |
| ``DIANTHA`` | Fixed battle | Champion helper; explicit slot funcs: 6 |
| ``DRAKE`` | Fixed battle | Elite Four helper; explicit slot funcs: 5 |
| ``DRASNA`` | Fixed battle | Elite Four helper; explicit slot funcs: 5 |
| ``DRAYDEN`` | Biome pool | Gym Leader helper |
| ``DRAYTON`` | Fixed battle | Elite Four helper; explicit slot funcs: 5 |
| ``ELESA`` | Biome pool | Gym Leader helper |
| ``ERI`` | Fixed battle | Evil admin helper; explicit slot funcs: 3 |
| ``ERIKA`` | Biome pool | Gym Leader helper |
| ``FABA`` | Fixed battle | Evil admin helper; explicit slot funcs: 3 |
| ``FALKNER`` | Biome pool | Gym Leader helper |
| ``FANTINA`` | Biome pool | Gym Leader helper |
| ``FLANNERY`` | Biome pool | Gym Leader helper |
| ``FLINT`` | Fixed battle | Elite Four helper; explicit slot funcs: 5 |
| ``GARDENIA`` | Biome pool | Gym Leader helper |
| ``GEETA`` | Fixed battle | Champion helper; explicit slot funcs: 6 |
| ``GHETSIS`` | Fixed battle | Evil boss helper; explicit slot funcs: 6 |
| ``GHETSIS_2`` | Fixed battle | Evil boss helper; explicit slot funcs: 6 |
| ``GIACOMO`` | Fixed battle | Evil admin helper; explicit slot funcs: 3 |
| ``GIOVANNI`` | Biome pool | Gym Leader helper |
| ``GLACIA`` | Fixed battle | Elite Four helper; explicit slot funcs: 5 |
| ``GORDIE`` | Biome pool | Gym Leader helper |
| ``GRANT`` | Biome pool | Gym Leader helper |
| ``GRIMSLEY`` | Fixed battle | Elite Four helper; explicit slot funcs: 5 |
| ``GRUSHA`` | Biome pool | Gym Leader helper |
| ``GUZMA`` | Fixed battle | Evil boss helper; explicit slot funcs: 6 |
| ``GUZMA_2`` | Fixed battle | Evil boss helper; explicit slot funcs: 6 |
| ``HALA`` | Fixed battle | Elite Four helper; explicit slot funcs: 5 |
| ``HASSEL`` | Fixed battle | Elite Four helper; explicit slot funcs: 5 |
| ``HAU`` | Fixed battle | Champion helper; explicit slot funcs: 6 |
| ``IONO`` | Biome pool | Gym Leader helper |
| ``IRIS`` | Fixed battle | Champion helper; explicit slot funcs: 6 |
| ``JANINE`` | Biome pool | Gym Leader helper |
| ``JASMINE`` | Biome pool | Gym Leader helper |
| ``JUAN`` | Biome pool | Gym Leader helper |
| ``JUPITER`` | Fixed battle | Evil admin helper; explicit slot funcs: 3 |
| ``KABU`` | Biome pool | Gym Leader helper |
| ``KAHILI`` | Fixed battle | Elite Four helper; explicit slot funcs: 5 |
| ``KAREN`` | Fixed battle | Elite Four helper; explicit slot funcs: 5 |
| ``KATY`` | Biome pool | Gym Leader helper |
| ``KIERAN`` | Fixed battle | Champion helper; explicit slot funcs: 6 |
| ``KOFU`` | Biome pool | Gym Leader helper |
| ``KOGA`` | Fixed battle | Elite Four helper; explicit slot funcs: 5 |
| ``KORRINA`` | Biome pool | Gym Leader helper |
| ``KUKUI`` | Fixed battle | Champion helper; explicit slot funcs: 6 |
| ``LACEY`` | Fixed battle | Elite Four helper; explicit slot funcs: 5 |
| ``LANCE`` | Fixed battle | Elite Four helper; explicit slot funcs: 5 |
| ``LANCE_CHAMPION`` | Fixed battle | Champion helper; explicit slot funcs: 6 |
| ``LARRY`` | Biome pool | Gym Leader helper |
| ``LARRY_ELITE`` | Fixed battle | Elite Four helper; explicit slot funcs: 5 |
| ``LENORA`` | Biome pool | Gym Leader helper |
| ``LEON`` | Fixed battle | Champion helper; explicit slot funcs: 6 |
| ``LIZA`` | Biome pool | Gym Leader helper |
| ``LORELEI`` | Fixed battle | Elite Four helper; explicit slot funcs: 5 |
| ``LT_SURGE`` | Biome pool | Gym Leader helper |
| ``LUCIAN`` | Fixed battle | Elite Four helper; explicit slot funcs: 5 |
| ``LUSAMINE`` | Fixed battle | Evil boss helper; explicit slot funcs: 6 |
| ``LUSAMINE_2`` | Fixed battle | Evil boss helper; explicit slot funcs: 6 |
| ``LYSANDRE`` | Fixed battle | Evil boss helper; explicit slot funcs: 6 |
| ``LYSANDRE_2`` | Fixed battle | Evil boss helper; explicit slot funcs: 6 |
| ``MABLE`` | Fixed battle | Evil admin helper; explicit slot funcs: 2 |
| ``MALVA`` | Fixed battle | Elite Four helper; explicit slot funcs: 5 |
| ``MARLEY`` | Mystery/event | explicit slot funcs: 6 |
| ``MARLON`` | Biome pool | Gym Leader helper |
| ``MARNIE`` | Biome pool | Gym Leader helper |
| ``MARNIE_ELITE`` | Fixed battle | Elite Four helper; explicit slot funcs: 5 |
| ``MARS`` | Fixed battle | Evil admin helper; explicit slot funcs: 3 |
| ``MARSHAL`` | Fixed battle | Elite Four helper; explicit slot funcs: 5 |
| ``MATT`` | Fixed battle | Evil admin helper; explicit slot funcs: 3 |
| ``MAXIE`` | Fixed battle | Evil boss helper; explicit slot funcs: 6 |
| ``MAXIE_2`` | Fixed battle | Evil boss helper; explicit slot funcs: 6 |
| ``MAYLENE`` | Biome pool | Gym Leader helper |
| ``MELA`` | Fixed battle | Evil admin helper; explicit slot funcs: 3 |
| ``MELONY`` | Biome pool | Gym Leader helper |
| ``MILO`` | Biome pool | Gym Leader helper |
| ``MIRA`` | Mystery/event | explicit slot funcs: 6 |
| ``MISTY`` | Biome pool | Gym Leader helper |
| ``MOLAYNE`` | Fixed battle | Elite Four helper; explicit slot funcs: 5 |
| ``MORTY`` | Biome pool | Gym Leader helper |
| ``MUSTARD`` | Fixed battle | Champion helper; explicit slot funcs: 6 |
| ``MYSTERIOUS_SISTERS`` | Biome pool | explicit slot funcs: 2 |
| ``NEMONA`` | Fixed battle | Champion helper; explicit slot funcs: 6 |
| ``NESSA`` | Biome pool | Gym Leader helper |
| ``NESSA_ELITE`` | Fixed battle | Elite Four helper; explicit slot funcs: 5 |
| ``NORMAN`` | Biome pool | Gym Leader helper |
| ``OLEANA`` | Fixed battle | Evil admin helper; explicit slot funcs: 3 |
| ``OLIVIA`` | Fixed battle | Elite Four helper; explicit slot funcs: 5 |
| ``OLYMPIA`` | Biome pool | Gym Leader helper |
| ``OPAL`` | Biome pool | Gym Leader helper |
| ``ORTEGA`` | Fixed battle | Evil admin helper; explicit slot funcs: 3 |
| ``PENNY`` | Fixed battle | Evil boss helper; explicit slot funcs: 6 |
| ``PENNY_2`` | Fixed battle | Evil boss helper; explicit slot funcs: 6 |
| ``PETREL`` | Fixed battle | Evil admin helper; explicit slot funcs: 3 |
| ``PHOEBE`` | Fixed battle | Elite Four helper; explicit slot funcs: 5 |
| ``PIERS`` | Biome pool | Gym Leader helper |
| ``PLUMERIA`` | Fixed battle | Evil admin helper; explicit slot funcs: 3 |
| ``POPPY`` | Fixed battle | Elite Four helper; explicit slot funcs: 5 |
| ``PROTON`` | Fixed battle | Evil admin helper; explicit slot funcs: 3 |
| ``PRYCE`` | Biome pool | Gym Leader helper |
| ``RAIHAN`` | Biome pool | Gym Leader helper |
| ``RAIHAN_ELITE`` | Fixed battle | Elite Four helper; explicit slot funcs: 5 |
| ``RAMOS`` | Biome pool | Gym Leader helper |
| ``RED`` | Fixed battle | Champion helper; explicit slot funcs: 6 |
| ``RIKA`` | Fixed battle | Elite Four helper; explicit slot funcs: 5 |
| ``RILEY`` | Mystery/event | explicit slot funcs: 6 |
| ``RIVAL`` | Fixed battle | explicit slot funcs: 2 |
| ``RIVAL_2`` | Fixed battle | explicit slot funcs: 3 |
| ``RIVAL_3`` | Fixed battle | explicit slot funcs: 4 |
| ``RIVAL_4`` | Fixed battle | explicit slot funcs: 5 |
| ``RIVAL_5`` | Fixed battle | explicit slot funcs: 6 |
| ``RIVAL_6`` | Fixed battle | explicit slot funcs: 6 |
| ``ROARK`` | Biome pool | Gym Leader helper |
| ``ROCKET_BOSS_GIOVANNI_1`` | Fixed battle | Evil boss helper; explicit slot funcs: 6 |
| ``ROCKET_BOSS_GIOVANNI_2`` | Fixed battle | Evil boss helper; explicit slot funcs: 6 |
| ``ROSE`` | Fixed battle | Evil boss helper; explicit slot funcs: 6 |
| ``ROSE_2`` | Fixed battle | Evil boss helper; explicit slot funcs: 6 |
| ``ROXANNE`` | Biome pool | Gym Leader helper |
| ``ROXIE`` | Biome pool | Gym Leader helper |
| ``RYME`` | Biome pool | Gym Leader helper |
| ``SABRINA`` | Biome pool | Gym Leader helper |
| ``SATURN`` | Fixed battle | Evil admin helper; explicit slot funcs: 3 |
| ``SHAUNTAL`` | Fixed battle | Elite Four helper; explicit slot funcs: 5 |
| ``SHELLY`` | Fixed battle | Evil admin helper; explicit slot funcs: 3 |
| ``SIDNEY`` | Fixed battle | Elite Four helper; explicit slot funcs: 5 |
| ``SIEBOLD`` | Fixed battle | Elite Four helper; explicit slot funcs: 5 |
| ``SKYLA`` | Biome pool | Gym Leader helper |
| ``STEVEN`` | Fixed battle | Champion helper; explicit slot funcs: 6 |
| ``TABITHA`` | Fixed battle | Evil admin helper; explicit slot funcs: 3 |
| ``TATE`` | Biome pool | Gym Leader helper |
| ``TULIP`` | Biome pool | Gym Leader helper |
| ``TWINS`` | Biome pool | explicit slot funcs: 2 |
| ``VALERIE`` | Biome pool | Gym Leader helper |
| ``VIOLA`` | Biome pool | Gym Leader helper |
| ``VOLKNER`` | Biome pool | Gym Leader helper |
| ``WALLACE`` | Fixed battle | Champion helper; explicit slot funcs: 6 |
| ``WATTSON`` | Biome pool | Gym Leader helper |
| ``WHITNEY`` | Biome pool | Gym Leader helper |
| ``WIKSTROM`` | Fixed battle | Elite Four helper; explicit slot funcs: 5 |
| ``WILL`` | Fixed battle | Elite Four helper; explicit slot funcs: 5 |
| ``WINONA`` | Biome pool | Gym Leader helper |
| ``WULFRIC`` | Biome pool | Gym Leader helper |
| ``XEROSIC`` | Fixed battle | Evil admin helper; explicit slot funcs: 2 |
| ``YOUNG_COUPLE`` | Biome pool | explicit slot funcs: 2 |
| ``ZINZOLIN`` | Fixed battle | Evil admin helper; explicit slot funcs: 3 |

## Template / Event / Default

| TrainerType | Seen In | Generation Notes |
|---|---|---|
| ``ACE_TRAINER`` | Biome pool | default trainer template/species rules or encounter overrides |
| ``BACKERS`` | Config only / indirect | default trainer template/species rules or encounter overrides |
| ``BUG_TYPE_SUPERFAN`` | Mystery/event | default trainer template/species rules or encounter overrides |
| ``EXPERT_POKEMON_BREEDER`` | Mystery/event | default trainer template/species rules or encounter overrides |
| ``HOOPSTER`` | Config only / indirect | default trainer template/species rules or encounter overrides |
| ``INFIELDER`` | Config only / indirect | default trainer template/species rules or encounter overrides |
| ``JANITOR`` | Config only / indirect | default trainer template/species rules or encounter overrides |
| ``LINEBACKER`` | Config only / indirect | default trainer template/species rules or encounter overrides |
| ``MAID`` | Config only / indirect | default trainer template/species rules or encounter overrides |
| ``NURSERY_AIDE`` | Config only / indirect | default trainer template/species rules or encounter overrides |
| ``PLAYER_F_ALTERNATE`` | Mystery/event | default trainer template/species rules or encounter overrides |
| ``PLAYER_M_ALTERNATE`` | Mystery/event | default trainer template/species rules or encounter overrides |
| ``SMASHER`` | Config only / indirect | default trainer template/species rules or encounter overrides |
| ``SNOW_ACE_TRAINER`` | Biome pool | default trainer template/species rules or encounter overrides |
| ``STRIKER`` | Config only / indirect | default trainer template/species rules or encounter overrides |
| ``UNKNOWN`` | Mystery/event | default trainer template/species rules or encounter overrides |
| ``VICKY`` | Mystery/event | default trainer template/species rules or encounter overrides |
| ``VICTOR`` | Mystery/event | default trainer template/species rules or encounter overrides |
| ``VICTORIA`` | Mystery/event | default trainer template/species rules or encounter overrides |
| ``VITO`` | Mystery/event | default trainer template/species rules or encounter overrides |
| ``VIVI`` | Mystery/event | default trainer template/species rules or encounter overrides |

## Notes For 2P Scaling

- Pool Based trainers are the easiest candidates for automatic 2P Full Mode expansion: increase the party template size and reuse the existing pool.
- Generic Filtered trainers are also good candidates for automatic expansion, but duplicates/type balance should be watched because they rely on broader global generation.
- Curated trainers should usually preserve explicit slot logic. Named partner trainers already started down this path by using each trainer's solo party logic.
- Template/Event/default trainers need case-by-case review before changing party size, especially mystery encounters that clone or mutate trainer configs at runtime.

