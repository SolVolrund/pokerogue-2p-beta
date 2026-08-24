import { globalScene } from "#app/global-scene";
import { getContestSpectacularEffect } from "#data/contests/contest-spectacular-effects";
import { getContestSpectacularMove } from "#data/contests/contest-spectacular-moves";
import { FusionOptions, type FusionComponent, type FusionNatureMode, type FusionTypeSlot } from "#data/fusion-options";
import { getNatureName, getNatureStatMultiplier } from "#data/nature";
import { getTypeRgb } from "#data/type";
import { Button } from "#enums/buttons";
import { MoveCategory } from "#enums/move-category";
import type { Nature } from "#enums/nature";
import { PokemonType } from "#enums/pokemon-type";
import { getStatKey, PERMANENT_STATS, type PermanentStat, Stat } from "#enums/stat";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { addTextObject } from "#ui/text";
import type { PokemonSelectFilter } from "#ui/party-ui-handler";
import { UiHandler } from "#ui/ui-handler";
import { getLocalizedSpriteKey } from "#utils/common";
import i18next from "i18next";

enum FusionSummaryPage {
  SPRITE,
  STATUS,
  STATS,
  MOVES,
}

export type FusionSummaryCallback = (
  bodySlotIndex?: number,
  donorSlotIndex?: number,
  fusionOptions?: FusionOptions,
) => void;

const PAGE_TITLES = ["SPRITE", "STATUS", "STATS", "MOVES"] as const;
const PAGE_TRANSITION_DURATION = 1500;
const STATS_LEFT_TRANSITION_DELAY_RATIO = 0.50;
type FusionSummaryTransitionRole =
  | "body"
  | "footer"
  | "stats-flyout"
  | "stats-left"
  | "stats-right"
  | "moves-left"
  | "moves-center"
  | "moves-right";

export class FusionSummaryUiHandler extends UiHandler {
  private fusionContainer: Phaser.GameObjects.Container;
  private pageContainer: Phaser.GameObjects.Container;
  private pageTransitionContainer: Phaser.GameObjects.Container;
  private renderTargetContainer: Phaser.GameObjects.Container;
  private renderLayerContainers: Partial<Record<FusionSummaryTransitionRole, Phaser.GameObjects.Container>> = {};
  private headerText: Phaser.GameObjects.Text;
  private pageTitleText: Phaser.GameObjects.Text;

  private party: PlayerPokemon[] = [];
  private eligibleSlotIndexes: number[] = [];
  private selectFilter: PokemonSelectFilter | null = null;
  private selectCallback: FusionSummaryCallback | null = null;

  private bodySlotIndex = 0;
  private donorSlotIndex = 1;
  private statBodySlotIndex = 0;
  private statDonorSlotIndex = 1;

  private p1TypeChoice = 0;
  private p2TypeChoice = 0;
  private teraChoice = 0;
  private abilityChoice = 0;
  private natureChoice = 0;
  private passiveChoice = 0;

  private moveColumn = 0;
  private moveRow = 0;
  private pendingMove: Move | null = null;
  private pendingMoveSourceColumn: number | null = null;
  private pendingMoveSourceRow: number | null = null;
  private fusionMoveSlots: (Move | null)[] = [null, null, null, null];
  private renderRevision = 0;
  private renderingPage = FusionSummaryPage.SPRITE;
  private transitioning = false;

  constructor() {
    super(UiMode.FUSION_SUMMARY);
  }

  setup(): void {
    const ui = this.getUi();

    this.fusionContainer = globalScene.add.container(0, -globalScene.scaledCanvas.height);
    this.fusionContainer.setName("fusion-summary");
    this.fusionContainer.setVisible(false);
    ui.add(this.fusionContainer);

    const bg = globalScene.add.image(0, 0, "fusion_summary_bg");
    bg.setOrigin(0, 0);
    this.fusionContainer.add(bg);

    this.pageContainer = globalScene.add.container(0, 0);
    this.fusionContainer.add(this.pageContainer);
    this.renderTargetContainer = this.pageContainer;

    this.pageTransitionContainer = globalScene.add.container(0, 0);
    this.pageTransitionContainer.setVisible(false);
    this.fusionContainer.add(this.pageTransitionContainer);

    this.headerText = addTextObject(4, 3, "Fusion Summary", TextStyle.SUMMARY_HEADER, { fontSize: "54px" });
    this.headerText.setOrigin(0, 0);
    this.fusionContainer.add(this.headerText);

    this.pageTitleText = addTextObject(54, 3, "<<SPRITE>>", TextStyle.SUMMARY_GREEN, { fontSize: "54px" });
    this.pageTitleText.setOrigin(0, 0);
    this.fusionContainer.add(this.pageTitleText);
  }

  show(
    args: [party: PlayerPokemon[], selectCallback: FusionSummaryCallback, selectFilter?: PokemonSelectFilter],
  ): boolean {
    super.show(args);

    this.party = args[0] ?? [];
    this.selectCallback = args[1] ?? null;
    this.selectFilter = args[2] ?? null;
    this.eligibleSlotIndexes = this.party
      .map((_pokemon, slotIndex) => slotIndex)
      .filter(slotIndex => this.isEligibleSlot(slotIndex));

    if (this.eligibleSlotIndexes.length < 2) {
      globalScene.time.delayedCall(1, () => this.finish(false));
      return true;
    }

    this.bodySlotIndex = this.eligibleSlotIndexes[0];
    this.donorSlotIndex =
      this.eligibleSlotIndexes.find(slotIndex => slotIndex !== this.bodySlotIndex) ?? this.eligibleSlotIndexes[1];
    this.statBodySlotIndex = this.bodySlotIndex;
    this.statDonorSlotIndex = this.donorSlotIndex;
    this.resetFusionMoveSlots();

    this.p1TypeChoice = 0;
    this.p2TypeChoice = 0;
    this.teraChoice = 0;
    this.abilityChoice = 0;
    this.natureChoice = 0;
    this.passiveChoice = 0;
    this.moveColumn = 0;
    this.moveRow = 0;
    this.clearPendingMove();

    globalScene.ui.bringToTop(this.fusionContainer);
    this.fusionContainer.setVisible(true);
    this.setCursor(FusionSummaryPage.SPRITE, true);

    return true;
  }

  processInput(button: Button): boolean {
    if (this.transitioning) {
      return false;
    }

    let success = false;
    let error = false;

    if (button === Button.ACTION) {
      if (this.cursor === FusionSummaryPage.MOVES) {
        success = this.processMoveAction();
      } else if (this.isSelectedFusionTypeless()) {
        error = true;
      } else {
        this.showFinishConfirmation(true);
        success = true;
      }
    } else if (button === Button.CANCEL) {
      if (this.pendingMove) {
        this.clearPendingMove();
        this.renderPage();
        success = true;
      } else {
        this.showFinishConfirmation(false);
        success = true;
      }
    } else {
      switch (this.cursor) {
        case FusionSummaryPage.SPRITE:
          success = this.processSpriteInput(button);
          break;
        case FusionSummaryPage.STATUS:
          success = this.processStatusInput(button);
          break;
        case FusionSummaryPage.STATS:
          success = this.processStatsInput(button);
          break;
        case FusionSummaryPage.MOVES:
          success = this.processMovesInput(button);
          break;
      }
    }

    if (success) {
      this.getUi().playSelect();
      this.broadcastTwoPlayerFusionCheckpoint("fusion-summary-input");
    } else if (error) {
      this.getUi().playError();
    }

    return success || error;
  }

