import { Battle } from "#app/battle";
import { BattleType } from "#enums/battle-type";
import { Button } from "#enums/buttons";
import { UiMode } from "#enums/ui-mode";
import type { BallUiHandler } from "#ui/ball-ui-handler";
import { PartyOption, PartyUiMode, type PartyUiHandler } from "#ui/party-ui-handler";
import { SwitchType } from "#enums/switch-type";
import { SwitchSummonPhase } from "#phases/switch-summon-phase";
import { Command } from "#enums/command";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { Pokemon } from "#field/pokemon";
import { Trainer } from "#field/trainer";
import { PokemonMove } from "#moves/pokemon-move";
import { EnemyMedicinePhase } from "#phases/enemy-medicine-phase";
import { EnemyCommandPhase } from "#phases/enemy-command-phase";
import { TurnStartPhase } from "#phases/turn-start-phase";
import { TrainerData } from "#system/trainer-data";
import { GameManager } from "#test/framework/game-manager";
import { trainerConfigs } from "#trainers/trainer-config";
import { chooseTrainerMedicine } from "#utils/battle-medicine-ai";
import { initializeTrainerMedicine, rollTrainerMedicine, spendTrainerMedicine } from "#utils/enemy-trainer-medicine";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Enemy trainer bags", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  beforeAll(() => { phaserGame = new Phaser.Game({ type: Phaser.HEADLESS }); });
  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(false);
    vi.spyOn(Pokemon.prototype, "loadAssets").mockResolvedValue();
  });

  function encounter(double = false, wave = 150) {
    const trainer = new Trainer(TrainerType.RIVAL_6, double ? TrainerVariant.DOUBLE : TrainerVariant.DEFAULT, 0,
      undefined, undefined, undefined, double ? TrainerType.RIVAL_2 : undefined);
    const battle = new Battle(game.scene.gameMode, { waveIndex: wave, battleType: BattleType.TRAINER, trainer, double });
    game.scene.currentBattle = battle;
    battle.incrementTurn();
    const party = [SpeciesId.EMPOLEON, SpeciesId.STARAPTOR, SpeciesId.RAYQUAZA, SpeciesId.PIDGEY]
      .map((species, i) => game.scene.addEnemyPokemon(getPokemonSpecies(species), 50,
        double && i % 2 ? TrainerSlot.TRAINER_PARTNER : TrainerSlot.TRAINER));
    battle.enemyParty.push(...party);
    const foe = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.WEAVILE), 50);
    game.scene.getPlayerParty().push(foe);
    game.scene.field.add([foe, ...party.slice(0, battle.getBattlerCount())]);
    foe.moveset = [new PokemonMove(MoveId.TACKLE)];
    return { trainer, party, foe, battle };
  }

  it("rolls capped budgets and at most one legal revive, never for a solo roster", () => {
    const legal = new Set(["POTION", "REVIVE", "MAX_REVIVE"]);
    const champion = trainerConfigs[TrainerType.RIVAL_6];
    expect(rollTrainerMedicine(champion, legal, true, () => 0)).toEqual(["POTION", "POTION", "MAX_REVIVE"]);
    legal.delete("MAX_REVIVE");
    expect(rollTrainerMedicine(champion, legal, true, () => 0)).toEqual(["POTION", "POTION", "REVIVE"]);
    expect(rollTrainerMedicine(champion, legal, false, () => 0)).toEqual(["POTION", "POTION", "POTION"]);
    expect(rollTrainerMedicine(trainerConfigs[TrainerType.RIVAL], legal, true, () => 99)).toEqual([]);
  });

  it("weights late potions by 2/13/55/30 and never rolls a restricted item", () => {
    const legal = new Set(["POTION", "SUPER_POTION", "HYPER_POTION", "MAX_POTION"]);
    const draw = (n: number) => rollTrainerMedicine(trainerConfigs[TrainerType.RIVAL_2], legal, false, () => n)[0];
    expect([0, 2, 15, 70].map(draw)).toEqual([...legal]);
    legal.delete("HYPER_POTION");
    expect(draw(15)).toBe("MAX_POTION");
  });

  it("packs each trainer's own rank and preserves an exhausted inventory through restore", () => {
    const { trainer, party, battle } = encounter(true);
    initializeTrainerMedicine();
    expect(trainer.medicineBags[TrainerSlot.TRAINER]).toHaveLength(3);
    expect(trainer.medicineBags[TrainerSlot.TRAINER_PARTNER]).toHaveLength(1);
    trainer.medicineBags[TrainerSlot.TRAINER] = ["REVIVE"];
    party[2].hp = party[3].hp = 0;
    expect(spendTrainerMedicine(party[0], party[3], "REVIVE")).toBe(false);
    expect(spendTrainerMedicine(party[0], party[2], "REVIVE")).toBe(true);
    expect(party[2].hp).toBe(Math.floor(party[2].getMaxHp() / 2));
    battle.trainer = new TrainerData(JSON.parse(JSON.stringify(new TrainerData(trainer)))).toTrainer();
    initializeTrainerMedicine();
    expect(battle.trainer.medicineBags).toEqual(trainer.medicineBags);
    expect(battle.trainer.medicineBags[TrainerSlot.TRAINER]).toEqual([]);
  });

  it("leaves bags empty without a previous shop, including runs with the shop disabled", () => {
    const { trainer, battle } = encounter(false, 1);
    initializeTrainerMedicine();
    expect(trainer.medicineBags[TrainerSlot.TRAINER]).toEqual([]);
    trainer.medicineBags = {};
    battle.waveIndex = 190;
    vi.spyOn(game.scene.gameMode, "getShopStatus").mockReturnValue(false);
    initializeTrainerMedicine();
    expect(trainer.medicineBags[TrainerSlot.TRAINER]).toEqual([]);
  });

  it("queues a trainer's revive before attacks and spends it on the selected individual", () => {
    const { trainer, battle, party, foe } = encounter();
    trainer.medicineBags[TrainerSlot.TRAINER] = ["REVIVE"];
    const [actor, target] = party;
    target.hp = 0;
    const medicine = { typeId: "REVIVE", targetId: target.id };
    battle.turnCommands[actor.getBattlerIndex()] = { command: Command.MEDICINE, medicine };
    battle.turnCommands[foe.getBattlerIndex()] = { command: Command.FIGHT };
    const turn = new TurnStartPhase();
    expect(turn["getCommandOrder"]()[0]).toBe(actor.getBattlerIndex());
    const queue = vi.spyOn(game.scene.phaseManager, "unshiftNew");
    turn["handleTurnCommand"](battle.turnCommands[actor.getBattlerIndex()]!, actor, new Map(), new Map());
    expect(queue).toHaveBeenCalledWith("EnemyMedicinePhase", actor.id, medicine);
    expect(target.hp).toBe(0);
    [battle.enemyParty[1], battle.enemyParty[2]] = [battle.enemyParty[2], battle.enemyParty[1]];
    const phase = new EnemyMedicinePhase(actor.id, medicine);
    vi.spyOn(phase, "end").mockImplementation(() => {});
    phase.start();
    expect(target.hp).toBe(Math.floor(target.getMaxHp() / 2));
    expect(trainer.medicineBags[TrainerSlot.TRAINER]).toEqual([]);
  });

  it("lets EP cancel, then revive an owned reserve through the medicine-only Bag", async () => {
    const { trainer, party, battle } = encounter(true);
    game.scene.twoPlayerEnemyPlayerMode = true;
    const [actor, other, reserve, otherReserve] = party;
    reserve.hp = otherReserve.hp = 0;
    trainer.medicineBags[trainer.getMedicineOwner(actor)] = ["REVIVE", "REVIVE"];
    trainer.medicineBags[trainer.getMedicineOwner(other)] = ["POTION"];
    const phase = new EnemyCommandPhase(0);
    vi.spyOn(phase, "end").mockImplementation(() => {});
    vi.spyOn(game.scene.phaseManager, "getCurrentPhase").mockReturnValue(phase);
    expect(phase.canUseCommand(Command.BALL)).toBe(true);
    expect(phase.handleMedicineCommand("REVIVE", otherReserve.id)).toBe(false);
    expect(phase.handleMedicineCommand("POTION", actor.id)).toBe(false);
    await game.scene.ui.setMode(UiMode.COMMAND, 0);
    await game.scene.ui.setModeWithoutClear(UiMode.BALL);
    const bag = game.scene.ui.handlers[UiMode.BALL] as BallUiHandler;
    expect(bag["medicines"]).toEqual([{ typeId: "REVIVE", quantity: 2 }]);
    bag.processInput(Button.RIGHT);
    expect(bag["pocket"]).toBe("medicine");
    const picker = game.scene.ui.handlers[UiMode.PARTY] as PartyUiHandler;
    bag.processInput(Button.ACTION);
    await vi.waitFor(() => expect(picker["getParty"]()).toEqual([actor, reserve]));
    expect(game.scene.inputOwner).toBe("ep");
    picker.processInput(Button.CANCEL);
    await vi.waitFor(() => expect(game.scene.ui.getMode()).toBe(UiMode.BALL));
    expect(phase.end).not.toHaveBeenCalled();
    bag.processInput(Button.ACTION);
    await vi.waitFor(() => expect(game.scene.ui.getMode()).toBe(UiMode.PARTY));
    picker.setCursor(1);
    picker.processInput(Button.ACTION);
    expect(battle.turnCommands[actor.getBattlerIndex()]?.medicine).toEqual({ typeId: "REVIVE", targetId: reserve.id });
    expect(phase.canUseCommand(Command.BALL)).toBe(false);
    expect(new EnemyCommandPhase(1).canUseCommand(Command.BALL)).toBe(true);
    expect(reserve.hp).toBe(0);
    expect(trainer.medicineBags[trainer.getMedicineOwner(actor)]).toHaveLength(2);
  });

  it("keeps a required EP replacement open on either Cancel, but permits voluntary cancellation", async () => {
    const { party } = encounter(true);
    game.scene.twoPlayerEnemyPlayerMode = true;
    const voluntary = new EnemyCommandPhase(0);
    const current = vi.spyOn(game.scene.phaseManager, "getCurrentPhase").mockReturnValue(voluntary);
    const picker = game.scene.ui.handlers[UiMode.PARTY] as PartyUiHandler;
    expect(voluntary.handleCommand(Command.POKEMON, 0)).toBe(true);
    await vi.waitFor(() => expect(picker["partyUiMode"]).toBe(PartyUiMode.ENEMY_SWITCH));
    picker.processInput(Button.CANCEL);
    await vi.waitFor(() => expect(game.scene.ui.getMode()).toBe(UiMode.COMMAND));

    party[0].hp = 0;
    const required = new SwitchSummonPhase(SwitchType.SWITCH, 0, -1, false, false);
    current.mockReturnValue(required);
    const resume = vi.spyOn(required, "preSummon").mockImplementation(() => {});
    required["promptEnemyPlayerReplacement"]();
    await vi.waitFor(() => expect(picker["partyUiMode"]).toBe(PartyUiMode.ENEMY_REPLACEMENT));
    picker.processInput(Button.CANCEL);
    picker.setCursor(6);
    picker.processInput(Button.ACTION);
    expect(game.scene.ui.getMode()).toBe(UiMode.PARTY);
    expect(resume).not.toHaveBeenCalled();
    expect(picker["getParty"]()).toEqual([party[0], party[2]]);
    picker.setCursor(1);
    picker.processInput(Button.ACTION);
    const sendOut = picker["options"].indexOf(PartyOption.SEND_OUT);
    expect(sendOut).toBeGreaterThanOrEqual(0);
    picker.setCursor(sendOut);
    picker.processInput(Button.ACTION);
    await vi.waitFor(() => expect(resume).toHaveBeenCalledOnce());
    expect(required["slotIndex"]).toBe(2);
    expect(game.scene.ui.getMode()).toBe(UiMode.MESSAGE);
  });

  it("does not offer EP medicine in wild battles, with an empty bag, or for a second action by the same trainer", () => {
    const { trainer, battle, party } = encounter(true);
    game.scene.twoPlayerEnemyPlayerMode = true;
    const phase = new EnemyCommandPhase(0);
    const owner = trainer.getMedicineOwner(party[0]);
    expect(phase.canUseCommand(Command.BALL)).toBe(false);
    trainer.medicineBags[owner] = ["POTION"];
    battle.battleType = BattleType.WILD;
    expect(phase.canUseCommand(Command.BALL)).toBe(false);
    battle.battleType = BattleType.TRAINER;
    party[1].trainerSlot = party[0].trainerSlot;
    battle.turnCommands[party[1].getBattlerIndex()] = {
      command: Command.MEDICINE, medicine: { typeId: "POTION", targetId: party[0].id },
    };
    expect(phase.canUseCommand(Command.BALL)).toBe(false);
  });

  it("evaluates fainted reserves at restored HP and priority without consuming items or changing the field", () => {
    const { trainer, party, foe, battle } = encounter();
    const [actor, fast, ace] = party;
    trainer.medicineBags[TrainerSlot.TRAINER] = ["REVIVE"];
    fast.hp = ace.hp = 0;
    ace.ace = true;
    fast.moveset = [new PokemonMove(MoveId.QUICK_ATTACK)];
    ace.moveset = [new PokemonMove(MoveId.VITAL_THROW)];
    actor.moveset = [new PokemonMove(MoveId.SPLASH)];
    const damage = (damage: number) => ({ damage, cancelled: false, result: 1 });
    vi.spyOn(foe, "getAttackDamage").mockReturnValue(damage(foe.hp * 2));
    vi.spyOn(fast, "getAttackDamage").mockReturnValue(damage(fast.getMaxHp() * 2));
    vi.spyOn(ace, "getAttackDamage").mockReturnValue(damage(ace.getMaxHp() * 0.75));
    const move = { move: MoveId.SPLASH, targets: [actor.getBattlerIndex()], useMode: MoveUseMode.NORMAL };
    const expected = { targetId: fast.id, typeId: "REVIVE" };
    expect(chooseTrainerMedicine(actor, move)).toEqual(expected);
    trainer.medicineBags[TrainerSlot.TRAINER] = ["MAX_REVIVE"];
    expect(chooseTrainerMedicine(actor, move)).toEqual({ targetId: ace.id, typeId: "MAX_REVIVE" });
    expect(battle.enemyParty).toEqual(party);
    expect([ace.hp, fast.hp]).toEqual([0, 0]);
    battle.turnCommands[actor.getBattlerIndex()] = { command: Command.MEDICINE, medicine: expected };
    expect(chooseTrainerMedicine(actor, move)).toBeUndefined();
    expect(trainer.medicineBags[TrainerSlot.TRAINER]).toEqual(["MAX_REVIVE"]);
  });

  it("spends a doomed attacker's command on a benched heal instead of a futile self-heal", () => {
    const { trainer, party, battle } = encounter();
    const [actor, reserve] = party;
    actor.hp = reserve.hp = 1;
    actor.moveset = [new PokemonMove(MoveId.SPLASH)];
    vi.spyOn(actor, "isTrapped").mockReturnValue(true);
    vi.spyOn(actor, "getAttackDamage").mockReturnValue({ damage: actor.getMaxHp() * 2, result: 1, cancelled: false });
    trainer.medicineBags[TrainerSlot.TRAINER] = ["MAX_POTION"];
    const phase = new EnemyCommandPhase(0);
    vi.spyOn(phase, "end").mockImplementation(() => {});
    phase.start();
    const medicine = { typeId: "MAX_POTION", targetId: reserve.id };
    expect(battle.turnCommands[actor.getBattlerIndex()]).toEqual({ command: Command.MEDICINE, medicine });
    const use = new EnemyMedicinePhase(actor.id, medicine);
    vi.spyOn(use, "end").mockImplementation(() => {});
    use.start();
    expect(actor.hp).toBe(1);
    expect(reserve.isFullHp()).toBe(true);
    expect(trainer.medicineBags[TrainerSlot.TRAINER]).toEqual([]);
  });
});
