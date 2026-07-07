import { TrainerType } from "#enums/trainer-type";
import { toCamelCase, toTitleCase } from "#utils/strings";

export enum ContestCoordinatorType {
  UNKNOWN,
  COORDINATOR,
  ACE_TRAINER,
  AROMA_LADY,
  BEAUTY,
  BREEDER,
  CAMPER,
  COLLECTOR,
  EXPERT,
  COOL_TRAINER_F,
  FLOWERS_GIRL,
  GENTLEMAN,
  GREEN_SHOES_BOY,
  HEX_MANIAC,
  LASS,
  NINJA_BOY,
  POKEFAN,
  PSYCHIC,
  RICH_BOY,
  SCHOOL_KID,
  TRIATHLETE,
  TUBER,
  YELLOW_DRESS_GIRL,
  YOUNGSTER,
  BATTLE_GIRL,
  BLACK_BELT,
  BUG_CATCHER,
  COOL_TRAINER_M,
  FOSSIL_MANIAC,
  GUITARIST,
  HIKER,
  KIRI,
  LADY,
  MOVE_REMINDER,
  MR_BRINEY,
  PICNICKER,
  POKEFAN_F,
  POKEFAN_M,
  POKEMON_BREEDER_M,
  PSYCHIC_M,
  SAILOR,
  SCIENTIST,
  TEALA,
  TWIN,
  YOUNG_COUPLE_F,
  DAWN_CONTEST,
  MAY_CONTEST,
  MOM,
  NURSE,
  NURSE_BORED,
  TUBER_M,
  VALERIE,
}

export class ContestCoordinatorConfig {
  public coordinatorType: ContestCoordinatorType;
  public name: string;
  public title: string;
  public trainerType?: TrainerType;
  public spriteKey?: string;

  constructor(coordinatorType: ContestCoordinatorType) {
    this.coordinatorType = coordinatorType;
    this.name = toTitleCase(ContestCoordinatorType[coordinatorType]);
    this.title = toCamelCase(this.name);
  }

  getKey(): string {
    return ContestCoordinatorType[this.coordinatorType].toString().toLowerCase();
  }

  getSpriteKey(): string {
    return (
      this.spriteKey
      ?? (this.trainerType === undefined ? this.getKey() : TrainerType[this.trainerType].toString().toLowerCase())
    );
  }

  setName(name: string): ContestCoordinatorConfig {
    this.name = name;

    return this;
  }

  setTitle(title: string): ContestCoordinatorConfig {
    this.title = toCamelCase(title);

    return this;
  }

  setTrainerType(trainerType: TrainerType): ContestCoordinatorConfig {
    this.trainerType = trainerType;

    return this;
  }

  setSpriteKey(spriteKey: string): ContestCoordinatorConfig {
    this.spriteKey = spriteKey;

    return this;
  }
}

