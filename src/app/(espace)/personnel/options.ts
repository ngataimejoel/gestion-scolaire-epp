import { db } from "@/lib/db";
import { classesVisibles } from "@/lib/eleves";
import type { User } from "@/generated/prisma/client";

/** Listes de choix de la fiche du personnel (Paramètres) et classes de l'année en cours. */
export async function optionsPersonnel(u: Pick<User, "id" | "schoolId" | "role">) {
  const [classes, listes] = await Promise.all([
    classesVisibles(db(), u),
    db().choiceItem.findMany({ where: { schoolId: u.schoolId!, list: { in: ["STAFF_FUNCTION", "MARITAL_STATUS"] } }, orderBy: { position: "asc" } }),
  ]);
  return {
    classes: classes.map((c) => [c.id, c.name] as [string, string]),
    fonctions: listes.filter((l) => l.list === "STAFF_FUNCTION").map((l) => l.value),
    situations: listes.filter((l) => l.list === "MARITAL_STATUS").map((l) => l.value),
  };
}
