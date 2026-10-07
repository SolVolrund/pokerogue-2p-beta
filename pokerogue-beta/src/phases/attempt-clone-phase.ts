import type { PlayerIndex } from "#app/battle-scene";
import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";
import { getPokeballAtlasKey } from "#data/pokeball";
import { PokeballType } from "#enums/pokeball";
import { UiMode } from "#enums/ui-mode";
import type { Pokemon } from "#field/pokemon";
import { BattlePhase } from "#phases/battle-phase";
import { PartyUiMode } from "#ui/party-ui-handler";
import {
  createCloneBallCopy,
  getCloneBallHeldItems,
  getCloneBallTargets,
  getComputerPartnerCloneReplacement,
  keepCloneBallCopy,
} from "#utils/clone-ball";
import { getPlayerMessageOptions } from "#utils/player-messages";
import i18next from "i18next";

export class AttemptClonePhase extends BattlePhase {
  public readonly phaseName = "AttemptClonePhase";
  private readonly targetId: number;
  private readonly playerIndex: PlayerIndex;

  constructor(targetId: number, playerIndex: PlayerIndex = 0) {
    super();
    this.targetId = targetId;
    this.playerIndex = playerIndex;
  }

  public start(): void {
    super.start();
    const target = getCloneBallTargets(this.playerIndex).find(pokemon => pokemon.id === this.targetId);
    const balls = globalScene.getPlayerPokeballCounts(this.playerIndex);
    if (!target || !(balls[PokeballType.CLONE_BALL] > 0)) {
      this.end();
      return;
    }
    globalScene.setInputOwner("none");
    this.performClone(target);
  }

  private async performClone(target: Pokemon): Promise<void> {
    const previousPlayer = globalScene.activePlayerIndex;
    globalScene.setActivePlayerIndex(this.playerIndex);
    const pokemon = createCloneBallCopy(target);
    globalScene.setActivePlayerIndex(previousPlayer);
    const items = getCloneBallHeldItems(target);
    const isCpu = globalScene.isComputerPartnerPlayer(this.playerIndex);
    const replacement = isCpu ? getComputerPartnerCloneReplacement(this.playerIndex, pokemon) : undefined;
    if (isCpu && !replacement) {
      pokemon.destroy();
      this.end();
      return;
    }
    globalScene.getPlayerPokeballCounts(this.playerIndex)[PokeballType.CLONE_BALL]--;
    await this.animateClone(target);
    await globalScene.ui.setMode(UiMode.MESSAGE);
    if (isCpu) {
      globalScene.waitForPlayerSideProgressionInput();
    } else {
      globalScene.waitForPlayerInput(this.playerIndex);
    }
    const finish = () => {
      globalScene.currentBattle.lastUsedPokeball = PokeballType.CLONE_BALL;
      this.end();
    };
    const keep = async (index?: number, insertionIndex?: number) => {
      await keepCloneBallCopy(pokemon, items, this.playerIndex, index, insertionIndex);
      finish();
    };
    globalScene.ui.showText(
      i18next.t("battle:pokemonCloned", {
        ...getPlayerMessageOptions(this.playerIndex),
        pokemonName: target.getNameToRender(),
      }),
      null,
      () => {
        if (isCpu) {
          keep(replacement?.replacedPokemonIndex);
        } else if (globalScene.isPlayerPartyFull(this.playerIndex)) {
          globalScene.waitForPlayerInput(this.playerIndex);
          globalScene.ui.showText(
            i18next.t("battle:partyFull", {
              ...getPlayerMessageOptions(this.playerIndex),
              pokemonName: pokemon.getNameToRender(),
            }),
            null,
            () => {
              const fieldIndex = globalScene.getPlayerFieldOwners().indexOf(this.playerIndex);
              globalScene.ui.setMode(
                UiMode.PARTY,
                PartyUiMode.RELEASE,
                fieldIndex < 0 ? this.playerIndex : fieldIndex,
                (slotIndex: number) => {
                  globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
                    if (slotIndex < 0 || slotIndex >= globalScene.getPlayerPartyLimit(this.playerIndex)) {
                      pokemon.destroy();
                      finish();
                    } else {
                      // The party menu has already released the selected Pokemon.
                      keep(undefined, slotIndex);
                    }
                  });
                },
              );
            },
            0,
            true,
          );
        } else {
          keep();
        }
      },
      0,
      true,
    );
  }

  private animateClone(target: Pokemon): Promise<void> {
    const thrower = globalScene
      .getPlayerField(true)
      .find(p => globalScene.getPlayerIndexForPokemon(p) === this.playerIndex);
    const atlasKey = getPokeballAtlasKey(PokeballType.CLONE_BALL);
    const ball = globalScene.addFieldSprite(thrower?.x ?? 16, (thrower?.y ?? 104) - 24, "pb", atlasKey);
    globalScene.field.add(ball);
    audioManager.playSound("se/pb_throw");
    return new Promise(resolve => {
      globalScene.tweens.add({
        targets: ball,
        x: target.x,
        y: target.y - 24,
        duration: 500,
        ease: "Sine.easeOut",
        onComplete: () => {
          ball.setTexture("pb", `${atlasKey}_open`);
          audioManager.playSound("se/pb_rel");
          globalScene.animations.addPokeballOpenParticles(ball.x, ball.y, PokeballType.CLONE_BALL);
          globalScene.time.delayedCall(500, () => {
            audioManager.playSound("se/pb_lock");
            ball.destroy();
            resolve();
          });
        },
      });
    });
  }
}
