"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { exigerUtilisateur } from "@/lib/auth/next";
import { ecritureBloquee } from "@/lib/abonnement";
import { changerEtatFeuille, enregistrerNotes, type ActionFeuille, type SaisieLigne } from "@/lib/notes";
import type { EtatFormulaire } from "./auth";

/** Formulaire de la feuille : p:<inscription> = OUI/NON/NONJ (absence justifiée), n:<inscription>:<matière> = note. */
function lireFeuille(fd: FormData): SaisieLigne[] {
  const lignes = new Map<string, SaisieLigne>();
  for (const [k, v] of fd.entries()) {
    const [type, enrollmentId, subjectId] = k.split(":");
    if (type !== "p" && type !== "n") continue;
    const l = lignes.get(enrollmentId) ?? { enrollmentId, present: true, notes: {} };
    if (type === "p") {
      l.present = v === "OUI";
      l.justifie = v === "NONJ";
    }
    else l.notes[subjectId] = String(v);
    lignes.set(enrollmentId, l);
  }
  return [...lignes.values()];
}

export async function actionEnregistrerNotes(classroomId: string, numero: number, _: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const u = await exigerUtilisateur(["DIRECTOR", "TEACHER"]);
  const bloque = await ecritureBloquee(db(), u);
  if (bloque) return { erreur: bloque };
  const r = await enregistrerNotes(db(), u, classroomId, numero, lireFeuille(fd), String(fd.get("empreinte") ?? ""));
  if (!r.ok) return { erreur: r.erreur, champ: r.champ };
  revalidatePath("/notes");
  revalidatePath("/classes");
  return { info: r.modifications ? `${r.modifications} modification(s) enregistrée(s).` : "Aucune modification à enregistrer." };
}

export async function actionEtatFeuille(classroomId: string, numero: number, action: ActionFeuille, _: EtatFormulaire): Promise<EtatFormulaire> {
  const u = await exigerUtilisateur(["DIRECTOR", "TEACHER"]);
  const bloque = await ecritureBloquee(db(), u);
  if (bloque) return { erreur: bloque };
  const r = await changerEtatFeuille(db(), u, classroomId, numero, action);
  if (!r.ok) return { erreur: r.erreur };
  revalidatePath("/notes");
  revalidatePath("/classes");
  return { info: { valider: "Feuille validée.", verrouiller: "Feuille verrouillée.", rouvrir: "Feuille rouverte à la saisie." }[action] };
}
