import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { PokemonMove } from "#moves/pokemon-move";
import { CommandPhase } from "#phases/command-phase";
import { GameManager } from "#test/framework/game-manager";
import { setSetting, SettingKeys } from "#system/settings";
import { UiInputs } from "#app/ui-inputs";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { PrivateFightPhase, PrivatePauseMenuPhase, type PlannedFight } from "#phases/private-fight-phase";
import { Button } from "#enums/buttons";
import { Command } from "#enums/command";
import { UiMode } from "#enums/ui-mode";
import { PartyUiMode } from "#enums/party-ui-mode";
import { PokeballType } from "#enums/pokeball";
import type { BallUiHandler } from "#ui/ball-ui-handler";
import { PartyOption, PartyUiHandler } from "#ui/party-ui-handler";
import * as theme from "#ui/ui-theme";
import { CommandUiHandler } from "#ui/command-ui-handler";
import { FightUiHandler } from "#ui/fight-ui-handler";
import * as moveUtils from "#moves/move-utils";
import type { PrivateTurnPick, PrivateTurnBatch, ReviewPrivateTurn } from "#utils/private-turn";
import { canPlanPrivateTurn } from "#phases/turn-init-phase";
import { BattleType } from "#enums/battle-type";
import { FieldPosition } from "#enums/field-position";
import { AttemptCapturePhase } from "#phases/attempt-capture-phase";
import { EnemyCommandPhase } from "#phases/enemy-command-phase";
import { Trainer } from "#field/trainer";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { TrainerSlot } from "#enums/trainer-slot";
import * as medicineAi from "#utils/battle-medicine-ai";
import { BerserkGeneModifier } from "#modifiers/modifier";
import { beforeAll, expect, it, vi } from "vitest";

let phaser: Phaser.Game;
beforeAll(() => { phaser = new Phaser.Game({ type: Phaser.HEADLESS }); });

it("defaults an existing host's settings to sequential and shares a saved private preference", async () => {
  const game = new GameManager(phaser);
  await game.runToTitle();
  const scene = game.scene;
  scene.configureTwoPlayerMode(true, 6, false, 2);
  scene.twoPlayerLocalInputSeat = 0;
  const original = localStorage.getItem("settings");
  const key = SettingKeys.Turn_Mode;
  try {
    localStorage.setItem("settings", "{}");
    const sequential = scene.getTwoPlayerSettingsSnapshot()!;
    expect(sequential.settings[key]).toBe(0);
    scene.gameData.saveSetting(key, 1);
    expect(scene.privateTurnSelection).toBe(true);
    const simultaneous = scene.getTwoPlayerSettingsSnapshot()!;
    expect(simultaneous.settings[key]).toBe(1);
    scene.twoPlayerLocalInputSeat = 1;
    for (const snapshot of [sequential, simultaneous]) {
      expect(scene.applyTwoPlayerSettingsSnapshot({ settings: { [key]: snapshot.settings[key] } })).toBe(true);
      expect(scene.privateTurnSelection).toBe(snapshot.settings[key] === 1);
    }
  } finally {
    if (original === null) localStorage.removeItem("settings");
    else localStorage.setItem("settings", original);
  }
});