  override setCursor(cursor: number, force = false): boolean {
    const changed = force || this.cursor !== cursor;
    if (changed) {
      const previousCursor = this.cursor as FusionSummaryPage;
      this.cursor = cursor;
      this.clearPendingMove();
      if (force || !this.pageContainer.visible) {
        this.renderPage(this.pageContainer, cursor);
        this.pageContainer.setVisible(true);
      } else {
        this.transitionToPage(previousCursor, cursor);
      }
    }
    return changed;
  }

  override clear(): void {
    super.clear();
    this.fusionContainer?.setVisible(false);
    this.pageContainer?.removeAll(true);
    this.pageTransitionContainer?.removeAll(true);
    this.pageTransitionContainer?.setVisible(false);
    this.pageContainer?.setPosition(0, 0);
    this.pageTransitionContainer?.setPosition(0, 0);
    this.transitioning = false;
    this.clearPendingMove();
  }

  getTwoPlayerInputContextState(): Record<string, unknown> {
    return this.getTwoPlayerFusionInputState();
  }

  getTwoPlayerInputContextPromptState(): Record<string, unknown> {
    return this.getTwoPlayerFusionInputState();
  }

  private getTwoPlayerFusionInputState(): Record<string, unknown> {
    return {
      page: this.cursor,
      eligibleSlotIndexes: this.eligibleSlotIndexes,
      bodySlotIndex: this.bodySlotIndex,
      donorSlotIndex: this.donorSlotIndex,
      statBodySlotIndex: this.statBodySlotIndex,
      statDonorSlotIndex: this.statDonorSlotIndex,
      p1TypeChoice: this.p1TypeChoice,
      p2TypeChoice: this.p2TypeChoice,
      teraChoice: this.teraChoice,
      abilityChoice: this.abilityChoice,
      natureChoice: this.natureChoice,
      passiveChoice: this.passiveChoice,
      moveColumn: this.moveColumn,
      moveRow: this.moveRow,
      pendingMoveId: this.pendingMove?.id ?? null,
      pendingMoveSourceColumn: this.pendingMoveSourceColumn,
      pendingMoveSourceRow: this.pendingMoveSourceRow,
      fusionMoveIds: this.fusionMoveSlots.map(move => move?.id ?? null),
    };
  }

  private broadcastTwoPlayerFusionCheckpoint(reason: string): void {
    if (!globalScene.twoPlayerMode) {
      return;
    }

    setTimeout(() => globalScene.uiInputs?.broadcastTwoPlayerCheckpoint(reason), 0);
  }

  private processSpriteInput(button: Button): boolean {
    switch (button) {
      case Button.DEV_CUSTOM:
      case Button.CYCLE_GENDER:
        this.cycleFusionSlot("body");
        return true;
      case Button.UP:
        this.swapSpriteSlots();
        return true;
      case Button.CYCLE_ABILITY:
        this.cycleFusionSlot("donor");
        return true;
      case Button.RIGHT:
        return this.setCursor(FusionSummaryPage.STATUS);
      case Button.CYCLE_FORM:
        return this.setCursor(FusionSummaryPage.STATUS);
      default:
        return false;
    }
  }

  private processStatusInput(button: Button): boolean {
    switch (button) {
      case Button.LEFT:
        return this.setCursor(FusionSummaryPage.SPRITE);
      case Button.RIGHT:
        return this.setCursor(FusionSummaryPage.STATS);
      case Button.DEV_CUSTOM:
      case Button.CYCLE_GENDER:
        return this.cycleFusionTypeChoice("body");
      case Button.UP:
        this.teraChoice = (this.teraChoice + 1) % 2;
        this.renderPage();
        return true;
      case Button.CYCLE_ABILITY:
        return this.cycleFusionTypeChoice("donor");
      case Button.CYCLE_SHINY:
        this.abilityChoice = (this.abilityChoice + 1) % 2;
        this.renderPage();
        return true;
      case Button.CYCLE_FORM:
      case Button.CYCLE_NATURE:
        this.natureChoice = (this.natureChoice + 1) % 3;
        this.renderPage();
        return true;
      case Button.CYCLE_TERA:
        this.passiveChoice = (this.passiveChoice + 1) % 2;
        this.renderPage();
        return true;
      default:
        return false;
    }
  }

  private processStatsInput(button: Button): boolean {
    switch (button) {
      case Button.LEFT:
        return this.setCursor(FusionSummaryPage.STATUS);
      case Button.RIGHT:
      case Button.CYCLE_FORM:
        return this.setCursor(FusionSummaryPage.MOVES);
      case Button.UP:
        [this.statBodySlotIndex, this.statDonorSlotIndex] = [this.statDonorSlotIndex, this.statBodySlotIndex];
        this.renderPage();
        return true;
      default:
        return false;
    }
  }

  private processMovesInput(button: Button): boolean {
    if (this.pendingMove) {
      switch (button) {
        case Button.UP:
          this.moveRow = this.moveRow === 0 ? 3 : this.moveRow - 1;
          this.renderPage();
          return true;
        case Button.DOWN:
          this.moveRow = this.moveRow === 3 ? 0 : this.moveRow + 1;
          this.renderPage();
          return true;
        default:
          return false;
      }
    }

    switch (button) {
      case Button.UP:
        this.moveRow = this.moveRow === 0 ? 3 : this.moveRow - 1;
        this.renderPage();
        return true;
      case Button.DOWN:
        this.moveRow = this.moveRow === 3 ? 0 : this.moveRow + 1;
        this.renderPage();
        return true;
      case Button.LEFT:
        if (this.moveColumn === 0) {
          return this.setCursor(FusionSummaryPage.STATS);
        }
        this.moveColumn--;
        this.renderPage();
        return true;
      case Button.RIGHT:
        if (this.moveColumn < 2) {
          this.moveColumn++;
          this.renderPage();
          return true;
        }
        return false;
      default:
        return false;
    }
  }

  private processMoveAction(): boolean {
    if (this.pendingMove) {
      this.fusionMoveSlots[this.moveRow] = this.pendingMove;
      this.clearPendingMove();
      this.moveColumn = 1;
      this.renderPage();
      return true;
    }

    if (this.moveColumn === 1) {
      this.fusionMoveSlots[this.moveRow] = null;
      this.renderPage();
      return true;
    }

    const sourceMove = this.getColumnMoves(this.moveColumn)[this.moveRow] ?? null;
    if (!sourceMove) {
      this.getUi().playError();
      return true;
    }

    this.pendingMove = sourceMove;
    this.pendingMoveSourceColumn = this.moveColumn;
    this.pendingMoveSourceRow = this.moveRow;
    this.moveColumn = 1;
    this.renderPage();
    return true;
  }

  private renderPage(pageContainer = this.pageContainer, page = this.cursor as FusionSummaryPage): void {
    if (!pageContainer) {
      return;
    }

    this.renderRevision++;
    this.renderTargetContainer = pageContainer;
    this.renderLayerContainers = {};
    this.renderingPage = page;
    pageContainer.removeAll(true);
    if (page === FusionSummaryPage.STATS) {
      this.createStatsTransitionLayers(pageContainer);
    }
    this.pageTitleText.setText(`<<${PAGE_TITLES[page]}>>`);

    switch (page) {
      case FusionSummaryPage.SPRITE:
        this.renderSpritePage();
        break;
      case FusionSummaryPage.STATUS:
        this.renderStatusPage();
        break;
      case FusionSummaryPage.STATS:
        this.renderStatsPage();
        break;
      case FusionSummaryPage.MOVES:
        this.renderMovesPage();
        break;
    }

    this.addFooterPrompts();
    this.orderPageTransitionObjects(pageContainer, page);
    this.renderLayerContainers = {};
    this.renderTargetContainer = this.pageContainer;
  }

