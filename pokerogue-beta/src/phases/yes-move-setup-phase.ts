import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import type { BattlerIndex } from "#enums/battler-index";
import { MoveId } from "#enums/move-id";
import type { MoveUseMode } from "#enums/move-use-mode";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import { PokemonPhase } from "#phases/pokemon-phase";
import { PartyUiHandler, PartyUiMode } from "#ui/party-ui-handler";
import { getYesRevivalCandidates, prepareYesField, reviveForYes } from "#utils/yes-move";

/** Owns the optional party-selection pause before resuming the ordinary damage pipeline. */
export class YesMoveSetupPhase extends PokemonPhase {
  public readonly phaseName = "YesMoveSetupPhase";
  private readonly user: Pokemon;
  private readonly targets: BattlerIndex[];
  private readonly useMode: MoveUseMode;

  constructor(user: Pokemon, targets: BattlerIndex[], useMode: MoveUseMode) {
    super(user.getBattlerIndex());
    this.user = user;
    this.targets = targets;
    this.useMode = useMode;
  }

  override start(): void {
    super.start();
    const user = this.user;
    if (!user.isActive(true)) {
      this.end();
      return;
    }
    // Freeze eligibility before any part of this move can cause a new faint.
    const candidates = getYesRevivalCandidates(user);
    prepareYesField(user, globalScene.getField()[this.targets[0]]);
    const resume = () => {
      globalScene.phaseManager.unshiftNew(
        "MoveEffectPhase",
        user.getBattlerIndex(),
        this.targets,
        allMoves[MoveId.YES],
        this.useMode,
        true,
      );
      this.end();
    };
    if (candidates.length === 0) {
      resume();
      return;
    }
    if (!user.isPlayer()) {
      reviveForYes(user, candidates[user.randBattleSeedInt(candidates.length)]);
      resume();
      return;
    }
    const playerIndex =
      globalScene.getPlayerIndexForPokemon(user) ?? globalScene.getPlayerIndexForFieldSlot(user.getFieldIndex());
    const party = globalScene.getPlayerParty(playerIndex);
    if (globalScene.twoPlayerMode) {
      globalScene.waitForPlayerInput(playerIndex);
    }
    globalScene.ui.setMode(
      UiMode.PARTY,
      PartyUiMode.REVIVAL_BLESSING,
      user.getFieldIndex(),
      (slotIndex: number) => {
        const chosen = party[slotIndex];
        if (chosen && candidates.some(p => p.id === chosen.id)) {
          reviveForYes(user, chosen);
        }
        globalScene.ui.setMode(UiMode.MESSAGE).then(resume);
      },
      (pokemon: PlayerPokemon) =>
        candidates.some(p => p.id === pokemon.id)
          ? PartyUiHandler.FilterFainted(pokemon)
          : PartyUiHandler.NoEffectMessage,
    );
  }
}
