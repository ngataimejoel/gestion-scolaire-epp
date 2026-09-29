"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { exigerUtilisateur } from "@/lib/auth/next";
import { aLaFonction, ecritureBloquee } from "@/lib/abonnement";
import { analyserImport, annulerImport, confirmerImport, TAILLE_MAX } from "@/lib/classeur/service";
import type { EtatFormulaire } from "./auth";

export async function actionAnalyserImport(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const u = await exigerUtilisateur(["DIRECTOR"]);
  const bloque = await ecritureBloquee(db(), u);
  if (bloque) return { erreur: bloque };
  if (!(await aLaFonction(db(), u.schoolId!, "import_excel"))) return { erreur: "L'import du classeur n'est pas inclus dans votre offre." };
  const f = fd.get("fichier");
  if (!(f instanceof File) || !f.size) return { champ: "fichier", erreur: "Choisissez le fichier du classeur." };
  if (f.size > TAILLE_MAX) return { champ: "fichier", erreur: "Fichier trop volumineux (8 Mo au plus)." };
  const r = await analyserImport(db(), u, Buffer.from(await f.arrayBuffer()), f.name);
  if (!r.ok) return { champ: r.champ, erreur: r.erreur };
  redirect(`/import-export/${r.jobId}`);
}

export async function actionConfirmerImport(jobId: string, _: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const u = await exigerUtilisateur(["DIRECTOR"]);
  const bloque = await ecritureBloquee(db(), u);
  if (bloque) return { erreur: bloque };
  const r = await confirmerImport(db(), u, jobId, { parametres: fd.get("parametres") === "oui", comptesEnseignants: fd.get("comptes") === "oui" });
  if (!r.ok) return { erreur: r.erreur };
  revalidatePath("/", "layout");
  redirect(`/import-export/${jobId}`);
}

export async function actionAnnulerImport(jobId: string): Promise<EtatFormulaire> {
  const u = await exigerUtilisateur(["DIRECTOR"]);
  const r = await annulerImport(db(), u, jobId);
  if (!r.ok) return { erreur: r.erreur };
  redirect("/import-export");
}
