import type { Metadata } from "next";
import { db } from "@/lib/db";
import { exigerUtilisateur } from "@/lib/auth/next";
import { mesNotifications } from "@/lib/notifications";
import { actionMarquerLues } from "@/app/actions/notifications";
import { BoutonAction } from "@/components/formulaires/bouton-action";

export const metadata: Metadata = { title: "Notifications" };

const quand = (d: Date) => d.toLocaleString("fr-FR", { timeZone: "Africa/Abidjan", dateStyle: "short", timeStyle: "short" });

export default async function Notifications() {
  const u = await exigerUtilisateur(["DIRECTOR", "TEACHER"]);
  const liste = await mesNotifications(db(), u.id);
  const nonLues = liste.filter((n) => !n.readAt).length;
  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Notifications</h1>
          <p className="text-attenue">
            Validations de notes, évaluations à venir, notes à terminer, paiements et abonnement.
            {nonLues ? ` ${nonLues} non lue${nonLues > 1 ? "s" : ""}.` : ""}
          </p>
        </div>
        {nonLues > 0 && <BoutonAction action={actionMarquerLues.bind(null, null)} libelle="Tout marquer comme lu" className="btn-secondaire" />}
      </div>
      {liste.length === 0 ? (
        <p className="carte text-attenue">Aucune notification pour l&apos;instant.</p>
      ) : (
        <ul className="carte divide-y divide-bordure p-0">
          {liste.map((n) => (
            <li key={n.id} className={`flex gap-3 px-5 py-4 ${n.readAt ? "" : "bg-info-fond/40"}`}>
              <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-principal"}`} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {n.title}
                  {!n.readAt && <span className="sr-only"> (non lue)</span>}
                </p>
                <p className="text-sm">{n.body}</p>
                <p className="mt-1 text-xs text-attenue">{quand(n.createdAt)}</p>
              </div>
              {!n.readAt && <BoutonAction action={actionMarquerLues.bind(null, n.id)} libelle="Marquer lu" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
