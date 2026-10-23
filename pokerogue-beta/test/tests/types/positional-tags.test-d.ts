import type { SerializedPositionalTag, ToSerializedPosTag } from "#data/positional-tags/load-positional-tag";
import type { DelayedAttackTag, WishTag } from "#data/positional-tags/positional-tag";
import type { FieldPosition } from "#enums/field-position";
import type { PositionalTagType } from "#enums/positional-tag-type";
import type { Jsonify } from "type-fest";
import { describe, expectTypeOf, it } from "vitest";

describe("Positional Tags", () => {
  describe("ToSerializedPosTag", () => {
    it("should map each class' tag type to their serialized forms", () => {
      // Branded equality misclassifies Jsonify's optional fields; check both round-trip directions instead.
      expectTypeOf<ToSerializedPosTag<PositionalTagType.DELAYED_ATTACK>>().toExtend<Jsonify<DelayedAttackTag>>();
      expectTypeOf<Jsonify<DelayedAttackTag>>().toExtend<ToSerializedPosTag<PositionalTagType.DELAYED_ATTACK>>();
      expectTypeOf<ToSerializedPosTag<PositionalTagType.WISH>>().toExtend<Jsonify<WishTag>>();
      expectTypeOf<Jsonify<WishTag>>().toExtend<ToSerializedPosTag<PositionalTagType.WISH>>();
    });
    it("should allow a missing position in legacy saves", () => {
      expectTypeOf<ToSerializedPosTag<PositionalTagType.WISH>["targetPosition"]>().toEqualTypeOf<
        FieldPosition | undefined
      >();
    });
  });

  describe("SerializedPositionalTag", () => {
    it("should be a union of all serialized tag forms", () => {
      expectTypeOf<SerializedPositionalTag>().toExtend<Jsonify<DelayedAttackTag> | Jsonify<WishTag>>();
      expectTypeOf<Jsonify<DelayedAttackTag> | Jsonify<WishTag>>().toExtend<SerializedPositionalTag>();
    });
    it("should be extended by all unserialized class instances", () => {
      expectTypeOf<WishTag>().toExtend<SerializedPositionalTag>();
      expectTypeOf<DelayedAttackTag>().toExtend<SerializedPositionalTag>();
    });
  });
});
