import { globalScene } from "#app/global-scene";
import type { PlayerIndex } from "#app/battle-scene";
import { allMoves } from "#data/data-lists";
import { BattlerTagType } from "#enums/battler-tag-type";
import type { BattlerIndex } from "#enums/battler-index";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { ZCrystal } from "#enums/z-crystal";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import { ZCrystalModifier, ZMoveAccessModifier } from "#modifiers/modifier";
import type { Move } from "#moves/move";
import type { PokemonMove } from "#moves/pokemon-move";
import type { TurnMove } from "#types/turn-move";

export interface ZMoveSelection {
  moveId: MoveId;
  sourceMoveId: MoveId;
  power?: number;
  zCrystal: ZCrystal;
}

interface GenericZMoveData {
  crystal: ZCrystal;
  physical: MoveId;
  special: MoveId;
}

interface SignatureZMoveData {
  crystal: ZCrystal;
  sourceMove: MoveId;
  zMove: MoveId;
  species: SpeciesId[];
}

const GENERIC_Z_MOVES: Partial<Record<PokemonType, GenericZMoveData>> = {
  [PokemonType.NORMAL]: {
    crystal: ZCrystal.NORMALIUM_Z,
    physical: MoveId.BREAKNECK_BLITZ__PHYSICAL,
    special: MoveId.BREAKNECK_BLITZ__SPECIAL,
  },
  [PokemonType.FIGHTING]: {
    crystal: ZCrystal.FIGHTINIUM_Z,
    physical: MoveId.ALL_OUT_PUMMELING__PHYSICAL,
    special: MoveId.ALL_OUT_PUMMELING__SPECIAL,
  },
  [PokemonType.FLYING]: {
    crystal: ZCrystal.FLYINIUM_Z,
    physical: MoveId.SUPERSONIC_SKYSTRIKE__PHYSICAL,
    special: MoveId.SUPERSONIC_SKYSTRIKE__SPECIAL,
  },
  [PokemonType.POISON]: {
    crystal: ZCrystal.POISONIUM_Z,
    physical: MoveId.ACID_DOWNPOUR__PHYSICAL,
    special: MoveId.ACID_DOWNPOUR__SPECIAL,
  },
  [PokemonType.GROUND]: {
    crystal: ZCrystal.GROUNDIUM_Z,
    physical: MoveId.TECTONIC_RAGE__PHYSICAL,
    special: MoveId.TECTONIC_RAGE__SPECIAL,
  },
  [PokemonType.ROCK]: {
    crystal: ZCrystal.ROCKIUM_Z,
    physical: MoveId.CONTINENTAL_CRUSH__PHYSICAL,
    special: MoveId.CONTINENTAL_CRUSH__SPECIAL,
  },
  [PokemonType.BUG]: {
    crystal: ZCrystal.BUGINIUM_Z,
    physical: MoveId.SAVAGE_SPIN_OUT__PHYSICAL,
    special: MoveId.SAVAGE_SPIN_OUT__SPECIAL,
  },
  [PokemonType.GHOST]: {
    crystal: ZCrystal.GHOSTIUM_Z,
    physical: MoveId.NEVER_ENDING_NIGHTMARE__PHYSICAL,
    special: MoveId.NEVER_ENDING_NIGHTMARE__SPECIAL,
  },
  [PokemonType.STEEL]: {
    crystal: ZCrystal.STEELIUM_Z,
    physical: MoveId.CORKSCREW_CRASH__PHYSICAL,
    special: MoveId.CORKSCREW_CRASH__SPECIAL,
  },
  [PokemonType.FIRE]: {
    crystal: ZCrystal.FIRIUM_Z,
    physical: MoveId.INFERNO_OVERDRIVE__PHYSICAL,
    special: MoveId.INFERNO_OVERDRIVE__SPECIAL,
  },
  [PokemonType.WATER]: {
    crystal: ZCrystal.WATERIUM_Z,
    physical: MoveId.HYDRO_VORTEX__PHYSICAL,
    special: MoveId.HYDRO_VORTEX__SPECIAL,
  },
  [PokemonType.GRASS]: {
    crystal: ZCrystal.GRASSIUM_Z,
    physical: MoveId.BLOOM_DOOM__PHYSICAL,
    special: MoveId.BLOOM_DOOM__SPECIAL,
  },
  [PokemonType.ELECTRIC]: {
    crystal: ZCrystal.ELECTRIUM_Z,
    physical: MoveId.GIGAVOLT_HAVOC__PHYSICAL,
    special: MoveId.GIGAVOLT_HAVOC__SPECIAL,
  },
  [PokemonType.PSYCHIC]: {
    crystal: ZCrystal.PSYCHIUM_Z,
    physical: MoveId.SHATTERED_PSYCHE__PHYSICAL,
    special: MoveId.SHATTERED_PSYCHE__SPECIAL,
  },
  [PokemonType.ICE]: {
    crystal: ZCrystal.ICIUM_Z,
    physical: MoveId.SUBZERO_SLAMMER__PHYSICAL,
    special: MoveId.SUBZERO_SLAMMER__SPECIAL,
  },
  [PokemonType.DRAGON]: {
    crystal: ZCrystal.DRAGONIUM_Z,
    physical: MoveId.DEVASTATING_DRAKE__PHYSICAL,
    special: MoveId.DEVASTATING_DRAKE__SPECIAL,
  },
  [PokemonType.DARK]: {
    crystal: ZCrystal.DARKINIUM_Z,
    physical: MoveId.BLACK_HOLE_ECLIPSE__PHYSICAL,
    special: MoveId.BLACK_HOLE_ECLIPSE__SPECIAL,
  },
  [PokemonType.FAIRY]: {
    crystal: ZCrystal.FAIRIUM_Z,
    physical: MoveId.TWINKLE_TACKLE__PHYSICAL,
    special: MoveId.TWINKLE_TACKLE__SPECIAL,
  },
};

