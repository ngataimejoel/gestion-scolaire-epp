import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { exigerUtilisateur } from "@/lib/auth/next";
import { formaterTelephone } from "@/lib/auth/telephone";
import { aUnCompteEnseignant } from "@/lib/personnel";
import { actionActivationCompte, actionEnregistrerPersonnel, actionNouveauMotDePasse, actionSupprimerPersonnel } from "@/app/actions/personnel";
import { BoutonNouveauMotDePasse, FormPersonnel } from "@/components/formulaires/personnel";
import { BoutonAction } from "@/components/formulaires/bouton-action";
import { jourIso } from "@/lib/dates";
import { optionsPersonnel } from "../options";

export const metadata: Metadata = { title: "Fiche du personnel" };

export default async function FichePersonnel({ params }: PageProps<"/personnel/[id]">) {
  const u = await exigerUtilisateur(["DIRECTOR"]);
  const { id } = await params;
  const s = await db().staff.findFirst({
    where: { id, schoolId: u.schoolId! },
    include: { user: true, classes: { where: { classroom: { academicYear: { isActive: true } } } } },
  });
  if (!s) notFound();
  const o = await optionsPersonnel(u);
  const moi = s.userId === u.id;
  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <Link href="/personnel" className="lien text-sm">← Personnel</Link>
        <h1 className="mt-1 text-2xl font-bold">{s.lastName} {s.firstNames}</h1>
        <p className="text-attenue">{s.matricule} · {s.function}</p>
      </div>
      <section className="carte">
        <FormPersonnel
          action={actionEnregistrerPersonnel.bind(null, s.id)}
          {...o}
          valeurs={{
            matricule: s.matricule,
            lastName: s.lastName,
            firstNames: s.firstNames,
            sex: s.sex,
            birthDate: jourIso(s.birthDate),
            function: s.function,
            grade: s.grade,
            diploma: s.diploma,
            serviceStartDate: jourIso(s.serviceStartDate),
            arrivalDate: jourIso(s.arrivalDate),
            phone: s.phone ? formaterTelephone(s.phone) : "",
            maritalStatus: s.maritalStatus,
            notes: s.notes,
            classroomId: s.classes[0]?.classroomId ?? "",
          }}
        />
      </section>

      {!moi && (s.user || (aUnCompteEnseignant(s.function) && s.phone)) && (
        <section className="carte space-y-3">
          <h2 className="font-semibold">Compte de connexion</h2>
          {s.user ? (
            <>
              <p className="text-sm">
                Identifiant : <b className="tabular-nums">{formaterTelephone(s.user.phone)}</b> ·{" "}
                {!s.user.isActive ? "désactivé" : s.user.mustChangePassword ? "en attente de première connexion" : "actif"}
                {s.user.lastLoginAt && <> · dernière connexion le {s.user.lastLoginAt.toLocaleDateString("fr-FR")}</>}
              </p>
              <div className="flex flex-wrap items-start gap-4">
                {s.user.isActive && <BoutonNouveauMotDePasse action={actionNouveauMotDePasse.bind(null, s.id)} libelle="Nouveau mot de passe provisoire" />}
                {s.user.isActive ? (
                  <BoutonAction action={actionActivationCompte.bind(null, s.id, false)} libelle="Désactiver le compte" confirmation="Désactiver ce compte ? L'enseignant ne pourra plus se connecter." />
                ) : (
                  <BoutonAction action={actionActivationCompte.bind(null, s.id, true)} libelle="Réactiver le compte" />
                )}
              </div>
            </>
          ) : (
            <BoutonNouveauMotDePasse action={actionNouveauMotDePasse.bind(null, s.id)} libelle="Créer le compte" />
          )}
        </section>
      )}

      {!moi && (
        <section className="carte space-y-2">
          <h2 className="font-semibold">Supprimer la fiche</h2>
          <p className="text-sm text-attenue">
            Réservé à une fiche saisie par erreur. Pour un départ ou une mutation, désactivez le compte et retirez la classe : l&apos;historique est conservé.
          </p>
          <BoutonAction action={actionSupprimerPersonnel.bind(null, s.id)} libelle="Supprimer cette fiche" confirmation={`Supprimer définitivement la fiche de ${s.lastName} ${s.firstNames} ?`} />
        </section>
      )}
    </div>
  );
}
