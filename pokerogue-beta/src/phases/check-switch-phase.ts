import { globalScene } from "#app/global-scene";
import type { PlayerIndex } from "#app/battle-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { BattleStyle } from "#enums/battle-style";
import { BattleType } from "#enums/battle-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { SwitchType } from "#enums/switch-type";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import { BattlePhase } from "#phases/battle-phase";
import { getComputerPartnerImprovedSwitchIndex, isComputerPartnerFieldIndex } from "#utils/computer-partner-ai";
import i18next from "i18next";

type OpeningPicks = Map<number, { leadId: number; reserveId: number }>;

function cannotSwitch(pokemon: PlayerPokemon): boolean {
  return !!pokemon.getTag(BattlerTagType.FRENZY) || pokemon.isTrapped()
    || globalScene.getPlayerField().some(p => p.getTag(BattlerTagType.COMMANDED));
}

/** Collect choices after the summons, then let the original checks execute them in field order. */
export function queueMultiplayerOpeningSwitches(): void {
  const scene = globalScene;
  const owners = scene.getPlayerFieldOwners();
  const fields = owners.flatMap((owner, i) => scene.getPokemonAllowedInBattle(owner).length > 1 ? [i] : []);
  if (!fields.length) return;
  const players = scene.getActivePlayerIndexes();
  let picks: OpeningPicks | undefined;
  if (scene.privateTurnSelection && scene.uiInputs?.privateOpeningSwitchEnabled && scene.uiInputs.privateContestSeats === players.length
    && scene.battleStyle !== BattleStyle.SET && scene.currentBattle.battleType === BattleType.WILD
    && !scene.twoPlayerVsMode && !scene.twoPlayerEnemyPlayerMode && !scene.currentBattle.mysteryEncounter && !scene.currentBattle.horde
    && owners.length === players.length && players.every(p => owners.includes(p) && !scene.isComputerPartnerPlayer(p))) {
    const agreed: OpeningPicks = new Map();
    picks = agreed;
    const legal = (seat: PlayerIndex): number[] => {
      const field = owners.indexOf(seat);
      const lead = scene.getPlayerPokemonForFieldSlot(field);
      if (!fields.includes(field) || !lead || !scene.field.getAll().includes(lead) || cannotSwitch(lead)) return [-1];
      return [-1, ...scene.getPlayerParty(seat).slice(scene.getPlayerActiveSlotCount(seat))
        .filter(p => p.isAllowedInBattle() && !p.isOnField()).map(p => p.id)];
    };
    scene.phaseManager.pushNew("PrivateRegistrationPhase", {
      name: "opening-switch",
      legal,
      openingSwitch: seat => {
        const fieldIndex = owners.indexOf(seat);
        return { fieldIndex, question: i18next.t("battle:switchQuestion", {
          pokemonName: getPokemonNameWithAffix(scene.getPlayerPokemonForFieldSlot(fieldIndex)!),
        }) };
      },
      queueCommit: choices => {
        for (const field of fields) {
          const lead = scene.getPlayerPokemonForFieldSlot(field);
          if (lead) agreed.set(field, { leadId: lead.id, reserveId: choices[owners[field]] });
        }
      },
      queueSequential: () => agreed.clear(),
    });
  }
  for (const field of fields) {
    if (picks) scene.phaseManager.pushNew("CheckSwitchPhase", field, true, picks);
    else scene.phaseManager.pushNew("CheckSwitchPhase", field, true);
  }
}

export class CheckSwitchPhase extends BattlePhase {
  public readonly phaseName = "CheckSwitchPhase";
  protected fieldIndex: number;
  protected useName: boolean;

  constructor(fieldIndex: number, useName: boolean, private readonly openingPicks?: OpeningPicks) {
    super();

    this.fieldIndex = fieldIndex;
    this.useName = useName;
  }