const SIGNATURE_Z_MOVES: readonly SignatureZMoveData[] = [
  {
    crystal: ZCrystal.PIKANIUM_Z,
    sourceMove: MoveId.VOLT_TACKLE,
    zMove: MoveId.CATASTROPIKA,
    species: [SpeciesId.PIKACHU],
  },
  {
    crystal: ZCrystal.PIKASHUNIUM_Z,
    sourceMove: MoveId.THUNDERBOLT,
    zMove: MoveId.TEN_MILLION_VOLT_THUNDERBOLT,
    species: [SpeciesId.PIKACHU],
  },
  {
    crystal: ZCrystal.DECIDIUM_Z,
    sourceMove: MoveId.SPIRIT_SHACKLE,
    zMove: MoveId.SINISTER_ARROW_RAID,
    species: [SpeciesId.DECIDUEYE],
  },
  {
    crystal: ZCrystal.INCINIUM_Z,
    sourceMove: MoveId.DARKEST_LARIAT,
    zMove: MoveId.MALICIOUS_MOONSAULT,
    species: [SpeciesId.INCINEROAR],
  },
  {
    crystal: ZCrystal.PRIMARIUM_Z,
    sourceMove: MoveId.SPARKLING_ARIA,
    zMove: MoveId.OCEANIC_OPERETTA,
    species: [SpeciesId.PRIMARINA],
  },
  {
    crystal: ZCrystal.TAPUNIUM_Z,
    sourceMove: MoveId.NATURES_MADNESS,
    zMove: MoveId.GUARDIAN_OF_ALOLA,
    species: [SpeciesId.TAPU_KOKO, SpeciesId.TAPU_LELE, SpeciesId.TAPU_BULU, SpeciesId.TAPU_FINI],
  },
  {
    crystal: ZCrystal.ALORAICHIUM_Z,
    sourceMove: MoveId.THUNDERBOLT,
    zMove: MoveId.STOKED_SPARKSURFER,
    species: [SpeciesId.ALOLA_RAICHU],
  },
  {
    crystal: ZCrystal.SNORLIUM_Z,
    sourceMove: MoveId.GIGA_IMPACT,
    zMove: MoveId.PULVERIZING_PANCAKE,
    species: [SpeciesId.SNORLAX],
  },
  {
    crystal: ZCrystal.EEVIUM_Z,
    sourceMove: MoveId.LAST_RESORT,
    zMove: MoveId.EXTREME_EVOBOOST,
    species: [SpeciesId.EEVEE],
  },
  {
    crystal: ZCrystal.MEWNIUM_Z,
    sourceMove: MoveId.PSYCHIC,
    zMove: MoveId.GENESIS_SUPERNOVA,
    species: [SpeciesId.MEW],
  },
  {
    crystal: ZCrystal.LUNALIUM_Z,
    sourceMove: MoveId.MOONGEIST_BEAM,
    zMove: MoveId.MENACING_MOONRAZE_MAELSTROM,
    species: [SpeciesId.LUNALA, SpeciesId.NECROZMA],
  },
  {
    crystal: ZCrystal.SOLGANIUM_Z,
    sourceMove: MoveId.SUNSTEEL_STRIKE,
    zMove: MoveId.SEARING_SUNRAZE_SMASH,
    species: [SpeciesId.SOLGALEO, SpeciesId.NECROZMA],
  },
  {
    crystal: ZCrystal.ULTRANECROZIUM_Z,
    sourceMove: MoveId.PHOTON_GEYSER,
    zMove: MoveId.LIGHT_THAT_BURNS_THE_SKY,
    species: [SpeciesId.NECROZMA],
  },
  {
    crystal: ZCrystal.MIMIKIUM_Z,
    sourceMove: MoveId.PLAY_ROUGH,
    zMove: MoveId.LETS_SNUGGLE_FOREVER,
    species: [SpeciesId.MIMIKYU],
  },
  {
    crystal: ZCrystal.LYCANIUM_Z,
    sourceMove: MoveId.STONE_EDGE,
    zMove: MoveId.SPLINTERED_STORMSHARDS,
    species: [SpeciesId.LYCANROC],
  },
  {
    crystal: ZCrystal.KOMMONIUM_Z,
    sourceMove: MoveId.CLANGING_SCALES,
    zMove: MoveId.CLANGOROUS_SOULBLAZE,
    species: [SpeciesId.KOMMO_O],
  },
  {
    crystal: ZCrystal.MARSHADIUM_Z,
    sourceMove: MoveId.SPECTRAL_THIEF,
    zMove: MoveId.SOUL_STEALING_7_STAR_STRIKE,
    species: [SpeciesId.MARSHADOW],
  },
];

