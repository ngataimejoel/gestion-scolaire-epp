"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { exigerUtilisateur } from "@/lib/auth/next";
import { inscrireEleve, modifierEleve, supprimerEleve, type DonneesEleve } from "@/lib/eleves";
import type { EtatFormulaire } from "./auth";

const CHAMPS = [
  "classroomId", "despsId", "fullName", "sex", "birthDate", "nationality", "locality", "subPrefecture", "hasBirthCertificate",
  "certificateNumber", "certificateDate", "civilRegistryCenter", "isOrphan", "orphanOf", "isRepeating", "status", "statusDate", "notes",
] as const;
const PARENT = ["fullName", "profession", "residence", "phone"] as const;

function lire(fd: FormData): DonneesEleve {
  const t = (k: string) => String(fd.get(k) ?? "");
  const parent = (p: string) => Object.fromEntries(PARENT.map((c) => [c, t(`${p}.${c}`)])) as DonneesEleve["pere"];
  return {
    ...(Object.fromEntries(CHAMPS.map((c) => [c, t(c)])) as unknown as DonneesEleve),
    pere: parent("pere"),
    mere: parent("mere"),
    tuteur: parent("tuteur"),
    confirmerDoublon: fd.get("confirmerDoublon") === "on",
  };
}

export async function actionEnregistrerEleve(studentId: string | null, _: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const u = await exigerUtilisateur(["DIRECTOR"]);
  const d = lire(fd);
  if (!studentId) {
    const r = await inscrireEleve(db(), u, d);
    if (!r.ok) return { erreur: r.erreur, champ: r.champ };
    revalidatePath("/eleves");
    redirect(`/eleves/${r.studentId}?inscrit=${encodeURIComponent(r.matricule)}`);
  }
  const r = await modifierEleve(db(), u, studentId, d);
  if (!r.ok) return { erreur: r.erreur, champ: r.champ };
  revalidatePath("/eleves");
  return { info: "Fiche enregistrée." };
}

export async function actionSupprimerEleve(studentId: string, _: EtatFormulaire): Promise<EtatFormulaire> {
  const u = await exigerUtilisateur(["DIRECTOR"]);
  const r = await supprimerEleve(db(), u, studentId);
  if (!r.ok) return { erreur: r.erreur };
  revalidatePath("/eleves");
  redirect("/eleves?supprime=1");
}