it.each([
  [3, undefined], [2, TrainerType.BROCK], [3, TrainerType.RIVAL_6],
] as const)("plans a %i-human turn from the last seat (trainer: %s)", async (count, trainerType) => {
  const game = new GameManager(phaser);
  await game.runToTitle();
  const scene = game.scene;
  scene.configureTwoPlayerMode(true, 6, false, count);
  scene.newBattle();
  scene.currentBattle.double = true;
  const trainer = trainerType === undefined ? null : new Trainer(trainerType, TrainerVariant.DEFAULT);
  scene.currentBattle.battleType = trainer ? BattleType.TRAINER : BattleType.WILD;
  scene.currentBattle.trainer = trainer;
  const local = count === 2 ? 1 : 2;
  scene.twoPlayerLocalInputSeat = local;
  setSetting(SettingKeys.Turn_Mode, 1);
  scene.uiInputs ??= {} as typeof scene.uiInputs;
  const capability = (value: number) => Object.defineProperty(scene.uiInputs, "privateFightSeats", { configurable: true, value });
  capability(0);
  expect(canPlanPrivateTurn()).toBe(false);
  capability(count);
  if (trainer) {
    Object.defineProperty(scene.uiInputs, "privateTrainerFightsEnabled", { configurable: true, value: false });
    expect(canPlanPrivateTurn()).toBe(false);
    Object.defineProperty(scene.uiInputs, "privateTrainerFightsEnabled", { configurable: true, value: true });
  }
  expect(canPlanPrivateTurn()).toBe(true);
  const seats = scene.getActivePlayerIndexes();
  const positions = [FieldPosition.LEFT, FieldPosition.CENTER, FieldPosition.RIGHT];
  const actors = seats.map(i => {
    const ally = scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.EEVEE), 20);
    const enemy = scene.addEnemyPokemon(getPokemonSpecies(SpeciesId.PSYDUCK), 15, trainer ? TrainerSlot.TRAINER : TrainerSlot.NONE);
    scene.getPlayerParty(i).push(ally);
    scene.getEnemyParty().push(enemy);
    for (const mon of [ally, enemy]) {
      mon.fieldPosition = positions[i];
      vi.spyOn(mon, "isOnField").mockReturnValue(true);
      vi.spyOn(mon, "isActive").mockReturnValue(true);
      vi.spyOn(mon, "getFieldIndex").mockReturnValue(i);
    }
    vi.spyOn(ally, "getMoveset").mockReturnValue([new PokemonMove(MoveId.TACKLE)]);
    return ally;
  });
  const plans = new Map<number, PlannedFight>();
  const phase = new PrivateFightPhase(plans);
  const current = vi.spyOn(scene.phaseManager, "getCurrentPhase").mockReturnValue(phase);
  const done = vi.spyOn(phase, "end").mockImplementation(() => {});
  const mode = vi.spyOn(scene.ui, "setMode").mockResolvedValue();
  vi.spyOn(scene.ui, "showText").mockImplementation(() => {});
  scene.uiInputs.beginPrivateDraft = vi.fn();
  const slots = seats.map(i => scene.getEnemyBattlerIndex(i));
  const picks = actors.map((actor, i) => ({ actor: actor.id, move: MoveId.TACKLE, slot: 0, target: slots[i] }));
  scene.uiInputs.submitPrivateFight = vi.fn(async (_key, pick, review) => {
    expect(pick).toEqual(picks[local]);
    const preceding = picks.slice(0, -1);
    expect(review(preceding)).toBe(false);
    if (count === 3) expect(review([...preceding, { ...picks[local], target: slots[0] }])).toBe(false);
    expect(review([...preceding, picks[0]])).toBe(false);
    if (trainer) expect(review([...preceding, { kind: "ball", actor: actors[local].id, ball: PokeballType.POKEBALL,
      targetId: scene.getEnemyParty()[local].id }])).toBe(false);
    expect(review(picks)).toBe(true);
    return picks;
  });
  phase.start();
  expect(mode).toHaveBeenLastCalledWith(UiMode.COMMAND, local);
  expect(phase.getPokemon()).toBe(actors[local]);
  if (trainer) {
    scene.getPlayerPokeballCounts(local)[PokeballType.POKEBALL] = 2;
    expect(phase.chooseBall(PokeballType.POKEBALL)).toBe(false);
    expect(scene.getPlayerPokeballCounts(local)[PokeballType.POKEBALL]).toBe(2);
    expect(scene.uiInputs.submitPrivateFight).not.toHaveBeenCalled();
  }
  expect(phase.chooseMove(0)).toBe(true);
  expect(mode.mock.lastCall?.[0]).toBe(UiMode.TARGET_SELECT);
  mode.mock.lastCall![3]([slots[local]]);
  await vi.waitFor(() => expect(done).toHaveBeenCalledOnce());
  expect(plans.size).toBe(count);
  for (const seat of seats) {
    const command = new CommandPhase(seat, plans);
    current.mockReturnValue(command);
    vi.spyOn(command, "end").mockImplementation(() => {});
    command.start();
    expect(scene.currentBattle.turnCommands[scene.getPlayerBattlerIndex(seat)]?.move)
      .toMatchObject({ move: MoveId.TACKLE, targets: [slots[seat]] });
  }
  if (trainer) {
    const enemy = scene.getEnemyParty()[0];
    const reserve = scene.addEnemyPokemon(getPokemonSpecies(SpeciesId.PIDGEY), 15, TrainerSlot.TRAINER);
    const index = scene.getEnemyParty().push(reserve) - 1;
    const medicine = { typeId: "POTION", targetId: enemy.id };
    scene.plannerAiEnabled = false;
    vi.spyOn(trainer, "getPartyMemberMatchupScores").mockReturnValue(count === 3 ? [[index, 100]] : []);
    vi.spyOn(enemy, "getMatchupScore").mockReturnValue(1);
    vi.spyOn(trainer, "getNextSummonIndex").mockReturnValue(index);
    const decideMedicine = vi.spyOn(medicineAi, "chooseTrainerMedicine").mockReturnValue(medicine);
    const command = new EnemyCommandPhase(0);
    current.mockReturnValue(command);
    vi.spyOn(command, "end").mockImplementation(() => {});
    expect(scene.currentBattle.turnCommands[slots[0]]).toBeFalsy();
    command.start();
    expect(scene.currentBattle.turnCommands[slots[0]]).toMatchObject(count === 3
      ? { command: Command.POKEMON, cursor: index } : { command: Command.MEDICINE, medicine });
    decideMedicine.mockRestore();
  }
  // No deadlock when a seat has nothing to command on a later turn.
  vi.mocked(actors[1].isActive).mockReturnValue(false);
  phase.start();
  expect(done).toHaveBeenCalledTimes(2);
  expect(scene.uiInputs.beginPrivateDraft).toHaveBeenCalledTimes(1);
});

