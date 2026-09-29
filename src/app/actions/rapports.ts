"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { exigerUtilisateur } from "@/lib/auth/next";
import { ecritureBloquee } from "@/lib/abonnement";
import { enregistrerRedaction, type CodeEtat, type ParametresEtat } from "@/lib/etats";
import type { EtatFormulaire } from "./auth";

export async function actionRedaction(code: CodeEtat, p: ParametresEtat, _: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const u = await exigerUtilisateur(["DIRECTOR"]);
  const bloque = await ecritureBloquee(db(), u);
  if (bloque) return { erreur: bloque };
  const textes = Object.fromEntries([...fd.entries()].filter(([k]) => k.startsWith("t.")).map(([k, v]) => [k.slice(2), String(v)]));
  const r = await enregistrerRedaction(db(), u, code, p, textes);
  if (!r.ok) return { erreur: r.erreur };
  revalidatePath("/rapports");
  return { info: "Enregistré." };
}