  private createStatsTransitionLayers(container: Phaser.GameObjects.Container): void {
    (["stats-flyout", "stats-left", "body", "stats-right", "footer"] as const).forEach(role => {
      const layer = globalScene.add.container(0, 0);
      layer.setData("fusionSummaryTransitionRole", role);
      container.add(layer);
      this.renderLayerContainers[role] = layer;
    });
  }

  private transitionToPage(previousPage: FusionSummaryPage, nextPage: FusionSummaryPage): void {
    const navigationOffset = this.getPageTransitionOffset(previousPage, nextPage);
    const incomingPageContainer = this.pageTransitionContainer;
    const outgoingPageContainer = this.pageContainer;

    this.transitioning = true;
    this.renderPage(incomingPageContainer, nextPage);
    const transitionDuration = PAGE_TRANSITION_DURATION + Math.max(
      this.getMaxObjectTransitionDelay(previousPage),
      this.getMaxObjectTransitionDelay(nextPage),
    );
    incomingPageContainer.setPosition(0, 0);
    this.preparePageObjectsForTransition(incomingPageContainer, nextPage, navigationOffset);
    incomingPageContainer.setVisible(true);

    this.animatePageObjectsOut(outgoingPageContainer, previousPage, navigationOffset);

    globalScene.tweens.add({
      targets: incomingPageContainer,
      x: 0,
      y: 0,
      duration: transitionDuration,
      ease: "Cubic.easeOut",
      onComplete: () => {
        outgoingPageContainer.removeAll(true);
        outgoingPageContainer.setPosition(0, 0);
        outgoingPageContainer.setVisible(false);
        this.pageContainer = incomingPageContainer;
        this.pageTransitionContainer = outgoingPageContainer;
        this.pageTransitionContainer.setPosition(0, 0);
        this.pageTransitionContainer.setVisible(false);
        this.renderTargetContainer = this.pageContainer;
        this.transitioning = false;
        this.broadcastTwoPlayerFusionCheckpoint("fusion-summary-transition-complete");
      },
    });
  }

  private preparePageObjectsForTransition(
    container: Phaser.GameObjects.Container,
    page: FusionSummaryPage,
    navigationOffset: { x: number; y: number },
  ): void {
    container.each((object: Phaser.GameObjects.GameObject) => {
      const transform = object as Phaser.GameObjects.GameObject & { x: number; y: number };
      const role = this.getObjectTransitionRole(object);
      const offset = this.getObjectTransitionOffset(page, role, navigationOffset, true);
      transform.x += offset.x;
      transform.y += offset.y;
      globalScene.tweens.add({
        targets: object,
        x: transform.x - offset.x,
        y: transform.y - offset.y,
        delay: this.getObjectTransitionDelay(page, role, true),
        duration: PAGE_TRANSITION_DURATION,
        ease: "Cubic.easeOut",
      });
    });
  }

  private animatePageObjectsOut(
    container: Phaser.GameObjects.Container,
    page: FusionSummaryPage,
    navigationOffset: { x: number; y: number },
  ): void {
    container.each((object: Phaser.GameObjects.GameObject) => {
      const transform = object as Phaser.GameObjects.GameObject & { x: number; y: number };
      const role = this.getObjectTransitionRole(object);
      const offset = this.getObjectTransitionOffset(page, role, navigationOffset, false);
      globalScene.tweens.add({
        targets: object,
        x: transform.x + offset.x,
        y: transform.y + offset.y,
        delay: this.getObjectTransitionDelay(page, role, false),
        duration: PAGE_TRANSITION_DURATION,
        ease: "Cubic.easeOut",
      });
    });
  }

  private orderPageTransitionObjects(container: Phaser.GameObjects.Container, page: FusionSummaryPage): void {
    if (page !== FusionSummaryPage.STATS) {
      return;
    }

    const children = container.getAll();
    container.removeAll(false);
    children
      .sort((a, b) => this.getStatsTransitionLayer(a) - this.getStatsTransitionLayer(b))
      .forEach(child => container.add(child));
  }

  private getStatsTransitionLayer(object: Phaser.GameObjects.GameObject): number {
    switch (this.getObjectTransitionRole(object)) {
      case "stats-flyout":
        return 0;
      case "stats-left":
        return 1;
      case "body":
        return 2;
      case "stats-right":
        return 3;
      case "footer":
        return 4;
      default:
        return 3;
    }
  }

  private getObjectTransitionRole(object: Phaser.GameObjects.GameObject): FusionSummaryTransitionRole {
    return object.getData("fusionSummaryTransitionRole") ?? "body";
  }

  private getObjectTransitionOffset(
    page: FusionSummaryPage,
    role: FusionSummaryTransitionRole,
    navigationOffset: { x: number; y: number },
    entering: boolean,
  ): { x: number; y: number } {
    if (role === "footer") {
      return { x: 320, y: 0 };
    }

    if (page === FusionSummaryPage.SPRITE || page === FusionSummaryPage.STATUS) {
      return { x: 0, y: 180 };
    }

    if (page === FusionSummaryPage.STATS) {
      return { x: 320, y: 0 };
    }

    if (page === FusionSummaryPage.MOVES) {
      switch (role) {
        case "moves-left":
          return { x: -320, y: 0 };
        case "moves-right":
          return { x: 320, y: 0 };
        case "moves-center":
          return { x: 0, y: 180 };
        default:
          return { x: 0, y: 180 };
      }
    }

    return entering ? navigationOffset : { x: -navigationOffset.x, y: -navigationOffset.y };
  }

  private getObjectTransitionDelay(page: FusionSummaryPage, role: FusionSummaryTransitionRole, entering: boolean): number {
    if (page === FusionSummaryPage.STATS) {
      const staggerDelay = Math.round(PAGE_TRANSITION_DURATION * STATS_LEFT_TRANSITION_DELAY_RATIO);
      if (entering && (role === "stats-flyout" || role === "stats-left")) {
        return staggerDelay;
      }
      if (!entering && (role === "body" || role === "stats-right" || role === "footer")) {
        return staggerDelay;
      }
    }

    return 0;
  }

  private getMaxObjectTransitionDelay(page: FusionSummaryPage): number {
    return page === FusionSummaryPage.STATS ? Math.round(PAGE_TRANSITION_DURATION * STATS_LEFT_TRANSITION_DELAY_RATIO) : 0;
  }

  private getPageTransitionOffset(previousPage: FusionSummaryPage, nextPage: FusionSummaryPage): { x: number; y: number } {
    if (nextPage === FusionSummaryPage.STATUS) {
      return { x: 0, y: 180 };
    }

    if (nextPage === FusionSummaryPage.MOVES) {
      return { x: 0, y: 180 };
    }

    if (nextPage === FusionSummaryPage.STATS) {
      return { x: previousPage < nextPage ? 320 : -320, y: 0 };
    }

    return { x: -320, y: 0 };
  }

