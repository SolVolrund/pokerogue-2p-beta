# Contest Data Source Notes

Contest data was generated from PokeAPI on 2026-07-03.

Source endpoints:

- https://pokeapi.co/api/v2/move?limit=100000
- https://pokeapi.co/api/v2/contest-type?limit=100000
- https://pokeapi.co/api/v2/contest-effect/{id}/
- https://pokeapi.co/api/v2/super-contest-effect/{id}/

The generated runtime data keeps Contest-specific behavior separate from battle move behavior.

## Generated Coverage

- PokeAPI moves fetched: 937
- Contest move entries matched to local MoveId values: 467
- Contest effects: 33
- Super Contest effects: 22
- Contest types: 5

## Notes

- PokeAPI uses `vice-grip`; this repo uses `MoveId.VISE_GRIP`, so that spelling is aliased during generation.
- Contest effect text is descriptive source material. Runtime Contest behavior should map effect IDs to explicit local behavior rather than parsing these strings.
- `normalCombo` corresponds to Ruby/Sapphire/Emerald-style Contests. `superCombo` and `superContestEffectId` are retained separately for future Super Contest support.
