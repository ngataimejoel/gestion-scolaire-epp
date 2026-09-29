import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { exigerUtilisateur } from "@/lib/auth/next";
import { etatAbonnement } from "@/lib/abonnement";
import { actualiserPaiement } from "@/lib/paiement";
import { Alerte } from "@/components/ui";
import { dateFr } from "@/lib/dates";

export const metadata: Metadata = { title: "Paiement" };

/** Retour depuis le fournisseur : le statut est relu auprès de lui, jamais pris dans l'adresse de retour. */
export default async function Retour({ searchParams }: PageProps<"/abonnement/retour">) {
  const u = await exigerUtilisateur(["DIRECTOR"]);
  const { paiement } = await searchParams;
  if (typeof paiement !== "string") notFound();
  const p = await db().payment.findFirst({ where: { id: paiement, schoolId: u.schoolId! } });
  if (!p) notFound();
  const statut = await actualiserPaiement(db(), p.id, "retour");
  const etat = await etatAbonnement(db(), u.schoolId!);
  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-2xl font-bold">Paiement de l&apos;abonnement</h1>
      <section className="carte space-y-4">
        {statut === "SUCCEEDED" && (
          <Alerte type="succes">
            Paiement reçu. L&apos;abonnement {etat.plan?.name} est actif jusqu&apos;au {dateFr(etat.finLe)}.
          </Alerte>
        )}
        {statut === "PENDING" && (
          <Alerte type="info">
            Le paiement n&apos;est pas encore confirmé par le fournisseur. L&apos;abonnement sera activé dès sa confirmation ; vous pouvez
            actualiser cette page dans un instant.
          </Alerte>
        )}
        {(statut === "FAILED" || statut === "CANCELLED") && <Alerte>Le paiement n&apos;a pas abouti. Aucun montant n&apos;a été retenu par la plateforme.</Alerte>}
        <div className="flex gap-4">
          {statut === "PENDING" && (
            <Link className="btn-secondaire" href={`/abonnement/retour?paiement=${p.id}`} prefetch={false}>
              Actualiser
            </Link>
          )}
          <Link className="btn-principal" href="/abonnement">
            Retour à l&apos;abonnement
          </Link>
        </div>
      </section>
    </div>
  );
}
