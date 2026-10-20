/* =====================================================================================
   Gestion de l'école (modules PRO de 1.7.0) : vie scolaire, scolarité et finances,
   services (bibliothèque, CEPE, parents), liaison avec l'IEPP.
   ===================================================================================== */
(function (AK) {
  'use strict';
  const C = AK.cfg, u = AK.u, V = AK.valid, X = AK.calc;
  const S = () => AK.store.etat;
  const P = () => S().pro;
  const E = (m, champ) => new AK.ErreurMetier(m, champ);
  const eleveVisible = (sid) => {
    const s = AK.eleves.trouver(sid);
    if (!s) throw E('Élève introuvable : choisissez-le dans la liste.', 'sid');
    if (!AK.perm.peut('eleve.voir', { classe: s.classe })) throw E('Cet élève n’est pas dans votre classe.', 'sid');
    return s;
  };
  const txt = (v, lib, o) => {
    const e = V.texte(v, lib, o);
    if (e) throw E(e);
    return String(v || '').trim();
  };

  /* ---------- Finances : calculs ---------- */
  const fraisDe = (c) => {
    const F = P().frais[c] || {};
    return { inscription: +F.inscription || 0, coges: +F.coges || 0, tenue: +F.tenue || 0, autre: +F.autre || 0 };
  };
  const duDe = (s) => Object.values(fraisDe(s.classe)).reduce((a, b) => a + b, 0);
  const payeDe = (s) => P().paiements.filter((p) => p.sid === s.id && !p.annule).reduce((a, p) => a + (+p.montant || 0), 0);
  const etatPaie = (s) => {
    const d = duDe(s), p = payeDe(s);
    return !d ? 'Aucun frais' : p >= d ? 'Soldé' : p > 0 ? 'Partiel' : 'Non payé';
  };
  const encaisse = () => P().paiements.filter((p) => !p.annule).reduce((a, p) => a + (+p.montant || 0), 0);
  const depense = () => P().depenses.reduce((a, d) => a + (+d.montant || 0), 0);

  const pro = {
    fraisDe, duDe, payeDe, etatPaie, encaisse, depense,
    telParent: (s) => s.tel || (s.pere && s.pere.tel) || (s.mere && s.mere.tel) || '',

    /* ---------- Emploi du temps ---------- */
    caseEdt(classe, k, matiere) {
      AK.perm.exiger('vie.utiliser', { classe });
      AK.store.modifier(null, () => {
        const E2 = P().edt[classe] || (P().edt[classe] = {});
        if (matiere) E2[k] = String(matiere).slice(0, 40);
        else delete E2[k];
      }, { rendu: false });
    },
    edtType(classe) {
      AK.perm.exiger('vie.utiliser', { classe });
      const M = X.matieres(classe, 1).map(([m]) => m), E2 = {};
      C.JOURS_EDT.forEach(([d], k) => C.CRENEAUX.forEach((h, i) => {
        E2[d + '|' + i] = i === 2 ? 'RECREATION' : i === 6 && k % 2 ? 'EPS' : i === 5 && k === 0 ? 'ANGLAIS' : M[(i + k * 3) % M.length];
      }));
      AK.store.modifier('Emploi du temps type : ' + classe, () => (P().edt[classe] = E2));
    },
    /* ---------- Cahier de textes ---------- */
    seance(d, id) {
      AK.perm.exiger('vie.utiliser', { classe: d.classe });
      const e = V.date(d.date, 'Date', { requise: true });
      if (e) throw E(e, 'date');
      if (!d.mat) throw E('Choisissez la discipline.', 'mat');
      const x = { classe: d.classe, date: d.date, mat: String(d.mat), contenu: txt(d.contenu, 'Contenu de la séance', { requis: true, max: 1000 }), travail: txt(d.travail, 'Travail à faire', { max: 300 }) };
      if (id) {
        const o = P().cahier.find((c) => c.id === id);
        if (!o) throw E('Séance introuvable.');
        AK.store.modifier('Cahier de textes modifié : ' + d.classe, () => Object.assign(o, x));
      } else AK.store.modifier('Cahier de textes : ' + d.classe + ' · ' + d.mat, () => P().cahier.push({ id: u.uid(), ...x }));
    },
    supprimerSeance(id) {
      const o = P().cahier.find((c) => c.id === id);
      if (!o) return;
      AK.perm.exiger('vie.utiliser', { classe: o.classe });
      AK.store.modifier('Séance supprimée du cahier de textes', () => (P().cahier = P().cahier.filter((c) => c !== o)));
    },
    /* ---------- Discipline ---------- */
    incident(d) {
      const s = eleveVisible(d.sid);
      const e = V.date(d.date, 'Date', { requise: true, max: u.aujourdhui() });
      if (e) throw E(e, 'date');
      if (!C.FAITS.includes(d.fait)) throw E('Choisissez le fait.', 'fait');
      if (!C.SANCTIONS.includes(d.sanction)) throw E('Choisissez la sanction.', 'sanction');
      const pts = /Bagarre|Insolence|Dégradation|Tricherie|dangereux/.test(d.fait) ? 3 : 1;
      AK.store.modifier('Discipline : ' + X.nomComplet(s) + ' · ' + d.fait, () =>
        P().incidents.push({ id: u.uid(), sid: s.id, date: d.date, fait: d.fait, detail: txt(d.detail, 'Précision', { max: 200 }), sanction: d.sanction, statut: d.statut === 'Traité' ? 'Traité' : 'En cours', pts }));
    },
    clore(id) {
      const x = P().incidents.find((o) => o.id === id);
      if (!x) return;
      eleveVisible(x.sid);
      AK.store.modifier('Fait de discipline clos', () => (x.statut = 'Traité'));
    },
    supprimerIncident(id) {
      AK.perm.exiger('vie.supprimer');
      AK.store.modifier('Fait de discipline supprimé', () => (P().incidents = P().incidents.filter((o) => o.id !== id)));
    },
    /* ---------- Infirmerie ---------- */
    soin(d) {
      const s = eleveVisible(d.sid);
      const e = V.date(d.date, 'Date', { requise: true, max: u.aujourdhui() });
      if (e) throw E(e, 'date');
      if (!C.MAUX.includes(d.motif)) throw E('Choisissez le motif.', 'motif');
      AK.store.modifier('Infirmerie : passage enregistré (' + s.classe + ')', () =>
        P().soins.push({ id: u.uid(), sid: s.id, date: d.date, heure: /^\d\d:\d\d$/.test(d.heure || '') ? d.heure : '', motif: d.motif, suite: C.SUITES_SOIN.includes(d.suite) ? d.suite : C.SUITES_SOIN[0], soin: txt(d.soin, 'Soins donnés', { max: 200 }) }));
    },
    supprimerSoin(id) {
      AK.perm.exiger('vie.supprimer');
      AK.store.modifier('Passage à l’infirmerie supprimé', () => (P().soins = P().soins.filter((o) => o.id !== id)));
    },
    /* ---------- Événements ---------- */
    evenement(d) {
      AK.perm.exiger('vie.utiliser');
      const e = V.date(d.date, 'Date', { requise: true });
      if (e) throw E(e, 'date');
      const titre = txt(d.titre, 'Intitulé', { requis: true, max: 100 });
      AK.store.modifier('Événement : ' + titre, () => P().events.push({ id: u.uid(), date: d.date, type: ['acc', 'w', 'g', 'b'].includes(d.type) ? d.type : 'acc', titre }));
    },
    supprimerEvenement(id) {
      AK.perm.exiger('vie.supprimer');
      AK.store.modifier('Événement supprimé', () => (P().events = P().events.filter((e) => e.id !== id)));
    },

    /* ---------- Frais et versements ---------- */
    fixerFrais(table) {
      AK.perm.exiger('finances.gerer');
      const F = {};
      X.niveaux().forEach((c) => {
        F[c] = {};
        ['inscription', 'coges', 'tenue', 'autre'].forEach((k) => {
          const v = Math.round(Number(table[c + '|' + k]) || 0);
          if (v < 0 || v > 10000000) throw E(`${c} : montant invalide (0 à 10 000 000 F).`, c + '|' + k);
          F[c][k] = v;
        });
      });
      AK.store.modifier('Frais par niveau modifiés', () => Object.assign(P().frais, F), { categorie: 'finances' });
    },
    encaisser(d) {
      AK.perm.exiger('finances.gerer');
      const s = AK.eleves.trouver(d.sid);
      if (!s) throw E('Choisissez l’élève.', 'sid');
      let e = V.montant(d.montant, 'Montant', { min: 25, max: 10000000 });
      if (e) throw E(e, 'montant');
      if ((e = V.date(d.date, 'Date', { requise: true, max: u.aujourdhui() }))) throw E(e, 'date');
      if (!C.MODES_PAIE.includes(d.mode)) throw E('Choisissez le mode de paiement.', 'mode');
      const p = { id: u.uid(), ref: `REC-${X.anneeRentree()}-${u.pad(P().seq.rec, 5)}`, sid: s.id, montant: Math.round(+d.montant), mode: d.mode, objet: C.OBJETS_PAIE.includes(d.objet) ? d.objet : 'Autre', date: d.date, payeur: txt(d.payeur, 'Versé par', { max: 80 }), cree: Date.now() };
      AK.store.modifier(`Versement ${p.ref} : ${u.fcfa(p.montant)}`, () => {
        P().seq.rec++;
        P().paiements.push(p);
      }, { categorie: 'finances' });
      return p;
    },
    /** Annulation d'un reçu : conservé dans l'historique avec la mention ANNULÉ (jamais effacé). */
    annulerRecu(id, motif) {
      AK.perm.exiger('finances.gerer');
      const p = P().paiements.find((x) => x.id === id);
      if (!p) throw E('Reçu introuvable.');
      if (p.annule) throw E('Ce reçu est déjà annulé.');
      const m = txt(motif, 'Motif d’annulation', { requis: true, max: 160 });
      AK.store.modifier(`Reçu annulé : ${p.ref} (${m})`, () => (p.annule = { le: new Date().toISOString(), motif: m, par: AK.session.libelle() }), { categorie: 'finances' });
    },
    depense(d) {
      AK.perm.exiger('finances.gerer');
      const libelle = txt(d.libelle, 'Libellé', { requis: true, max: 120 });
      let e = V.montant(d.montant, 'Montant', { min: 1, max: 100000000 });
      if (e) throw E(e, 'montant');
      if ((e = V.date(d.date, 'Date', { requise: true, max: u.aujourdhui() }))) throw E(e, 'date');
      AK.store.modifier('Dépense : ' + libelle + ' · ' + u.fcfa(+d.montant), () =>
        P().depenses.push({ id: u.uid(), libelle, cat: C.CAT_DEP.includes(d.cat) ? d.cat : 'Autre', montant: Math.round(+d.montant), date: d.date, fournisseur: txt(d.fournisseur, 'Fournisseur', { max: 80 }), justif: txt(d.justif, 'Justificatif', { max: 60 }) }), { categorie: 'finances' });
    },
    supprimerDepense(id) {
      AK.perm.exiger('finances.gerer');
      const x = P().depenses.find((o) => o.id === id);
      if (!x) return;
      AK.store.modifier(`Dépense supprimée : ${x.libelle} (${u.fcfa(x.montant)})`, () => (P().depenses = P().depenses.filter((o) => o !== x)), { categorie: 'finances' });
    },
    /* ---------- Cantine ---------- */
    cantineInscrire(sid, oui) {
      AK.perm.exiger('finances.gerer');
      AK.store.modifier(null, () => {
        if (oui) P().cantine.inscrits[sid] = true;
        else delete P().cantine.inscrits[sid];
      });
    },
    cantineTous(classe) {
      AK.perm.exiger('finances.gerer');
      AK.store.modifier('Cantine : toute la classe ' + classe + ' inscrite', () => X.actifsDe(classe).forEach((s) => (P().cantine.inscrits[s.id] = true)));
    },
    cantinePrix(prix) {
      AK.perm.exiger('finances.gerer');
      const e = V.montant(prix, 'Prix du repas', { min: 0, max: 100000 });
      if (e) throw E(e, 'prix');
      AK.store.modifier('Prix du repas : ' + u.fcfa(+prix), () => (P().cantine.prix = Math.round(+prix)));
    },
    cantineMenu(i, plat) {
      AK.perm.exiger('finances.gerer');
      AK.store.modifier(null, () => (P().cantine.menu[i].p = String(plat || '').trim().slice(0, 80)), { rendu: false });
    },
    cantineJour() {
      AK.perm.exiger('finances.gerer');
      const j = u.aujourdhui();
      if (!X.estJourClasse(j)) throw E('Aujourd’hui n’est pas un jour de classe.');
      const abs = S().att[j] || {};
      const n = X.actifs().filter((s) => P().cantine.inscrits[s.id] && !abs[s.id]).length;
      AK.store.modifier(`Cantine : ${n} repas le ${u.fmtDate(j)}`, () => (P().cantine.repas[j] = n));
      return n;
    },

    /* ---------- Bibliothèque ---------- */
    ouvrage(d) {
      AK.perm.exiger('services.utiliser');
      const titre = txt(d.titre, 'Titre', { requis: true, max: 120 });
      const ex = Math.round(Number(d.ex));
      if (!(ex >= 1 && ex <= 9999)) throw E('Nombre d’exemplaires : de 1 à 9999.', 'ex');
      const g = C.GENRES.includes(d.genre) ? d.genre : 'Manuel';
      const cote = txt(d.cote, 'Cote', { max: 20 }) || u.norm(g).slice(0, 3).toUpperCase() + '-' + (100 + P().livres.length * 7);
      if (P().livres.some((b) => b.cote === cote)) throw E('Cette cote est déjà utilisée.', 'cote');
      AK.store.modifier('Ouvrage ajouté : ' + titre, () => P().livres.push({ id: u.uid(), titre, auteur: txt(d.auteur, 'Auteur', { max: 80 }), genre: g, ex, cote }));
    },
    retirerOuvrage(id) {
      AK.perm.exiger('services.utiliser');
      if (P().prets.some((p) => p.livre === id && !p.rendu)) throw E('Des exemplaires sont encore prêtés.');
      AK.store.modifier('Ouvrage retiré du fonds', () => (P().livres = P().livres.filter((b) => b.id !== id)));
    },
    preter(d) {
      AK.perm.exiger('services.utiliser');
      const s = eleveVisible(d.sid);
      const b = P().livres.find((x) => x.id === d.livre);
      if (!b) throw E('Choisissez l’ouvrage.', 'livre');
      if (P().prets.filter((p) => p.livre === b.id && !p.rendu).length >= b.ex) throw E('Aucun exemplaire disponible.', 'livre');
      let e = V.date(d.out, 'Date du prêt', { requise: true });
      if (e) throw E(e, 'out');
      if ((e = V.date(d.due, 'Retour prévu', { requise: true, min: d.out }))) throw E(e, 'due');
      AK.store.modifier('Prêt : ' + b.titre + ' (' + s.classe + ')', () => P().prets.push({ id: u.uid(), sid: s.id, livre: b.id, out: d.out, due: d.due, rendu: false }));
    },
    retour(id) {
      AK.perm.exiger('services.utiliser');
      const p = P().prets.find((x) => x.id === id);
      if (p) AK.store.modifier('Retour d’un ouvrage enregistré', () => (p.rendu = u.aujourdhui()));
    },
    /* ---------- CEPE ---------- */
    pieceCepe(sid, k, oui) {
      AK.perm.exiger('services.utiliser');
      eleveVisible(sid);
      if (!C.PIECES_CEPE.some(([x]) => x === k)) throw E('Pièce inconnue.');
      AK.store.modifier(null, () => ((P().cepe[sid] = P().cepe[sid] || {})[k] = !!oui));
    },
    dossierCepe(s) {
      const d = P().cepe[s.id] || {};
      const pieces = C.PIECES_CEPE.filter(([k]) => (k === 'extrait' ? d.extrait ?? !!s.extrait : d[k]));
      return { d, n: pieces.length, complet: pieces.length === C.PIECES_CEPE.length };
    },
    /* ---------- Parents ---------- */
    cibleSms(dest, classe) {
      const abs = S().att[u.aujourdhui()] || {};
      return X.actifs().filter((s) => AK.session.classes().includes(s.classe) && (dest === 'tous' || (dest === 'classe' && s.classe === classe) || (dest === 'cm2' && s.classe === 'CM2') || (dest === 'absents' && abs[s.id] === 'A') || (dest === 'impayes' && ['Partiel', 'Non payé'].includes(etatPaie(s)))));
    },
    noterEnvoi(d) {
      AK.perm.exiger('services.utiliser');
      AK.store.modifier(`Message aux parents : ${d.dest} (${d.n})`, () => P().sms.unshift({ id: u.uid(), date: u.aujourdhui(), dest: d.dest, n: d.n, objet: d.objet, texte: String(d.texte || '').slice(0, 459) }));
    },
    annonce(d) {
      AK.perm.exiger('services.utiliser');
      const titre = txt(d.titre, 'Titre', { requis: true, max: 100 });
      const corps = txt(d.corps, 'Texte', { requis: true, max: 1500 });
      AK.store.modifier('Annonce publiée : ' + titre, () => P().annonces.push({ id: u.uid(), titre, cible: ['Parents', 'Enseignants', 'Élèves', 'Tous'].includes(d.cible) ? d.cible : 'Tous', date: d.date || u.aujourdhui(), corps }));
    },
    retirerAnnonce(id) {
      AK.perm.exiger('services.utiliser');
      AK.store.modifier('Annonce retirée', () => (P().annonces = P().annonces.filter((a) => a.id !== id)));
    },

    /* ---------- Liaison IEPP ---------- */
    paquetIEPP(n) {
      const sc = S().school, A = X.actifs();
      const sx = (L) => ({ G: L.filter((s) => s.sexe === 'Masculin').length, F: L.filter((s) => s.sexe === 'Féminin').length, T: L.length });
      const mois = u.aujourdhui().slice(0, 7), absM = Object.entries(S().att).filter(([d]) => d.slice(0, 7) === mois);
      return {
        format: 'AKWA SCHOOL · transmission IEPP', version: 2, genere: new Date().toISOString(), application: AK.NOM + ' ' + AK.VERSION,
        ecole: { nom: sc.name, code: sc.codeecole || '', iepp: sc.iepp, drenaet: sc.drenaet, annee: sc.year, directeur: sc.director, statut: sc.statut || '' },
        evaluation: { numero: n, libelle: C.EV_GEN[n - 1] },
        effectifs: X.niveaux().map((c) => ({ classe: c, ...sx(X.actifsDe(c)) })),
        resultats: X.niveaux().map((c) => {
          const r = X.reussite(c, n);
          return { classe: c, moyenne: X.moyClasse(c, n), evalues: r.n, admis_seuil: r.ok, taux: r.n ? u.arrondi((r.ok / r.n) * 100, 1) : null, seuil: X.info(c).seuil, echelle: X.echelle(c) };
        }),
        absences_mois: { mois, non_justifiees: absM.reduce((a, [, m]) => a + Object.values(m).filter((v) => v === 'A').length, 0), justifiees: absM.reduce((a, [, m]) => a + Object.values(m).filter((v) => v && v !== 'A').length, 0) },
        // personnel : fonction et classes seulement (pas de téléphone : minimisation des données)
        personnel: S().teachers.filter((t) => t.actif !== false).map((t) => ({ nom: t.nom, fonction: t.fonction || '', fonctionnement: t.fonct || '', classes: X.clsDe(t).join(' ') })),
        cepe: { candidats: A.filter((s) => s.classe === 'CM2').length },
        vie_scolaire: { incidents: P().incidents.length, soins: P().soins.length, inscrits_cantine: A.filter((s) => P().cantine.inscrits[s.id]).length },
        finances: { encaisse: encaisse(), depenses: depense() }
      };
    },
    noterTransmission(objet) {
      AK.perm.exiger('liaison.gerer');
      AK.store.modifier('Transmission IEPP : ' + objet, () => P().transmis.unshift({ date: u.aujourdhui(), objet }));
    }
  };
  AK.pro = pro;
})(window.AK);
