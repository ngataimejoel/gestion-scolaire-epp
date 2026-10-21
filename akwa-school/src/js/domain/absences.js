/* =====================================================================================
   Appel du jour et demandes d'autorisation d'absence (personnel et élèves).
   ===================================================================================== */
(function (AK) {
  'use strict';
  const C = AK.cfg, u = AK.u, V = AK.valid, X = AK.calc;
  const S = () => AK.store.etat;
  const E = (m, champ) => new AK.ErreurMetier(m, champ);

  const dateAppel = (date) => {
    if (V.date(date, 'Date') || !date) throw E('Date invalide.');
    if (date > u.aujourdhui()) throw E('Impossible de faire l’appel d’un jour à venir.');
  };
  const classeOuverte = (classe) => {
    if (!X.niveaux().includes(classe)) throw E('Classe inconnue.');
  };

  const absences = {
    /** État suivant d'une case de l'appel : Présent → Absent → Absent justifié → Présent. */
    basculer(date, classe, sid) {
      const s = AK.eleves.trouver(sid);
      if (!s || s.classe !== classe || s.statut !== 'Inscrit') throw E('Élève introuvable dans cette classe.');
      AK.perm.exiger('appel.faire', { classe });
      dateAppel(date);
      const d = S().att[date] || {};
      const v = d[sid] || '';
      // un enseignant ne lève pas une absence déjà enregistrée
      if (v && !AK.perm.peut('appel.lever')) throw E('Absence déjà enregistrée : seul le directeur peut la modifier.');
      const nv = AK.perm.peut('appel.lever') ? (v === '' ? 'A' : v === 'A' ? 'J' : '') : 'A';
      AK.store.modifier(null, (st) => {
        const j = st.att[date] || (st.att[date] = {});
        if (nv) j[sid] = nv;
        else delete j[sid];
        (st.appel[date] || (st.appel[date] = {}))[classe] = true;
      }, { rendu: false });
      return nv;
    },
    /**
     * « Tout le monde présent » : le directeur lève les absences non justifiées du jour ; les absences
     * justifiées (autorisation accordée) restent. Renvoie le nombre d'absences justifiées conservées.
     */
    tousPresents(date, classe) {
      classeOuverte(classe);
      AK.perm.exiger('appel.faire', { classe });
      dateAppel(date);
      const directeur = AK.perm.peut('appel.lever');
      let gardees = 0;
      AK.store.modifier(`Appel ${classe} du ${u.fmtDate(date)} : ${directeur ? 'absences non justifiées levées' : 'les autres élèves présents'}`, (st) => {
        const j = st.att[date] || (st.att[date] = {});
        X.actifsDe(classe).forEach((s) => {
          if (j[s.id] === 'J') gardees++;
          else if (directeur) delete j[s.id];
        });
        (st.appel[date] || (st.appel[date] = {}))[classe] = true;
      }, { categorie: 'appel' });
      return gardees;
    },
    valider(date, classe) {
      classeOuverte(classe);
      AK.perm.exiger('appel.faire', { classe });
      dateAppel(date);
      AK.store.modifier(`Appel validé : ${classe}, ${u.fmtDate(date)}`, (st) => ((st.appel[date] || (st.appel[date] = {}))[classe] = true), { categorie: 'appel' });
    },
    joursDemande: (a) => X.joursClasse(a.du, a.au).length,
    /** Demande d'autorisation. d = { qui: 'personnel'|'eleve', pid, du, au, motif, precision } */
    demander(d) {
      AK.perm.exiger('autorisation.demander');
      if (d.qui !== 'eleve' && d.qui !== 'personnel') throw E('Choisissez pour qui est la demande.', 'qui');
      let nom = '';
      if (d.qui === 'eleve') {
        const s = AK.eleves.trouver(d.pid);
        if (!s) throw E('Élève introuvable : choisissez-le dans la liste.', 'pid');
        if (!AK.perm.peut('eleve.voir', { classe: s.classe })) throw E('Cet élève n’est pas dans votre classe.', 'pid');
        nom = X.nomComplet(s);
      } else {
        const t = AK.personnel.trouver(d.pid);
        if (!t) throw E(S().teachers.length ? 'Personne introuvable : choisissez-la dans la liste.' : 'Aucun membre du personnel enregistré : ajoutez d’abord la personne dans Personnel.', 'pid');
        const moi = AK.session.agent();
        if (AK.session.estEnseignant() && (!moi || moi.id !== t.id)) throw E('Vous ne pouvez demander une autorisation que pour vous-même ou un élève de votre classe.', 'pid');
        nom = t.nom;
      }
      let e = V.date(d.du, 'Date de début', { requise: true });
      if (e) throw E(e, 'du');
      if ((e = V.date(d.au, 'Date de fin', { requise: true }))) throw E(e, 'au');
      if ((e = V.periode(d.du, d.au))) throw E(e, 'au');
      if (u.ecartJours(d.du, d.au) > 366) throw E('Période trop longue (un an au plus).', 'au');
      if (!C.MOTIFS.includes(d.motif)) throw E('Choisissez le motif.', 'motif');
      if ((e = V.texte(d.precision, 'Précision', { max: 160 }))) throw E(e, 'precision');
      const an = X.anneeRentree();
      const n = S().auth.reduce((k, a) => Math.max(k, parseInt(String(a.ref).split('-').pop(), 10) || 0), 0) + 1;
      const a = { id: u.uid(), ref: `AUT-${an}-${u.pad(n, 3)}`, qui: d.qui, pid: d.pid, nom, du: d.du, au: d.au, motif: d.motif, precision: String(d.precision || '').trim(), statut: 'En attente', cree: u.aujourdhui() };
      AK.store.modifier(`Demande ${a.ref} : ${nom}`, (st) => st.auth.push(a), { categorie: 'autorisations' });
      return a;
    },
    /** Accorder : pour un élève, crée les absences justifiées des jours de classe concernés. */
    decider(id, accord) {
      AK.perm.exiger('autorisation.decider');
      const a = S().auth.find((x) => x.id === id);
      if (!a) throw E('Demande introuvable.');
      if (a.statut !== 'En attente') throw E('Cette demande a déjà reçu une décision.');
      let n = 0;
      AK.store.modifier(`${a.ref} ${accord ? 'accordée' : 'refusée'}`, (st) => {
        a.statut = accord ? 'Accordée' : 'Refusée';
        a.decideLe = u.aujourdhui();
        if (accord && a.qui === 'eleve')
          X.joursClasse(a.du, a.au).forEach((d) => {
            (st.att[d] || (st.att[d] = {}))[a.pid] = 'J';
            n++;
          });
      }, { categorie: 'autorisations' });
      return n;
    },
    supprimer(id) {
      AK.perm.exiger('autorisation.supprimer');
      const a = S().auth.find((x) => x.id === id);
      if (!a) throw E('Demande introuvable.');
      AK.store.modifier(`Demande supprimée : ${a.ref}`, (st) => (st.auth = st.auth.filter((x) => x !== a)), { categorie: 'autorisations' });
    },
    visible(a) {
      if (AK.session.estDirecteur()) return true;
      const moi = AK.session.agent();
      if (a.qui === 'personnel') return !!moi && a.pid === moi.id;
      const s = AK.eleves.trouver(a.pid);
      return !!s && AK.session.classes().includes(s.classe);
    },
    /* ---------- Calendrier (jours fériés et congés) ---------- */
    ajouterConge(d) {
      AK.perm.exiger('parametres.gerer');
      let e = V.texte(d.lib, 'Libellé', { requis: true, max: 80 });
      if (e) throw E(e, 'lib');
      if ((e = V.date(d.du, 'Date', { requise: true }))) throw E(e, 'du');
      if ((e = V.date(d.au, 'Fin'))) throw E(e, 'au');
      if ((e = V.periode(d.du, d.au))) throw E(e, 'au');
      AK.store.modifier(`Calendrier : ${String(d.lib).trim()} ajouté`, (st) => st.conges.push({ id: u.uid(), lib: String(d.lib).trim(), du: d.du, au: d.au && d.au !== d.du ? d.au : '' }));
    },
    supprimerConge(id) {
      AK.perm.exiger('parametres.gerer');
      const c = S().conges.find((x) => x.id === id);
      if (!c) return;
      AK.store.modifier(`Calendrier : ${c.lib} supprimé`, (st) => (st.conges = st.conges.filter((x) => x !== c)));
    }
  };
  AK.absences = absences;
})(window.AK);
