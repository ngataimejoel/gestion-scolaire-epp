/* =====================================================================================
   Notes, validation des saisies des enseignants, décisions et passage à l'année suivante.
   ===================================================================================== */
(function (AK) {
  'use strict';
  const C = AK.cfg, u = AK.u, V = AK.valid, X = AK.calc;
  const S = () => AK.store.etat;
  const E = (m, champ) => new AK.ErreurMetier(m, champ);
  const EVALS = [1, 2, 3, 4];

  const cleSaisie = (c, n) => S().saisie[c + '|' + n] || (S().saisie[c + '|' + n] = { fermee: false, fin: '' });
  const saisieOuverte = (c, n) => {
    const x = S().saisie[c + '|' + n] || {};
    return !x.fermee && !(x.fin && x.fin < u.aujourdhui());
  };
  const enAttenteDe = (c, n) =>
    Object.keys(S().attente).filter((k) => {
      const [id, e] = k.split('|');
      const s = S().students.find((x) => x.id === id);
      return s && s.classe === c && (n == null || String(e) === String(n));
    });

  const notes = {
    EVALS,
    saisieOuverte,
    enAttenteDe,
    /**
     * Saisie d'une note. Renvoie { etat: 'ok' | 'attente' | 'inchange', v }.
     * Une correction (note déjà enregistrée modifiée ou effacée) exige options.correctionConfirmee
     * (mot de passe administrateur demandé par l'écran) : sinon ErreurMetier avec .correction = true.
     */
    saisir(sid, n, m, brut, options = {}) {
      const s = AK.eleves.trouver(sid);
      if (!s || s.statut !== 'Inscrit') throw E('Élève introuvable ou non inscrit.');
      AK.perm.exiger('notes.saisir', { classe: s.classe });
      if (!EVALS.includes(Number(n))) throw E('Évaluation inconnue.');
      n = Number(n);
      const mat = X.matieres(s.classe, n).find(([x]) => x === m);
      if (!mat) throw E('Matière inconnue pour cette évaluation.');
      if (X.estAbsent(sid, n)) throw E('Élève marqué absent à cette évaluation : retirez d’abord l’absence.');
      const max = X.noteMax(s.classe, mat[1]);
      const r = V.note(brut, max);
      if (r.err) throw E(r.err);
      const v = r.v, k = X.cle(sid, n, m), ancien = S().grades[k];
      const enseignant = AK.session.estEnseignant();
      if (enseignant && !saisieOuverte(s.classe, n)) throw E('La saisie est fermée pour cette évaluation (date limite dépassée ou fermée par le directeur).');

      // enseignant avec validation : la note attend la validation du directeur (sauf correction d'une note validée)
      if (enseignant && S().school.validation && ancien == null) {
        if ((S().attente[k] ?? null) === v) return { etat: 'inchange', v };
        AK.store.modifier(v == null ? null : `Note saisie (en attente) : ${X.nomComplet(s)}, ${m} = ${u.fmtNote(v)}`, (st) => {
          if (v == null) delete st.attente[k];
          else st.attente[k] = v;
        }, { rendu: false, categorie: 'notes' });
        return { etat: 'attente', v };
      }
      if (ancien === v || (ancien == null && v == null)) return { etat: 'inchange', v };
      // corriger ou effacer une note enregistrée (validée) : réservé au directeur, quel que soit l'écran
      if (ancien != null) AK.perm.exiger('notes.corriger', { classe: s.classe });
      if (ancien != null && !options.correctionConfirmee) {
        const err = E(`Corriger la note de ${X.nomComplet(s)} en ${m} : ${u.fmtNote(ancien)} → ${v == null ? '(vide)' : u.fmtNote(v)} sur ${max} ?`);
        err.correction = true;
        throw err;
      }
      AK.store.modifier(ancien != null ? `Note corrigée : ${X.nomComplet(s)}, ${m} (${u.fmtNote(ancien)} → ${v == null ? 'vide' : u.fmtNote(v)})` : null, (st) => {
        if (v == null) delete st.grades[k];
        else st.grades[k] = v;
        delete st.attente[k];
      }, { rendu: false, categorie: 'notes' });
      return { etat: 'ok', v };
    },
    /** Absence à une évaluation : efface les notes de l'évaluation (moyenne = 0). Confirmation exigée si des notes existent ou pour retirer l'absence. */
    marquerAbsent(sid, n, absent, options = {}) {
      const s = AK.eleves.trouver(sid);
      if (!s) throw E('Élève introuvable.');
      AK.perm.exiger('notes.saisir', { classe: s.classe });
      n = Number(n);
      if (AK.session.estEnseignant() && !saisieOuverte(s.classe, n)) throw E('La saisie est fermée pour cette évaluation.');
      const k = sid + '|' + n;
      const notesValidees = Object.keys(S().grades).some((g) => g.startsWith(k + '|'));
      const aDesNotes = notesValidees || Object.keys(S().attente).some((g) => g.startsWith(k + '|'));
      // marquer absent efface les notes : si des notes sont validées, c'est une correction (directeur)
      if (absent && notesValidees) AK.perm.exiger('notes.corriger', { classe: s.classe });
      if ((aDesNotes || !absent) && !options.confirme) {
        const err = E(absent
          ? `Marquer ${X.nomComplet(s)} absent(e) ? Ses notes de cette évaluation seront effacées et sa moyenne vaudra 0.`
          : `Annuler l’absence de ${X.nomComplet(s)} à cette évaluation ?`);
        err.correction = true;
        throw err;
      }
      AK.store.modifier(`Notes : ${X.nomComplet(s)} ${absent ? 'marqué(e) absent(e)' : 'n’est plus absent(e)'} (${X.evalLabel(s.classe, n)})`, (st) => {
        if (absent) {
          Object.keys(st.grades).forEach((g) => g.startsWith(k + '|') && delete st.grades[g]);
          Object.keys(st.attente).forEach((g) => g.startsWith(k + '|') && delete st.attente[g]);
          st.compAbs[k] = true;
        } else delete st.compAbs[k];
      }, { rendu: false, categorie: 'notes' });
    },
    valider(classe, n) {
      AK.perm.exiger('notes.valider');
      const L = enAttenteDe(classe, n);
      if (!L.length) return 0;
      AK.store.modifier(`${u.pluriel(L.length, 'note')} validée(s) : ${classe}`, (st) =>
        L.forEach((k) => {
          st.grades[k] = st.attente[k];
          delete st.attente[k];
        }), { categorie: 'notes' });
      return L.length;
    },
    rejeter(classe, n) {
      AK.perm.exiger('notes.valider');
      const L = enAttenteDe(classe, n);
      if (!L.length) return 0;
      AK.store.modifier(`${u.pluriel(L.length, 'note')} en attente rejetée(s) : ${classe}`, (st) => L.forEach((k) => delete st.attente[k]), { categorie: 'notes' });
      return L.length;
    },
    basculerSaisie(classe, n) {
      AK.perm.exiger('notes.periode');
      const x = cleSaisie(classe, n);
      AK.store.modifier(`Saisie ${x.fermee ? 'rouverte' : 'fermée'} : ${classe} (${C.evCourt(n)})`, () => (x.fermee = !x.fermee), { categorie: 'notes' });
    },
    dateLimite(classe, n, date) {
      AK.perm.exiger('notes.periode');
      const e = V.date(date, 'Date limite');
      if (e) throw E(e);
      const x = cleSaisie(classe, n);
      AK.store.modifier(`Date limite de saisie ${classe} : ${date ? u.fmtDate(date) : 'aucune'}`, () => (x.fin = date || ''), { categorie: 'notes' });
    },
    basculerValidation(oui) {
      AK.perm.exiger('notes.periode');
      AK.store.modifier(`Validation des notes par le directeur : ${oui ? 'oui' : 'non'}`, (s) => (s.school.validation = !!oui));
    },
    /** Matières d'une composition au CP (choix parmi la liste officielle + matières ajoutées). */
    matieresCP(c, n, liste, nouvelle, aussiAutre) {
      AK.perm.exiger('notes.matieres', { classe: c });
      if (X.info(c).grille !== 'CP') throw E('Le choix des matières ne concerne que le CP1 et le CP2.');
      const nv = String(nouvelle || '').trim().toUpperCase().replace(/\s+/g, ' ').slice(0, 40);
      const L = [...liste];
      const tout = [...C.CP_MATIERES, ...(S().cpExtra || [])];
      if (nv && !L.includes(nv)) L.push(nv);
      if (!L.length) throw E('Choisissez au moins une matière.');
      const autre = c === 'CP1' ? 'CP2' : 'CP1';
      AK.store.modifier(`Matières ${c}${aussiAutre ? ' et ' + autre : ''} – ${X.evalLabel(c, n)}`, (s) => {
        if (nv && !tout.includes(nv)) s.cpExtra = [...(s.cpExtra || []), nv];
        const ordre = [...C.CP_MATIERES, ...(s.cpExtra || [])].filter((m) => L.includes(m));
        const defaut = ordre.length === C.CP_MATIERES.length && C.CP_MATIERES.every((m) => ordre.includes(m));
        [c, ...(aussiAutre ? [autre] : [])].forEach((k) => {
          s.cpMat[k] = s.cpMat[k] || {};
          s.cpMat[k][n] = defaut ? null : ordre;
        });
      }, { categorie: 'notes' });
    },
    fixerDecision(sid, d) {
      AK.perm.exiger('decision.modifier');
      const s = AK.eleves.trouver(sid);
      if (!s) throw E('Élève introuvable.');
      if (d && !C.DECISIONS.includes(d)) throw E('Décision inconnue.');
      AK.store.modifier(`Décision de ${X.nomComplet(s)} : ${d || 'proposition'}`, () => (s.decision = !d || d === X.decisionProposee(s) ? '' : d), { categorie: 'notes' });
    },
    anneeSuivante() {
      const y = parseInt(S().school.year, 10);
      return y ? `${y + 1}–${y + 2}` : '';
    },
    /** Bilan prévisionnel du passage (affiché avant confirmation). */
    bilanPassage() {
      const R = { montent: 0, restent: 0, sortants: 0, archives: 0, sansDecision: 0, niveauNonOuvert: [] };
      S().students.forEach((s) => {
        const d = X.decision(s);
        if (s.statut !== 'Inscrit' || ['Abandon', 'Exclu', 'Transféré'].includes(d)) return R.archives++;
        if (d === 'Admis') {
          const sv = X.niveauSuivant(s.classe);
          if (!sv) return R.sortants++;
          if (!X.niveaux().includes(sv)) {
            R.niveauNonOuvert.push(`${X.nomComplet(s)} (${s.classe} → ${sv})`);
            return R.sortants++;
          }
          return R.montent++;
        }
        if (!d) R.sansDecision++;
        R.restent++;
      });
      return R;
    },
    /**
     * Passage à l'année suivante (correction de 1.7.0 : un admis du plus haut niveau ouvert, autre que le CM2,
     * restait sans classe et bloquait le tableau de bord). Copie de sécurité préalable.
     */
    async passerAnnee() {
      AK.perm.exiger('annee.passer');
      const annee = S().school.year, suivante = notes.anneeSuivante();
      if (!suivante) throw E('Renseignez d’abord l’année scolaire en cours (Paramètres).');
      await AK.store.copieAvant('avant-passage-' + annee);
      const effs = Object.fromEntries(X.niveaux().map((c) => [c, X.actifsDe(c).length]));
      const R = { montent: 0, restent: 0, archives: 0 };
      AK.store.modifier(`Passage à ${suivante}`, (st) => {
        const arch = [], garder = [];
        st.students.forEach((s) => {
          const d = X.decision(s);
          if (s.statut === 'Inscrit') {
            const m = X.mga(s);
            s.parcours = [...(s.parcours || []), { annee, niveau: s.classe, moy: m != null ? u.fmtSaisie(m) : '', eff: String(effs[s.classe] || '') }];
          }
          if (s.statut !== 'Inscrit' || ['Abandon', 'Exclu', 'Transféré'].includes(d)) {
            arch.push({ ...s, decision: d || s.statut });
            R.archives++;
            return;
          }
          if (d === 'Admis') {
            const sv = X.niveauSuivant(s.classe);
            if (!sv) {
              arch.push({ ...s, decision: 'Admis (entrée en 6ème)' });
              R.archives++;
              return;
            }
            if (!X.niveaux().includes(sv)) {
              arch.push({ ...s, decision: `Admis en ${sv} (niveau non ouvert dans l’école : à transférer)` });
              R.archives++;
              return;
            }
            s.classe = sv;
            s.redoublant = false;
            R.montent++;
          } else {
            if (d === 'Redoublant') s.redoublant = true;
            R.restent++;
          }
          s.decision = '';
          garder.push(s);
        });
        st.archives[annee || 'sans-annee'] = { students: arch, grades: st.grades, compAbs: st.compAbs, att: st.att, appel: st.appel, cloture: new Date().toISOString() };
        Object.assign(st, { students: garder, grades: {}, compAbs: {}, att: {}, appel: {}, attente: {}, saisie: {} });
        Object.assign(st.school, { year: suivante, evalCourante: 1 });
      }, { categorie: 'annee' });
      AK.store.journaliser(`Passage à ${suivante} : ${R.montent} admis passent, ${R.restent} restent, ${R.archives} archivés`);
      return R;
    }
  };
  AK.notes = notes;
})(window.AK);