export function getZCrystalLocaleKey(zCrystal: ZCrystal): string {
  const crystalKey = Object.entries(ZCrystal).find(([, value]) => value === zCrystal)?.[0] ?? "NORMALIUM_Z";
  return `modifierType:ModifierType.${crystalKey}`;
}

export function getValidZCrystalsForParty(party: readonly Pokemon[]): ZCrystal[] {
  const validCrystals = new Set<ZCrystal>();

  for (const pokemon of party) {
    for (const zCrystal of getValidZCrystalsForPokemon(pokemon)) {
      validCrystals.add(zCrystal);
    }
  }

  return Array.from(validCrystals);
}

export function getReceivableZCrystalsForParty(party: readonly Pokemon[]): ZCrystal[] {
  const receivableCrystals = new Set<ZCrystal>();

  for (const pokemon of party) {
    for (const zCrystal of getReceivableZCrystalsForPokemon(pokemon)) {
      receivableCrystals.add(zCrystal);
    }
  }

  return Array.from(receivableCrystals);
}

export function hasZMoveAccessForParty(party: readonly Pokemon[]): boolean {
  const playerIndex = getPlayerIndexForParty(party);
  return globalScene.findModifierForPlayer(modifier => modifier instanceof ZMoveAccessModifier, playerIndex) !== undefined;
}

export function getReceivableZCrystalsForPokemon(pokemon: Pokemon): ZCrystal[] {
  const heldCrystals = new Set<ZCrystal>();
  const modifiers = globalScene.findModifiersForPokemon(
    modifier => modifier instanceof ZCrystalModifier && modifier.pokemonId === pokemon.id,
    pokemon,
  );

  for (const modifier of modifiers) {
    if (modifier instanceof ZCrystalModifier) {
      heldCrystals.add(modifier.zCrystal);
    }
  }

  return getValidZCrystalsForPokemon(pokemon).filter(zCrystal => !heldCrystals.has(zCrystal));
}

