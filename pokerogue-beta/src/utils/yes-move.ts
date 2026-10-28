import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import type { PendingHealTag } from "#data/arena-tag";
import { TerrainType } from "#data/terrain";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveId } from "#enums/move-id";
import { PositionalTagType } from "#enums/positional-tag-type";
import { BATTLE_STATS } from "#enums/stat";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import { toDmgValue } from "#utils/common";
import i18next from "i18next";

/** Independent components intentionally do not register whole-move failure conditions. */
export function prepareYesField(user: Pokemon, target?: Pokemon): void {
  const arena = globalScene.arena;
  const hpCost = toDmgValue(user.getMaxHp() / 2);
  if (user.hp > hpCost && BATTLE_STATS.some(stat => user.getStatStage(stat) < 6)) {
    user.damageAndUpdate(hpCost, { result: HitResult.INDIRECT, ignoreSegments: true });
    for (const stat of BATTLE_STATS) {
      user.setStatStage(stat, 6);
    }
  }

  const terrains = [
    TerrainType.ELECTRIC,
    TerrainType.GRASSY,
    TerrainType.MISTY,
    TerrainType.PSYCHIC,
    TerrainType.NONE,
    TerrainType.NONE,
    TerrainType.NONE,
  ];
  // Apply the usual effects quietly; the composite animation presents Yes's setup.
  arena.trySetTerrain(terrains[user.randBattleSeedInt(terrains.length)], true, user, true);
  const weather = [WeatherType.SUNNY, WeatherType.RAIN, WeatherType.SANDSTORM, WeatherType.HAIL, WeatherType.SNOW];
  // Preserve immutable primal weather, just as ordinary weather-setting moves do.
  if (!arena.weather?.isImmutable()) {
    arena.trySetWeather(weather[user.randBattleSeedInt(weather.length)], user, true);
  }

  for (const [tag, turns] of [
    [ArenaTagType.TRICK_ROOM, 5],
    [ArenaTagType.MAGIC_ROOM, 5],
    [ArenaTagType.GRAVITY, 5],
    [ArenaTagType.MUD_SPORT, 5],
    [ArenaTagType.WATER_SPORT, 5],
    [ArenaTagType.FAIRY_LOCK, 2],
  ] as const) {
    arena.addTag(tag, turns, MoveId.YES, user.id, ArenaTagSide.BOTH, true);
  }

  const ownSide = user.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY;
  const opposingSide = user.isPlayer() ? ArenaTagSide.ENEMY : ArenaTagSide.PLAYER;
  for (const tag of [
    ArenaTagType.SPIKES,
    ArenaTagType.TOXIC_SPIKES,
    ArenaTagType.STEALTH_ROCK,
    ArenaTagType.STICKY_WEB,
  ]) {
    arena.addTag(tag, 0, MoveId.YES, user.id, opposingSide, true);
  }
  for (const [tag, turns] of [
    [ArenaTagType.REFLECT, 5],
    [ArenaTagType.LIGHT_SCREEN, 5],
    [ArenaTagType.SAFEGUARD, 5],
    [ArenaTagType.MIST, 5],
    [ArenaTagType.TAILWIND, 4],
    [ArenaTagType.NO_CRIT, 5],
  ] as const) {
    arena.addTag(tag, turns, MoveId.YES, user.id, ownSide, true);
  }

  const positions = arena.positionalTagManager;
  if (positions.canAddTag(PositionalTagType.WISH, user.getBattlerIndex())) {
    positions.addTag({
      tagType: PositionalTagType.WISH,
      healHp: toDmgValue(user.getMaxHp() / 2),
      targetIndex: user.getBattlerIndex(),
      turnCount: 2,
      pokemonName: getPokemonNameWithAffix(user),
    });
  }
  if (target && positions.canAddTag(PositionalTagType.DELAYED_ATTACK, target.getBattlerIndex())) {
    positions.addTag({
      tagType: PositionalTagType.DELAYED_ATTACK,
      sourceId: user.id,
      targetIndex: target.getBattlerIndex(),
      sourceMove: MoveId.FUTURE_SIGHT,
      turnCount: 3,
    });
  }
}

export function getYesRevivalCandidates(user: Pokemon): Pokemon[] {
  const party = user.isPlayer()
    ? globalScene.getPlayerParty(globalScene.getPlayerIndexForPokemon(user))
    : user.hasTrainer()
      ? globalScene.getEnemyParty()
      : [];
  return party.filter(pokemon => pokemon.id !== user.id && pokemon.isFainted() && !pokemon.isBoss());
}

export function reviveForYes(user: Pokemon, target: Pokemon): void {
  if (target.id === user.id || !target.isFainted() || target.isBoss()) {
    return;
  }
  target.resetTurnData();
  target.resetStatus(true, false, false, false);
  target.heal(toDmgValue(target.getMaxHp() / 2));
}

/** Commit the sacrifice before queued faint/victory phases can end the battle. */
export function finishYes(user: Pokemon): void {
  if (user.hp <= 0) {
    return;
  }
  globalScene.arena.addTag(ArenaTagType.PENDING_HEAL, 0, MoveId.LUNAR_DANCE, user.id);
  const pending = globalScene.arena.getTag(ArenaTagType.PENDING_HEAL) as PendingHealTag;
  pending.queueHeal(user.getBattlerIndex(), {
    sourceId: user.id,
    moveId: MoveId.LUNAR_DANCE,
    restorePP: true,
    healMessage: i18next.t("moveTriggers:lunarDanceRestore", { pokemonName: getPokemonNameWithAffix(user) }),
  });
  user.damageAndUpdate(user.hp, { result: HitResult.INDIRECT, ignoreSegments: true, ignoreFaintPhase: true });
  // Yes's sacrifice is unconditional, including in the presence of a Reviver Seed.
  globalScene.phaseManager.unshiftNew("FaintPhase", user, true, undefined, true);
}