export const contestCoordinatorConfigs = {
  [ContestCoordinatorType.UNKNOWN]: new ContestCoordinatorConfig(ContestCoordinatorType.UNKNOWN),
  [ContestCoordinatorType.COORDINATOR]: new ContestCoordinatorConfig(ContestCoordinatorType.COORDINATOR),
  [ContestCoordinatorType.ACE_TRAINER]: new ContestCoordinatorConfig(ContestCoordinatorType.ACE_TRAINER).setTrainerType(
    TrainerType.ACE_TRAINER,
  ),
  [ContestCoordinatorType.AROMA_LADY]: new ContestCoordinatorConfig(ContestCoordinatorType.AROMA_LADY).setTrainerType(
    TrainerType.AROMA_LADY,
  ),
  [ContestCoordinatorType.BEAUTY]: new ContestCoordinatorConfig(ContestCoordinatorType.BEAUTY).setTrainerType(
    TrainerType.BEAUTY,
  ),
  [ContestCoordinatorType.BREEDER]: new ContestCoordinatorConfig(ContestCoordinatorType.BREEDER).setTrainerType(
    TrainerType.BREEDER,
  ),
  [ContestCoordinatorType.CAMPER]: new ContestCoordinatorConfig(ContestCoordinatorType.CAMPER).setTrainerType(
    TrainerType.CAMPER,
  ),
  [ContestCoordinatorType.COLLECTOR]: new ContestCoordinatorConfig(ContestCoordinatorType.COLLECTOR).setTrainerType(
    TrainerType.COLLECTOR,
  ),
  [ContestCoordinatorType.EXPERT]: new ContestCoordinatorConfig(ContestCoordinatorType.EXPERT)
    .setTrainerType(TrainerType.VETERAN)
    .setSpriteKey("veteran_f"),
  [ContestCoordinatorType.COOL_TRAINER_F]: new ContestCoordinatorConfig(ContestCoordinatorType.COOL_TRAINER_F)
    .setTrainerType(TrainerType.ACE_TRAINER)
    .setSpriteKey("ace_trainer_f"),
  [ContestCoordinatorType.FLOWERS_GIRL]: new ContestCoordinatorConfig(ContestCoordinatorType.FLOWERS_GIRL)
    .setTrainerType(TrainerType.AROMA_LADY)
    .setSpriteKey("aroma_lady"),
  [ContestCoordinatorType.GENTLEMAN]: new ContestCoordinatorConfig(ContestCoordinatorType.GENTLEMAN)
    .setTrainerType(TrainerType.RICH)
    .setSpriteKey("gentleman_jext"),
  [ContestCoordinatorType.GREEN_SHOES_BOY]: new ContestCoordinatorConfig(ContestCoordinatorType.GREEN_SHOES_BOY)
    .setTrainerType(TrainerType.YOUNGSTER)
    .setSpriteKey("youngster_m"),
  [ContestCoordinatorType.HEX_MANIAC]: new ContestCoordinatorConfig(ContestCoordinatorType.HEX_MANIAC).setTrainerType(
    TrainerType.HEX_MANIAC,
  ),
  [ContestCoordinatorType.LASS]: new ContestCoordinatorConfig(ContestCoordinatorType.LASS)
    .setTrainerType(TrainerType.YOUNGSTER)
    .setSpriteKey("youngster_f"),
  [ContestCoordinatorType.NINJA_BOY]: new ContestCoordinatorConfig(ContestCoordinatorType.NINJA_BOY).setSpriteKey(
    "ninja_boy",
  ),
  [ContestCoordinatorType.POKEFAN]: new ContestCoordinatorConfig(ContestCoordinatorType.POKEFAN).setTrainerType(
    TrainerType.POKEFAN,
  ),
  [ContestCoordinatorType.PSYCHIC]: new ContestCoordinatorConfig(ContestCoordinatorType.PSYCHIC).setTrainerType(
    TrainerType.PSYCHIC,
  ),
  [ContestCoordinatorType.RICH_BOY]: new ContestCoordinatorConfig(ContestCoordinatorType.RICH_BOY).setTrainerType(
    TrainerType.RICH_KID,
  ),
  [ContestCoordinatorType.SCHOOL_KID]: new ContestCoordinatorConfig(ContestCoordinatorType.SCHOOL_KID).setTrainerType(
    TrainerType.SCHOOL_KID,
  ),
  [ContestCoordinatorType.TRIATHLETE]: new ContestCoordinatorConfig(ContestCoordinatorType.TRIATHLETE)
    .setTrainerType(TrainerType.CYCLIST)
    .setSpriteKey("triathlete_kyledove"),
  [ContestCoordinatorType.TUBER]: new ContestCoordinatorConfig(ContestCoordinatorType.TUBER)
    .setTrainerType(TrainerType.SWIMMER)
    .setSpriteKey("tuber_f_kyledove"),
  [ContestCoordinatorType.YELLOW_DRESS_GIRL]: new ContestCoordinatorConfig(ContestCoordinatorType.YELLOW_DRESS_GIRL)
    .setTrainerType(TrainerType.PRESCHOOLER)
    .setSpriteKey("preschooler_f"),
  [ContestCoordinatorType.YOUNGSTER]: new ContestCoordinatorConfig(ContestCoordinatorType.YOUNGSTER).setTrainerType(
    TrainerType.YOUNGSTER,
  ),
  [ContestCoordinatorType.BATTLE_GIRL]: new ContestCoordinatorConfig(ContestCoordinatorType.BATTLE_GIRL)
    .setTrainerType(TrainerType.SMASHER)
    .setSpriteKey("smasher"),
  [ContestCoordinatorType.BLACK_BELT]: new ContestCoordinatorConfig(ContestCoordinatorType.BLACK_BELT).setTrainerType(
    TrainerType.BLACK_BELT,
  ),
  [ContestCoordinatorType.BUG_CATCHER]: new ContestCoordinatorConfig(ContestCoordinatorType.BUG_CATCHER).setTrainerType(
    TrainerType.BUG_CATCHER,
  ),
  [ContestCoordinatorType.COOL_TRAINER_M]: new ContestCoordinatorConfig(ContestCoordinatorType.COOL_TRAINER_M)
    .setTrainerType(TrainerType.ACE_TRAINER)
    .setSpriteKey("ace_trainer_m"),
  [ContestCoordinatorType.FOSSIL_MANIAC]: new ContestCoordinatorConfig(
    ContestCoordinatorType.FOSSIL_MANIAC,
  ).setTrainerType(TrainerType.RUIN_MANIAC),
  [ContestCoordinatorType.GUITARIST]: new ContestCoordinatorConfig(ContestCoordinatorType.GUITARIST).setTrainerType(
    TrainerType.GUITARIST,
  ),
  [ContestCoordinatorType.HIKER]: new ContestCoordinatorConfig(ContestCoordinatorType.HIKER).setTrainerType(
    TrainerType.HIKER,
  ),
  [ContestCoordinatorType.KIRI]: new ContestCoordinatorConfig(ContestCoordinatorType.KIRI)
    .setTrainerType(TrainerType.AROMA_LADY)
    .setSpriteKey("aroma_lady"),
  [ContestCoordinatorType.LADY]: new ContestCoordinatorConfig(ContestCoordinatorType.LADY)
    .setTrainerType(TrainerType.RICH_KID)
    .setSpriteKey("rich_kid_f"),
  [ContestCoordinatorType.MOVE_REMINDER]: new ContestCoordinatorConfig(ContestCoordinatorType.MOVE_REMINDER)
    .setTrainerType(TrainerType.VETERAN)
    .setSpriteKey("veteran_f"),
  [ContestCoordinatorType.MR_BRINEY]: new ContestCoordinatorConfig(ContestCoordinatorType.MR_BRINEY).setTrainerType(
    TrainerType.SAILOR,
  ),
  [ContestCoordinatorType.PICNICKER]: new ContestCoordinatorConfig(ContestCoordinatorType.PICNICKER)
    .setTrainerType(TrainerType.CAMPER)
    .setSpriteKey("camper_f"),
  [ContestCoordinatorType.POKEFAN_F]: new ContestCoordinatorConfig(ContestCoordinatorType.POKEFAN_F)
    .setTrainerType(TrainerType.POKEFAN)
    .setSpriteKey("pokefan_f"),
  [ContestCoordinatorType.POKEFAN_M]: new ContestCoordinatorConfig(ContestCoordinatorType.POKEFAN_M)
    .setTrainerType(TrainerType.POKEFAN)
    .setSpriteKey("pokefan_m"),
  [ContestCoordinatorType.POKEMON_BREEDER_M]: new ContestCoordinatorConfig(ContestCoordinatorType.POKEMON_BREEDER_M)
    .setTrainerType(TrainerType.BREEDER)
    .setSpriteKey("breeder_m"),
  [ContestCoordinatorType.PSYCHIC_M]: new ContestCoordinatorConfig(ContestCoordinatorType.PSYCHIC_M)
    .setTrainerType(TrainerType.PSYCHIC)
    .setSpriteKey("psychic_m"),
  [ContestCoordinatorType.SAILOR]: new ContestCoordinatorConfig(ContestCoordinatorType.SAILOR).setTrainerType(
    TrainerType.SAILOR,
  ),
  [ContestCoordinatorType.SCIENTIST]: new ContestCoordinatorConfig(ContestCoordinatorType.SCIENTIST)
    .setTrainerType(TrainerType.SCIENTIST)
    .setSpriteKey("scientist_m"),
  [ContestCoordinatorType.TEALA]: new ContestCoordinatorConfig(ContestCoordinatorType.TEALA).setTrainerType(
    TrainerType.BEAUTY,
  ),
  [ContestCoordinatorType.TWIN]: new ContestCoordinatorConfig(ContestCoordinatorType.TWIN).setTrainerType(
    TrainerType.TWINS,
  ),
  [ContestCoordinatorType.YOUNG_COUPLE_F]: new ContestCoordinatorConfig(ContestCoordinatorType.YOUNG_COUPLE_F)
    .setTrainerType(TrainerType.YOUNG_COUPLE)
    .setSpriteKey("young_couple"),
  [ContestCoordinatorType.DAWN_CONTEST]: new ContestCoordinatorConfig(ContestCoordinatorType.DAWN_CONTEST)
    .setName("Dawn")
    .setSpriteKey("dawn_contest_kyledove"),
  [ContestCoordinatorType.MAY_CONTEST]: new ContestCoordinatorConfig(ContestCoordinatorType.MAY_CONTEST)
    .setName("May")
    .setSpriteKey("may_contest_kyledove"),
  [ContestCoordinatorType.MOM]: new ContestCoordinatorConfig(ContestCoordinatorType.MOM)
    .setName("Mom")
    .setSpriteKey("mom_kyledove"),
  [ContestCoordinatorType.NURSE]: new ContestCoordinatorConfig(ContestCoordinatorType.NURSE)
    .setName("Nurse")
    .setSpriteKey("nurse_kyledove"),
  [ContestCoordinatorType.NURSE_BORED]: new ContestCoordinatorConfig(ContestCoordinatorType.NURSE_BORED)
    .setName("Nurse")
    .setSpriteKey("nurse_bored_kyledove"),
  [ContestCoordinatorType.TUBER_M]: new ContestCoordinatorConfig(ContestCoordinatorType.TUBER_M)
    .setName("Tuber")
    .setSpriteKey("tuber_m_kyledove"),
  [ContestCoordinatorType.VALERIE]: new ContestCoordinatorConfig(ContestCoordinatorType.VALERIE)
    .setName("Valerie")
    .setSpriteKey("valerie_kyledove"),
} as const satisfies Record<ContestCoordinatorType, ContestCoordinatorConfig>;
