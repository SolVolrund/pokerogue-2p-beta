import { globalScene } from "#app/global-scene";
import { FieldPosition } from "#enums/field-position";
import { BattlePhase } from "#phases/battle-phase";

export class ToggleDoublePositionPhase extends BattlePhase {
  public readonly phaseName = "ToggleDoublePositionPhase";
  private double: boolean;

  constructor(double: boolean, private previousSlotCount?: number) {
    super();

    this.double = double;
  }

  start() {
    super.start();

    if (
      globalScene.twoPlayerMode
      && !(globalScene.twoPlayerEnemyPlayerMode && globalScene.multiplayerPlayerCount === 1)
      && this.previousSlotCount === undefined
      && !globalScene.currentBattle.horde
    ) {
      this.end();
      return;
    }

    const field = globalScene.getPlayerField().filter(p => p.isActive(true));
    const singleTeam = !globalScene.twoPlayerMode || (globalScene.twoPlayerEnemyPlayerMode && globalScene.multiplayerPlayerCount === 1);
    const singleSurvivor = singleTeam && globalScene.getPokemonAllowedInBattle().length === 1;
    if (singleSurvivor && field[0]?.getFieldIndex() > 0) {
      const party = globalScene.getPlayerParty();
      const index = field[0].getFieldIndex();
      [party[0], party[index]] = [party[index], party[0]];
    }
    const moves = field.map(pokemon => {
      const position = globalScene.currentBattle.horde?.playerPositions[pokemon.getFieldIndex()] ?? (!this.double || singleSurvivor
        ? FieldPosition.CENTER
        : pokemon.getFieldIndex() === 2
          ? FieldPosition.CENTER
          : pokemon.getFieldIndex() === 1
            ? FieldPosition.RIGHT
            : FieldPosition.LEFT);
      return pokemon.setFieldPosition(position, 500, this.previousSlotCount);
    });
    void Promise.all(moves).then(() => this.end());
  }
}