export function getValidZCrystalsForPokemon(pokemon: Pokemon): ZCrystal[] {
  const validCrystals = new Set<ZCrystal>();
  const moveset = pokemon.getMoveset(true);

  for (const pokemonMove of moveset) {
    const move = pokemonMove.getMove();
    if (![MoveCategory.PHYSICAL, MoveCategory.SPECIAL].includes(move.category) || move.power <= 0) {
      continue;
    }

    const moveType = pokemon.getMoveType(move, true, null);
    const zMoveData = GENERIC_Z_MOVES[moveType];
    if (zMoveData) {
      validCrystals.add(zMoveData.crystal);
    }
  }

  for (const signatureZMove of SIGNATURE_Z_MOVES) {
    if (
      moveset.some(move => move.moveId === signatureZMove.sourceMove)
      && signatureZMove.species.some(species => pokemon.hasSpecies(species))
    ) {
      validCrystals.add(signatureZMove.crystal);
    }
  }

  return Array.from(validCrystals);
}

function getPlayerIndexForParty(party: readonly Pokemon[]): PlayerIndex {
  return (
    globalScene.getActivePlayerIndexes().find(playerIndex => {
      const playerParty = globalScene.getPlayerParty(playerIndex);
      return (
        playerParty === party
        || (playerParty.length === party.length && playerParty.every((pokemon, index) => pokemon.id === party[index]?.id))
      );
    }) ?? globalScene.activePlayerIndex
  );
}

export function getGenericZPower(basePower: number): number {
  if (basePower <= 55) {
    return 100;
  }
  if (basePower <= 65) {
    return 120;
  }
  if (basePower <= 75) {
    return 140;
  }
  if (basePower <= 85) {
    return 160;
  }
  if (basePower <= 95) {
    return 175;
  }
  if (basePower === 100) {
    return 180;
  }
  if (basePower === 110) {
    return 185;
  }
  if (basePower <= 125) {
    return 190;
  }
  if (basePower === 130) {
    return 195;
  }
  return 200;
}

export function hasZMoveAccess(pokemon: PlayerPokemon): boolean {
  const playerIndex = globalScene.getPlayerIndexForPokemon(pokemon) ?? 0;
  return globalScene.findModifierForPlayer(modifier => modifier instanceof ZMoveAccessModifier, playerIndex) !== undefined;
}

export function hasUsableZMove(pokemon: PlayerPokemon): boolean {
  return hasZMoveAccess(pokemon) && pokemon.getMoveset().some(move => !!getZMoveForPokemonMove(pokemon, move));
}

export function getZMoveForPokemonMove(
  pokemon: Pokemon,
  pokemonMove: PokemonMove,
  ignoreAccess = false,
): ZMoveSelection | undefined {
  if (!ignoreAccess && (!pokemon.isPlayer() || !hasZMoveAccess(pokemon))) {
    return;
  }

  const zCrystalModifiers = pokemon
    .getHeldItems()
    .filter((modifier): modifier is ZCrystalModifier => modifier instanceof ZCrystalModifier);
  let activeCrystal = zCrystalModifiers.find(modifier => modifier.active);
  if (!activeCrystal && zCrystalModifiers.length > 0) {
    activeCrystal = zCrystalModifiers[0];
    activeCrystal.active = true;
  }
  for (const modifier of zCrystalModifiers) {
    modifier.active = modifier === activeCrystal;
  }
  const heldCrystals = activeCrystal ? [activeCrystal.zCrystal] : [];

  if (heldCrystals.length === 0 || pokemonMove.isOutOfPp()) {
    return;
  }

  return (
    getSignatureZMoveSelection(pokemon, pokemonMove.moveId, heldCrystals)
    ?? getGenericZMoveSelection(pokemon, pokemonMove, heldCrystals)
  );
}

function getSignatureZMoveSelection(
  pokemon: Pokemon,
  sourceMoveId: MoveId,
  heldCrystals: readonly ZCrystal[],
): ZMoveSelection | undefined {
  const signatureZMove = SIGNATURE_Z_MOVES.find(
    entry =>
      entry.sourceMove === sourceMoveId
      && heldCrystals.includes(entry.crystal)
      && entry.species.some(species => pokemon.hasSpecies(species)),
  );

  return signatureZMove
    ? {
        moveId: signatureZMove.zMove,
        sourceMoveId,
        zCrystal: signatureZMove.crystal,
      }
    : undefined;
}

