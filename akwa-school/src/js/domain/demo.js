/* =====================================================================================
   École de démonstration (fictive) pour découvrir l'application.
   Toutes les données sont inventées ; les documents imprimés en démonstration portent
   le filigrane SPÉCIMEN et ne sont pas inscrits comme documents officiels valides.
   ===================================================================================== */
(function (AK) {
  'use strict';
  const C = AK.cfg, u = AK.u;
  const DEMO_MDP = 'Demo2026';
  const DEMO_MDP_ENS = 'Classe2026';

  /** Notes fictives : remplit les évaluations demandées (laisse quelques trous si « trous »). */
  function genNotes(S, evals, trous) {
    const X = AK.calc;
    S.students.forEach((s, i) => {
      if (s.statut !== 'Inscrit') return;
      const b = (((i * 29) % 9) - 4) / 22;
      evals.forEach((n) =>
        X.matieres(s.classe, n).forEach(([m, w], k) => {
          if (trous && i % 11 === 4 && k >= 2) return;
          const key = `${s.id}|${n}|${m}`;
          if (S.grades[key] != null) return;
          const r = Math.max(0.12, Math.min(0.97, 0.56 + b + ((((k * 7 + i * 3 + n * 5) % 7) - 3) / 22)));
          S.grades[key] = Math.round(r * X.noteMax(s.classe, w) * 2) / 2;
        })
      );
    });
  }

  function creer() {
    const S = AK.schema.vierge();
    const auj = u.aujourdhui();
    const an = new Date().getMonth() < 7 ? new Date().getFullYear() - 1 : new Date().getFullYear();
    S.meta.demo = true;
    Object.assign(S.school, {
      localite: 'OUANINOU', sp: 'Ouaninou', name: 'EPP OUANINOU 2 (DÉMONSTRATION)', iepp: 'IEPP OUANINOU', drenaet: 'DRENAET DE TOUBA',
      director: 'M. OUATTARA Siaka', dirTel: '+225 07 00 00 00 01', codedren: '35', codeiep: '000251', codeecole: 'E000000',
      direction: C.ENTETE.direction + ' DE TOUBA', inspection: C.ENTETE.inspection + ' DE OUANINOU',
      year: `${an}–${an + 1}`, evalCourante: 1, adresse: 'BP 12 Ouaninou', telephone: '+225 07 00 00 00 01'
    });
    AK.store.installer(S); // les calculs ci-dessous lisent l'état courant
    S.conges = [
      [`${an}-11-01`, '', 'Toussaint'], [`${an}-11-15`, '', 'Journée nationale de la paix'], [`${an}-12-19`, `${an + 1}-01-04`, 'Congés de Noël'],
      [`${an + 1}-02-13`, `${an + 1}-02-21`, 'Congés de février'], [`${an + 1}-04-03`, `${an + 1}-04-11`, 'Congés de Pâques'], [`${an + 1}-05-01`, '', 'Fête du Travail']
    ].map(([du, au, lib]) => ({ id: u.uid(), du, au, lib: lib + ' (date d’exemple)' }));
    const N = ['KOUASSI', 'TRAORE', 'YAO', 'KONE', 'BAMBA', 'DIALLO', 'N’GUESSAN', 'TOURE', 'KOFFI', 'OUATTARA', 'KOUAME', 'COULIBALY', 'SORO', 'TANO', 'AKA', 'GNAGNE', 'ZADI', 'FOFANA', 'KONAN', 'SYLLA', 'DOUMBIA', 'ASSI', 'BROU', 'DAGO'];
    const M = ['Mamadou', 'Jean-Baptiste', 'Ismaël', 'Arnaud', 'Emmanuel', 'Yacouba', 'Kouadio', 'Serge', 'Ibrahim', 'Cédric', 'Abdoulaye', 'Franck', 'Lassina', 'Éric', 'Moussa', 'Désiré', 'Hervé', 'Sékou', 'Patrick', 'Konan', 'Ali', 'Wilfried'];
    const F = ['Aya Mireille', 'Aminata', 'Fatou', 'Aïcha', 'Mariame', 'Adjoua', 'Nathalie', 'Rokia', 'Esther', 'Affoué', 'Salimata', 'Grâce', 'Priscilla', 'Awa', 'Linda', 'Bintou'];
    const mix = [[5, 4], [5, 3], [4, 4], [4, 4], [6, 2], [5, 3]];
    const sansExtrait = [2, 11, 19, 30, 41], depart = { 8: 'Abandon', 27: 'Transféré' }, ages = { 6: 2, 15: 3, 33: 3 }, etr = [13, 35];
    const LIEUX = ['Ouaninou', 'Touba', 'Man', 'Séguéla', 'Koonan'];
    let n = 0, mi = 0, fi = 0;
    C.TOUS_NIVEAUX.forEach((c, ci) => {
      [...Array(mix[ci][0]).fill('Masculin'), ...Array(mix[ci][1]).fill('Féminin')].forEach((sexe) => {
        const by = an - C.AGE_NORMAL[c] - (ages[n] || 0) - (n % 4 === 3 ? 1 : 0);
        const nais = `${by}-${u.pad(((n * 5) % 12) + 1)}-${u.pad(((n * 7) % 27) + 1)}`, lieu = LIEUX[n % 5], ex = !sansExtrait.includes(n);
        const nom = N[(n * 5 + 3) % N.length];
        S.students.push(AK.schema.completerEleve({
          id: u.uid(), nom, prenoms: sexe === 'Masculin' ? M[mi++ % M.length] : F[fi++ % F.length], mat: 'AK-' + String(an).slice(2) + u.pad(n + 1, 3),
          matNat: ex ? `${u.pad(10000000 + n * 7919, 8)}${'ABCDEFGHJK'[n % 10]}` : '', classe: c, sexe, naissance: ex ? nais : `${by}-01-01`, ageEstime: !ex, lieu,
          nationalite: etr.includes(n) ? 'BURKINABE' : 'IVOIRIENNE', redoublant: n % 9 === 5, parent: '', tel: '',
          pere: { nom, prenoms: M[(n * 7 + 2) % M.length], profession: C.PROF_P[n % C.PROF_P.length], tel: '+225 07 ' + u.pad((n * 37) % 100) + ' ' + u.pad((n * 53) % 100) + ' 00 00', domicile: lieu + ', quartier Commerce' },
          mere: { nom: N[(n * 11 + 5) % N.length], prenoms: F[(n * 3 + 1) % F.length], profession: C.PROF_M[n % C.PROF_M.length], tel: n % 4 ? '+225 05 ' + u.pad((n * 23) % 100) + ' ' + u.pad((n * 31) % 100) + ' 00 00' : '', domicile: lieu },
          sang: n % 3 === 0 ? C.SANG[n % 8] : '', allergies: n === 9 ? 'Asthme' : '', entree: `${an - ci}-09-14`,
          parcours: Array.from({ length: ci }, (_, k) => ({ annee: `${an - ci + k}–${an - ci + k + 1}`, niveau: C.TOUS_NIVEAUX[k], moy: u.fmtSaisie(u.arrondi(5.2 + ((n * 7 + k * 13) % 31) / 10)), eff: String(34 + ((k * 5 + ci * 3) % 9)) })),
          extrait: ex, acte: ex ? { num: `${120 + n * 7}`, date: u.ajouterJours(nais, 10 + (n % 20)), centre: `Centre d’état civil de ${lieu}`, sp: `Sous-préfecture de ${lieu}` } : { num: '', date: '', centre: '', sp: '' },
          statut: depart[n] || 'Inscrit', photo: '', decision: '', inscritLe: `${an}-09-14`
        }));
        n++;
      });
    });
    genNotes(S, [1], true);
    const tn = [['Mme AKA Adjoua Rose', 'Institutrice', ['CP1'], 'Instituteur ordinaire'], ['M. KOFFI Yao Michel', 'Instituteur', ['CP2'], 'Instituteur adjoint'], ['Mme BAMBA Mariam', 'Institutrice', ['CE1'], 'Instituteur ordinaire'],
      ['M. DIABY Souleymane', 'Instituteur', ['CE2'], 'Instituteur ordinaire'], ['Mme TANOH Léa', 'Institutrice', ['CM1'], 'Instituteur adjoint'], ['M. GNAHORE Bertin', 'Instituteur', ['CM2'], 'Instituteur adjoint'], ['M. OUATTARA Siaka', 'Directeur', [], 'Instituteur principal']];
    S.teachers = tn.map((t, i) => AK.schema.completerAgent({ id: u.uid(), nom: t[0], fonction: t[1], classes: t[2], grade: t[3], matricule: `${300 + i * 37} ${u.pad((i * 113) % 1000, 3)}-${'ABCDEFGHJK'[i]}`, tel: '+225 05 ' + u.pad((i * 41 + 7) % 100) + ' 00 ' + u.pad((i * 13 + 9) % 100) + ' 00', fonct: t[2].length ? 'simple' : '', photo: '', compte: null, actif: true }));
    const act = S.students.filter((s) => s.statut === 'Inscrit');
    AK.calc.derniersJoursClasse(10, u.ajouterJours(auj, -1), S.conges).forEach((d, di) => {
      S.appel[d] = {};
      S.att[d] = {};
      C.TOUS_NIVEAUX.forEach((c) => (S.appel[d][c] = true));
      act.forEach((s, si) => {
        const h = (si * 7 + di * 11) % 29;
        if (h === 0 || (h === 13 && di % 3 === 0)) S.att[d][s.id] = h === 13 ? 'J' : 'A';
      });
    });
    const eleve = act.find((s) => s.classe === 'CE2');
    S.auth = [
      { id: u.uid(), ref: `AUT-${an}-001`, qui: 'personnel', pid: S.teachers[4].id, nom: S.teachers[4].nom, du: u.ajouterJours(auj, 2), au: u.ajouterJours(auj, 2), motif: 'Formation', precision: 'Atelier IEPP', statut: 'En attente', cree: auj },
      { id: u.uid(), ref: `AUT-${an}-002`, qui: 'eleve', pid: eleve.id, nom: AK.calc.nomComplet(eleve), du: u.ajouterJours(auj, 1), au: u.ajouterJours(auj, 2), motif: 'Maladie', precision: 'Certificat médical fourni', statut: 'En attente', cree: auj }
    ];
    S.messages = [{ id: u.uid(), t: Date.now() - 36e5 * 20, dest: '', titre: 'Conseil des maîtres', texte: 'Conseil des maîtres vendredi à 15 h. Merci d’apporter vos cahiers de préparation.', lus: {} }];
    S.pro.frais = Object.fromEntries(C.TOUS_NIVEAUX.map((c) => [c, { inscription: 0, coges: 2000, tenue: 0, autre: 0 }]));
    S.pro.livres = [{ id: u.uid(), titre: 'Lecture CE1 – Mamadou et Bineta', auteur: 'Collectif', genre: 'Manuel', ex: 12, cote: 'MAN-100' }, { id: u.uid(), titre: 'Contes de la savane', auteur: 'B. Dadié', genre: 'Contes', ex: 4, cote: 'CON-107' }];
    S.pro.journal = [{ t: Date.now(), m: 'École de démonstration créée (données fictives)', qui: 'Système', c: '' }];
    S.log = [{ t: Date.now(), m: 'École de démonstration créée (données fictives)' }];
    return S;
  }

  /** Comptes de démonstration : mots de passe connus, affichés sur l'écran de connexion de la démonstration. */
  async function comptes(S) {
    S.securite.admin = await AK.crypto.empreinteSecret(DEMO_MDP);
    S.securite.secours = await AK.crypto.empreinteSecret(AK.crypto.normCode('DEMO-DEMO-DEMO'));
    for (const t of S.teachers.slice(0, 3)) {
      t.compte = { login: AK.auth.loginDe(t.nom), actif: true, cree: u.aujourdhui() };
      S.securite.comptes[t.id] = { ...(await AK.crypto.empreinteSecret(DEMO_MDP_ENS)), provisoire: false };
    }
  }

  AK.demo = { creer, comptes, genNotes, DEMO_MDP, DEMO_MDP_ENS };
})(window.AK);
