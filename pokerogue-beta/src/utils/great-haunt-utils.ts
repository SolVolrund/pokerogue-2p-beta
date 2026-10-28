import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { GREAT_HAUNT_SPRITE } from "#data/great-haunt";
import { PokemonBattleData, PokemonSummonData } from "#data/pokemon-data";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { PokeballType } from "#enums/pokeball";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { TrainerSlot } from "#enums/trainer-slot";
import type { EnemyPokemon, Pokemon } from "#field/pokemon";
import { BaseStatModifier } from "#modifiers/modifier";
import { ModifierTypeGenerator } from "#modifiers/modifier-type";
import { PokemonMove } from "#moves/pokemon-move";
import { PokemonData } from "#system/pokemon-data";
import { randSeedInt } from "#utils/common";
import { getModifierType } from "#utils/modifier-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";

export function createGreatHauntBoss(disguised: boolean): EnemyPokemon {
  const battle = globalScene.currentBattle;
  const pokemon = globalScene.addEnemyPokemon(
    getPokemonSpecies(SpeciesId.MAROWAK),
    battle.greatHauntState?.level ?? battle.enemyLevels?.[0] ?? battle.getLevelForWave(),
    TrainerSlot.NONE,
    true,
    false,
    undefined,
    undefined,
    false,
    true,
  );
  pokemon.ivs.fill(31);
  pokemon.formIndex = 0;
  pokemon.customPokemonData.ability = AbilityId.GRAVE_WIND;
  pokemon.customPokemonData.passive = AbilityId.RESTLESS_SPIRIT;
  pokemon.passive = true;
  pokemon.customPokemonData.eventVariant = disguised ? GREAT_HAUNT_SPRITE : undefined;
  pokemon.nickname = disguised ? btoa("Great Haunt") : undefined;
  pokemon.moveset = [MoveId.BLIZZARD, MoveId.DOUBLE_TEAM, MoveId.SHADOW_BONE, MoveId.BONEMERANG].map(
    move => new PokemonMove(move),
  );
  pokemon.setHaunted();
  pokemon.setBoss(true, disguised ? 3 : 6);
  ensureGreatHauntBossBulk(pokemon);
  pokemon.calculateStats();
  pokemon.hp = pokemon.getMaxHp();
  if (disguised) {
    battle.greatHauntState!.ghostId = pokemon.id;
    battle.greatHauntState!.level = pokemon.level;
  } else {
    battle.greatHauntState!.marowakId = pokemon.id;
  }
  return pokemon;
}

/** Add missing boss vitamins, including on older saves, without stacking them again on reload. */
export function ensureGreatHauntBossBulk(pokemon: EnemyPokemon): boolean {
  const generator = getModifierType(modifierTypes.BASE_STAT_BOOSTER) as ModifierTypeGenerator;
  const targetStacks = 5 * globalScene.getActivePlayerIndexes().length;
  let changed = false;
  for (const stat of [Stat.HP, Stat.DEF, Stat.SPDEF]) {
    const vitamin = generator.generateType([pokemon], [stat])!.newModifier(pokemon) as BaseStatModifier;
    const existing = pokemon.getHeldItems().find(m => m.matchType(vitamin));
    vitamin.stackCount = targetStacks - (existing?.stackCount ?? 0);
    if (vitamin.stackCount <= 0) continue;
    vitamin.isTransferable = false;
    void globalScene.addEnemyModifier(vitamin, true, true);
    changed = true;
  }
  return changed;
}

export function recordGreatHauntFaint(pokemon: Pokemon): void {
  const state = globalScene.currentBattle.greatHauntState;
  if (!state || !pokemon.isPlayer() || state.stage !== "ghost" || state.fallen.some(p => p.id === pokemon.id)) {
    return;
  }
  state.fallen.push(new PokemonData(JSON.parse(JSON.stringify(new PokemonData(pokemon)))));
}

export function createGreatHauntClone(snapshot: PokemonData): EnemyPokemon {
  const data = new PokemonData(JSON.parse(JSON.stringify(snapshot)));
  const usedIds = new Set(
    [
      ...globalScene.getActivePlayerIndexes().flatMap(p => globalScene.getPlayerParty(p)),
      ...globalScene.getEnemyParty(),
    ].map(p => p.id),
  );
  const state = globalScene.currentBattle.greatHauntState;
  for (const id of [state?.ghostId, state?.marowakId]) {
    if (id !== undefined) usedIds.add(id);
  }
  data.id = randSeedInt(4294967296);
  while (usedIds.has(data.id)) {
    data.id = (data.id + 1) >>> 0;
  }
  data.player = false;
  data.hp = data.stats[Stat.HP];
  data.status = null;
  data.boss = false;
  data.bossSegments = 0;
  data.trainerSlot = TrainerSlot.NONE;
  data.isTerastallized = false;
  data.stellarTypesBoosted = [];
  data.haunted = true;
  data.summonData = new PokemonSummonData();
  data.battleData = new PokemonBattleData();
  data.summonDataSpeciesFormIndex = 0;
  data.moveset.forEach(move => {
    move.ppUsed = 0;
  });
  const clone = globalScene.addEnemyPokemon(
    getPokemonSpecies(data.species),
    data.level,
    TrainerSlot.NONE,
    false,
    false,
    data,
    undefined,
    false,
    true,
  );
  clone.bossSegments = 0;
  clone.bossSegmentIndex = 0;
  clone.level = data.level;
  clone.exp = data.exp;
  clone.calculateStats();
  clone.hp = clone.getMaxHp();
  return clone;
}

export function getGreatHauntCaptureBlock(pokemon: Pokemon, ball: PokeballType): string | undefined {
  const state = globalScene.currentBattle.greatHauntState;
  if (!state) {
    return;
  }
  if (ball === PokeballType.CLONE_BALL || state.stage !== "marowak" || pokemon.id !== state.marowakId) {
    return "battle:noPokeballForce";
  }
  if ((pokemon as EnemyPokemon).bossSegmentIndex > 0) {
    return "battle:noPokeballStrong";
  }
}

/** Cancel the old turn, but retain queued faints, messages, EXP and reserve selections. */
export function cancelGreatHauntTurn(): void {
  const manager = globalScene.phaseManager;
  for (const name of [
    "MovePhase",
    "MoveEffectPhase",
    "MoveEndPhase",
    "MoveChargePhase",
    "CheckInterludePhase",
    "TurnEndPhase",
    "SoulBondPhase",
    "WeatherEffectPhase",
    "PositionalTagPhase",
    "BerryPhase",
    "CheckStatusEffectPhase",
    "PostTurnStatusEffectPhase",
    "AttemptCapturePhase",
    "AttemptClonePhase",
    "TurnInitPhase",
    "TurnStartPhase",
    "CommandPhase",
    "EnemyCommandPhase",
  ] as const) {
    while (manager.tryRemovePhase(name)) {
      /* Remove every remaining action of this turn. */
    }
    while (manager.tryRemovePhase("DynamicPhaseMarker", marker => marker.phaseType === name)) {
      /* Keep cancelled actions and their queue markers in sync. */
    }
  }
  globalScene.getField().forEach(p => {
    if (p) p.summonData.moveQueue = [];
  });
}
