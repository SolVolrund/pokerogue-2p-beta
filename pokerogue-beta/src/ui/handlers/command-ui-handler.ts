import { MAX_TERAS_PER_ARENA } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { getTypeRgb } from "#data/type";
import { Button } from "#enums/buttons";
import { Command } from "#enums/command";
import { FieldPosition } from "#enums/field-position";
import { PartyUiMode } from "#enums/party-ui-mode";
import { PokemonType } from "#enums/pokemon-type";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import type { CommandPhase } from "#phases/command-phase";
import type { OptionSelectConfig, OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import { PartyUiHandler } from "#ui/party-ui-handler";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { canTerastallize } from "#utils/pokemon-utils";
import i18next from "i18next";

export class CommandUiHandler extends UiHandler {
  private commandsContainer: Phaser.GameObjects.Container;
  private cursorObj: Phaser.GameObjects.Image | null;

  private teraButton: Phaser.GameObjects.Sprite;

  protected fieldIndex = 0;
  protected cursor2 = 0;
  protected cursor3 = 0;

  constructor() {
    super(UiMode.COMMAND);
  }

  private getCommandPhase(): CommandPhase {
    const currentPhase = globalScene.phaseManager.getCurrentPhase();
    if (currentPhase.is("CommandPhase")) {
      return currentPhase;
    }

    return globalScene.phaseManager.getStandbyPhase() as CommandPhase;
  }

  setup() {
    const ui = this.getUi();
    const commands = [
      i18next.t("commandUiHandler:fight"),
      i18next.t("commandUiHandler:ball"),
      i18next.t("commandUiHandler:pokemon"),
      i18next.t("commandUiHandler:run"),
    ];

    this.commandsContainer = globalScene.add.container(217, -38.7);
    this.commandsContainer.setName("commands");
    this.commandsContainer.setVisible(false);
    ui.add(this.commandsContainer);

    this.teraButton = globalScene.add.sprite(-32, 15, "button_tera");
    this.teraButton.setName("terastallize-button");
    this.teraButton.setScale(1.3);
    this.teraButton.setFrame("fire");
    this.teraButton.setPipeline(globalScene.spritePipeline, {
      tone: [0.0, 0.0, 0.0, 0.0],
      ignoreTimeTint: true,
      teraColor: getTypeRgb(PokemonType.FIRE),
      isTerastallized: false,
    });
    this.commandsContainer.add(this.teraButton);

    for (let c = 0; c < commands.length; c++) {
      const commandText = addTextObject(
        c % 2 === 0 ? 0 : 55.8,
        c < 2 ? 0 : 16,
        commands[c],
        TextStyle.WINDOW_BATTLE_COMMAND,
      );
      commandText.setName(commands[c]);
      this.commandsContainer.add(commandText);
    }
  }

  private getActivePokemon(): PlayerPokemon | undefined {
    const fieldPokemon = globalScene.getPlayerField()[this.fieldIndex];
    if (fieldPokemon) {
      return fieldPokemon;
    }

    const battlerPokemon = globalScene.getField()[this.fieldIndex];
    if (battlerPokemon?.isPlayer()) {
      return battlerPokemon as PlayerPokemon;
    }

    return undefined;
  }

  show(args: any[]): boolean {
    super.show(args);

    const commandPhase = this.getCommandPhase();
    this.fieldIndex = args.length > 0 ? (args[0] as number) : commandPhase.getFieldIndex();
    const activePokemon = this.getActivePokemon();
    if (activePokemon) {
      this.fieldIndex = activePokemon.getFieldIndex();
    }
    this.fieldIndex = commandPhase.getFieldIndex();

    this.commandsContainer.setVisible(true);

    if (this.canTera()) {
      this.teraButton.setVisible(true);
      this.teraButton.setFrame(PokemonType[this.getActivePokemon()!.getTeraType()].toLowerCase());
    } else {
      this.teraButton.setVisible(false);
      if (this.getCursor() === Command.TERA) {
        this.setCursor(Command.FIGHT);
      }
    }
    this.toggleTeraButton();

    const pokemonName = (
      this.getActivePokemon()
      ?? commandPhase.getPokemon()
      ?? globalScene.getPlayerParty(globalScene.getPlayerIndexForFieldSlot(this.fieldIndex))[0]
    )?.getNameToRender({ prependFormName: false }) ?? i18next.t("battle:pokemon");
    const messageHandler = this.getUi().getMessageHandler();
    messageHandler.bg.setVisible(true);
    messageHandler.commandWindow.setVisible(true);
    messageHandler.movesWindowContainer.setVisible(false);
    messageHandler.message.setWordWrapWidth(this.canTera() ? 910 : 1110);
    messageHandler.showText(i18next.t("commandUiHandler:actionMessage", { pokemonName }), 0);

    if (this.getCursor() === Command.POKEMON) {
      this.setCursor(Command.FIGHT);
    } else {
      this.setCursor(this.getCursor());
    }

    return true;
  }

  processInput(button: Button): boolean {
    const ui = this.getUi();

    let success = false;

    const cursor = this.getCursor();

    if (button === Button.CANCEL || button === Button.ACTION) {
      if (button === Button.ACTION) {
        const commandPhase = this.getCommandPhase();
        switch (cursor) {
          // Fight
          case Command.FIGHT:
            ui.setMode(UiMode.FIGHT, commandPhase.getFieldIndex());
            success = true;
            break;
          // Ball
          case Command.BALL:
            ui.setModeWithoutClear(UiMode.BALL);
            success = true;
            break;
          // Pokemon
          case Command.POKEMON:
            this.openPokemonCommandMenu(commandPhase);
            success = true;
            break;
          // Run
          case Command.RUN:
            commandPhase.handleCommand(Command.RUN, 0);
            success = true;
            break;
          case Command.TERA:
            ui.setMode(
              UiMode.FIGHT,
              commandPhase.getFieldIndex(),
              Command.TERA,
            );
            success = true;
            break;
        }
      } else {
        (globalScene.phaseManager.getCurrentPhase() as CommandPhase).cancel();
      }
    } else {
      switch (button) {
        case Button.UP:
          if (cursor === Command.POKEMON || cursor === Command.RUN) {
            success = this.setCursor(cursor - 2);
          }
          break;
        case Button.DOWN:
          if (cursor === Command.FIGHT || cursor === Command.BALL) {
            success = this.setCursor(cursor + 2);
          }
          break;
        case Button.LEFT:
          if (cursor === Command.BALL || cursor === Command.RUN) {
            success = this.setCursor(cursor - 1);
          } else if ((cursor === Command.FIGHT || cursor === Command.POKEMON) && this.canTera()) {
            success = this.setCursor(Command.TERA);
            this.toggleTeraButton();
          }
          break;
        case Button.RIGHT:
          if (cursor === Command.FIGHT || cursor === Command.POKEMON) {
            success = this.setCursor(cursor + 1);
          } else if (cursor === Command.TERA) {
            success = this.setCursor(Command.FIGHT);
            this.toggleTeraButton();
          }
          break;
      }
    }

    if (success) {
      ui.playSelect();
    }

    return success;
  }

  private openPokemonCommandMenu(commandPhase: CommandPhase): void {
    if (!this.shouldShowTriplePokemonMenu()) {
      this.openPartySwitch(commandPhase);
      return;
    }

    const options: OptionSelectItem[] = [
      {
        label: "Pokemon",
        handler: () => {
          this.openPartySwitch(commandPhase);
          return true;
        },
      },
      {
        label: "Switch",
        keepOpen: true,
        handler: () => {
          this.openRepositionMenu(commandPhase);
          return true;
        },
      },
      {
        label: "Pass",
        handler: () => commandPhase.passTurn(),
      },
      {
        label: i18next.t("menu:cancel"),
        handler: () => {
          globalScene.ui.setMode(UiMode.COMMAND, commandPhase.getFieldIndex());
          return true;
        },
      },
    ];

    this.showCommandOptionSelect({ options, noCancel: true });
  }

  private openPartySwitch(commandPhase: CommandPhase): void {
    globalScene.ui.setMode(
      UiMode.PARTY,
      PartyUiMode.SWITCH,
      commandPhase.getFieldIndex(),
      null,
      PartyUiHandler.FilterNonFainted,
    );
  }

  private openRepositionMenu(commandPhase: CommandPhase): void {
    const pokemon = commandPhase.getPokemon();
    const positionOptions: Array<{ label: string; position: FieldPosition }> = [
      { label: "Switch to Left", position: FieldPosition.LEFT },
      { label: "Switch to Center", position: FieldPosition.CENTER },
      { label: "Switch to Right", position: FieldPosition.RIGHT },
    ];
    const options: OptionSelectItem[] = positionOptions.map(option => ({
      label: option.label,
      handler: () => commandPhase.handleCommand(Command.REPOSITION, option.position),
      disabled: pokemon.fieldPosition === option.position,
    }));
    options.push({
      label: i18next.t("menu:cancel"),
      keepOpen: true,
      handler: () => {
        this.openPokemonCommandMenu(commandPhase);
        return true;
      },
    });

    this.showCommandOptionSelect({ options, noCancel: true });
  }

  private shouldShowTriplePokemonMenu(): boolean {
    return (
      globalScene.twoPlayerMode
      && globalScene.getPlayerFieldOwners().length > 2
      && (globalScene.currentBattle?.getBattlerCount() ?? 1) > 2
    );
  }

  private showCommandOptionSelect(config: OptionSelectConfig): void {
    if (globalScene.ui.getMode() === UiMode.OPTION_SELECT) {
      globalScene.ui.handlers[UiMode.OPTION_SELECT].show([config]);
      return;
    }

    globalScene.ui.setModeWithoutClear(UiMode.OPTION_SELECT, config, null, true);
  }

  canTera(): boolean {
    const activePokemon = this.getActivePokemon();
    const currentTeras = globalScene.arena.playerTerasUsed;
    if (!activePokemon) {
      return false;
    }

    const canTera = canTerastallize(activePokemon);
    const plannedTera = +(
      globalScene.currentBattle.preTurnCommands[0]?.command === Command.TERA && this.fieldIndex > 0
    );
    return canTera && currentTeras + plannedTera < MAX_TERAS_PER_ARENA;
  }

  toggleTeraButton() {
    const activePokemon = this.getActivePokemon();
    if (!activePokemon) {
      return;
    }

    this.teraButton.setPipeline(globalScene.spritePipeline, {
      tone: [0.0, 0.0, 0.0, 0.0],
      ignoreTimeTint: true,
      teraColor: getTypeRgb(activePokemon.getTeraType()),
      isTerastallized: this.getCursor() === Command.TERA,
    });
  }

  getCursor(): number {
    return this.fieldIndex === 2 ? this.cursor3 : this.fieldIndex ? this.cursor2 : this.cursor;
  }

  setCursor(cursor: number): boolean {
    const changed = this.getCursor() !== cursor;
    if (changed) {
      if (this.fieldIndex === 2) {
        this.cursor3 = cursor;
      } else if (this.fieldIndex) {
        this.cursor2 = cursor;
      } else {
        this.cursor = cursor;
      }
    }

    if (!this.cursorObj) {
      this.cursorObj = globalScene.add.image(0, 0, "cursor");
      this.commandsContainer.add(this.cursorObj);
    }

    if (cursor === Command.TERA) {
      this.cursorObj.setVisible(false);
    } else {
      this.cursorObj.setPosition(-5 + (cursor % 2 === 1 ? 56 : 0), 8 + (cursor >= 2 ? 16 : 0));
      this.cursorObj.setVisible(true);
    }

    return changed;
  }

  clear(): void {
    super.clear();
    this.getUi().getMessageHandler().commandWindow.setVisible(false);
    this.commandsContainer.setVisible(false);
    this.getUi().getMessageHandler().clearText();
    this.eraseCursor();
  }

  eraseCursor(): void {
    if (this.cursorObj) {
      this.cursorObj.destroy();
    }
    this.cursorObj = null;
  }
}