  private getPlayerPokemon(): PlayerPokemon | undefined {
    const fieldPokemon = globalScene.getPlayerPokemonForFieldSlot(this.fieldIndex);
    if (fieldPokemon) {
      return fieldPokemon;
    }

    const battlerPokemon = globalScene.getField()[this.fieldIndex];
    return battlerPokemon?.isPlayer() ? (battlerPokemon as PlayerPokemon) : undefined;
  }

  start() {
    super.start();

    const pokemon = this.getPlayerPokemon();
    if (pokemon) {
      this.fieldIndex = pokemon.getFieldIndex();
    }

    const playerIndex = pokemon
      ? globalScene.getPlayerIndexForPokemon(pokemon) ?? globalScene.getPlayerIndexForFieldSlot(this.fieldIndex)
      : globalScene.getPlayerIndexForFieldSlot(this.fieldIndex);
    const activePartySlotCount = globalScene.getPlayerActiveSlotCount(playerIndex);

    // End this phase early...

    // ...if the user is playing in Set Mode
    if (globalScene.battleStyle === BattleStyle.SET) {
      this.end();
      return;
    }

    // ...if the checked Pokemon is somehow not on the field
    if (!pokemon || globalScene.field.getAll().indexOf(pokemon) === -1) {
      globalScene.phaseManager.unshiftNew("SummonMissingPhase", this.fieldIndex);
      return super.end();
    }

    // ...if there are no other allowed Pokemon in the player's party to switch with
    if (
      globalScene
        .getPlayerParty(playerIndex)
        .slice(activePartySlotCount)
        .filter(p => p.isActive()).length === 0
    ) {
      this.end();
      return;
    }

    // ...or if any player Pokemon has an effect that prevents the checked Pokemon from switching
    if (cannotSwitch(pokemon)) {
      this.end();
      return;
    }

    const pick = this.openingPicks?.get(this.fieldIndex);
    if (pick?.leadId === pokemon.id) {
      if (pick.reserveId === -1) return this.end();
      const slot = globalScene.getPlayerParty(playerIndex).findIndex((p, i) =>
        i >= activePartySlotCount && p.id === pick.reserveId && p.isAllowedInBattle() && !p.isOnField());
      if (slot >= 0) {
        globalScene.phaseManager.unshiftNew("SwitchSummonPhase", SwitchType.INITIAL_SWITCH, this.fieldIndex, slot, true);
        return this.end();
      }
      // An earlier switch's entry effects changed the field. Ask this seat again.
    }
    if (isComputerPartnerFieldIndex(this.fieldIndex)) {
      const switchIndex = getComputerPartnerImprovedSwitchIndex(this.fieldIndex);
      if (switchIndex !== undefined) {
        globalScene.ui.setMode(UiMode.MESSAGE);
        globalScene.phaseManager.unshiftNew(
          "SwitchSummonPhase",
          SwitchType.INITIAL_SWITCH,
          this.fieldIndex,
          switchIndex,
          true,
        );
      }
      this.end();
      return;
    }

    if (globalScene.twoPlayerMode) {
      globalScene.waitForPlayerInput(playerIndex);
    }

    globalScene.ui.showText(
      i18next.t("battle:switchQuestion", {
        pokemonName: this.useName ? getPokemonNameWithAffix(pokemon) : i18next.t("battle:pokemon"),
      }),
      null,
      () => {
        if (globalScene.twoPlayerMode) {
          globalScene.waitForPlayerInput(playerIndex);
        }
        globalScene.ui.setMode(
          UiMode.CONFIRM,
          () => {
            globalScene.ui.setMode(UiMode.MESSAGE);
            globalScene.phaseManager.unshiftNew("SwitchPhase", SwitchType.INITIAL_SWITCH, this.fieldIndex, false, true);
            this.end();
          },
          () => {
            globalScene.ui.setMode(UiMode.MESSAGE);
            this.end();
          },
        );
      },
    );
  }
}
