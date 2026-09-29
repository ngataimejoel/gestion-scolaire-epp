"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { exigerUtilisateur } from "@/lib/auth/next";
import { marquerLues } from "@/lib/notifications";
import type { EtatFormulaire } from "./auth";

/** Marque une notification (ou toutes si id est null) comme lue. Lire n'est pas écrire : permis même en lecture seule. */
export async function actionMarquerLues(id: string | null): Promise<EtatFormulaire> {
  const u = await exigerUtilisateur(["DIRECTOR", "TEACHER"]);
  await marquerLues(db(), u.id, id ?? undefined);
  revalidatePath("/", "layout");
  return {};
}
