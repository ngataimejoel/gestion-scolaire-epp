/* =====================================================================================
   Personnel : fiches, affectation des classes, fiches actives, messages aux enseignants,
   corbeille (restauration des élèves et membres supprimés).
   ===================================================================================== */
(function (AK) {
  'use strict';
  const C = AK.cfg, u = AK.u, V = AK.valid, X = AK.calc;
  const S = () => AK.store.etat;
  const E = (m, champ) => new AK.ErreurMetier(m, champ);

  /** Range les niveaux tenus dans l'ordre du cursus ; t.classe = le premier (compatibilité). */
  const poserClasses = (t, L) => {
    L = C.TOUS_NIVEAUX.filter((c) => L.includes(c));
    t.classes = L;
    t.classe = L[0] || '';
  };

  function controler(d, existant) {
    if (!C.CIVS.includes(d.civ)) throw E('Choisissez la civilité : M., Mme ou Mlle.', 'civ');
    let e = V.nom(d.nom, 'Nom complet', 2, 80);
    if (e) throw E(e, 'nom');
    if ((e = V.matriculeAgent(d.matricule))) throw E(e, 'matricule');
    if ((e = V.tel(d.tel, 'Téléphone'))) throw E(e, 'tel');
    const classes = (Array.isArray(d.classes) ? d.classes : d.classes ? [d.classes] : []).filter((c) => X.niveaux().includes(c));
    if ((e = X.fonctErr(d.fonct, classes.length, d.fonctAutre))) throw E(e, 'fonct');
    if (!C.FONCTIONS.includes(d.fonction)) throw E('Choisissez la fonction.', 'fonction');
    const nom = V.civ.avec(d.civ, d.nom);
    const meme = S().teachers.find((t) => t !== existant && u.norm(V.civ.sans(t.nom)) === u.norm(V.civ.sans(nom)));
    if (meme && !d.accepterDoublon) {
      const err = E(`${meme.nom} figure déjà dans le personnel.`, 'nom');
      err.doublons = [meme];
      throw err;
    }
    const mat = String(d.matricule || '').trim();
    if (mat) {
      const m2 = S().teachers.find((t) => t !== existant && u.norm(t.matricule) === u.norm(mat));
      if (m2) throw E(`Matricule déjà attribué à ${m2.nom}.`, 'matricule');
    }
    return classes;
  }

  function appliquer(d, t, classes) {
    t.nom = V.civ.avec(d.civ, d.nom);
    t.fonct = classes.length ? d.fonct : '';
    t.fonctAutre = classes.length && t.fonct === 'autre' ? String(d.fonctAutre || '').trim() : '';
    t.matricule = String(d.matricule || '').trim().toUpperCase();
    t.fonction = d.fonction;
    t.grade = C.GRADES.includes(d.grade) ? d.grade : '';
    t.echelon = String(d.echelon || '').trim().toUpperCase().slice(0, 6);
    t.tel = V.telPropre(d.tel);
    t.dateEntree = d.dateEntree || t.dateEntree || '';
    poserClasses(t, classes);
    if (d.photo !== undefined) t.photo = d.photo && u.IMG_OK.test(d.photo) ? d.photo : '';
    if (d.avis !== undefined) t.avis = d.avis && u.IMG_OK.test(d.avis) ? d.avis : '';
    // un niveau n'a qu'un enseignant : il est retiré aux autres
    S().teachers.forEach((o) => {
      if (o !== t && X.clsDe(o).some((c) => classes.includes(c))) poserClasses(o, X.clsDe(o).filter((c) => !classes.includes(c)));
    });
  }

  const personnel = {
    poserClasses,
    trouver: (id) => S().teachers.find((t) => t.id === id) || null,
    ajouter(d) {
      AK.perm.exiger('personnel.gerer');
      const classes = controler(d, null);
      const t = { id: u.uid(), photo: '', compte: null, actif: true, classes: [], classe: '' };
      AK.store.modifier(`Personnel ajouté : ${V.civ.avec(d.civ, d.nom)}`, (s) => {
        appliquer(d, t, classes);
        s.teachers.push(t);
      }, { categorie: 'personnel' });
      return t;
    },
    modifier(id, d) {
      AK.perm.exiger('personnel.gerer');
      const t = personnel.trouver(id);
      if (!t) throw E('Membre du personnel introuvable.');
      const classes = controler(d, t);
      AK.store.modifier(`Personnel modifié : ${t.nom}`, () => appliquer(d, t, classes), { categorie: 'personnel' });
      return t;
    },
    /** Affectation d'un niveau à un enseignant (ou retrait si tid vide). */
    affecter(classe, tid) {
      AK.perm.exiger('classe.affecter');
      if (!X.niveaux().includes(classe)) throw E('Classe inconnue.');
      const m = tid ? personnel.trouver(tid) : null;
      if (tid && !m) throw E('Enseignant introuvable.');
      if (m) {
        const e = X.fonctErr(m.fonct, X.clsDe(m).filter((k) => k !== classe).length + 1, m.fonctAutre);
        if (e) {
          const err = E(e + ' Complétez d’abord la fiche de l’enseignant.');
          err.ficheAgent = m.id;
          throw err;
        }
      }
      AK.store.modifier(m ? `${m.nom} affecté(e) en ${classe}` : `${classe} : enseignant retiré`, (s) => {
        s.teachers.forEach((x) => {
          if (X.clsDe(x).includes(classe)) poserClasses(x, X.clsDe(x).filter((k) => k !== classe));
        });
        if (m) poserClasses(m, [...X.clsDe(m), classe]);
      }, { categorie: 'personnel' });
    },
    /** Fiche désactivée (départ, mutation) : compte bloqué, classes conservées pour l'historique. */
    basculerFiche(id) {
      AK.perm.exiger('personnel.gerer');
      const t = personnel.trouver(id);
      if (!t) throw E('Membre du personnel introuvable.');
      AK.store.modifier(`Fiche de ${t.nom} ${t.actif === false ? 'réactivée' : 'désactivée (compte bloqué)'}`, () => {
        t.actif = t.actif === false;
        if (!t.actif && t.compte) t.compte.actif = false;
      }, { categorie: 'personnel' });
    },
    basculerCompte(id) {
      AK.perm.exiger('comptes.gerer');
      const t = personnel.trouver(id);
      if (!t || !t.compte) throw E('Ce membre n’a pas de compte.');
      if (!t.compte.actif && t.actif === false) throw E('Réactivez d’abord la fiche de ce membre.');
      AK.store.modifier(`Compte ${t.compte.login} ${t.compte.actif ? 'désactivé' : 'activé'}`, () => (t.compte.actif = !t.compte.actif), { categorie: 'comptes' });
    },
    retirer(id) {
      AK.perm.exiger('personnel.gerer');
      const t = personnel.trouver(id);
      if (!t) throw E('Membre du personnel introuvable.');
      AK.store.modifier(`Personnel retiré (corbeille) : ${t.nom}`, (s) => {
        s.teachers = s.teachers.filter((x) => x !== t);
        const compte = s.securite.comptes[t.id];
        delete s.securite.comptes[t.id];
        s.corbeille.unshift({ id: u.uid(), type: 'agent', t: Date.now(), libelle: t.nom, donnees: { t, compte: compte || null } });
      }, { categorie: 'personnel' });
    },
    /* ---------- Messages du directeur aux enseignants ---------- */
    envoyerMessage(d) {
      AK.perm.exiger('messages.envoyer');
      let e = V.texte(d.titre, 'Objet', { requis: true, max: 120 });
      if (e) throw E(e, 'titre');
      if ((e = V.texte(d.texte, 'Message', { requis: true, max: 2000 }))) throw E(e, 'texte');
      if (d.dest && !personnel.trouver(d.dest)) throw E('Destinataire introuvable.', 'dest');
      AK.store.modifier(`Message envoyé : ${String(d.titre).trim()}`, (s) =>
        s.messages.unshift({ id: u.uid(), t: Date.now(), dest: d.dest || '', titre: String(d.titre).trim(), texte: String(d.texte).trim(), lus: {} }), { categorie: 'messages' });
    },
    marquerLus(tid) {
      const moi = AK.session.agent();
      if (!AK.session.estDirecteur() && (!moi || moi.id !== tid)) throw new AK.ErreurDroits('Vous ne pouvez marquer comme lus que vos propres messages.');
      const L = S().messages.filter((m) => (!m.dest || m.dest === tid) && !m.lus[tid]);
      if (L.length) AK.store.modifier('Messages lus', () => L.forEach((m) => (m.lus[tid] = Date.now())));
    },
    nonLus: (tid) => S().messages.filter((m) => (!m.dest || m.dest === tid) && !m.lus[tid]),

    /* ---------- Corbeille ---------- */
    restaurer(idCorbeille) {
      const c = S().corbeille.find((x) => x.id === idCorbeille);
      if (!c) throw E('Élément introuvable dans la corbeille.');
      if (c.type === 'eleve') {
        AK.perm.exiger('eleve.supprimer', { classe: c.donnees.s.classe });
        if (S().students.some((x) => x.id === c.donnees.s.id)) throw E('Cet élève est déjà présent.');
        const el = c.donnees.s, mn = u.norm(el.matNat);
        const homonyme = mn && S().students.find((x) => u.norm(x.matNat) === mn);
        if (homonyme) throw E(`Le matricule national ${el.matNat} est maintenant porté par ${X.nomComplet(homonyme)} : corrigez d’abord ce dossier.`);
        // matricule école repris entre-temps (données antérieures à la réservation des matricules de la corbeille)
        const nouveauMat = el.mat && S().students.some((x) => x.mat === el.mat) ? AK.eleves.prochainMatricule() : null;
        AK.store.modifier(`Élève restauré : ${c.libelle}${nouveauMat ? ` (matricule ${el.mat} déjà attribué : nouveau matricule ${nouveauMat})` : ''}`, (s) => {
          if (nouveauMat) el.mat = nouveauMat;
          s.students.push(el);
          Object.assign(s.grades, c.donnees.notes || {});
          Object.assign(s.compAbs, c.donnees.compAbs || {});
          Object.assign(s.attente, c.donnees.attente || {});
          Object.entries(c.donnees.abs || {}).forEach(([d, v]) => ((s.att[d] = s.att[d] || {})[c.donnees.s.id] = v));
          s.corbeille = s.corbeille.filter((x) => x !== c);
        });
      } else if (c.type === 'agent') {
        AK.perm.exiger('personnel.gerer');
        AK.store.modifier(`Personnel restauré : ${c.libelle}`, (s) => {
          const t = c.donnees.t;
          // ses niveaux ont pu être confiés à d'autres entre-temps : on ne les reprend pas
          poserClasses(t, X.clsDe(t).filter((k) => !s.teachers.some((o) => X.clsDe(o).includes(k))));
          s.teachers.push(t);
          if (c.donnees.compte) s.securite.comptes[t.id] = c.donnees.compte;
          s.corbeille = s.corbeille.filter((x) => x !== c);
        });
      }
    },
    viderCorbeilleElement(idCorbeille) {
      AK.perm.exiger('parametres.gerer');
      const c = S().corbeille.find((x) => x.id === idCorbeille);
      if (!c) return;
      AK.store.modifier(`Supprimé définitivement de la corbeille : ${c.libelle}`, (s) => (s.corbeille = s.corbeille.filter((x) => x !== c)));
    }
  };
  AK.personnel = personnel;
})(window.AK);