it.each([[0, "mixed"], [1, "mixed"], [1, "switches"], [0, "fallback"], [1, "fallback"], [0, "bag"], [1, "bag"],
  [0, "shadow"], [1, "gene"], [0, "invalid"], [1, "invalid"], [0, "wild-fights"], [0, "wild-ball-fight"],
  [1, "wild-ball-fight"], [1, "wild-balls"], [0, "wild-same-target"], [0, "late-rejection"],
  [0, "pause"], [1, "pause"], [1, "host-pause"], [0, "sequential-pause"], [1, "sequential-pause"]] as const)("seat %i chooses through native menus (%s)", async (seat, scenario) => {
  const game = new GameManager(phaser);
  await game.runToTitle();
  const scene = game.scene;
  scene.configureTwoPlayerMode(true, 6, false, 2);
  scene.newBattle();
  scene.currentBattle.double = true;
  scene.twoPlayerLocalInputSeat = seat;
  setSetting(SettingKeys.Turn_Mode, 1);
  const plans = new Map<number, PlannedFight>();
  const phase = new PrivateFightPhase(plans);
  const end = vi.spyOn(phase, "end").mockImplementation(() => {});
  const actors = ([0, 1] as const).map(i => {
    const p = scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.EEVEE), 20);
    scene.getPlayerParty(i).push(p);
    vi.spyOn(p, "getBattlerIndex").mockReturnValue(i);
    vi.spyOn(p, "getFieldIndex").mockReturnValue(i);
    vi.spyOn(p, "isOnField").mockReturnValue(true);
    vi.spyOn(p, "isActive").mockReturnValue(true);
    vi.spyOn(p, "getNameToRender").mockReturnValue("Player " + i);
    vi.spyOn(p, "getMoveset").mockReturnValue([new PokemonMove(MoveId.TACKLE), new PokemonMove(MoveId.HELPING_HAND)]);
    return p;
  });
  scene.currentBattle.mysteryEncounter = { misc: { shinyBadgeDuelActive: true, shinyBadgeDuelPlayerIndexes: [0, 1] } } as typeof scene.currentBattle.mysteryEncounter;
  const reserves = ([0, 1] as const).map(i => {
    const p = scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.PSYDUCK), 20);
    scene.getPlayerParty(i).push(p);
    return p;
  });
  vi.spyOn(scene, "getPlayerField").mockReturnValue(actors);
  if (scenario.startsWith("wild")) {
    scene.currentBattle.mysteryEncounter = undefined;
    scene.currentBattle.battleType = BattleType.WILD;
    for (const i of [0, 1]) {
      const enemy = scene.addEnemyPokemon(getPokemonSpecies(SpeciesId.PSYDUCK), 15, 0);
      scene.getEnemyParty().push(enemy);
      vi.spyOn(enemy, "isOnField").mockReturnValue(true);
      vi.spyOn(enemy, "isActive").mockReturnValue(true);
      vi.spyOn(enemy, "getBattlerIndex").mockReturnValue(scene.getEnemyBattlerIndex(i));
      scene.getPlayerPokeballCounts(i as 0 | 1)[PokeballType.POKEBALL] = 2;
    }
  } else vi.spyOn(scene, "getField").mockReturnValue(actors);
  const originalTargets = moveUtils.getMoveTargets;
  const targeting = vi.spyOn(moveUtils, "getMoveTargets").mockImplementation((...args) =>
    args[1] === MoveId.HELPING_HAND ? { targets: [0, 1], multiple: false } : originalTargets(...args));
  let release!: (v: PrivateTurnBatch) => void;
  const submit = vi.fn((_key: string, _pick: PrivateTurnPick | null, review: ReviewPrivateTurn) =>
    new Promise<PrivateTurnBatch>(resolve => { release = batch => resolve(batch && review(batch) ? batch : null); }));
  const current = vi.spyOn(scene.phaseManager, "getCurrentPhase").mockReturnValue(phase);
  scene.uiInputs ??= {} as typeof scene.uiInputs;
  scene.uiInputs.submitPrivateFight = submit;
  scene.uiInputs.beginPrivateDraft = vi.fn();
  const skin = vi.spyOn(theme, "applyWindowAppearance");
  const mode = vi.spyOn(scene.ui, "setMode").mockResolvedValue();
  const message = vi.spyOn(scene.ui, "showText").mockImplementation(() => {});
  const confirm = vi.spyOn(scene.ui, "setModeWithoutClear").mockResolvedValue();
  vi.spyOn(scene.ui, "playSelect").mockImplementation(() => {});
  if (scenario === "shadow" || scenario === "gene") {
    if (scenario === "shadow") vi.spyOn(actors[1], "isShadowPokemon").mockReturnValue(true);
    else vi.spyOn(actors[0], "getActiveHeldItems").mockReturnValue([Object.create(BerserkGeneModifier.prototype)]);
    phase.start();
    expect(end).toHaveBeenCalledTimes(1);
    expect(mode).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    targeting.mockRestore();
    return;
  }
  phase.start();
  expect(skin).toHaveBeenLastCalledWith(seat + 1);
  expect(mode).toHaveBeenLastCalledWith(UiMode.COMMAND, seat);
  if (scenario === "pause" || scenario === "host-pause" || scenario === "sequential-pause") {
    const owner = scenario === "host-pause" ? 0 : 1;
    const other = owner === 0 ? 1 : 0;
    const [oldKey, grant] = vi.mocked(scene.uiInputs.beginPrivateDraft).mock.lastCall!;
    const queue = vi.spyOn(scene.phaseManager, "unshiftNew");
    scene.uiInputs.broadcastTwoPlayerSettingsSnapshot = vi.fn();
    expect(phase.chooseSwitch(reserves[seat].id, false)).toBe(true);
    await Promise.resolve();
    const openedAt = 1800000000000;
    grant(owner, openedAt);
    release(null);
    await vi.waitFor(() => expect(end).toHaveBeenCalledOnce());
    expect(plans.size).toBe(0);
    expect(queue).toHaveBeenCalledWith("PrivatePauseMenuPhase", owner, plans, 1, openedAt);
    const menu = new PrivatePauseMenuPhase(owner, plans, 1, openedAt);
    current.mockReturnValue(menu);
    vi.spyOn(menu, "end").mockImplementation(() => {});
    menu.start();
    expect(mode).toHaveBeenLastCalledWith(UiMode.MENU);
    const turnMode = scenario === "sequential-pause" ? 0 : 1;
    const hostSettings = { settings: { [SettingKeys.Window_Type]: 0, [SettingKeys.Item_Set_Destiny_Knots]: 0, [SettingKeys.Turn_Mode]: turnMode } };
    if (seat === 0) setSetting(SettingKeys.Turn_Mode, turnMode);
    if (seat === 1) {
      expect(scene.applyTwoPlayerSettingsSnapshot(hostSettings)).toBe(true);
      expect(scene.inputOwner).toBe(owner);
      expect(scene.windowType).toBe(owner + 1);
    }
    expect(scene.canAcceptLocalInput()).toBe(seat === owner);
    expect(scene.canAcceptRemoteInput(other)).toBe(false);
    expect(scene.canAcceptRemoteInput(owner)).toBe(true);
    const inputs: UiInputs = Object.assign(Object.create(UiInputs.prototype), { twoPlayerInputDebugEvents: [] });
    vi.spyOn(scene.ui, "getMode").mockReturnValue(UiMode.MENU);
    const navigate = vi.spyOn(scene.ui, "processInput").mockReturnValue(true);
    expect(inputs.processRemoteInput(other, Button.ACTION)).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(inputs.processRemoteInput(owner, Button.ACTION)).toBe(true);
    expect(navigate).toHaveBeenCalledExactlyOnceWith(Button.ACTION);
    expect(inputs.processRemoteInput(other, Button.MENU)).toBe(false);
    expect(menu.end).not.toHaveBeenCalled();
    expect(inputs.processRemoteInput(owner, Button.CANCEL)).toBe(true);
    await Promise.resolve();
    expect(menu.end).toHaveBeenCalledOnce();
    expect(scene.uiInputs.broadcastTwoPlayerSettingsSnapshot).toHaveBeenCalledTimes(2);
    if (scenario === "sequential-pause") {
      expect(queue).not.toHaveBeenCalledWith("PrivateFightPhase", plans, 1);
      expect(plans.size).toBe(0);
      targeting.mockRestore();
      return;
    }
    expect(queue).toHaveBeenCalledWith("PrivateFightPhase", plans, 1);
    const fresh = new PrivateFightPhase(plans, 1);
    current.mockReturnValue(fresh);
    fresh.start();
    expect(vi.mocked(scene.uiInputs.beginPrivateDraft).mock.lastCall![0]).not.toBe(oldKey);
    expect(mode).toHaveBeenLastCalledWith(UiMode.COMMAND, seat);
    if (seat === 1) {
      // The close snapshot may arrive after the new private draft is already visible.
      scene.applyTwoPlayerSettingsSnapshot(hostSettings);
      expect(scene.windowType).toBe(2);
      expect(scene.inputOwner).toBe("both");
      expect(scene.canAcceptLocalInput()).toBe(true);
      vi.mocked(scene.ui.getMode).mockReturnValue(UiMode.COMMAND);
      expect(inputs.submitUiButton(Button.RIGHT)).toBe(true);
      expect(navigate).toHaveBeenLastCalledWith(Button.RIGHT);
      expect(inputs.processRemoteInput(0, Button.LEFT)).toBe(false);
    }
    targeting.mockRestore();
    return;
  }
  if (scenario.startsWith("wild")) {
    Object.defineProperty(scene.uiInputs, "privateFightSeats", { configurable: true, value: 2 });
    setSetting(SettingKeys.Turn_Mode, 0);
    expect(canPlanPrivateTurn()).toBe(false);
    setSetting(SettingKeys.Turn_Mode, 1);
    expect(canPlanPrivateTurn()).toBe(true);
    scene.currentBattle.battleType = BattleType.TRAINER;
    expect(canPlanPrivateTurn()).toBe(false);
    scene.currentBattle.battleType = BattleType.WILD;
    const slots = [scene.getEnemyBattlerIndex(0), scene.getEnemyBattlerIndex(scenario === "wild-same-target" ? 0 : 1)];
    const picks = actors.map((actor, i) => scenario === "wild-fights" || (scenario === "wild-ball-fight" && i === 1)
      ? { actor: actor.id, slot: 0, move: MoveId.TACKLE, target: slots[i] }
      : { actor: actor.id, kind: "ball", ball: PokeballType.POKEBALL, targetId: scene.getField()[slots[i]].id }) as NonNullable<PrivateTurnBatch>;
    const local = picks[seat];
    expect("kind" in local ? phase.chooseBall(PokeballType.POKEBALL) : phase.chooseMove(0)).toBe(true);
    expect(mode.mock.lastCall?.[0]).toBe(UiMode.TARGET_SELECT);
    mode.mock.lastCall![3]([slots[seat]]);
    await Promise.resolve();
    expect(submit).toHaveBeenCalledWith(expect.any(String), local, expect.any(Function));
    release(picks);
    await Promise.resolve();
    expect(plans.size).toBe(2);
    for (const i of [0, 1] as const) {
      const command = new CommandPhase(i, plans);
      current.mockReturnValue(command);
      vi.spyOn(command, "end").mockImplementation(() => {});
      command.start();
      const queued = scene.currentBattle.turnCommands[i];
      if ("kind" in picks[i]) expect(queued).toMatchObject({ command: Command.BALL, targets: [slots[i]] });
      else expect(queued?.move).toMatchObject({ move: MoveId.TACKLE, targets: [slots[i]] });
      expect(scene.getPlayerPokeballCounts(i)[PokeballType.POKEBALL]).toBe(2);
      expect(command.end).toHaveBeenCalledTimes(1);
    }
    if (scenario === "wild-same-target") {
      scene.currentBattle.capturedBattlerIndexesThisTurn.add(slots[0]);
      const secondThrow = new AttemptCapturePhase(0, PokeballType.POKEBALL, 1, actors[1]);
      vi.spyOn(secondThrow, "end").mockImplementation(() => {});
      secondThrow.start();
      expect(secondThrow.end).toHaveBeenCalledOnce();
      expect(scene.getPlayerPokeballCounts(1)[PokeballType.POKEBALL]).toBe(2);
    }
    targeting.mockRestore();
    return;
  }
  const commandMenu = new CommandUiHandler();
  const fightMenu = new FightUiHandler();
  phase.cursors.command = Command.POKEMON;
  expect(commandMenu.processInput(Button.ACTION)).toBe(true);
  expect(mode).toHaveBeenLastCalledWith(UiMode.PARTY, PartyUiMode.SWITCH, seat, null, PartyUiHandler.FilterNonFainted);
  const partyMenu = new PartyUiHandler();
  Object.assign(partyMenu, {
    fieldIndex: seat, partyUiMode: PartyUiMode.SWITCH, partyDiscardModeButton: { clear() {} },
    clearOptions() {}, selectFilter: PartyUiHandler.FilterNonFainted,
  });
  expect(partyMenu.processInput(Button.CANCEL)).toBe(true);
  expect(mode).toHaveBeenLastCalledWith(UiMode.COMMAND, seat);
  expect(submit).not.toHaveBeenCalled();
  expect(phase.chooseSwitch(actors[seat].id, false)).toBe(false);
  expect(phase.chooseSwitch(reserves[1 - seat].id, false)).toBe(false);
  expect(phase.chooseSwitch(reserves[seat].id, true)).toBe(false);
  const trapped = vi.spyOn(actors[seat], "isTrapped").mockReturnValue(true);
  expect(phase.chooseSwitch(reserves[seat].id, false)).toBe(false);
  trapped.mockRestore();
  phase.cursors.command = Command.BALL;
  commandMenu.processInput(Button.ACTION);
  expect(confirm).toHaveBeenLastCalledWith(UiMode.BALL);
  const balls = scene.ui.handlers[UiMode.BALL] as BallUiHandler;
  if (scenario === "bag") {
    const move = new PokemonMove(MoveId.TACKLE, 3);
    reserves[0].moveset = [move];
    scene.getPlayerBagMedicines(0).push({ typeId: "ETHER", quantity: 1 });
    scene.getPlayerPokeballCounts(1)[PokeballType.CLONE_BALL] = 1;
    balls.show([]);
    scene.getPlayerPokeballCounts(seat)[PokeballType.POKEBALL] = 1;
    balls.setCursor(0);
    balls.processInput(Button.ACTION);
    expect(mode).toHaveBeenLastCalledWith(UiMode.MESSAGE);
    message.mock.lastCall![2]!();
    expect(confirm).toHaveBeenLastCalledWith(UiMode.BALL);
    expect(scene.getPlayerPokeballCounts(seat)[PokeballType.POKEBALL]).toBe(1);
    expect(submit).not.toHaveBeenCalled();
    if (seat === 0) {
      expect(phase.handleMedicineCommand("ETHER", actors[1].id, 0)).toBe(false);
      expect(phase.handleMedicineCommand("ETHER", reserves[0].id)).toBe(false);
      balls.processInput(Button.RIGHT);
      balls.processInput(Button.ACTION);
      expect(mode.mock.lastCall?.slice(0, 3)).toEqual([UiMode.PARTY, PartyUiMode.MOVE_MODIFIER, seat]);
      mode.mock.lastCall![3](6, PartyOption.CANCEL);
      await Promise.resolve();
      expect(confirm).toHaveBeenLastCalledWith(UiMode.BALL, true);
      expect(submit).not.toHaveBeenCalled();
      balls.processInput(Button.ACTION);
      mode.mock.lastCall![3](1, PartyOption.MOVE_1);
    } else {
      balls.setCursor(balls["pokeballTypes"].indexOf(PokeballType.CLONE_BALL));
      balls.processInput(Button.ACTION);
      expect(mode.mock.lastCall?.[0]).toBe(UiMode.TARGET_SELECT);
      mode.mock.lastCall![3]([]);
      expect(submit).not.toHaveBeenCalled();
      balls.processInput(Button.ACTION);
      mode.mock.lastCall![3]([0]);
    }
    balls.clear();
    const batch: PrivateTurnBatch = [
      { kind: "medicine", typeId: "ETHER", actor: actors[0].id, targetId: reserves[0].id, moveIndex: 0 },
      { kind: "ball", actor: actors[1].id, ball: PokeballType.CLONE_BALL, targetId: actors[0].id },
    ];
    await Promise.resolve();
    expect(submit).toHaveBeenCalledWith(expect.any(String), batch[seat], expect.any(Function));
    expect(plans.size).toBe(0);
    release(batch);
    await Promise.resolve();
    expect(end).toHaveBeenCalledTimes(1);
    for (const i of [0, 1]) {
      const command = new CommandPhase(i, plans);
      current.mockReturnValue(command);
      vi.spyOn(command, "end").mockImplementation(() => {});
      command.start();
      expect(command.end).toHaveBeenCalledTimes(1);
    }
    expect(scene.currentBattle.turnCommands[0]?.medicine).toEqual({ typeId: "ETHER", targetId: reserves[0].id, moveIndex: 0 });
    expect(scene.currentBattle.turnCommands[1]).toMatchObject({ command: Command.BALL, targets: [0], cloneTargetId: actors[0].id });
    expect(scene.getPlayerBagMedicines(0)[0].quantity).toBe(1);
    expect(scene.getPlayerPokeballCounts(1)[PokeballType.CLONE_BALL]).toBe(1);
    targeting.mockRestore();
    return;
  }
  phase.cursors.command = Command.RUN;
  commandMenu.processInput(Button.ACTION);
  expect(confirm.mock.lastCall?.[0]).toBe(UiMode.CONFIRM);
  confirm.mock.lastCall![2](); // No: neither player is committed.
  expect(mode).toHaveBeenLastCalledWith(UiMode.COMMAND, seat);
  phase.cursors.command = Command.FIGHT;
  commandMenu.processInput(Button.ACTION);
  expect(mode).toHaveBeenLastCalledWith(UiMode.FIGHT, seat);
  phase.cursors.move = 1;
  fightMenu.processInput(Button.ACTION);
  expect(mode.mock.lastCall?.[0]).toBe(UiMode.TARGET_SELECT);
  mode.mock.lastCall![3]([]); // Cancel the target on the field.
  expect(mode).toHaveBeenLastCalledWith(UiMode.FIGHT, seat);
  expect(submit).not.toHaveBeenCalled();
  if (scenario === "fallback") {
    fightMenu.processInput(Button.CANCEL);
    expect(mode).toHaveBeenLastCalledWith(UiMode.COMMAND, seat);
    phase.cursors.command = Command.RUN;
    commandMenu.processInput(Button.ACTION);
    confirm.mock.lastCall![1]();
    await Promise.resolve();
    expect(submit).toHaveBeenCalledWith(expect.any(String), null, expect.any(Function));
    expect(end).not.toHaveBeenCalled();
    release(null);
    await Promise.resolve();
    expect(plans.size).toBe(0);
    expect(end).toHaveBeenCalledTimes(1);
    targeting.mockRestore();
    current.mockReturnValue(new CommandPhase(seat));
    expect(commandMenu.getCursor()).toBe(Command.FIGHT);
    expect(fightMenu.getCursor()).toBe(0);
    return;
  }
  const picks = actors.map((p, i) => i === 1 || scenario === "switches"
    ? { kind: "switch", actor: p.id, reserve: reserves[i].id, baton: false }
    : { actor: p.id, move: 33, slot: 0, target: 1 - i }) as [PrivateTurnPick, PrivateTurnPick];
  if ("kind" in picks[seat]) {
    Object.assign(partyMenu, { optionsMode: true, cursor: 1, optionsCursor: 0, options: [PartyOption.SEND_OUT] });
    expect(partyMenu.processInput(Button.ACTION)).toBe(true);
  } else {
    phase.cursors.move = 0;
    fightMenu.processInput(Button.ACTION);
  }
  await Promise.resolve();
  expect(submit).toHaveBeenCalledWith(expect.any(String), picks[seat], expect.any(Function));
  expect(plans.size).toBe(0);
  expect(end).not.toHaveBeenCalled();
  if (scenario === "invalid") {
    picks[1 - seat] = { ...picks[1 - seat], actor: actors[seat].id };
    release(picks);
    await Promise.resolve();
    expect(plans.size).toBe(0);
    expect(end).toHaveBeenCalledTimes(1);
    targeting.mockRestore();
    return;
  }
  release(picks);
  await Promise.resolve();
  expect(skin).toHaveBeenLastCalledWith(5);
  expect(end).toHaveBeenCalledTimes(1);
  targeting.mockRestore();
  if (scenario === "late-rejection") {
    vi.spyOn(moveUtils, "getMoveTargets").mockReturnValueOnce({ targets: [], multiple: false });
    const command = new CommandPhase(0, plans);
    current.mockReturnValue(command);
    vi.spyOn(command, "end").mockImplementation(() => {});
    command.start();
    expect(plans.size).toBe(0);
    expect(scene.currentBattle.turnCommands[0]).toBeFalsy();
    expect(mode).toHaveBeenLastCalledWith(UiMode.COMMAND, 0);
    expect(command.end).not.toHaveBeenCalled();
    return;
  }
  for (const i of [0, 1]) {
    const command = new CommandPhase(i, plans);
    current.mockReturnValue(command);
    vi.spyOn(command, "end").mockImplementation(() => {});
    command.start();
    if ("kind" in picks[i]) expect(scene.currentBattle.turnCommands[i]).toMatchObject({ command: Command.POKEMON, cursor: 1, args: [false] });
    else expect(scene.currentBattle.turnCommands[i]?.move).toMatchObject({ move: MoveId.TACKLE, targets: [1 - i] });
    expect(command.end).toHaveBeenCalledTimes(1);
  }
});
