import type { Metadata } from "next";
import Link from "next/link";
import { dateFr } from "@/lib/dates";
import { db } from "@/lib/db";
import { exigerUtilisateur } from "@/lib/auth/next";
import { formaterTelephone } from "@/lib/auth/telephone";
import { listerPersonnel } from "@/lib/personnel";
import { compterParSexe, estEnseignant } from "@/lib/regles";

export const metadata: Metadata = { title: "Personnel" };


export default async function Personnel() {
  const u = await exigerUtilisateur(["DIRECTOR"]);
  const liste = await listerPersonnel(db(), u.schoolId!);
  const enseignants = compterParSexe(liste.filter((s) => estEnseignant(s.function)).map((s) => ({ sexe: s.sex })));
  return (
    <div className="max-w-6xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Personnel</h1>
          <p className="text-attenue">
            Chaque enseignant enregistré reçoit un compte : identifiant = son numéro, mot de passe provisoire envoyé par SMS et à changer à la
            première connexion.
          </p>
        </div>
        <Link href="/personnel/nouveau" className="btn-principal">Ajouter un membre</Link>
      </div>
      <p className="text-sm" role="status">
        {liste.length} membre(s) · enseignants : <b>{enseignants.M}</b> hommes, <b>{enseignants.F}</b> femmes
      </p>
      <div className="carte overflow-x-auto p-0 sm:p-0">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="border-b border-bordure text-left text-attenue">
            <tr>
              <th className="px-3 py-3 font-medium">Matricule</th>
              <th className="px-3 py-3 font-medium">Nom et prénoms</th>
              <th className="px-3 py-3 font-medium">Sexe</th>
              <th className="px-3 py-3 font-medium">Âge</th>
              <th className="px-3 py-3 font-medium">Fonction</th>
              <th className="px-3 py-3 font-medium">Grade</th>
              <th className="px-3 py-3 font-medium">Prise de service</th>
              <th className="px-3 py-3 font-medium">Ancienneté</th>
              <th className="px-3 py-3 font-medium">Classe tenue</th>
              <th className="px-3 py-3 font-medium">Contact</th>
              <th className="px-3 py-3 font-medium">Compte</th>
            </tr>
          </thead>
          <tbody>
            {liste.length === 0 && (
              <tr>
                <td colSpan={11} className="px-3 py-6 text-center text-attenue">Aucun membre du personnel pour l&apos;instant.</td>
              </tr>
            )}
            {liste.map((s) => (
              <tr key={s.id} className="border-b border-bordure last:border-0">
                <td className="px-3 py-2.5 tabular-nums">
                  <Link href={`/personnel/${s.id}`} className="lien">{s.matricule}</Link>
                </td>
                <td className="px-3 py-2.5 font-medium">{s.lastName} {s.firstNames}</td>
                <td className="px-3 py-2.5">{s.sex}</td>
                <td className="px-3 py-2.5 tabular-nums">{s.age ?? "—"}</td>
                <td className="px-3 py-2.5">{s.function}</td>
                <td className="px-3 py-2.5">{s.grade ?? "—"}</td>
                <td className="px-3 py-2.5 tabular-nums">{dateFr(s.serviceStartDate)}</td>
                <td className="px-3 py-2.5 tabular-nums">{s.anciennete != null ? `${s.anciennete} an(s)` : "—"}</td>
                <td className="px-3 py-2.5">{s.classeTenue ?? "—"}</td>
                <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">{s.phone ? formaterTelephone(s.phone) : "—"}</td>
                <td className="px-3 py-2.5">
                  {!s.user ? "—" : !s.user.isActive ? "Désactivé" : s.user.mustChangePassword ? "En attente de 1re connexion" : "Actif"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-attenue">Âge à la date de référence des âges ; ancienneté à la date d&apos;édition des états (Paramètres).</p>
    </div>
  );
}
