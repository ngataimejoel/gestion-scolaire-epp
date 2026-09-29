import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { exigerUtilisateur } from "@/lib/auth/next";
import { simulationAutorisee } from "@/lib/paiement/fournisseurs";
import { actionSimulerPaiement } from "@/app/actions/abonnement";
import { BoutonAction } from "@/components/formulaires/bouton-action";

export const metadata: Metadata = { title: "Paiement simulé" };

/** Remplace la page du fournisseur en démonstration : aucun argent ne circule. */
export default async function Simulation({ searchParams }: PageProps<"/abonnement/simulation">) {
  const u = await exigerUtilisateur(["DIRECTOR"]);
  const { paiement } = await searchParams;
  if (!simulationAutorisee() || typeof paiement !== "string") notFound();
  const p = await db().payment.findFirst({ where: { id: paiement, schoolId: u.schoolId!, provider: "simulation" }, include: { subscription: { include: { plan: true } } } });
  if (!p) notFound();
  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Paiement simulé</h1>
        <p className="text-attenue">Mode démonstration : cette page remplace celle du fournisseur de paiement. Aucun argent ne circule.</p>
      </div>
      <section className="carte space-y-4">
        <dl className="grid grid-cols-2 gap-3">
          <dt className="text-attenue">Offre</dt>
          <dd className="font-semibold">{p.subscription.plan.name}</dd>
          <dt className="text-attenue">Montant</dt>
          <dd className="font-semibold tabular-nums">{p.amountXof.toLocaleString("fr-FR")} FCFA</dd>
        </dl>
        {p.status === "PENDING" ? (
          <div className="flex flex-wrap gap-3">
            <BoutonAction action={actionSimulerPaiement.bind(null, p.id, true)} libelle="Confirmer le paiement" className="btn-principal" />
            <BoutonAction action={actionSimulerPaiement.bind(null, p.id, false)} libelle="Simuler un échec" className="btn-secondaire" />
          </div>
        ) : (
          <p className="text-sm">Ce paiement est déjà traité. <a className="lien" href="/abonnement">Retour à l&apos;abonnement</a></p>
        )}
      </section>
    </div>
  );
}