  private renderSpritePage(): void {
    const body = this.bodyPokemon;
    const donor = this.donorPokemon;
    if (!body || !donor) {
      return;
    }

    this.addPageImage("fusion_summary_sprite_menu");

    this.addPokemonFrontSprite(body, 52, 83, 0.62);
    this.addPokemonFrontSprite(body, 160, 83, 0.62, donor);
    this.addPokemonFrontSprite(donor, 268, 83, 0.62);

    this.addCenteredText(52, 127, body.getNameToRender({ useIllusion: false }), TextStyle.SUMMARY);
    this.addCenteredText(160, 127, this.getFusionPreviewName(), TextStyle.SUMMARY_GOLD);
    this.addCenteredText(268, 127, donor.getNameToRender({ useIllusion: false }), TextStyle.SUMMARY);

    this.addCenteredText(52, 149, "Sprite Body: P1", TextStyle.WINDOW_ALT);
    this.addCenteredText(160, 149, "Live Preview", TextStyle.WINDOW_ALT);
    this.addCenteredText(268, 149, "Palette: P2", TextStyle.WINDOW_ALT);

    this.addControlText(12, 166, "Q: Change Body");
    this.addControlText(124, 166, "W: Swap Body/Donor");
    this.addControlText(224, 166, "E: Change Donor");
  }

  private renderStatusPage(): void {
    const body = this.bodyPokemon;
    const donor = this.donorPokemon;
    if (!body || !donor) {
      return;
    }

    this.addPageImage("fusion_summary_status_left");
    this.addPageImage("fusion_summary_status_mid");
    this.addPageImage("fusion_summary_status_right");

    this.addPokemonIcon(body, 51, 58, 1.1);
    this.addPokemonIcon(donor, 269, 58, 1.1);
    //this.addPokemonIcon(body, 160, 58, 1.1);
    this.addFusionPokemonIcon(body, donor, 160, 70, 1.1);

    this.addBoundedCenteredText(5, 92, 96, "Q: Change Body Type", TextStyle.SUMMARY_GREEN, "36px");
    this.addBoundedCenteredText(112, 101, 96, "W: Change Tera Type", TextStyle.SUMMARY_GREEN, "36px");
    this.addBoundedCenteredText(219, 92, 96, "E: Change Donor Type", TextStyle.SUMMARY_GREEN, "36px");

    this.addTypeChoiceSlots(
      [
        { x: 10, y: 102, type: this.getTypeChoice(body, 0) },
        { x: 64, y: 102, type: this.getTypeChoice(body, 1) },
      ],
      this.p1TypeChoice,
    );
    this.addTypeChoiceSlots(
      [
        { x: 117, y: 112, type: body.getTeraType() },
        { x: 170, y: 112, type: donor.getTeraType() },
      ],
      this.teraChoice,
    );
    this.addTypeChoiceSlots(
      [
        { x: 224, y: 102, type: this.getTypeChoice(donor, 0) },
        { x: 278, y: 102, type: this.getTypeChoice(donor, 1) },
      ],
      this.p2TypeChoice,
    );

    const selectedAbility = this.abilityChoice === 0 ? body.getAbility(true) : donor.getAbility(true);
    const selectedPassive = this.passiveChoice === 0 ? body.getPassiveAbility() : donor.getPassiveAbility();
    // Left -> right Top -> Bottom
    this.addBoundedCenteredText(5, 120, 96, "R: Change Ability", TextStyle.SUMMARY_GREEN, "38px");
    this.addBoundedCenteredText(112, 130, 96, "F: Change Nature", TextStyle.SUMMARY_GREEN, "38px");
    this.addBoundedCenteredText(219, 120, 96, "V: Change Passive", TextStyle.SUMMARY_GREEN, "38px");

    this.addStatusSelectionInfo(5, 134, 96, "Ability", selectedAbility.name, selectedAbility.description);
    this.addBoundedCenteredText(
      111,
      141,
      98,
      `Nature: ${this.getChosenNatureLabel(body, donor)}`,
      TextStyle.WINDOW_ALT,
      "40px",
    );
    this.addNatureStatTable(body, donor);
    this.addStatusSelectionInfo(219, 134, 96, "Passive", selectedPassive.name, selectedPassive.description);
  }

  private renderStatsPage(): void {
    const body = this.party[this.statBodySlotIndex];
    const donor = this.party[this.statDonorSlotIndex];
    if (!body || !donor) {
      return;
    }

    this.addPageImage("fusion_summary_stats");
    this.addPageImage("fusion_summary_stats_top_flyout");
    this.addPageImage("fusion_summary_stats_mid_flyout");
    this.addPageImage("fusion_summary_stats_bottom_flyout");

    this.addPokemonIcon(body, 82, 44, 1.15, "stats-left");
    this.addPokemonIcon(donor, 82, 100, 1.15, "stats-left");
    this.addFusionPokemonIcon(body, donor, 82, 156, 1.15, "stats-left");

    this.addCenteredText(84, 10, body.getNameToRender({ useIllusion: false }), TextStyle.SUMMARY, "58px");
    this.addCenteredText(84, 66, donor.getNameToRender({ useIllusion: false }), TextStyle.SUMMARY, "58px");
    this.addCenteredText(84, 123, "Fusion result", TextStyle.SUMMARY_GOLD, "58px");
    this.addCenteredText(160, 58, "W: Switch Stat Blocks", TextStyle.SUMMARY_GREEN, "54px");
    this.addCenteredText(160, 114, "((2 x base + donor) / 3)", TextStyle.SUMMARY_GREEN, "54px");

    this.addStatBlock(18, body, donor, "body");
    this.addStatBlock(74, donor, body, "body");
    this.addStatBlock(126, body, donor, "fusion");
  }

  private renderMovesPage(): void {
    const body = this.bodyPokemon;
    const donor = this.donorPokemon;
    if (!body || !donor) {
      return;
    }

    this.addPageImage("fusion_summary_moves_left");
    this.addPageImage("fusion_summary_moves_center");
    this.addPageImage("fusion_summary_moves_right");

    this.addBoundedCenteredText(8, 20, 90, body.getNameToRender({ useIllusion: false }), TextStyle.SUMMARY, "58px");
    this.addBoundedCenteredText(116, 20, 90, "Fusion Set", TextStyle.SUMMARY_GOLD, "58px");
    this.addBoundedCenteredText(224, 20, 90, donor.getNameToRender({ useIllusion: false }), TextStyle.SUMMARY, "58px");

    this.addMoveColumn(0, 8, this.getColumnMoves(0), this.moveColumn === 0, body);
    this.addMoveColumn(1, 116, this.fusionMoveSlots, this.moveColumn === 1);
    this.addMoveColumn(2, 224, this.getColumnMoves(2), this.moveColumn === 2, donor);
    this.addMoveTransferHints();

    const selectedMove = this.pendingMove ?? this.getColumnMoves(this.moveColumn)[this.moveRow] ?? null;
    const detailMove = this.moveColumn === 1 ? this.fusionMoveSlots[this.moveRow] : selectedMove;
    this.addBattleMoveDescription(6, detailMove ?? selectedMove);
    this.addFusionMoveDetails(detailMove ?? selectedMove);
    this.addContestMoveDescription(222, detailMove ?? selectedMove);

    if (this.pendingMove) {
      this.addCenteredText(160, 111, "Choose fusion slot", TextStyle.SUMMARY_GREEN, "58px");
    }
  }

