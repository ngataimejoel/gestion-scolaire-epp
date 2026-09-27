"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { exigerUtilisateur } from "@/lib/auth/next";
import { creerCompteEnseignant } from "@/lib/auth/service";
import { enregistrerPersonnel } from "@/lib/personnel";
import type { EtatFormulaire } from "./auth";

export interface EtatPersonnel extends EtatFormulaire {
  identifiants?: { nom: string; phone: string; motDePasse: string };
  n?: number; // change à chaque succès pour vider le formulaire
}

export async function actionEnregistrerPersonnel(etat: EtatPersonnel, fd: FormData): Promise<EtatPersonnel> {
  const u = await exigerUtilisateur(["DIRECTOR"]);
  const d = Object.fromEntries(["matricule", "lastName", "firstNames", "sex", "function", "phone"].map((k) => [k, String(fd.get(k) ?? "")]));
  const r = await enregistrerPersonnel(db(), u, d);
  if (!r.ok) return { erreur: r.erreur, champ: r.champ, valeurs: d };
  revalidatePath("/personnel");
  return {
    n: (etat.n ?? 0) + 1,
    info: r.compte ? undefined : "Membre du personnel enregistré.",
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
