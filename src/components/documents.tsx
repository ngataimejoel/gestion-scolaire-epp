import type { ReactNode } from "react";
import { dateFr } from "@/lib/dates";

export interface EnteteEcole {
  name: string;
  code: string;
  ministry: string;
  regionalDirectorate: string | null;
  inspectorate: string | null;
  locality: string | null;
  settings?: { directorName: string | null; reportDate: Date | null } | null;
}

/** En-tête officiel des états (ministère, DREN, IEPP, école / République de Côte d'Ivoire, année). */
export function EnteteOfficiel({ ecole, annee, titre, sousTitre }: { ecole: EnteteEcole; annee: string; titre: string; sousTitre?: ReactNode }) {
  return (
    <header className="mb-4 space-y-3 text-texte">
      <div className="flex justify-between gap-4 text-[10px] uppercase leading-snug sm:text-xs">
        <div className="flex flex-col">
          <span>{ecole.ministry}</span>
          {ecole.regionalDirectorate && <span>{ecole.regionalDirectorate}</span>}
          {ecole.inspectorate && <span>{ecole.inspectorate}</span>}
          <span>
            {ecole.name} – Code : {ecole.code}
          </span>
        </div>
        <div className="flex flex-col text-right">
          <span>République de Côte d&apos;Ivoire</span>
          <span>Union – Discipline – Travail</span>
          <span>Année scolaire : {annee}</span>
        </div>
      </div>
      <div className="text-center">
        <h2 className="text-lg font-bold uppercase tracking-wide">{titre}</h2>
        {sousTitre && <p className="text-sm text-attenue print:text-black">{sousTitre}</p>}
      </div>
    </header>
  );
}

/** « Fait à …, le … » et signature du directeur. */
export function Signature({ ecole, date }: { ecole: EnteteEcole; date?: Date | null }) {
  return (
    <div className="mt-8 flex justify-between gap-4 text-sm">
      <span>
        Fait à {ecole.locality ?? "……………"}, le {dateFr(date ?? ecole.settings?.reportDate ?? new Date())}
      </span>
      <span className="text-center">
        <b>LE DIRECTEUR</b>
        <br />
        {ecole.settings?.directorName ?? ""}
      </span>
    </div>
  );
}

/** Tableau officiel à bordures (identique à l'écran et à l'impression). */
export function TableOfficielle({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className={`tableau-officiel w-full text-sm ${className}`}>{children}</table>
    </div>
  );
}