  private addStatBlock(yBase: number, primary: PlayerPokemon, secondary: PlayerPokemon, mode: "body" | "fusion"): void {
    PERMANENT_STATS.forEach((stat, index) => {
      const column = index < 3 ? 0 : 1;
      const row = index % 3;
      const labelX = column === 0 ? 110 : 230;
      const valueX = column === 0 ? 190 : 280;
      this.addStatRow(
        labelX,
        valueX,
        yBase - 1 + row * 16,
        stat,
        this.getDisplayedStat(stat, primary, secondary, mode),
        this.getDisplayedNatureStatMultiplier(stat, primary, secondary, mode),
      );
    });
  }

  private addStatRow(
    labelX: number,
    valueX: number,
    y: number,
    stat: PermanentStat,
    value: number,
    natureStatMultiplier: number,
  ): void {
    const labelStyle = this.getNatureStatTextStyle(natureStatMultiplier);
    const label = addTextObject(labelX, y, i18next.t(getStatKey(stat)), labelStyle, { fontSize: "66px" });
    label.setOrigin(0, 0);
    this.fitTextToWidth(label, 48);
    this.addToRenderTarget(label);

    const valueText = addTextObject(valueX + 33, y, value.toString(), TextStyle.WINDOW_ALT, { fontSize: "66px" });
    valueText.setOrigin(1, 0);
    this.fitTextToWidth(valueText, 33);
    this.addToRenderTarget(valueText);
  }

  private addMoveColumn(
    column: number,
    x: number,
    moves: (Move | null)[],
    active: boolean,
    pokemon?: PlayerPokemon,
  ): void {
    for (let row = 0; row < 4; row++) {
      const y = 39 + row * 16;
      const move = moves[row] ?? null;
      const selectionY = y - 8;
      if (this.pendingMoveSourceColumn === column && this.pendingMoveSourceRow === row) {
        this.addSelectionRect(x - 2, selectionY, 96, 17, 0xffdc54);
      }
      if (active && this.moveRow === row) {
        this.addSelectionRect(x - 2, selectionY, 96, 17);
      }
      if (move) {
        this.addTypeIcon(x, y - 6, pokemon?.getMoveType(move) ?? move.type);
        const moveText = addTextObject(x + 38, y - 2, move.name, TextStyle.SUMMARY, { fontSize: "62px" });
        moveText.setOrigin(0, 0);
        this.fitTextToWidth(moveText, 52);
        this.addToRenderTarget(moveText);
      } else {
        const moveText = addTextObject(x + 38, y - 2, "-", TextStyle.SUMMARY_GRAY, { fontSize: "62px" });
        moveText.setOrigin(0, 0);
        this.addToRenderTarget(moveText);
      }
    }
  }

  private addMoveTransferHints(): void {
    this.addBoundedCenteredText(98, 68, 14, ">", TextStyle.SUMMARY_GREEN, "58px");
    this.addBoundedCenteredText(210, 68, 14, "<", TextStyle.SUMMARY_GREEN, "58px");
  }

  private addBattleMoveDescription(x: number, move: Move | null): void {
    this.addBoundedCenteredText(x, 122, 94, "Battle Effect", TextStyle.SUMMARY, "46px");
    this.addWrappedText(x + 2, 137, move?.effect || "-", 92, TextStyle.WINDOW_ALT, "44px", 3);
  }

  private addContestMoveDescription(x: number, move: Move | null): void {
    this.addBoundedCenteredText(x, 122, 94, "Contest Effect", TextStyle.SUMMARY, "46px");
    if (!move) {
      this.addWrappedText(x + 2, 137, "-", 92, TextStyle.WINDOW_ALT, "44px", 3);
      return;
    }

    const contestMove = getContestSpectacularMove(move.id);
    const description = contestMove
      ? getContestSpectacularEffect(contestMove.effectId).flavorText
      : i18next.t("pokemonSummary:noContestEffectData", { defaultValue: "No contest effect data." });
    this.addWrappedText(x + 2, 137, description, 92, TextStyle.WINDOW_ALT, "44px", 3);
  }

  private addFusionMoveDetails(move: Move | null): void {
    const contestMove = move ? getContestSpectacularMove(move.id) : undefined;
    this.addMoveDetailLabel(116, 131, "Power");
    this.addMoveDetailLabel(116, 137, "Appeal");
    this.addMoveDetailValue(172, 132, move && move.power >= 0 ? move.power.toString() : "---");
    this.addMoveDetailValue(207, 132, contestMove ? contestMove.appeal.toString() : "---");
    this.addMoveDetailLabel(116, 147, "Accuracy");
    this.addMoveDetailLabel(116, 153, "Jamming");
    this.addMoveDetailValue(172, 148, move && move.accuracy >= 0 ? move.accuracy.toString() : "---");
    this.addMoveDetailValue(207, 148, contestMove ? contestMove.jam.toString() : "---");
    this.addMoveDetailLabel(116, 163, "Category");
    this.addMoveDetailLabel(116, 171, "Condition");

    if (move) {
      const categoryIcon = globalScene.add.sprite(159, 171, "categories", MoveCategory[move.category].toLowerCase());
      categoryIcon.setOrigin(0.5, 0.5);
      this.addToRenderTarget(categoryIcon);
    }

    if (contestMove) {
      const contestTypeIcon = globalScene.add.sprite(194, 171, "contest_attributes_tags", contestMove.contestType);
      contestTypeIcon.setOrigin(0.5, 0.5);
      this.addToRenderTarget(contestTypeIcon);
    } else {
      this.addBoundedCenteredText(177, 164, 34, "???", TextStyle.SUMMARY, "42px");
    }
  }

  private addMoveDetailValue(rightX: number, y: number, value: string): void {
    const valueText = addTextObject(rightX, y, value, TextStyle.WINDOW_ALT, { fontSize: "44px" });
    valueText.setOrigin(1, 0);
    this.fitTextToWidth(valueText, 28);
    this.addToRenderTarget(valueText);
  }

  private addMoveDetailLabel(x: number, y: number, label: string): void {
    const labelText = addTextObject(x, y, label, TextStyle.SUMMARY, { fontSize: "44px" });
    labelText.setOrigin(0, 0);
    this.fitTextToWidth(labelText, 34);
    this.addToRenderTarget(labelText);
  }

  private addPageImage(key: string): void {
    const image = globalScene.add.image(0, 0, key);
    image.setOrigin(0, 0);
    this.addToRenderTarget(image, this.getPageImageTransitionRole(key));
  }

  private addSelectionRect(x: number, y: number, width: number, height: number, color = 0x7bd8ff): void {
    const rect = globalScene.add.rectangle(x, y, width, height);
    rect.setOrigin(0, 0);
    rect.setStrokeStyle(1, color);
    this.addToRenderTarget(rect);
  }

  private addTypeIcon(x: number, y: number, type: PokemonType, alpha = 1): void {
    const frame = PokemonType[type]?.toLowerCase() ?? "unknown";
    const icon = globalScene.add.sprite(x, y, getLocalizedSpriteKey("types"), frame);
    icon.setOrigin(0, 0);
    icon.setAlpha(alpha);
    this.addToRenderTarget(icon);
  }

  private addToRenderTarget<T extends Phaser.GameObjects.GameObject>(
    object: T,
    role = this.getDefaultTransitionRole(object),
  ): T {
    object.setData("fusionSummaryTransitionRole", role);
    (this.renderLayerContainers[role] ?? this.renderTargetContainer).add(object);
    return object;
  }

