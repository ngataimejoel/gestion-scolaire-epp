"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { exigerUtilisateur } from "@/lib/auth/next";
import { creerCompteEnseignant } from "@/lib/auth/service";
import { changerActivationCompte, enregistrerPersonnel, modifierPersonnel, supprimerPersonnel } from "@/lib/personnel";
import type { EtatFormulaire } from "./auth";

export interface EtatPersonnel extends EtatFormulaire {
  identifiants?: { nom: string; phone: string; motDePasse: string };
}

const CHAMPS = ["matricule", "lastName", "firstNames", "sex", "birthDate", "function", "grade", "diploma", "serviceStartDate", "arrivalDate", "phone", "maritalStatus", "notes", "classroomId"];
const lire = (fd: FormData) => Object.fromEntries(CHAMPS.map((k) => [k, String(fd.get(k) ?? "")]));

export async function actionEnregistrerPersonnel(staffId: string | null, _: EtatPersonnel, fd: FormData): Promise<EtatPersonnel> {
  const u = await exigerUtilisateur(["DIRECTOR"]);
  const d = lire(fd);
  if (staffId) {
    const r = await modifierPersonnel(db(), u, staffId, d);
    if (!r.ok) return { erreur: r.erreur, champ: r.champ };
    revalidatePath("/personnel");
    return { info: r.avertissement ? `Fiche enregistrée. ${r.avertissement}` : "Fiche enregistrée." };
  }
  const r = await enregistrerPersonnel(db(), u, d);
  if (!r.ok) return { erreur: r.erreur, champ: r.champ };
  revalidatePath("/personnel");
  return {
    info: r.avertissement ?? (r.compte ? undefined : "Membre du personnel enregistré."),
    identifiants: r.compte ? { nom: `${d.lastName.toUpperCase()} ${d.firstNames}`, ...r.compte } : undefined,
  };
}

export async function actionNouveauMotDePasse(staffId: string, _: EtatPersonnel): Promise<EtatPersonnel> {
  const u = await exigerUtilisateur(["DIRECTOR"]);
  const r = await creerCompteEnseignant(db(), u, staffId);
  if (!r.ok) return { erreur: r.erreur };
  revalidatePath("/personnel");
  return { identifiants: { nom: "", phone: r.phone, motDePasse: r.motDePasse } };
}

export async function actionActivationCompte(staffId: string, actif: boolean, _: EtatFormulaire): Promise<EtatFormulaire> {
  const u = await exigerUtilisateur(["DIRECTOR"]);
  const r = await changerActivationCompte(db(), u, staffId, actif);
  if (!r.ok) return { erreur: r.erreur };
  revalidatePath("/personnel");
  return { info: actif ? "Compte réactivé." : "Compte désactivé." };
}

export async function actionSupprimerPersonnel(staffId: string, _: EtatFormulaire): Promise<EtatFormulaire> {
  const u = await exigerUtilisateur(["DIRECTOR"]);
  const r = await supprimerPersonnel(db(), u, staffId);
  if (!r.ok) return { erreur: r.erreur };
  revalidatePath("/personnel");
  redirect("/personnel");
}
