import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { getPokeballTintColor } from "#data/pokeball";
import { FieldPosition } from "#enums/field-position";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import { FieldPhase } from "#phases/field-phase";
import i18next from "i18next";

export class EonFluteSummonPhase extends FieldPhase {
  public readonly phaseName = "EonFluteSummonPhase";

  constructor(private readonly playerIndex: PlayerIndex) {
    super();
  }

  start(): void {
    super.start();

    if (globalScene.hasPlayerUsablePokemon(this.playerIndex) || !globalScene.hasEonFluteProtection(this.playerIndex)) {
      this.end();
      return;
    }

    const pokemon = globalScene.createEonFluteGuest(this.playerIndex);
    if (pokemon.isFainted()) {
      this.end();
      return;
    }

    void pokemon.loadAssets().then(() => {
      globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
        globalScene.ui.showText(
          i18next.t(globalScene.isLegendaryHelperGuest(pokemon) ? "battle:glassBallSummon" : "battle:eonFluteSummon", {
            pokemonName: getPokemonNameWithAffix(pokemon),
          }),
          null,
          () => this.summon(pokemon),
          0,
          true,
        );
      });
    });
  }

  private summon(pokemon: PlayerPokemon): void {
    this.hideCoveredTrainerSprite();

    const fieldIndex = globalScene.getEonFluteFieldIndex(this.playerIndex);
    const playerFieldSlotCount = globalScene.twoPlayerMode
      ? globalScene.getPlayerFieldOwners().length
      : globalScene.currentBattle.double
        ? 2
        : 1;
    const fieldSlotCount = globalScene.twoPlayerMode ? playerFieldSlotCount : globalScene.currentBattle.getBattlerCount();

    applyAbAttrs("PreSummonAbAttr", { pokemon });

    pokemon.setPosition(106, 148);
    if (fieldSlotCount > 2 && fieldIndex === 2) {
      pokemon.setFieldPosition(FieldPosition.CENTER, 0);
    } else if (fieldIndex === 1) {
      pokemon.setFieldPosition(FieldPosition.RIGHT, 0);
    } else {
      pokemon.setFieldPosition(
        !globalScene.currentBattle.double || playerFieldSlotCount === 1 ? FieldPosition.CENTER : FieldPosition.LEFT,
      );
    }

    const [offsetX, offsetY] = pokemon.getFieldPositionOffset();
    pokemon.setPosition(106 + offsetX, 148 + offsetY);
    pokemon.switchOutStatus = false;
    pokemon.setVisible(true);
    pokemon.getSprite().setVisible(true);
    pokemon.setAlpha(0);
    pokemon.setScale(0.5);
    pokemon.tint(getPokeballTintColor(pokemon.getPokeball(true)));

    globalScene.add.existing(pokemon);
    globalScene.field.add(pokemon);
    globalScene.updateFieldDepthOrder();
    globalScene.updateModifiers(true, undefined, this.playerIndex);
    globalScene.updateFieldScale();
    pokemon.showInfo();
    pokemon.playAnim();
    pokemon.untint(250, "Sine.easeIn");

    globalScene.tweens.add({
      targets: pokemon,
      alpha: 1,
      duration: 250,
      ease: "Sine.easeIn",
    });
    globalScene.tweens.add({
      targets: pokemon,
      duration: 250,
      ease: "Sine.easeIn",
      scale: pokemon.getSpriteScale(),
      onComplete: () => {
        pokemon.cry(pokemon.getHpRatio() > 0.25 ? undefined : { rate: 0.85 });
        pokemon.getSprite().clearTint();
        pokemon.fieldSetup();
        pokemon.turnData.summonedThisTurn = true;
        globalScene.updateFieldScale();
        globalScene.time.delayedCall(500, () => this.end());
      },
    });
  }

  private hideCoveredTrainerSprite(): void {
    const trainerSprite = globalScene.getPlayerTrainerBackSprite(this.playerIndex);
    globalScene.tweens.killTweensOf(trainerSprite);
    trainerSprite.setVisible(false);
  }
}