  private getDefaultTransitionRole(object: Phaser.GameObjects.GameObject): FusionSummaryTransitionRole {
    const { x } = object as Phaser.GameObjects.GameObject & { x?: number };

    if (this.renderingPage === FusionSummaryPage.STATS) {
      return (x ?? 0) < 100 ? "stats-left" : "stats-right";
    }

    if (this.renderingPage !== FusionSummaryPage.MOVES) {
      return "body";
    }

    if ((x ?? 0) < 108) {
      return "moves-left";
    }
    if ((x ?? 0) >= 216) {
      return "moves-right";
    }
    return "moves-center";
  }

  private getPageImageTransitionRole(key: string): FusionSummaryTransitionRole {
    switch (key) {
      case "fusion_summary_stats":
        return "body";
      case "fusion_summary_stats_top_flyout":
      case "fusion_summary_stats_mid_flyout":
      case "fusion_summary_stats_bottom_flyout":
        return "stats-flyout";
      case "fusion_summary_moves_left":
        return "moves-left";
      case "fusion_summary_moves_center":
        return "moves-center";
      case "fusion_summary_moves_right":
        return "moves-right";
      default:
        return "body";
    }
  }

  private addTypeChoiceSlots(slots: { x: number; y: number; type: PokemonType | null }[], choice: number): void {
    const selectableIndexes = slots.map((slot, index) => (slot.type === null ? -1 : index)).filter(index => index > -1);
    const selectedSlotIndex = selectableIndexes.length ? selectableIndexes[choice % selectableIndexes.length] : -1;

    slots.forEach((slot, index) => {
      if (slot.type === null) {
        return;
      }
      this.addTypeChoiceTag(slot.x, slot.y, slot.type, index === selectedSlotIndex);
    });
  }

  private addTypeChoiceTag(x: number, y: number, type: PokemonType, selected: boolean): void {
    const alpha = selected ? 1 : 0.45;
    this.addTypeIcon(x, y, type, alpha);

    if (selected) {
      this.addSelectionRect(x - 1, y - 1, 34, 16);
    }
  }

  private addChoiceText(x: number, y: number, width: number, text: string): void {
    const label = addTextObject(x + width / 2, y, `< ${text} >`, TextStyle.WINDOW_ALT, { fontSize: "64px" });
    label.setOrigin(0.5, 0);
    this.fitTextToWidth(label, width - 4);
    this.addToRenderTarget(label);
  }

  private addStatusSelectionInfo(
    x: number,
    y: number,
    width: number,
    label: string,
    name: string,
    description: string,
  ): void {
    this.addBoundedCenteredText(x, y, width, `${label}: ${name}`, TextStyle.WINDOW_ALT, "36px");
    this.addWrappedText(x, y + 10, description || "-", width, TextStyle.WINDOW_ALT, "30px", 3);
  }

  private addNatureStatTable(body: PlayerPokemon, donor: PlayerPokemon): void {
    PERMANENT_STATS.forEach((stat, index) => {
      const column = index < 3 ? 0 : 1;
      const row = index % 3;
      const labelX = column === 0 ? 109 : 161;
      const signX = column === 0 ? 146 : 198;
      const y = 151 + row * 10;

      const label = addTextObject(labelX + 12, y, i18next.t(getStatKey(stat)), TextStyle.SUMMARY, {
        fontSize: "34px",
      });
      label.setOrigin(0.5, 0);
      this.fitTextToWidth(label, 22);
      this.addToRenderTarget(label);

      const sign = this.getNatureStatSign(stat, body, donor);
      if (!sign) {
        return;
      }

      const signStyle = this.getNatureSignTextStyle(sign);
      const signText = addTextObject(signX, y, sign, signStyle, { fontSize: "44px" });
      signText.setOrigin(0.5, 0);
      this.addToRenderTarget(signText);
    });
  }

  private fitTextToWidth(textObject: Phaser.GameObjects.Text, maxWidth: number): void {
    if (textObject.displayWidth <= maxWidth) {
      return;
    }
    const scale = textObject.scale * (maxWidth / textObject.displayWidth);
    textObject.setScale(scale);
  }

  private addPokemonIcon(
    pokemon: PlayerPokemon,
    x: number,
    y: number,
    scale = 1,
    role?: FusionSummaryTransitionRole,
  ): void {
    const icon = globalScene.addPokemonIcon(pokemon, x, y, 0.5, 0.5, true, false);
    icon.setScale(scale);
    this.addToRenderTarget(icon, role);
  }

  private addFusionPokemonIcon(
    body: PlayerPokemon,
    donor: PlayerPokemon,
    x: number,
    y: number,
    scale = 1,
    role?: FusionSummaryTransitionRole,
  ): void {
    const previewPokemon = this.createFusionPreviewPokemon(body, donor);
    const icon = globalScene.addPokemonIcon(previewPokemon, x, y, 0.5, 0.5, true, false);
    icon.setScale(scale);
    this.addToRenderTarget(icon, role);
    previewPokemon.destroy();
  }

  private addPokemonFrontSprite(
    pokemon: PlayerPokemon,
    x: number,
    y: number,
    scale: number,
    fusionPaletteSource?: PlayerPokemon,
  ): void {
    const sprite = globalScene.initPokemonSprite(globalScene.add.sprite(x, y, "pkmn__sub"), pokemon, false, true);
    sprite.setOrigin(0.5, 0.5);
    sprite.setScale(scale);
    sprite.setVisible(false);
    delete sprite.pipelineData["spriteColorsBase"];
    delete sprite.pipelineData["fusionSpriteColorsBase"];
    sprite
      .setPipelineData("teraColor", getTypeRgb(pokemon.getTeraType()))
      .setPipelineData("isTerastallized", pokemon.isTerastallized)
      .setPipelineData("ignoreTimeTint", true)
      .setPipelineData("spriteKey", pokemon.getSpriteKey())
      .setPipelineData("shiny", pokemon.shiny)
      .setPipelineData("variant", pokemon.variant)
      .setPipelineData("spriteColors", [])
      .setPipelineData("fusionSpriteColors", []);

    this.addToRenderTarget(sprite);
    if (fusionPaletteSource) {
      void this.applyFusionPalettePreview(sprite, pokemon, fusionPaletteSource, this.renderRevision);
    }

    const spriteKey = pokemon.getSpriteKey(true);
    const playSprite = () => {
      if (!this.active || !sprite.scene) {
        return;
      }
      try {
        sprite.play(spriteKey);
        sprite.setVisible(true);
      } catch (err) {
        console.error(`Failed to play fusion summary sprite for ${spriteKey}`, err);
      }
    };

    if (globalScene.anims.exists(spriteKey)) {
      playSprite();
      return;
    }

    void pokemon
      .loadAssets(false)
      .then(playSprite)
      .catch(err => {
        console.error(`Failed to load fusion summary sprite for ${spriteKey}`, err);
      });
  }

