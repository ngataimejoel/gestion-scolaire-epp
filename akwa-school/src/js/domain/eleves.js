/* =====================================================================================
   Élèves : inscription, modification, statut, suppression (corbeille), doublons.
   Toutes les règles sont vérifiées ici, quel que soit l'écran qui appelle.
   ===================================================================================== */
(function (AK) {
  'use strict';
  const C = AK.cfg, u = AK.u, V = AK.valid, X = AK.calc;
  const S = () => AK.store.etat;
  const E = (m, champ) => new AK.ErreurMetier(m, champ);

  /** Prochain matricule école : AK-<2 chiffres de l'année><numéro sur 3 chiffres> */
  function prochainMatricule() {
    const num = (s) => parseInt(((s && s.mat) || '').replace(/\D/g, '').slice(2), 10) || 0;
    // élèves présents, archivés et à la corbeille : un matricule n'est jamais réattribué
    const nums = [
      ...S().students.map(num),
      ...Object.values(S().archives || {}).flatMap((a) => (a.students || []).map(num)),
      ...(S().corbeille || []).filter((c) => c.type === 'eleve' && c.donnees).map((c) => num(c.donnees.s))
    ];
    return 'AK-' + String(X.anneeRentree()).slice(2) + u.pad(Math.max(0, ...nums) + 1, 3);
  }

  const lireParent = (d, k) => ({
    nom: u.majNom(String(d[k + '_nom'] || '').trim()),
    prenoms: u.majPrenoms(String(d[k + '_prenoms'] || '').trim()),
    profession: String(d[k + '_profession'] || '').trim(),
    tel: V.telPropre(d[k + '_tel']),
    domicile: String(d[k + '_domicile'] || '').trim()
  });

  /** Contrôle d'un formulaire d'élève (objet champ → valeur). Lève une ErreurMetier ciblée. */
  function controler(d, existant) {
    const ex = d.extrait === true || d.extrait === 'on';
    const P = (k) => String(d[k + '_nom'] || '').trim() && String(d[k + '_prenoms'] || '').trim();
    let e = V.nom(d.nom, 'Nom de l’élève', 1, 40);
    if (e) throw E(e, 'nom');
    if ((e = V.nom(d.prenoms, 'Prénoms de l’élève', 1, 60))) throw E(e, 'prenoms');
    if (d.sexe !== 'Masculin' && d.sexe !== 'Féminin') throw E('Choisissez le sexe de l’élève.', 'sexe');
    if ((e = V.classe(d.classe, X.niveaux()))) throw E(e, 'classe');
    if ((e = V.matNat(d.matNat))) throw E(e, 'matNat');
    if (ex) {
      if ((e = V.naissanceEleve(d.naissance, X.anneeRentree()))) throw E(e, 'naissance');
      if (!P('pere') || !P('mere')) throw E('Avec un extrait, les nom et prénoms du père et de la mère sont obligatoires.', P('pere') ? 'mere_nom' : 'pere_nom');
      if ((e = V.texte(d.acte_num, 'N° de l’acte', { requis: true, max: 20 }))) throw E(e, 'acte_num');
      if ((e = V.date(d.acte_date, 'Date de l’acte', { requise: true, max: u.aujourdhui(), min: d.naissance }))) throw E(e, 'acte_date');
    } else {
      const a = Number(d.age);
      if (!a || a < 2 || a > 20 || !Number.isInteger(a)) throw E('Saisissez l’âge de l’enfant (de 2 à 20 ans).', 'age');
      if (!P('pere') && !P('mere') && !((d.tuteur === true || d.tuteur === 'on') && String(d.parent || '').trim()))
        throw E('Sans extrait, le nom et les prénoms de l’un des parents ou du tuteur sont obligatoires.', 'pere_nom');
    }
    if (d.classe !== 'CP1' || existant) {
      if (d.classe !== 'CP1' && !d.entree) throw E('Saisissez la date d’entrée à l’école.', 'entree');
    }
    if (d.entree && (e = V.date(d.entree, 'Date d’entrée', { max: u.ajouterJours(u.aujourdhui(), 31) }))) throw E(e, 'entree');
    for (const [k, l] of [['pere', 'du père'], ['mere', 'de la mère']]) {
      if (String(d[k + '_nom'] || '').trim() || String(d[k + '_prenoms'] || '').trim()) {
        if ((e = V.nom(d[k + '_nom'], 'Nom ' + l, 1, 40))) throw E(e, k + '_nom');
        if ((e = V.nom(d[k + '_prenoms'], 'Prénoms ' + l, 1, 60))) throw E(e, k + '_prenoms');
      }
      if ((e = V.tel(d[k + '_tel'], 'Contact ' + l))) throw E(e, k + '_tel');
    }
    if ((d.tuteur === true || d.tuteur === 'on') && String(d.parent || '').trim() && (e = V.nom(d.parent, 'Nom et prénoms du tuteur'))) throw E(e, 'parent');
    if ((e = V.tel(d.tel, 'Contact du tuteur'))) throw E(e, 'tel');
    if ((e = V.texte(d.allergies, 'Allergies / handicap', { max: 120 }))) throw E(e, 'allergies');
    for (const [k, l, max] of [['lieu', 'Lieu de naissance', 60], ['nationalite', 'Nationalité', 40], ['acte_centre', 'Centre d’état civil', 80], ['acte_sp', 'Sous-préfecture', 60],
      ['pere_profession', 'Profession du père', 60], ['mere_profession', 'Profession de la mère', 60], ['pere_domicile', 'Domicile du père', 80], ['mere_domicile', 'Domicile de la mère', 80]])
      if ((e = V.texte(d[k], l, { max }))) throw E(e, k);
    // matricule national unique
    const mn = u.norm(d.matNat);
    if (mn) {
      const autre = S().students.find((o) => o !== existant && u.norm(o.matNat) === mn);
      if (autre) throw E(`Matricule national déjà attribué à ${X.nomComplet(autre)} (${autre.classe}).`, 'matNat');
    }
  }

  /** Élèves déjà enregistrés qui ressemblent à celui-ci (même nom et prénoms, même naissance si connue). */
  function doublons(d, existant) {
    const n = u.norm(u.majNom(d.nom) + u.majPrenoms(d.prenoms));
    return S().students.filter((o) => o !== existant && u.norm(o.nom + o.prenoms) === n && (!d.naissance || !o.naissance || o.ageEstime || o.naissance === d.naissance));
  }

  function appliquer(d, s) {
    const ex = d.extrait === true || d.extrait === 'on';
    const tut = d.tuteur === true || d.tuteur === 'on';
    const age = Number(d.age) || 0;
    const nat = AK.ref.NATIONALITES.find((x) => u.norm(x[1]) === u.norm(d.nationalite));
    Object.assign(s, {
      matNat: String(d.matNat || '').replace(/\s/g, '').toUpperCase(),
      nom: u.majNom(String(d.nom).trim().replace(/\s+/g, ' ')),
      prenoms: u.majPrenoms(String(d.prenoms).trim().replace(/\s+/g, ' ')),
      naissance: ex ? d.naissance : `${X.anneeRentree() - age}-01-01`,
      ageEstime: !ex,
      lieu: String(d.lieu || '').trim(),
      sexe: d.sexe,
      nationalite: nat ? nat[1] : String(d.nationalite || '').trim().toUpperCase() || C.NAT_DEFAUT,
      classe: d.classe,
      statut: s.statut || 'Inscrit',
      parent: tut ? u.majNomComplet(String(d.parent || '').trim()) : '',
      tel: tut ? V.telPropre(d.tel) : '',
      redoublant: d.redoublant === true || d.redoublant === 'on',
      extrait: ex,
      pere: lireParent(d, 'pere'),
      mere: lireParent(d, 'mere'),
      sang: C.SANG.includes(d.sang) ? d.sang : '',
      allergies: String(d.allergies || '').trim(),
      entree: d.classe === 'CP1' && !s.entree ? u.aujourdhui() : d.entree || s.entree || '',
      motifDepart: s.motifDepart || '',
      parcours: s.parcours || [],
      acte: ex ? { num: String(d.acte_num || '').trim(), date: d.acte_date || '', centre: String(d.acte_centre || '').trim(), sp: String(d.acte_sp || '').trim() } : s.acte || { num: '', date: '', centre: '', sp: '' }
    });
    if (d.photo !== undefined) s.photo = d.photo && u.IMG_OK.test(d.photo) ? d.photo : '';
    if (d.extraitPhoto !== undefined) s.extraitPhoto = d.extraitPhoto && u.IMG_OK.test(d.extraitPhoto) ? d.extraitPhoto : '';
    return s;
  }

  const eleves = {
    prochainMatricule,
    controler,
    doublons,
    trouver: (id) => S().students.find((s) => s.id === id) || null,
    /** Inscription. options.accepterDoublon : l'utilisateur a confirmé qu'il s'agit d'un autre enfant. */
    inscrire(d, { accepterDoublon = false } = {}) {
      AK.perm.exiger('eleve.inscrire', { classe: d.classe });
      controler(d, null);
      const dbl = doublons(d, null);
      if (dbl.length && !accepterDoublon) {
        const err = E(`Un élève du même nom est déjà enregistré : ${dbl.map((o) => `${X.nomComplet(o)} (${o.classe}, ${X.fmtNaissance(o)})`).join(' ; ')}.`, 'nom');
        err.doublons = dbl;
        throw err;
      }
      const s = appliquer(d, { id: u.uid(), mat: prochainMatricule(), photo: '', decision: '', statut: 'Inscrit', inscritLe: u.aujourdhui() });
      AK.store.modifier(`Inscription : ${X.nomComplet(s)} (${s.classe})`, (st) => st.students.push(s), { categorie: 'eleves' });
      return s;
    },
    /**
     * Modification du dossier. Un changement de classe en cours d'année retire du calcul les notes et
     * absences aux évaluations de l'ancienne classe (barèmes différents) : elles sont conservées dans
     * s.notesAnciennes. Exige options.changementConfirme quand il y en a (ErreurMetier .changementClasse).
     */
    modifier(id, d, options = {}) {
      const s = eleves.trouver(id);
      if (!s) throw E('Élève introuvable.');
      AK.perm.exiger('eleve.modifier', { classe: s.classe });
      AK.perm.exiger('eleve.modifier', { classe: d.classe });
      controler(d, s);
      const avant = s.classe, p = s.id + '|';
      const cles = avant !== d.classe ? ['grades', 'attente', 'compAbs'].map((t) => [t, Object.keys(S()[t]).filter((k) => k.startsWith(p))]) : [];
      const nb = cles.reduce((a, [, L]) => a + L.length, 0);
      if (nb && !options.changementConfirme) {
        const err = E(`${X.nomComplet(s)} a ${u.pluriel(nb, 'note ou absence', 'notes ou absences')} cette année en ${avant}. En ${d.classe}, les barèmes et les matières diffèrent : elles ne compteront plus dans ses moyennes et seront conservées dans son dossier (notes de l’ancienne classe).`);
        err.changementClasse = true;
        throw err;
      }
      AK.store.modifier(`Dossier modifié : ${X.nomComplet(s)}${avant !== d.classe ? ` (classe ${avant} → ${d.classe})` : ''}`, (st) => {
        if (nb) {
          const garde = { classe: avant, annee: st.school.year || '', le: u.aujourdhui() };
          cles.forEach(([t, L]) => {
            garde[t] = {};
            L.forEach((k) => {
              garde[t][k] = st[t][k];
              delete st[t][k];
            });
          });
          s.notesAnciennes = [...(Array.isArray(s.notesAnciennes) ? s.notesAnciennes : []), garde];
        }
        appliquer(d, s);
      }, { categorie: 'eleves' });
      return s;
    },
    changerStatut(id, statut, motif) {
      const s = eleves.trouver(id);
      if (!s) throw E('Élève introuvable.');
      AK.perm.exiger('eleve.statut', { classe: s.classe });
      if (!C.STATUTS.includes(statut)) throw E('Statut inconnu.');
      // le motif (parfois personnel ou sensible) reste dans le dossier, pas dans le journal
      AK.store.modifier(`Statut de ${X.nomComplet(s)} : ${statut}`, () => {
        s.statut = statut;
        s.motifDepart = statut === 'Inscrit' ? '' : String(motif || '').trim().slice(0, 200);
        if (statut !== 'Inscrit') s.departLe = s.departLe || u.aujourdhui();
        else delete s.departLe;
      }, { categorie: 'eleves' });
    },
    /** Suppression : l'élève et ses notes, absences… vont à la corbeille (restaurables). */
    supprimer(id) {
      const s = eleves.trouver(id);
      if (!s) throw E('Élève introuvable.');
      AK.perm.exiger('eleve.supprimer', { classe: s.classe });
      const docs = (S().docs.items || []).filter((d) => d.sujet && d.sujet.id === id && d.statut === 'valide');
      AK.store.modifier(`Élève supprimé (corbeille) : ${X.nomComplet(s)}`, (st) => {
        const notes = {}, abs = {}, compAbs = {}, attente = {};
        Object.keys(st.grades).forEach((k) => {
          if (k.startsWith(id + '|')) {
            notes[k] = st.grades[k];
            delete st.grades[k];
          }
        });
        Object.keys(st.attente).forEach((k) => {
          if (k.startsWith(id + '|')) {
            attente[k] = st.attente[k];
            delete st.attente[k];
          }
        });
        Object.keys(st.compAbs).forEach((k) => {
          if (k.startsWith(id + '|')) {
            compAbs[k] = true;
            delete st.compAbs[k];
          }
        });
        Object.entries(st.att).forEach(([d, m]) => {
          if (m[id]) {
            abs[d] = m[id];
            delete m[id];
          }
        });
        st.students = st.students.filter((x) => x !== s);
        st.corbeille.unshift({ id: u.uid(), type: 'eleve', t: Date.now(), libelle: `${X.nomComplet(s)} (${s.classe})`, donnees: { s, notes, abs, compAbs, attente } });
      }, { categorie: 'eleves' });
      return { documentsValides: docs.length };
    },
    appliquer
  };
  AK.eleves = eleves;
})(window.AK);
