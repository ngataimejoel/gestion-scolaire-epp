/* =====================================================================================
   Modèles de documents des élèves.
   ===================================================================================== */
(function (AK) {
  'use strict';
  const u = AK.u, { html, raw } = u, C = AK.cfg;
  const S = () => AK.store.etat;
  const X = () => AK.calc;
  const def = (d) => AK.modeles.def(d);

  /* ---------- Éléments communs ---------- */
  const photoBloc = (s, r) => (r.champs.photo === false ? '' : html`<div class="doc-photo">${s.photo ? html`<img src="${s.photo}" alt="">` : raw('<span>PHOTO<br>35 × 45 mm</span>')}</div>`);
  const naissance = (s) => `${X().fmtNaissance(s)}${s.lieu ? ' à ' + s.lieu : ''}`;
  function identite(s, r, extra = []) {
    const x = X(), t = x.enseignantDe(s.classe);
    const paires = [
      ['Nom et prénoms', x.nomComplet(s)],
      ['Matricule', x.matOf(s)],
      ['Classe', `${s.classe} · effectif ${x.actifsDe(s.classe).length}${s.redoublant ? ' · redoublant(e)' : ''}`],
      r.champs.naissance !== false ? ['Né(e) le', naissance(s)] : null,
      ['Sexe', s.sexe],
      r.champs.enseignant !== false ? ['Enseignant(e)', t ? t.nom : '—'] : null,
      ...extra
    ];
    const ph = photoBloc(s, r);
    return ph ? html`<div style="display:grid;grid-template-columns:1fr auto;gap:5mm;align-items:start;margin-bottom:3mm"><div>${AK.mise.infos(paires)}</div>${ph}</div>` : AK.mise.infos(paires);
  }
  const absences = (s) => {
    const ab = X().absencesDe(s.id);
    const a = ab.filter((z) => z.v === 'A').length;
    return [a, ab.length - a];
  };
  const pied = (ctx, r, o) => html`<div style="display:grid;grid-template-columns:${ctx.qrTexte ? 'auto 1fr' : '1fr'};gap:6mm;align-items:end;margin-top:auto">${ctx.qrTexte ? AK.mise.verification(ctx.qrTexte, ctx.doc, r.qr.taille) : ''}<div>${o.signatures(r, ctx)}</div></div>`;
  const colonne = (contenu) => html`<div style="display:flex;flex-direction:column;height:100%">${contenu}</div>`;
  const anneeCle = () => S().school.year || '';
  /* Empreinte du contenu variable d'un document (notes, rang, dossier) : si elle change, le registre
     enregistre une nouvelle version et signale les exemplaires antérieurs comme dépassés. */
  const resumeNotes = (s, n) => {
    const x = X(), cl = x.classement(s.classe, n).w.find((z) => z.s.id === s.id);
    return [x.matieres(s.classe, n).map(([m]) => x.note(s.id, n, m) ?? '').join(','), x.estAbsent(s.id, n) ? 'ABS' : '', cl ? cl.rank : ''].join('/');
  };
  const resumeDossier = (s) => u.empreinte(JSON.stringify([s.nom, s.prenoms, s.sexe, s.naissance, s.lieu, s.nationalite, s.classe, s.matNat, s.mat, s.pere, s.mere, s.parent, s.tel, s.acte, s.sang, s.allergies, s.entree, s.statut, s.motifDepart, s.parcours, !!s.photo]));

  /* ---------- Bulletin de composition ---------- */
  def({
    id: 'bulletin', version: 1, lib: 'Bulletin de notes (composition)', categorie: 'eleve', sujet: 'eleve', icone: 'award',
    description: 'Notes par discipline, moyenne, rang, mention, absences. Une référence par élève et par composition.',
    emission: { type: 'BUL', politique: 'unique', cleUnique: (c) => `BUL|${c.eleve.id}|${anneeCle()}|${c.periode}`, extra: (c) => u.empreinte(resumeNotes(c.eleve, c.periode)) },
    champsOptionnels: [['photo', 'Photo de l’élève', true], ['naissance', 'Date et lieu de naissance', true], ['enseignant', 'Nom de l’enseignant(e)', true], ['moyClasse', 'Moyenne de la classe par discipline', true], ['appreciation', 'Appréciation par discipline', true], ['absences', 'Absences', true], ['observations', 'Zone d’observations', true]],
    defauts: {
      titre: 'BULLETIN DE NOTES',
      champs: { photo: true, naissance: true, enseignant: true, moyClasse: true, appreciation: true, absences: true, observations: true },
      signatures: [{ role: 'L’enseignant(e)', nom: '' }, { role: 'Le parent / tuteur', nom: '' }, { role: 'Le Directeur', nom: '{directeur}', cachet: true }],
      hauteurSignature: 22, qr: { actif: true, identite: false, taille: 20 }
    },
    statut(ctx) {
      const s = ctx.eleve, n = ctx.periode, x = X();
      const attente = Object.keys(S().attente).some((k) => k.startsWith(`${s.id}|${n}|`));
      const manque = !x.estAbsent(s.id, n) && x.matieres(s.classe, n).some(([m]) => x.note(s.id, n, m) == null);
      return attente || manque ? 'provisoire' : null;
    },
    rendu(ctx, r, o) {
      const s = ctx.eleve, n = ctx.periode, x = X(), c = s.classe, e = x.echelle(c);
      const res = x.resultat(s, n), cl = x.classement(c, n), moi = cl.w.find((z) => z.s.id === s.id);
      const M = x.matieres(c, n);
      const moyM = (m) => u.moyenne(x.actifsDe(c).filter((o2) => !x.estAbsent(o2.id, n)).map((o2) => x.note(o2.id, n, m)).filter((v) => v != null));
      const [na, nj] = absences(s);
      const lignes = M.map(([m, w]) => {
        const v = x.note(s.id, n, m), mx = x.noteMax(c, w);
        return html`<tr><td class="g">${m}</td><td><b>${res && res.abs ? 'Abs.' : u.fmtNote(v)}</b></td><td>${mx}</td>${r.champs.moyClasse !== false ? html`<td>${u.fmtNote(moyM(m))}</td>` : ''}${r.champs.appreciation !== false ? html`<td class="g">${res && res.abs ? '' : v == null ? '' : x.mention((v / mx) * e, c)}</td>` : ''}</tr>`;
      });
      return {
        contenu: colonne(html`${o.entete(r)}${o.titre(r.titre, `${x.evalLabel(c, n)} · Année scolaire ${S().school.year}`)}${identite(s, r)}
          <table class="doc-tab"><thead><tr><th class="g">Discipline</th><th>Note</th><th>Sur</th>${r.champs.moyClasse !== false ? html`<th>Moy. classe</th>` : ''}${r.champs.appreciation !== false ? html`<th class="g">Appréciation</th>` : ''}</tr></thead><tbody>${lignes}</tbody></table>
          <div class="doc-recap"><div>Total<b>${res && !res.abs ? u.fmtNote(res.total) : '—'}</b></div><div>Moyenne<b>${res && res.abs ? 'Absent' : u.fmtNote(res ? res.moy : null)} / ${e}</b></div><div>Rang<b>${moi ? x.rangTxt(moi.rank) + ' / ' + cl.w.length : '—'}</b></div><div>Moy. de la classe<b>${u.fmtNote(x.moyClasse(c, n))}</b></div><div>Mention<b>${res && res.abs ? '—' : x.mention(res ? res.moy : null, c)}</b></div></div>
          ${r.champs.absences !== false ? html`<div class="doc-ligne"><span>Absences de l’année :</span><b>${na} non justifiée(s), ${nj} justifiée(s)</b><span style="margin-left:auto">Seuil de réussite : <b>${x.info(c).seuil}/${e}</b></span></div>` : ''}
          ${r.champs.observations !== false ? html`<div class="doc-zone"><b>Observations de l’enseignant(e) :</b><div class="z" style="min-height:13mm"></div></div>` : ''}
          ${pied(ctx, r, o)}`)
      };
    }
  });

  /* ---------- Bulletin annuel (MGA) ---------- */
  def({
    id: 'bulletin-annuel', version: 1, lib: 'Bulletin annuel (MGA et décision)', categorie: 'eleve', sujet: 'eleve', icone: 'award',
    description: 'Moyennes des quatre évaluations, MGA, rang, décision de fin d’année.',
    emission: { type: 'BUA', politique: 'unique', cleUnique: (c) => `BUA|${c.eleve.id}|${anneeCle()}`, extra: (c) => u.empreinte([1, 2, 3, 4].map((n) => resumeNotes(c.eleve, n)).join(';') + '|' + X().decision(c.eleve)) },
    champsOptionnels: [['photo', 'Photo de l’élève', true], ['naissance', 'Date et lieu de naissance', true], ['enseignant', 'Nom de l’enseignant(e)', true], ['observations', 'Zone d’observations', true]],
    defauts: {
      titre: 'BULLETIN ANNUEL', champs: { photo: true, naissance: true, enseignant: true, observations: true },
      signatures: [{ role: 'L’enseignant(e)', nom: '' }, { role: 'Le parent / tuteur', nom: '' }, { role: 'Le Directeur', nom: '{directeur}', cachet: true }], hauteurSignature: 22, qr: { actif: true, identite: false, taille: 20 }
    },
    statut: (ctx) => (X().mga(ctx.eleve) == null ? 'provisoire' : null),
    rendu(ctx, r, o) {
      const s = ctx.eleve, x = X(), c = s.classe, e = x.echelle(c), m = x.mga(s), cl = x.classement(c, 'A'), moi = cl.w.find((z) => z.s.id === s.id);
      const lignes = [1, 2, 3, 4].map((n) => {
        const rk = x.classement(c, n).w.find((z) => z.s.id === s.id);
        return html`<tr><td class="g">${x.evalLabel(c, n)}</td><td>${u.fmtDate(x.evalDate(c, n))}</td><td><b>${x.estAbsent(s.id, n) ? 'Absent' : u.fmtNote(x.moyEval(s, n))}</b></td><td>${rk ? x.rangTxt(rk.rank) : '—'}</td><td>${u.fmtNote(x.moyClasse(c, n))}</td></tr>`;
      });
      const [na, nj] = absences(s);
      return {
        contenu: colonne(html`${o.entete(r)}${o.titre(r.titre, `Année scolaire ${S().school.year}`)}${identite(s, r)}
          <table class="doc-tab"><thead><tr><th class="g">Évaluation</th><th>Date</th><th>Moyenne / ${e}</th><th>Rang</th><th>Moy. classe</th></tr></thead><tbody>${lignes}</tbody></table>
          <div class="doc-recap"><div>MGA<b>${u.fmtNote(m)} / ${e}</b></div><div>Rang annuel<b>${moi ? x.rangTxt(moi.rank) + ' / ' + cl.w.length : '—'}</b></div><div>Seuil<b>${x.info(c).seuil}/${e}</b></div><div>Décision<b>${x.decision(s) || '—'}</b></div><div>Mention<b>${x.mention(m, c)}</b></div></div>
          <p class="doc-note">${x.info(c).regle === 'MOYENNE4' ? 'MGA = moyenne des 4 évaluations (toutes saisies).' : 'MGA = (moyenne des 3 compositions + 2 × composition de passage) ÷ 3.'} Absences de l’année : ${na} non justifiée(s), ${nj} justifiée(s).</p>
          ${r.champs.observations !== false ? html`<div class="doc-zone"><b>Observations du conseil des maîtres :</b><div class="z" style="min-height:13mm"></div></div>` : ''}
          ${pied(ctx, r, o)}`)
      };
    }
  });

  /* ---------- Fiche scolaire (modèle officiel) ---------- */
  def({
    id: 'fiche-scolaire', version: 2, lib: 'Fiche scolaire (modèle officiel)', categorie: 'eleve', sujet: 'eleve', icone: 'file',
    description: 'Identité, parents, tuteur, parcours scolaire sur 8 ans. QR code minimal (plus aucune donnée personnelle dedans).',
    emission: { type: 'FIS', politique: 'unique', cleUnique: (c) => `FIS|${c.eleve.id}|${anneeCle()}`, extra: (c) => resumeDossier(c.eleve) },
    champsOptionnels: [['photo', 'Photo de l’élève', true], ['sante', 'Groupe sanguin et allergies', true], ['parents', 'Parents et tuteur', true]],
    defauts: {
      titre: 'FICHE SCOLAIRE', champs: { photo: true, sante: true, parents: true }, lieuDate: false,
      signatures: [{ role: 'Le Parent / Tuteur', nom: '' }, { role: 'L’Enseignant(e)', nom: '' }, { role: 'Le Directeur de l’école', nom: '{directeur}', cachet: true }],
      hauteurSignature: 24, qr: { actif: true, identite: false, taille: 20 }, entete: { compact: true }
    },
    rendu(ctx, r, o) {
      const s = ctx.eleve, x = X(), sc = S().school, a = s.acte || {};
      const ch = (v, w) => html`<span class="pt"${w ? html` style="flex:0 0 ${w}"` : ''}>${v || ''}</span>`;
      const ligne = (...parts) => html`<div class="doc-ligne">${parts}</div>`;
      const cur = { annee: sc.year, niveau: s.classe, moy: x.mga(s) != null ? u.fmtSaisie(x.mga(s)) : '', eff: String(x.actifsDe(s.classe).length) };
      const P = [...(s.parcours || []), ...(s.statut === 'Inscrit' ? [cur] : [])].slice(-8);
      const cols = Array.from({ length: 8 }, (_, i) => P[i] || {});
      const parent = (lib, p) => html`<div><div class="doc-section" style="text-align:center;border:0;text-decoration:underline">${lib}</div>${ligne('Nom :', ch(p.nom))}${ligne('Prénom(s) :', ch(p.prenoms))}${ligne('Domicile :', ch(p.domicile))}${ligne('Contact :', ch(p.tel))}${ligne('Profession :', ch(p.profession))}</div>`;
      const tut = s.parent ? { nom: s.parent, tel: s.tel } : {};
      const box = (on) => html`<span class="doc-case"><i class="${on ? 'on' : ''}"></i></span>`;
      return {
        contenu: colonne(html`${o.entete(r)}<div class="doc-titre cadre"><h1>${r.titre}</h1></div>
          <div style="display:grid;grid-template-columns:auto 1fr auto;gap:5mm;align-items:start;margin-bottom:2mm">
            ${photoBloc(s, r) || html`<span></span>`}
            <div style="font-size:9.6pt;line-height:1.7"><div><b>Sexe :</b> ${box(s.sexe === 'Masculin')} Masculin &nbsp; ${box(s.sexe === 'Féminin')} Féminin</div><div><b>Classe :</b> ${C.TOUS_NIVEAUX.map((c) => html`${box(s.classe === c)} ${c} &nbsp;`)}</div><div class="doc-note">Réf. ${ctx.ref || '—'}</div></div>
            <div style="display:grid;gap:2mm;justify-items:end"><div style="border:0.8pt solid #222;padding:1.4mm 3mm;font-weight:800;font-size:9pt">FICHE N° ${u.pad(parseInt((s.mat || '').replace(/\D/g, '').slice(2), 10) || 0, 3)}</div><div style="text-align:right;font-size:8.6pt"><b>MATRICULE</b><div style="border:1pt solid #222;padding:1.2mm 3mm;font-weight:800;min-width:34mm;text-align:center;font-size:10pt">${x.matOf(s)}</div></div>${ctx.qrTexte ? html`<div class="doc-verif"><div class="qr" style="width:${r.qr.taille}mm;height:${r.qr.taille}mm">${o.qrSvg(ctx.qrTexte)}</div></div>` : ''}</div>
          </div>
          ${ligne('NOM :', ch(s.nom))}${ligne('PRÉNOM(S) :', ch(s.prenoms))}
          ${ligne('Né(e) le :', ch(x.fmtNaissance(s), '34mm'), 'à :', ch(s.lieu), 'S/P :', ch(String(a.sp || '').replace(/^Sous-préfecture de /i, ''), '30mm'))}
          ${ligne('Nationalité :', ch(s.nationalite, '36mm'), ...(r.champs.sante !== false ? ['Groupe sanguin :', ch(s.sang, '14mm'), 'Allergies / handicap :', ch(s.allergies)] : []))}
          ${ligne('Acte de naissance / jugement supplétif N° :', ch(s.extrait ? a.num : '', '24mm'), 'du', ch(s.extrait ? u.fmtDate(a.date) : '', '26mm'), 'délivré à :', ch(s.extrait ? a.centre : ''))}
          ${r.champs.parents !== false ? html`<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:5mm;margin:2mm 0">${parent('PÈRE', s.pere || {})}${parent('MÈRE', s.mere || {})}${parent('TUTEUR / TUTRICE', tut)}</div>` : ''}
          <table class="doc-tab serre"><thead><tr><th class="g">Année scolaire</th>${cols.map((c) => html`<th>${c.annee || '20…/20…'}</th>`)}</tr></thead><tbody>
            <tr><td class="g"><i>Année de scolarité</i></td>${cols.map((_, i) => html`<td><i>${i + 1}${i ? 'e' : 're'}</i></td>`)}</tr>
            <tr><td class="g"><b>Niveau de cours</b></td>${cols.map((c) => html`<td>${c.niveau || '…'}</td>`)}</tr>
            <tr><td class="g"><b>Moyenne annuelle</b></td>${cols.map((c) => html`<td>${c.moy || '…'}</td>`)}</tr>
            <tr><td class="g"><b>Effectif de la classe</b></td>${cols.map((c) => html`<td>${c.eff || '…'}</td>`)}</tr></tbody></table>
          ${ligne('École :', ch(sc.name), 'Ville / sous-préfecture :', ch([sc.localite, sc.sp].filter(Boolean).join(' / ')))}
          ${ligne('Fréquentée du :', ch(s.entree ? u.fmtDate(s.entree) : '', '30mm'), 'au :', ch(s.statut === 'Inscrit' ? '' : u.fmtDate(s.departLe) || s.statut, '30mm'), 'Matricule :', ch(x.matOf(s)))}
          ${ligne('Motif de départ :', ch(s.motifDepart || (s.statut !== 'Inscrit' ? s.statut : '')))}
          <div class="doc-fait"><i>Fait à ${u.capitale(sc.localite || '……')}, le ${u.fmtDate(u.aujourdhui())}</i></div>
          ${o.signatures({ ...r, lieuDate: false }, ctx)}`)
      };
    }
  });

  /* ---------- Certificat de scolarité ---------- */
  def({
    id: 'certificat-scolarite', version: 1, lib: 'Certificat de scolarité', categorie: 'eleve', sujet: 'eleve', icone: 'fileCheck',
    description: 'Atteste l’inscription régulière de l’élève pour l’année en cours. Référence unique et QR code vérifiable.',
    emission: { type: 'CSC', politique: 'registre' },
    refuser: (ctx) => (ctx.eleve.statut !== 'Inscrit' ? `${X().nomComplet(ctx.eleve)} n’est plus inscrit(e) (${ctx.eleve.statut}) : délivrez une attestation de fréquentation ou un certificat de transfert.` : null),
    champsOptionnels: [['photo', 'Photo de l’élève', false]],
    defauts: {
      titre: 'CERTIFICAT DE SCOLARITÉ',
      texte: 'Je soussigné(e), **{directeur}**, {directeur.titre} de l’{ecole.nomLong} ({iepp}, {drenaet}), certifie que l’élève **{eleve.nomComplet}**, {eleve.ne} le {eleve.naissance} à {eleve.lieuNaissance}, matricule **{eleve.matricule}**, est régulièrement {eleve.inscrit} dans mon établissement en classe de **{eleve.classe}** au titre de l’année scolaire **{annee}**.\n\nEn foi de quoi, le présent certificat lui est délivré pour servir et valoir ce que de droit.',
      champs: { photo: false }, filigrane: { type: 'logo', opacite: 5, taille: 62 }, qr: { actif: true, identite: false, taille: 24 }
    },
    rendu(ctx, r, o) {
      const s = ctx.eleve;
      return {
        contenu: colonne(html`${o.entete(r)}${o.titre(r.titre, r.sousTitre)}${r.champs.photo ? html`<div style="display:flex;justify-content:flex-end">${photoBloc(s, r)}</div>` : ''}<div class="doc-texte">${o.rediger(r.texte, ctx)}</div>
          <div style="margin-top:auto">${o.signatures(r, ctx)}<div style="margin-top:6mm">${AK.mise.verification(ctx.qrTexte, ctx.doc, r.qr.taille)}</div></div>`)
      };
    }
  });

  /* ---------- Attestation de fréquentation ---------- */
  def({
    id: 'attestation-frequentation', version: 1, lib: 'Attestation de fréquentation', categorie: 'eleve', sujet: 'eleve', icone: 'fileCheck',
    description: 'Atteste que l’élève fréquente (ou a fréquenté) l’établissement, avec son assiduité si souhaité.',
    emission: { type: 'ATF', politique: 'registre' },
    champsOptionnels: [['assiduite', 'Nombre de jours d’absence de l’année', true]],
    defauts: {
      titre: 'ATTESTATION DE FRÉQUENTATION',
      texte: 'Je soussigné(e), **{directeur}**, {directeur.titre} de l’{ecole.nomLong}, atteste que l’élève **{eleve.nomComplet}**, {eleve.ne} le {eleve.naissance} à {eleve.lieuNaissance}, matricule **{eleve.matricule}**, fréquente l’établissement depuis le {eleve.entree}, en classe de **{eleve.classe}** pour l’année scolaire {annee}.\n\nLa présente attestation est délivrée à la demande de l’intéressé(e) pour servir et valoir ce que de droit.',
      champs: { assiduite: true }, filigrane: { type: 'logo', opacite: 5, taille: 62 }, qr: { actif: true, identite: false, taille: 24 }
    },
    rendu(ctx, r, o) {
      const s = ctx.eleve, [na, nj] = absences(s);
      return {
        contenu: colonne(html`${o.entete(r)}${o.titre(r.titre, r.sousTitre)}<div class="doc-texte">${o.rediger(r.texte, ctx)}</div>
          ${r.champs.assiduite !== false ? html`<div class="doc-recap" style="max-width:120mm"><div>Absences non justifiées<b>${na} jour(s)</b></div><div>Absences justifiées<b>${nj} jour(s)</b></div></div>` : ''}
          <div style="margin-top:auto">${o.signatures(r, ctx)}<div style="margin-top:6mm">${AK.mise.verification(ctx.qrTexte, ctx.doc, r.qr.taille)}</div></div>`)
      };
    }
  });

  /* ---------- Certificat de transfert (exeat) ---------- */
  def({
    id: 'certificat-transfert', version: 1, lib: 'Certificat de transfert (exeat)', categorie: 'eleve', sujet: 'eleve', icone: 'send',
    description: 'Pour un élève qui quitte l’école : date et motif de départ, dernier niveau, parcours.',
    emission: { type: 'CTR', politique: 'registre' },
    champsOptionnels: [['parcours', 'Parcours scolaire', true]],
    defauts: {
      titre: 'CERTIFICAT DE TRANSFERT (EXEAT)',
      texte: 'Je soussigné(e), **{directeur}**, {directeur.titre} de l’{ecole.nomLong} ({iepp}), certifie que l’élève **{eleve.nomComplet}**, {eleve.ne} le {eleve.naissance} à {eleve.lieuNaissance}, matricule **{eleve.matricule}**, inscrit(e) en classe de **{eleve.classe}**, a quitté l’établissement.\n\nMotif du départ : {eleve.motifDepart}.\n\nL’intéressé(e) peut être admis(e) dans tout autre établissement scolaire. Le présent certificat est délivré pour servir et valoir ce que de droit.',
      champs: { parcours: true }, filigrane: { type: 'logo', opacite: 5, taille: 60 }, qr: { actif: true, identite: false, taille: 24 }
    },
    rendu(ctx, r, o) {
      const s = ctx.eleve, x = X();
      const P = [...(s.parcours || []), { annee: S().school.year, niveau: s.classe, moy: x.mga(s) != null ? u.fmtSaisie(x.mga(s)) : '' }];
      return {
        contenu: colonne(html`${o.entete(r)}${o.titre(r.titre, r.sousTitre)}<div class="doc-texte">${o.rediger(r.texte, ctx)}</div>
          ${r.champs.parcours !== false ? html`<div class="doc-section">Parcours dans l’établissement</div><table class="doc-tab serre"><thead><tr><th>Année scolaire</th><th>Niveau</th><th>Moyenne annuelle</th></tr></thead><tbody>${P.map((p) => html`<tr><td>${p.annee || '—'}</td><td>${p.niveau || '—'}</td><td>${p.moy || '—'}</td></tr>`)}</tbody></table>` : ''}
          ${s.statut === 'Inscrit' ? html`<p class="doc-note">Attention : l’élève figure encore comme inscrit(e) ; enregistrez son départ (statut « Transféré ») dans sa fiche.</p>` : ''}
          <div style="margin-top:auto">${o.signatures(r, ctx)}<div style="margin-top:6mm">${AK.mise.verification(ctx.qrTexte, ctx.doc, r.qr.taille)}</div></div>`),
        avertissement: s.statut === 'Inscrit' ? `${x.nomComplet(s)} est encore inscrit(e) : pensez à enregistrer son départ.` : null
      };
    }
  });

  /* ---------- Fiche individuelle (document interne) ---------- */
  def({
    id: 'fiche-individuelle', version: 1, lib: 'Fiche individuelle de l’élève', categorie: 'eleve', sujet: 'eleve', icone: 'user',
    description: 'Dossier complet de l’élève pour le classeur de l’école : identité, extrait, parents, santé. Document interne.',
    emission: { type: 'FII', politique: 'unique', cleUnique: (c) => `FII|${c.eleve.id}|${anneeCle()}`, extra: (c) => resumeDossier(c.eleve) },
    champsOptionnels: [['photo', 'Photo', true], ['sante', 'Santé (groupe sanguin, allergies)', true], ['contacts', 'Téléphones des parents', true], ['resultats', 'Résultats de l’année', true]],
    defauts: {
      titre: 'FICHE INDIVIDUELLE DE L’ÉLÈVE', sousTitre: 'Document interne · données personnelles à protéger',
      champs: { photo: true, sante: true, contacts: true, resultats: true }, filigrane: { type: 'texte', texte: 'CONFIDENTIEL', opacite: 5, taille: 70 },
      signatures: [{ role: 'Le Directeur', nom: '{directeur}', cachet: true }], qr: { actif: true, identite: false, taille: 18 }
    },
    rendu(ctx, r, o) {
      const s = ctx.eleve, x = X(), a = s.acte || {};
      const parent = (l, p) => [l, p && (p.nom || p.prenoms) ? `${p.nom} ${p.prenoms}${p.profession ? ' · ' + p.profession : ''}${r.champs.contacts !== false && p.tel ? ' · ' + p.tel : ''}${p.domicile ? ' · ' + p.domicile : ''}` : '—'];
      return {
        contenu: colonne(html`${o.entete(r)}${o.titre(r.titre, r.sousTitre)}${identite(s, r, [['Nationalité', u.capitale(s.nationalite)], ['Entré(e) le', u.fmtDate(s.entree)], ['Statut', s.statut + (s.motifDepart ? ' · ' + s.motifDepart : '')], ['Matricule école', s.mat]])}
          <div class="doc-section">Extrait de naissance</div>${s.extrait ? AK.mise.infos([['Acte n°', a.num], ['Établi le', u.fmtDate(a.date)], ['Centre d’état civil', a.centre], ['Sous-préfecture', a.sp]]) : html`<p class="doc-note">Extrait de naissance non fourni (âge déclaré).</p>`}
          <div class="doc-section">Parents et tuteur</div>${AK.mise.infos([parent('Père', s.pere), parent('Mère', s.mere), ['Tuteur / tutrice', s.parent ? s.parent + (r.champs.contacts !== false && s.tel ? ' · ' + s.tel : '') : '—']], { une: true })}
          ${r.champs.sante !== false ? html`<div class="doc-section">Santé</div>${AK.mise.infos([['Groupe sanguin', s.sang || 'Non renseigné'], ['Allergies / handicap', s.allergies || 'Aucun signalé']])}` : ''}
          ${r.champs.resultats !== false ? html`<div class="doc-section">Résultats de l’année</div><table class="doc-tab serre"><thead><tr>${[1, 2, 3, 4].map((n) => html`<th>${x.evalLabel(s.classe, n)}</th>`)}<th>MGA</th><th>Décision</th></tr></thead><tbody><tr>${[1, 2, 3, 4].map((n) => html`<td>${x.estAbsent(s.id, n) ? 'Abs.' : u.fmtNote(x.moyEval(s, n))}</td>`)}<td><b>${u.fmtNote(x.mga(s))}</b></td><td>${x.decision(s) || '—'}</td></tr></tbody></table>` : ''}
          <div style="margin-top:auto;display:grid;grid-template-columns:auto 1fr;gap:6mm;align-items:end">${AK.mise.verification(ctx.qrTexte, ctx.doc, r.qr.taille)}<div>${o.signatures(r, ctx)}</div></div>`)
      };
    }
  });

  /* ---------- Fiche d'inscription ---------- */
  def({
    id: 'fiche-inscription', version: 1, lib: 'Fiche d’inscription', categorie: 'eleve', sujet: 'eleve', icone: 'filePlus',
    description: 'Fiche remplie à l’inscription, avec engagement et signature du parent, et liste des pièces fournies.',
    emission: { type: 'FIN', politique: 'unique', cleUnique: (c) => `FIN|${c.eleve.id}|${anneeCle()}`, extra: (c) => resumeDossier(c.eleve) },
    champsOptionnels: [['photo', 'Photo', true], ['pieces', 'Liste des pièces à fournir', true], ['engagement', 'Engagement du parent', true]],
    defauts: {
      titre: 'FICHE D’INSCRIPTION', champs: { photo: true, pieces: true, engagement: true },
      texte: 'Je soussigné(e), parent ou tuteur de l’élève **{eleve.nomComplet}**, certifie l’exactitude des renseignements ci-dessus et m’engage à respecter le règlement intérieur de l’établissement et à suivre la scolarité de mon enfant.',
      signatures: [{ role: 'Le parent / tuteur', nom: '' }, { role: 'Le Directeur', nom: '{directeur}', cachet: true }], qr: { actif: true, identite: false, taille: 18 }
    },
    rendu(ctx, r, o) {
      const s = ctx.eleve, x = X(), a = s.acte || {};
      const p = (l, q) => [l, q && (q.nom || q.prenoms) ? `${q.nom} ${q.prenoms}${q.profession ? ' · ' + q.profession : ''}${q.tel ? ' · ' + q.tel : ''}` : '……………………………………'];
      const pieces = [['Extrait d’acte de naissance', s.extrait], ['Photos d’identité', !!s.photo], ['Certificat de transfert (si venant d’une autre école)', s.classe === 'CP1' ? null : false], ['Carnet de vaccination', false]];
      return {
        contenu: colonne(html`${o.entete(r)}${o.titre(r.titre, `Année scolaire ${S().school.year} · inscription en ${s.classe}`)}${identite(s, r, [['Nationalité', u.capitale(s.nationalite)], ['Date d’inscription', u.fmtDate(s.inscritLe || s.entree)]])}
          ${s.extrait ? AK.mise.infos([['Acte de naissance n°', a.num], ['du', u.fmtDate(a.date)], ['Centre d’état civil', a.centre], ['Sous-préfecture', a.sp]]) : ''}
          <div class="doc-section">Parents et tuteur</div>${AK.mise.infos([p('Père', s.pere), p('Mère', s.mere), ['Tuteur / tutrice', s.parent ? `${s.parent}${s.tel ? ' · ' + s.tel : ''}` : '……………………………………'], ['Domicile', (s.pere && s.pere.domicile) || (s.mere && s.mere.domicile) || '……………………………………']], { une: true })}
          ${r.champs.pieces !== false ? html`<div class="doc-section">Pièces fournies</div><div class="doc-cases" style="display:grid;grid-template-columns:1fr 1fr;gap:1.6mm 6mm;font-size:9.4pt">${pieces.filter(([, v]) => v !== null).map(([l, v]) => html`<span class="doc-case"><i class="${v ? 'on' : ''}"></i> ${l}</span>`)}</div>` : ''}
          ${r.champs.engagement !== false ? html`<div class="doc-texte" style="font-size:10pt;margin:5mm 0 2mm">${o.rediger(r.texte, ctx)}</div>` : ''}
          <div style="margin-top:auto;display:grid;grid-template-columns:auto 1fr;gap:6mm;align-items:end">${AK.mise.verification(ctx.qrTexte, ctx.doc, r.qr.taille)}<div>${o.signatures(r, ctx)}</div></div>`)
      };
    }
  });
})(window.AK);
