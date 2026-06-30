import { audioManager } from "#app/global-audio-manager";
import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { ChallengeType } from "#enums/challenge-type";
import { BattlePhase } from "#phases/battle-phase";
import { applyChallenges } from "#utils/challenge-utils";
import { BooleanHolder } from "#utils/common";

export class PartyHealPhase extends BattlePhase {
  public readonly phaseName = "PartyHealPhase";
  private resumeBgm: boolean;
  private playerIndex: PlayerIndex | undefined;

  constructor(resumeBgm: boolean, playerIndex?: PlayerIndex) {
    super();

    this.resumeBgm = resumeBgm;
    this.playerIndex = playerIndex;
  }

  start() {
    super.start();

    audioManager.fadeOutBgm(1000, false, !this.resumeBgm);
    globalScene.ui.fadeOut(1000).then(() => {
      const preventRevive = new BooleanHolder(false);
      applyChallenges(ChallengeType.PREVENT_REVIVE, preventRevive);
      const playerIndexes: Array<PlayerIndex | undefined> =
        this.playerIndex == null && globalScene.twoPlayerMode
          ? globalScene.getActivePlayerIndexes()
          : [this.playerIndex];
      for (const playerIndex of playerIndexes) {
        for (const pokemon of globalScene.getPlayerParty(playerIndex)) {
          // Prevent reviving fainted pokemon during certain challenges
          if (pokemon.isFainted() && preventRevive.value) {
            continue;
          }

          pokemon.hp = pokemon.getMaxHp();
          pokemon.resetStatus(true, false, false, true);
          for (const move of pokemon.moveset) {
            move.ppUsed = 0;
          }
          pokemon.updateInfo(true);
        }
      }

      const healSound = this.resumeBgm
        ? audioManager.replaceBgmUntilEnd("bw/heal")
        : audioManager.playBgm("bw/heal", false, false);
      if (healSound == null) {
        this.end();
      } else {
        healSound.onEnd(() => this.end());
      }
    });
    globalScene.arena.resetPlayerTerasUsed();
  }

  public override end() {
    globalScene.ui.fadeIn(500).then(() => super.end());
  }
}
