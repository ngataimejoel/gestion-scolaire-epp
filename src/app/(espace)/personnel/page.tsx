import type { Metadata } from "next";
import { db } from "@/lib/db";
import { exigerUtilisateur } from "@/lib/auth/next";
import { formaterTelephone } from "@/lib/auth/telephone";
import { FONCTIONS } from "@/lib/personnel";
import { estEnseignant } from "@/lib/regles";
import { actionNouveauMotDePasse } from "@/app/actions/personnel";
import { BoutonNouveauMotDePasse, FormPersonnel } from "@/components/formulaires/personnel";

export const metadata: Metadata = { title: "Personnel" };

export default async function Personnel() {
  const u = await exigerUtilisateur(["DIRECTOR"]);
  const liste = await db().staff.findMany({
    where: { schoolId: u.schoolId! },
    include: { user: { select: { mustChangePassword: true, lastLoginAt: true } } },
    orderBy: [{ lastName: "asc" }, { firstNames: "asc" }],
  });
  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Personnel</h1>
        <p className="text-attenue">
          Chaque enseignant enregistré reçoit un compte : identifiant = son numéro, mot de passe provisoire = 4 derniers chiffres + 4
          caractères, envoyé par SMS et à changer à la première connexion.
        </p>
      </div>
      <section className="carte">
        <h2 className="mb-4 font-semibold">Enregistrer un membre du personnel</h2>
        <FormPersonnel fonctions={[...FONCTIONS]} />
      </section>
      <section className="carte overflow-x-auto p-0 sm:p-0">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-bordure text-left text-attenue">
            <tr>
              <th className="px-4 py-3 font-medium">Nom et prénoms</th>
              <th className="px-4 py-3 font-medium">Matricule</th>
              <th className="px-4 py-3 font-medium">Fonction</th>
              <th className="px-4 py-3 font-medium">Téléphone</th>
              <th className="px-4 py-3 font-medium">Compte</th>
            </tr>
          </thead>
          <tbody>
            {liste.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-attenue">Aucun membre du personnel pour l&apos;instant.</td>
              </tr>
            )}
            {liste.map((s) => (
              <tr key={s.id} className="border-b border-bordure last:border-0">
                <td className="px-4 py-3 font-medium">{s.lastName} {s.firstNames}</td>
                <td className="px-4 py-3 tabular-nums">{s.matricule}</td>
                <td className="px-4 py-3">{s.function}</td>
                <td className="px-4 py-3 whitespace-nowrap tabular-nums">{s.phone ? formaterTelephone(s.phone) : "—"}</td>
                <td className="px-4 py-3">
                  {s.user ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{s.user.mustChangePassword ? "En attente de 1re connexion" : "Actif"}</span>
                      <BoutonNouveauMotDePasse action={actionNouveauMotDePasse.bind(null, s.id)} libelle="Nouveau mot de passe" />
                    </div>
                  ) : estEnseignant(s.function) && s.function !== "DIRECTEUR" && s.phone ? (
                    <BoutonNouveauMotDePasse action={actionNouveauMotDePasse.bind(null, s.id)} libelle="Créer le compte" />
                  ) : (
                    <span className="text-attenue">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
