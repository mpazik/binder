import {
  type EntityRef,
  type EntityRefType,
  isEntityId,
  isEntityUid,
} from "./entity.ts";
import type { EntityNsId, EntityNsRef, Namespace } from "./namespace.ts";

export const resolveEntityRefType = (ref: EntityRef): EntityRefType => {
  if (isEntityId(ref)) return "id";
  if (isEntityUid(ref)) return "uid";
  return "key";
};

export const normalizeEntityRef = <N extends Namespace>(
  ref: string | number,
): EntityNsRef[N] => {
  if (typeof ref === "number") return ref as EntityNsId[N];
  if (/^\d+$/.test(ref)) {
    return parseInt(ref, 10) as EntityNsId[N];
  }
  return ref as EntityNsRef[N];
};