  private async applyFusionPalettePreview(
    sprite: Phaser.GameObjects.Sprite,
    body: PlayerPokemon,
    donor: PlayerPokemon,
    renderRevision: number,
  ): Promise<void> {
    const previewPokemon = this.createFusionPreviewPokemon(body, donor);

    try {
      await previewPokemon.loadAssets(false);
      if (!this.active || !sprite.scene || renderRevision !== this.renderRevision) {
        return;
      }
      this.copyFusionPaletteData(sprite, previewPokemon);
    } catch (err) {
      console.error(
        `Failed to build fusion summary palette for ${body.getSpriteKey(true)} + ${donor.getSpriteKey(true)}`,
        err,
      );
    } finally {
      previewPokemon.destroy();
    }
  }

  private createFusionPreviewPokemon(body: PlayerPokemon, donor: PlayerPokemon): PlayerPokemon {
    const previewPokemon = globalScene.addPlayerPokemon(
      body.species,
      body.level,
      body.abilityIndex,
      body.formIndex,
      body.gender,
      body.shiny,
      body.variant,
      body.ivs,
      body.getNature(),
      body,
      pokemon => {
        pokemon.fusionSpecies = donor.species;
        pokemon.fusionFormIndex = donor.formIndex;
        pokemon.fusionAbilityIndex = donor.abilityIndex;
        pokemon.fusionShiny = donor.shiny;
        pokemon.fusionVariant = donor.variant;
        pokemon.fusionGender = donor.gender;
        pokemon.fusionLuck = donor.luck;
        pokemon.fusionCustomPokemonData = donor.customPokemonData;
        pokemon.fusionTeraType = donor.getTeraType();
      },
    );

    previewPokemon.setVisible(false);
    previewPokemon.getBattleInfo().setVisible(false);
    return previewPokemon;
  }

  private copyFusionPaletteData(sprite: Phaser.GameObjects.Sprite, sourcePokemon: PlayerPokemon): void {
    ["spriteColors", "fusionSpriteColors"].forEach(key => {
      delete sprite.pipelineData[`${key}Base`];
      const sourceKey = sourcePokemon.summonData.speciesForm ? `${key}Base` : key;
      const colors =
        sourcePokemon.getSprite().pipelineData[sourceKey] ?? sourcePokemon.getSprite().pipelineData[key] ?? [];
      sprite.pipelineData[sourceKey] = colors.map((color: number[]) => color.slice());
    });
  }

  private addCenteredText(
    x: number,
    y: number,
    text: string,
    style: TextStyle,
    fontSize?: string,
  ): Phaser.GameObjects.Text {
    const textObject = addTextObject(x, y, text, style, fontSize ? { fontSize } : undefined);
    textObject.setOrigin(0.5, 0);
    this.addToRenderTarget(textObject);
    return textObject;
  }

  private addBoundedCenteredText(
    x: number,
    y: number,
    width: number,
    text: string,
    style: TextStyle,
    fontSize?: string,
  ): Phaser.GameObjects.Text {
    const textObject = this.addCenteredText(x + width / 2, y, text, style, fontSize);
    this.fitTextToWidth(textObject, width - 2);
    return textObject;
  }

  private addControlText(x: number, y: number, text: string): void {
    const textObject = addTextObject(x, y, text, TextStyle.SUMMARY_GREEN, { fontSize: "48px" });
    textObject.setOrigin(0, 0);
    this.addToRenderTarget(textObject);
  }