function getGenericZMoveSelection(
  pokemon: Pokemon,
  pokemonMove: PokemonMove,
  heldCrystals: readonly ZCrystal[],
): ZMoveSelection | undefined {
  const move = pokemonMove.getMove();
  if (![MoveCategory.PHYSICAL, MoveCategory.SPECIAL].includes(move.category) || move.power <= 0) {
    return;
  }

  const moveType = pokemon.getMoveType(move, true, null);
  const zMoveData = GENERIC_Z_MOVES[moveType];
  if (!zMoveData || !heldCrystals.includes(zMoveData.crystal)) {
    return;
  }

  const moveId = move.category === MoveCategory.PHYSICAL ? zMoveData.physical : zMoveData.special;
  if (!allMoves[moveId]) {
    return;
  }

  return {
    moveId,
    sourceMoveId: pokemonMove.moveId,
    power: getGenericZPower(move.power),
    zCrystal: zMoveData.crystal,
  };
}

export function shouldSpendZMoveForTurnMove(
  pokemon: Pokemon,
  turnMove: TurnMove,
  zMoveSelection: ZMoveSelection,
): boolean {
  const sourceMove = allMoves[zMoveSelection.sourceMoveId];
  const zMove = allMoves[zMoveSelection.moveId];
  if (!sourceMove || !zMove) {
    return false;
  }

  if (zMove.category === MoveCategory.STATUS || sourceMove.category === MoveCategory.STATUS) {
    return true;
  }

  const targets = getOpposingTargetsForZSpendCheck(pokemon, turnMove.targets);
  if (targets.length === 0) {
    return false;
  }

  const normalKos = countEstimatedZSpendCheckKos(pokemon, sourceMove, targets);
  const zKos = withTemporaryZMoveTurnData(pokemon, zMoveSelection, () =>
    countEstimatedZSpendCheckKos(pokemon, zMove, targets),
  );

  return zKos > normalKos;
}

function getOpposingTargetsForZSpendCheck(pokemon: Pokemon, targetIndexes: readonly BattlerIndex[]): Pokemon[] {
  const opponents = pokemon.getOpponents();
  return targetIndexes
    .map(targetIndex => globalScene.getField()[targetIndex])
    .filter((target): target is Pokemon => !!target && opponents.includes(target));
}

function countEstimatedZSpendCheckKos(pokemon: Pokemon, move: Move, targets: readonly Pokemon[]): number {
  return targets.filter(target => estimateZSpendCheckDamage(pokemon, target, move) >= target.hp).length;
}

function estimateZSpendCheckDamage(source: Pokemon, target: Pokemon, move: Move): number {
  if (![MoveCategory.PHYSICAL, MoveCategory.SPECIAL].includes(move.category)) {
    return 0;
  }

  const isCritical = move.hasAttr("CritOnlyAttr") || !!source.getTag(BattlerTagType.ALWAYS_CRIT);
  return target.getAttackDamage({
    source,
    move,
    ignoreAbility: !target.waveData.abilityRevealed,
    ignoreSourceAbility: false,
    ignoreAllyAbility: !target.getAllies().some(ally => ally.waveData.abilityRevealed),
    ignoreSourceAllyAbility: false,
    isCritical,
    simulated: true,
  }).damage;
}

function withTemporaryZMoveTurnData<T>(pokemon: Pokemon, zMoveSelection: ZMoveSelection, callback: () => T): T {
  const previousPower = pokemon.turnData.zMovePower;
  const previousSourceMove = pokemon.turnData.zMoveSourceMove;
  pokemon.turnData.zMovePower = zMoveSelection.power;
  pokemon.turnData.zMoveSourceMove = zMoveSelection.sourceMoveId;
  try {
    return callback();
  } finally {
    pokemon.turnData.zMovePower = previousPower;
    pokemon.turnData.zMoveSourceMove = previousSourceMove;
  }
}
