import type { Metadata } from "next";
import Link from "next/link";
import { exigerUtilisateur } from "@/lib/auth/next";
import { actionEnregistrerPersonnel } from "@/app/actions/personnel";
import { FormPersonnel } from "@/components/formulaires/personnel";
import { optionsPersonnel } from "../options";

export const metadata: Metadata = { title: "Ajouter un membre du personnel" };

export default async function NouveauPersonnel() {
  const u = await exigerUtilisateur(["DIRECTOR"]);
  const o = await optionsPersonnel(u);
  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <Link href="/personnel" className="lien text-sm">← Personnel</Link>
        <h1 className="mt-1 text-2xl font-bold">Ajouter un membre du personnel</h1>
        <p className="text-attenue">Pour un enseignant, le compte est créé et ses identifiants partent par SMS dès l&apos;enregistrement.</p>
      </div>
      <section className="carte">
        <FormPersonnel action={actionEnregistrerPersonnel.bind(null, null)} {...o} />
      </section>
    </div>
  );
}