  private addWrappedText(
    x: number,
    y: number,
    text: string,
    width: number,
    style: TextStyle,
    fontSize: string,
    maxLines?: number,
  ): void {
    const textStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontSize,
      wordWrap: { width: width * 6 },
      lineSpacing: 0,
    };
    if (maxLines !== undefined) {
      textStyle.maxLines = maxLines;
    }
    const textObject = addTextObject(x, y, text, style, textStyle);
    textObject.setOrigin(0, 0);
    this.addToRenderTarget(textObject);
  }

  private addFooterPrompts(): void {
    const promptText = this.cursor === FusionSummaryPage.MOVES ? "Z Select/Place   X Back" : "Z Fuse   X Back";
    const prompt = addTextObject(244, 2, promptText, TextStyle.SUMMARY, { fontSize: "64px" });
    prompt.setOrigin(0, 0);
    this.addToRenderTarget(prompt, "footer");
  }

  private getColumnMoves(column: number): (Move | null)[] {
    const pokemon = column === 2 ? this.donorPokemon : this.bodyPokemon;
    if (!pokemon) {
      return [null, null, null, null];
    }
    return [0, 1, 2, 3].map(index => pokemon.moveset[index]?.getMove() ?? null);
  }

  private resetFusionMoveSlots(): void {
    const bodyMoves = this.bodyPokemon?.moveset ?? [];
    const donorMoves = this.donorPokemon?.moveset ?? [];
    this.fusionMoveSlots = [
      bodyMoves[0]?.getMove() ?? null,
      bodyMoves[1]?.getMove() ?? null,
      donorMoves[0]?.getMove() ?? null,
      donorMoves[1]?.getMove() ?? null,
    ];
  }

  private clearPendingMove(): void {
    this.pendingMove = null;
    this.pendingMoveSourceColumn = null;
    this.pendingMoveSourceRow = null;
  }

  private getDisplayedStat(
    stat: PermanentStat,
    primary: PlayerPokemon,
    secondary: PlayerPokemon,
    mode: "body" | "fusion",
  ): number {
    if (mode === "body") {
      return primary.getStat(stat);
    }
    return Math.ceil((2 * primary.getStat(stat) + secondary.getStat(stat)) / 3);
  }

  private getDisplayedNatureStatMultiplier(
    stat: PermanentStat,
    primary: PlayerPokemon,
    secondary: PlayerPokemon,
    mode: "body" | "fusion",
  ): number {
    if (mode === "body") {
      return primary.getNatureStatMultiplierForStat(stat);
    }

    const selectedNature = this.getChosenNature(primary, secondary);
    if (selectedNature !== null) {
      return getNatureStatMultiplier(selectedNature, stat);
    }

    const combinedDelta =
      this.getNatureMultiplierDelta(getNatureStatMultiplier(primary.getNature(), stat))
      + this.getNatureMultiplierDelta(getNatureStatMultiplier(secondary.getNature(), stat));
    return 1 + combinedDelta * 0.1;
  }

  private getTypeChoice(pokemon: PlayerPokemon, index: number): PokemonType {
    const types = pokemon
      .getTypes({ includeTeraType: false, bypassSummonData: true, ignoreThirdType: true })
      .filter(type => type !== PokemonType.UNKNOWN);
    return types[index] ?? PokemonType.UNKNOWN;
  }

  private cycleFusionTypeChoice(component: FusionComponent): boolean {
    const nextBodyChoice = component === "body" ? this.getNextTypeChoice(this.p1TypeChoice) : this.p1TypeChoice;
    const nextDonorChoice = component === "donor" ? this.getNextTypeChoice(this.p2TypeChoice) : this.p2TypeChoice;

    if (this.isSelectedFusionTypeless(nextBodyChoice, nextDonorChoice)) {
      this.getUi().playError();
      return false;
    }

    this.p1TypeChoice = nextBodyChoice;
    this.p2TypeChoice = nextDonorChoice;
    this.renderPage();
    return true;
  }

  private getNextTypeChoice(choice: number): number {
    return (choice + 1) % 2;
  }

  private isSelectedFusionTypeless(
    bodyChoice = this.p1TypeChoice,
    donorChoice = this.p2TypeChoice,
  ): boolean {
    const body = this.bodyPokemon;
    const donor = this.donorPokemon;
    if (!body || !donor) {
      return false;
    }

    return (
      this.getTypeChoice(body, this.getTypeSlotChoice(bodyChoice)) === PokemonType.UNKNOWN
      && this.getTypeChoice(donor, this.getTypeSlotChoice(donorChoice)) === PokemonType.UNKNOWN
    );
  }

  private getChosenNatureLabel(body: PlayerPokemon, donor: PlayerPokemon): string {
    if (this.natureChoice === 0) {
      return getNatureName(body.getNature(), false, false, true);
    }
    if (this.natureChoice === 1) {
      return getNatureName(donor.getNature(), false, false, true);
    }
    return "Mixed";
  }

  private getChosenNature(body: PlayerPokemon, donor: PlayerPokemon): Nature | null {
    if (this.natureChoice === 0) {
      return body.getNature();
    }
    if (this.natureChoice === 1) {
      return donor.getNature();
    }
    return null;
  }

  private getNatureStatSign(stat: PermanentStat, body: PlayerPokemon, donor: PlayerPokemon): string {
    if (stat === Stat.HP) {
      return "";
    }

    const selectedNature = this.getChosenNature(body, donor);
    if (selectedNature !== null) {
      return this.getNatureMultiplierSign(getNatureStatMultiplier(selectedNature, stat));
    }

    const combinedDelta =
      this.getNatureMultiplierDelta(getNatureStatMultiplier(body.getNature(), stat))
      + this.getNatureMultiplierDelta(getNatureStatMultiplier(donor.getNature(), stat));
    if (combinedDelta >= 2) {
      return "++";
    }
    if (combinedDelta === 1) {
      return "+";
    }
    if (combinedDelta <= -2) {
      return "--";
    }
    if (combinedDelta < 0) {
      return "-";
    }
    return "";
  }

  private getNatureMultiplierSign(multiplier: number): string {
    if (multiplier > 1) {
      return "+";
    }
    if (multiplier < 1) {
      return "-";
    }
    return "";
  }

  private getNatureMultiplierDelta(multiplier: number): number {
    if (multiplier > 1) {
      return 1;
    }
    if (multiplier < 1) {
      return -1;
    }
    return 0;
  }

  private getNatureStatTextStyle(multiplier: number): TextStyle {
    if (multiplier >= 1.2) {
      return TextStyle.SUMMARY_STATS_ORANGE;
    }
    if (multiplier > 1) {
      return TextStyle.SUMMARY_STATS_PINK;
    }
    if (multiplier <= 0.8) {
      return TextStyle.SUMMARY_STATS_PURPLE;
    }
    if (multiplier < 1) {
      return TextStyle.SUMMARY_STATS_BLUE;
    }
    return TextStyle.SUMMARY_STATS;
  }

  private getNatureSignTextStyle(sign: string): TextStyle {
    if (sign === "++") {
      return TextStyle.SUMMARY_ORANGE;
    }
    if (sign === "+") {
      return TextStyle.SUMMARY_RED;
    }
    if (sign === "--") {
      return TextStyle.SUMMARY_PURPLE;
    }
    return TextStyle.SUMMARY_BLUE;
  }

  private getFusionPreviewName(): string {
    const bodyName = this.bodyPokemon?.getNameToRender({ useIllusion: false }) ?? "";
    const donorName = this.donorPokemon?.getNameToRender({ useIllusion: false }) ?? "";
    if (!bodyName || !donorName) {
      return "";
    }
    return `${bodyName}/${donorName}`;
  }

  private cycleFusionSlot(slot: "body" | "donor"): void {
    const currentSlotIndex = slot === "body" ? this.bodySlotIndex : this.donorSlotIndex;
    const otherSlotIndex = slot === "body" ? this.donorSlotIndex : this.bodySlotIndex;
    const currentEligibleIndex = this.eligibleSlotIndexes.indexOf(currentSlotIndex);

    for (let offset = 1; offset <= this.eligibleSlotIndexes.length; offset++) {
      const nextSlotIndex = this.eligibleSlotIndexes[(currentEligibleIndex + offset) % this.eligibleSlotIndexes.length];
      if (nextSlotIndex !== otherSlotIndex) {
        if (slot === "body") {
          this.bodySlotIndex = nextSlotIndex;
        } else {
          this.donorSlotIndex = nextSlotIndex;
        }
        this.statBodySlotIndex = this.bodySlotIndex;
        this.statDonorSlotIndex = this.donorSlotIndex;
        this.resetFusionMoveSlots();
        this.renderPage();
        return;
      }
    }
  }

  private swapSpriteSlots(): void {
    [this.bodySlotIndex, this.donorSlotIndex] = [this.donorSlotIndex, this.bodySlotIndex];
    this.statBodySlotIndex = this.bodySlotIndex;
    this.statDonorSlotIndex = this.donorSlotIndex;
    this.resetFusionMoveSlots();
    this.renderPage();
  }

  private showFinishConfirmation(acceptFusion: boolean): void {
    const ui = this.getUi();
    ui.setOverlayMode(
      UiMode.CONFIRM,
      () => {
        ui.revertMode().then(() => this.finish(acceptFusion));
        return true;
      },
      () => {
        ui.revertMode();
        return true;
      },
    );
  }

  private finish(acceptFusion: boolean): void {
    if (acceptFusion && this.bodySlotIndex !== this.donorSlotIndex && this.isSelectedFusionTypeless()) {
      this.getUi().playError();
      return;
    }

    const callback = this.selectCallback;
    this.selectCallback = null;

    if (acceptFusion && this.bodySlotIndex !== this.donorSlotIndex) {
      callback?.(this.bodySlotIndex, this.donorSlotIndex, this.buildFusionOptions());
    } else {
      callback?.();
    }
  }

  private buildFusionOptions(): FusionOptions {
    return new FusionOptions({
      spriteBody: "body",
      palette: "donor",
      statPrimary: this.getComponentForSlot(this.statBodySlotIndex),
      bodyTypeSlot: this.getTypeSlotChoice(this.p1TypeChoice),
      donorTypeSlot: this.getTypeSlotChoice(this.p2TypeChoice),
      teraSource: this.getChoiceComponent(this.teraChoice),
      abilitySource: this.getChoiceComponent(this.abilityChoice),
      natureMode: this.getNatureModeChoice(),
      passiveSource: this.getChoiceComponent(this.passiveChoice),
      moves: this.fusionMoveSlots.map(move => move?.id ?? null),
    });
  }

  private getComponentForSlot(slotIndex: number): FusionComponent {
    return slotIndex === this.donorSlotIndex ? "donor" : "body";
  }

  private getChoiceComponent(choice: number): FusionComponent {
    return choice % 2 === 1 ? "donor" : "body";
  }

  private getNatureModeChoice(): FusionNatureMode {
    const choices: FusionNatureMode[] = ["body", "donor", "mixed"];
    return choices[this.natureChoice % choices.length];
  }

  private getTypeSlotChoice(choice: number): FusionTypeSlot {
    return choice % 2 === 1 ? 1 : 0;
  }

  private isEligibleSlot(slotIndex: number): boolean {
    const pokemon = this.party[slotIndex];
    return !!pokemon && (!this.selectFilter || this.selectFilter(pokemon) === null);
  }

  private get bodyPokemon(): PlayerPokemon | null {
    return this.party[this.bodySlotIndex] ?? null;
  }

  private get donorPokemon(): PlayerPokemon | null {
    return this.party[this.donorSlotIndex] ?? null;
  }
}
