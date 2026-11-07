import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { type PermanentStat, Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import type { DestinyKnotModifier, PersistentModifier, PokemonHeldItemModifier } from "#modifiers/modifier";
import { areHeldItemEffectsSuppressed, isHeldItemSuppressionForecast } from "#utils/held-item-suppression-state";

export const THREAD_COLORS = ["red", "pink", "gold", "lime", "sky", "blue", "violet", "silver", "green"] as const;
export type ThreadColor = (typeof THREAD_COLORS)[number];
export const SOUL_BOND_STAT_RATIO = 0.15;

let threadInventories = new WeakMap<PersistentModifier[], { length: number; threads: DestinyKnotModifier[] }>();
let statRefreshDepth = 0;

/** Inventory mutation paths invalidate same-length replacements; simple appends also self-invalidate. */
export function invalidateThreadInventories(): void {
  threadInventories = new WeakMap();
}

function getThreads(owner: PlayerIndex): DestinyKnotModifier[] {
  const inventory = globalScene.getPlayerModifiers(owner);
  const cached = threadInventories.get(inventory);
  if (cached?.length === inventory.length) {
    return cached.threads;
  }
  const threads = inventory.filter(isDestinyKnot);
  threadInventories.set(inventory, { length: inventory.length, threads });
  return threads;
}

function hasThreads(): boolean {
  return !!globalScene && globalScene.getActivePlayerIndexes().some(owner => getThreads(owner).length > 0);
}

function getPokemonThreads(pokemon: Pokemon): DestinyKnotModifier[] {
  const owner = globalScene.getPlayerIndexForPokemon(pokemon);
  return owner === undefined
    ? []
    : getThreads(owner).filter(item => item.pokemonId === pokemon.id && item.stackCount > 0);
}

export function isSoulBondStatRefreshDeferred(): boolean {
  return statRefreshDepth > 0;
}

/** Rebuild all raw stats in a batch before rescaling either endpoint, so iteration order cannot lose HP. */
export function withSoulBondStatRefresh<T>(calculate: () => T): T {
  if (statRefreshDepth > 0 || isHeldItemSuppressionForecast() || !hasThreads()) {
    return calculate();
  }
  const snapshots = globalScene
    .getActivePlayerIndexes()
    .flatMap(owner => globalScene.getPlayerParty(owner))
    .map(pokemon => ({
      pokemon,
      hp: pokemon.hp,
      maxHp: pokemon.stats[Stat.HP] + pokemon.soulBondHpBonus,
      bonus: pokemon.soulBondHpBonus,
    }));
  statRefreshDepth++;
  try {
    return calculate();
  } finally {
    statRefreshDepth--;
    for (const { pokemon, hp, maxHp, bonus } of snapshots) {
      const newBonus = getSoulBondStatBonus(pokemon, Stat.HP);
      if (!bonus && !newBonus) {
        continue;
      }
      pokemon.soulBondHpBonus = newBonus;
      const newMax = pokemon.stats[Stat.HP] + newBonus;
      pokemon.hp = hp <= 0 ? 0 : Math.max(1, Math.min(newMax, Math.floor((hp * newMax) / maxHp)));
    }
  }
}

export function isThreadColor(color: unknown): color is ThreadColor {
  return THREAD_COLORS.includes(color as ThreadColor);
}

// Structural checks keep the modifier/stat dependency graph free of runtime class cycles.
export function isDestinyKnot(item: { type?: { id: string } }): item is DestinyKnotModifier {
  return item.type?.id === "DESTINY_KNOT";
}

export function getThreadParty(playerIndex: PlayerIndex): Pokemon[] {
  const owners =
    globalScene.twoPlayerMode && !globalScene.twoPlayerVsMode ? globalScene.getActivePlayerIndexes() : [playerIndex];
  return owners.flatMap(owner => globalScene.getPlayerParty(owner));
}

function getOwnedThreads(pokemon: Pokemon): { color: ThreadColor; item?: PokemonHeldItemModifier }[] {
  return [
    ...getPokemonThreads(pokemon).map(item => ({ color: item.color, item })),
    ...pokemon.battleData.removedHeldItems
      .filter(data => data.typeId === "DESTINY_KNOT" && isThreadColor(data.typePregenArgs?.[0]))
      .map(data => ({ color: data.typePregenArgs[0] as ThreadColor })),
  ];
}

/** Rechecked at acquisition and transfer, not just when the reward was generated. */
export function canReceiveThread(
  pokemon: Pokemon,
  color: ThreadColor,
  transferring?: PokemonHeldItemModifier,
): boolean {
  const owner = globalScene.getPlayerIndexForPokemon(pokemon);
  if (!pokemon.isPlayer() || owner === undefined || !isThreadColor(color)) {
    return false;
  }
  if (getOwnedThreads(pokemon).some(thread => !transferring || thread.item !== transferring)) {
    return false;
  }
  return canStoreThread(owner, color, transferring);
}

/** Bag acquisition reserves a pair slot without requiring an available holder. */
export function canStoreThread(owner: PlayerIndex, color: ThreadColor, transferring?: PokemonHeldItemModifier): boolean {
  if (!isThreadColor(color)) {
    return false;
  }
  const count = getThreadParty(owner)
    .flatMap(getOwnedThreads)
    .filter(thread => thread.color === color && (!transferring || thread.item !== transferring)).length;
  const owners = globalScene.twoPlayerMode && !globalScene.twoPlayerVsMode ? globalScene.getActivePlayerIndexes() : [owner];
  const storedCount = owners.flatMap(index => globalScene.getPlayerBag(index)).filter(isDestinyKnot)
    .filter(item => item.color === color)
    .reduce((total, item) => total + item.stackCount - (item === transferring ? 1 : 0), 0);
  return count + storedCount < 2;
}

export function getAvailableThreadColors(party: readonly Pokemon[]): ThreadColor[] {
  return THREAD_COLORS.filter(color => party.some(pokemon => canReceiveThread(pokemon, color)));
}

export function bothHoldThreads(a: Pokemon, b: Pokemon): boolean {
  return getOwnedThreads(a).length > 0 && getOwnedThreads(b).length > 0;
}

/** Faint handling may look up the pair after HP reaches zero, but before faint cleanup. */
export function getSoulBondPartner(pokemon: Pokemon, allowFainted = false): Pokemon | undefined {
  if (!pokemon.isPlayer() || !hasThreads()) {
    return;
  }
  const owner = globalScene.getPlayerIndexForPokemon(pokemon);
  if (!pokemon.isPlayer() || owner === undefined || areHeldItemEffectsSuppressed(pokemon)) {
    return;
  }
  const thread = getPokemonThreads(pokemon)[0];
  if (!thread || (!allowFainted && pokemon.isFainted())) {
    return;
  }
  const holders = getThreadParty(owner).filter(p => getPokemonThreads(p).some(item => item.color === thread.color));
  if (holders.length !== 2) {
    return;
  }
  const partner = holders.find(p => p !== pokemon);
  return partner && !areHeldItemEffectsSuppressed(partner) && (allowFainted || !partner.isFainted())
    ? partner
    : undefined;
}

export function getSoulBondStatBonus(pokemon: Pokemon, stat: PermanentStat): number {
  // The existing one-HP rule must not be bypassed by a bond.
  if (stat === Stat.HP && pokemon.stats?.[Stat.HP] === 1) {
    return 0;
  }
  const partner = getSoulBondPartner(pokemon);
  // stats contains only calculated unbonded values: never read the partner's getStat here.
  return Math.floor((partner?.stats?.[stat] ?? 0) * SOUL_BOND_STAT_RATIO);
}

/** Preserve health percentage when the max-HP contribution changes, without healing on re-equipping. */
export function refreshSoulBondHp(pokemon: Pokemon): void {
  if (isHeldItemSuppressionForecast() || statRefreshDepth > 0) {
    return;
  }
  const baseMax = pokemon.stats?.[Stat.HP];
  if (!baseMax || pokemon.hp === undefined) {
    return;
  }
  const bonus = getSoulBondStatBonus(pokemon, Stat.HP);
  const previous = pokemon.soulBondHpBonus;
  if (bonus === previous) {
    return;
  }
  pokemon.soulBondHpBonus = bonus;
  pokemon.hp =
    pokemon.hp <= 0
      ? 0
      : Math.max(1, Math.min(baseMax + bonus, Math.floor((pokemon.hp * (baseMax + bonus)) / (baseMax + previous))));
}

export function refreshSoulBondHpForParties(): void {
  if (!globalScene || isHeldItemSuppressionForecast() || statRefreshDepth > 0) {
    return;
  }
  for (const owner of globalScene.getActivePlayerIndexes()) {
    for (const pokemon of globalScene.getPlayerParty(owner)) {
      refreshSoulBondHp(pokemon);
    }
  }
}

/** Equal absolute HP, returning capped overflow and the odd point to available capacity. */
export function splitSoulBondHp(hpA: number, maxA: number, hpB: number, maxB: number): [number, number] {
  const total = hpA + hpB;
  let a = Math.min(maxA, Math.floor(total / 2));
  let b = Math.min(maxB, Math.floor(total / 2));
  let remainder = total - a - b;
  // Prefer the original healthier holder for the odd point, so an unchanged pair stays unchanged.
  if (hpA >= hpB) {
    const restored = Math.min(maxA - a, remainder);
    a += restored;
    remainder -= restored;
    b += Math.min(maxB - b, remainder);
  } else {
    const restored = Math.min(maxB - b, remainder);
    b += restored;
    remainder -= restored;
    a += Math.min(maxA - a, remainder);
  }
  return [a, b];
}

export function redistributeSoulBondHp(): void {
  refreshSoulBondHpForParties();
  const handled = new Set<Pokemon>();
  for (const owner of globalScene.getActivePlayerIndexes()) {
    for (const pokemon of globalScene.getPlayerParty(owner)) {
      if (handled.has(pokemon)) {
        continue;
      }
      const partner = getSoulBondPartner(pokemon);
      if (!partner) {
        continue;
      }
      handled.add(pokemon);
      handled.add(partner);
      const [hp, partnerHp] = splitSoulBondHp(pokemon.hp, pokemon.getMaxHp(), partner.hp, partner.getMaxHp());
      // HP redistribution is neither attack damage nor a healing move; do not trigger their effects.
      pokemon.hp = hp;
      partner.hp = partnerHp;
      void pokemon.updateInfo(true);
      void partner.updateInfo(true);
    }
  }
}
