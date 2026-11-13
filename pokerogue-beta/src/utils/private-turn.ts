import { FieldPosition } from "#enums/field-position";

/** A private menu never writes battle commands. Only the relay's completed batch can do that. */
export interface PrivateFightPick {
  actor: number;
  slot: number;
  move: number;
  target: number | null;
}

export interface PrivateSwitchPick {
  kind: "switch";
  actor: number;
  reserve: number;
  baton: boolean;
}
export interface PrivateMedicinePick {
  kind: "medicine";
  actor: number;
  typeId: string;
  targetId: number;
  moveIndex?: number;
}
export interface PrivateBallPick {
  kind: "ball";
  actor: number;
  ball: number;
  targetId: number;
}
export type PrivateFieldPick = { kind: "pass"; actor: number } | { kind: "reposition"; actor: number; position: FieldPosition };
export type PrivateTurnPick = PrivateFightPick | PrivateSwitchPick | PrivateMedicinePick | PrivateBallPick | PrivateFieldPick;
export type PrivateTurnBatch = PrivateTurnPick[] | null;
export type ReviewPrivateTurn = (picks: NonNullable<PrivateTurnBatch>) => boolean;

export const isPrivateSeatPicks = (picks: unknown): picks is PrivateTurnPick[] =>
  Array.isArray(picks) && picks.length >= 1 && picks.length <= 3 && picks.every(isPrivateTurnPick)
  && new Set(picks.map(p => p.actor)).size === picks.length;

export function isPrivateTurnPick(value: unknown): value is PrivateTurnPick {
  if (!value || typeof value !== "object") return false;
  if ("kind" in value) {
    if (value.kind === "pass" || value.kind === "reposition") {
      const p = value as PrivateFieldPick;
      return Number.isSafeInteger(p.actor) && (p.kind === "pass" || Number.isInteger(p.position)
        && p.position >= FieldPosition.CENTER && p.position <= FieldPosition.FAR_RIGHT);
    }
    if (value.kind === "medicine" || value.kind === "ball") {
      const p = value as PrivateMedicinePick | PrivateBallPick;
      return Number.isSafeInteger(p.actor) && Number.isSafeInteger(p.targetId) && (p.kind === "medicine"
        ? typeof p.typeId === "string" && /^[A-Z0-9_]{1,64}$/.test(p.typeId) && (p.moveIndex === undefined
          || Number.isInteger(p.moveIndex) && p.moveIndex >= 0 && p.moveIndex < 4)
        : Number.isSafeInteger(p.ball) && p.ball >= 0);
    }
    const p = value as PrivateSwitchPick;
    return p.kind === "switch" && Number.isSafeInteger(p.actor) && Number.isSafeInteger(p.reserve)
      && p.reserve !== p.actor && typeof p.baton === "boolean";
  }
  const p = value as PrivateFightPick;
  return Number.isSafeInteger(p.actor) && Number.isInteger(p.slot) && p.slot >= 0 && p.slot < 4
    && Number.isSafeInteger(p.move) && p.move > 0
    && (p.target === null || Number.isSafeInteger(p.target));
}

export class PrivateChoiceExchange<T, B extends T[]> {
  constructor(private readonly valid: (value: unknown) => boolean, public seats = 2) {}
  public enabled = false;
  private pending: { key: string; resolve: (batch: B | null) => void; reject: (err: Error) => void } | undefined;

  submit(key: string, pick: T | null, send: () => void): Promise<B | null> {
    if (!this.enabled || this.pending || (pick !== null && !this.valid(pick))) {
      return Promise.reject(new Error("Private turn unavailable"));
    }
    return new Promise((resolve, reject) => {
      this.pending = { key, resolve, reject };
      try { send(); } catch { this.close(); }
    });
  }

  receive(key: unknown, batch: unknown): void {
    if (!this.pending || this.pending.key !== key) return;
    if (batch !== null && !(Array.isArray(batch) && batch.length === this.seats && batch.every(this.valid))) {
      this.close();
      return;
    }
    const { resolve } = this.pending;
    this.pending = undefined;
    resolve(batch as B | null);
  }

  close(): void {
    this.enabled = false;
    this.pending?.reject(new Error("Private turn interrupted"));
    this.pending = undefined;
  }
}

export class PrivateTurnExchange extends PrivateChoiceExchange<PrivateTurnPick, NonNullable<PrivateTurnBatch>> {
  constructor() { super(isPrivateTurnPick); }
}
