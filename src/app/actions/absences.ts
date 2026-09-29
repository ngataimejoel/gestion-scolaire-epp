"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { exigerUtilisateur } from "@/lib/auth/next";
import { enregistrerEvenement, supprimerEvenement } from "@/lib/absences";
import type { EtatFormulaire } from "./auth";

export async function actionEnregistrerAbsence(cible: "eleve" | "personnel", _: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const u = await exigerUtilisateur(["DIRECTOR", "TEACHER"]);
  const t = (k: string) => String(fd.get(k) ?? "");
  const r = await enregistrerEvenement(db(), u, {
    cible,
    personId: t("personId"),
    date: t("date"),
    nature: t("nature") as "ABSENCE" | "RETARD",
    days: t("days"),
    minutes: t("minutes"),
    reason: t("reason"),
    justified: t("justified") === "OUI" ? "OUI" : "NON",
    notes: t("notes"),
    confirmerDoublon: fd.get("confirmerDoublon") === "on",
  });
  if (!r.ok) return { erreur: r.erreur, champ: r.champ };
  revalidatePath("/absences");
  return { info: "Événement ajouté au journal." };
}

export async function actionSupprimerAbsence(id: string, _: EtatFormulaire): Promise<EtatFormulaire> {
  const u = await exigerUtilisateur(["DIRECTOR", "TEACHER"]);
  const r = await supprimerEvenement(db(), u, id);
  if (!r.ok) return { erreur: r.erreur };
  revalidatePath("/absences");
  return { info: "Supprimé." };
}
