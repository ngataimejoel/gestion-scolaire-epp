"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { exigerUtilisateur } from "@/lib/auth/next";
import { ecritureBloquee } from "@/lib/abonnement";
import type { Resultat } from "@/lib/auth/service";
import * as p from "@/lib/parametres/service";
import type { ChoiceList } from "@/generated/prisma/client";
import type { EtatFormulaire } from "./auth";

const LISTES: ChoiceList[] = ["NATIONALITY", "STAFF_FUNCTION", "ORPHAN_OF", "ABSENCE_REASON", "MARITAL_STATUS"];

async function executer(fn: (d: Awaited<ReturnType<typeof exigerUtilisateur>>) => Promise<Resultat>): Promise<EtatFormulaire> {
  const u = await exigerUtilisateur(["DIRECTOR"]);
  const bloque = await ecritureBloquee(db(), u);
  if (bloque) return { erreur: bloque };
  const r = await fn(u);
  if (!r.ok) return { erreur: r.erreur, champ: r.champ };
  revalidatePath("/", "layout");
  return { info: "Enregistré." };
}

/** Regroupe les champs « prefixe.cle » d'un formulaire en { cle: valeur }. */
function groupe(fd: FormData, prefixe: string): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (k.startsWith(prefixe + ".")) o[k.slice(prefixe.length + 1)] = String(v);
  return o;
}

export async function actionIdentite(_: EtatFormulaire, fd: FormData) {
  const champs = ["name", "code", "ministry", "regionalDirectorate", "inspectorate", "sector", "locality", "directorName"];
  return executer((u) => p.majIdentite(db(), u, Object.fromEntries(champs.map((c) => [c, String(fd.get(c) ?? "")]))));
}

export async function actionAnnee(_: EtatFormulaire, fd: FormData) {
  return executer((u) =>
    p.majAnnee(db(), u, {
      ageReferenceDate: String(fd.get("ageReferenceDate") ?? ""),
      reportDate: String(fd.get("reportDate") ?? ""),
      expectedNewCp1: String(fd.get("expectedNewCp1") ?? ""),
      neutralizeJustifiedAbsence: fd.get("neutralizeJustifiedAbsence") === "on",
      teacherLoginOtp: fd.get("teacherLoginOtp") === "on",
    }),
  );
}

export async function actionSeuils(_: EtatFormulaire, fd: FormData) {
  const pass = groupe(fd, "passMark");
  const scale = groupe(fd, "scale");
  return executer((u) => p.majSeuils(db(), u, Object.fromEntries(Object.keys(pass).map((id) => [id, { passMark: pass[id], scale: scale[id] }]))));
}

export async function actionCalendrier(_: EtatFormulaire, fd: FormData) {
  return executer((u) => p.majCalendrier(db(), u, groupe(fd, "date")));
}

export async function actionJours(_: EtatFormulaire, fd: FormData) {
  return executer((u) => p.majJours(db(), u, groupe(fd, "jours")));
}

export async function actionMatieres(_: EtatFormulaire, fd: FormData) {
  return executer((u) => p.majMatieres(db(), u, groupe(fd, "matiere")));
}

export async function actionListe(liste: ChoiceList, _: EtatFormulaire, fd: FormData) {
  if (!LISTES.includes(liste)) return { erreur: "Liste inconnue." };
  return executer((u) => p.majListe(db(), u, liste, String(fd.get("valeurs") ?? "")));
}

export async function actionAjouterClasse(_: EtatFormulaire, fd: FormData) {
  return executer((u) => p.ajouterClasse(db(), u, String(fd.get("levelId") ?? ""), String(fd.get("name") ?? "")));
}

export async function actionSupprimerClasse(classroomId: string, _: EtatFormulaire) {
  return executer((u) => p.supprimerClasse(db(), u, classroomId));
}
