import { globalScene } from "#app/global-scene";
import { getHordePlayerPositions, HORDE_ENEMY_POSITIONS, HORDE_POSITION_COLUMNS } from "#data/horde-battle";
import { FieldPosition } from "#enums/field-position";
import type { Pokemon } from "#field/pokemon";

export function getRepositionPositions(pokemon: Pokemon): FieldPosition[] {
  const horde = globalScene.currentBattle?.horde;
  if (horde) {
    return pokemon.isPlayer() ? getHordePlayerPositions(horde.playerCount) : [...HORDE_ENEMY_POSITIONS];
  }
  return [FieldPosition.LEFT, FieldPosition.CENTER, FieldPosition.RIGHT];
}

/** Re-form only after a team is eliminated, not when its active Pokemon needs a replacement. */
export async function reformHordePlayers(): Promise<void> {
  const horde = globalScene.currentBattle?.horde;
  if (!horde) {
    return;
  }
  const slots = globalScene
    .getPlayerFieldOwners()
    .flatMap((owner, slot) => (globalScene.hasPlayerUsablePokemonOrEonFlute(owner) ? [slot] : []));
  if (slots.length === 0 || slots.join() === horde.playerFieldSlots.join()) {
    return;
  }
  const pokemon = slots.map(slot => globalScene.getPlayerPokemonForFieldSlot(slot));
  const previousCount = horde.playerCount;
  const visualOrder = [...slots].sort(
    (a, b) => HORDE_POSITION_COLUMNS[horde.playerPositions[a]] - HORDE_POSITION_COLUMNS[horde.playerPositions[b]],
  );
  const formation = [...getHordePlayerPositions(slots.length)].sort(
    (a, b) => HORDE_POSITION_COLUMNS[a] - HORDE_POSITION_COLUMNS[b],
  );
  horde.playerFieldSlots = slots;
  horde.playerCount = slots.length;
  await Promise.all(
    pokemon.map((p, i) => {
      const position = formation[visualOrder.indexOf(slots[i])];
      horde.playerPositions[slots[i]] = position;
      if (!p?.isOnField()) {
        return Promise.resolve();
      }
      return p.setFieldPosition(position, 250, previousCount);
    }),
  );
}
