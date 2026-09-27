import type { Db } from "./db";
import type { Prisma } from "@/generated/prisma/client";

export interface EntreeAudit {
  schoolId?: string | null;
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  ip?: string | null;
}

/** Journal d'audit : qui a fait quoi, sur quelle donnée, avant/après. Jamais de mot de passe ni de code. */
export const journaliser = (db: Db, e: EntreeAudit) =>
  db.auditLog.create({
    data: {
      schoolId: e.schoolId ?? null,
      userId: e.userId ?? null,
      action: e.action,
      entity: e.entity,
      entityId: e.entityId ?? null,
      before: e.before,
      after: e.after,
      ip: e.ip ?? null,
    },
  });
