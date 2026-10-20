/* =====================================================================================
   Autres documents : demandes d'autorisation d'absence, convocation des parents, emploi du
   temps, cahier de textes, reçus, journal de caisse, attestation de service du personnel.
   ===================================================================================== */
(function (AK) {
  'use strict';
  const u = AK.u, { html, raw } = u, C = AK.cfg;
  const S = () => AK.store.etat;
  const X = () => AK.calc;
  const SIG = [{ role: 'Le Directeur', nom: '{directeur}', cachet: true }];
  const def = (d) => AK.modeles.def({ version: 1, ...d });
  const colonne = (c) => html`<div style="display:flex;flex-direction:column;height:100%">${c}</div>`;

  /* ---------- Demande d'autorisation d'absence du personnel (lettre à l'IEPP) ---------- */
  def({
    id: 'demande-absence-personnel', lib: 'Demande d’autorisation d’absence (personnel)', categorie: 'absence', sujet: 'agent', icone: 'cal',
    description: 'Lettre adressée à l’Inspecteur, avec l’avis du directeur et la décision de l’IEPP.',
    defauts: {
      titre: 'Demande d’autorisation d’absence', signatures: [], lieuDate: false, qr: { actif: false },
      texte: 'Monsieur l’Inspecteur,\n\nPar la présente, j’ai l’honneur de solliciter respectueusement de votre haute bienveillance l’autorisation de m’absenter de mon poste de travail pour la période indiquée ci-dessus.\n\nJe prendrai toutes les dispositions utiles afin que le bon fonctionnement du service soit préservé durant cette période et je m’engage à reprendre mes activités dès la fin de la période autorisée.\n\nEspérant que ma demande retiendra votre bienveillante attention, je vous prie d’agréer, Monsieur l’Inspecteur, l’expression de mon profond respect.'
    },
    rendu(ctx, r, o) {
      const a = ctx.demande, m = ctx.agent, sc = S().school, x = X(), n = AK.absences.joursDemande(a);
      const ville = u.capitale(sc.localite || sc.sp || ''), lieuIepp = String(sc.iepp || '').replace(/^IEPP\s+/i, '') || '………';
      const L = (k, v) => html`<div>${k} : <b>${v || '……………………'}</b></div>`;
      const coche = (ok, lab) => html`<span class="doc-case" style="margin-right:6mm"><i class="${ok ? 'on' : ''}"></i> ${lab}</span>`;
      return {
        contenu: colonne(html`${o.entete(r)}<div style="font-size:9.6pt;margin:0 0 3mm">N° ………… /${String(X().anneeRentree()).slice(2)}/IEPP/${lieuIepp.toUpperCase()}</div>
          <div style="display:flex;justify-content:space-between;gap:8mm;font-size:9.8pt;line-height:1.55"><div>${L('Nom et prénoms', a.nom)}${L('Matricule', m && m.matricule)}${L('Emploi / grade', m && x.emploiGrade(m))}${L('Fonction', m && m.fonction)}${L('Classe tenue', m && x.clsTxt(m))}${L('Établissement', sc.name)}${L('Circonscription', sc.iepp)}${L('Téléphone', m && m.tel)}</div>
            <div style="text-align:center;min-width:38%"><div>${ville || '………'}, le ${u.fmtDate(a.cree)}</div><div style="font-size:8.6pt">Demande N° ${a.ref}</div><div style="margin-top:7mm;font-weight:700;line-height:1.4">À<br>Monsieur l’Inspecteur de l’Enseignement<br>Préscolaire et Primaire de ${ville || lieuIepp}</div></div></div>
          <p style="margin:5mm 0 2mm;font-size:10.5pt"><b><u>Objet</u> : demande d’autorisation d’absence</b></p>
          <div class="doc-infos" style="margin-bottom:2mm"><div class="c"><span class="l">Période :</span><span class="v">du ${u.fmtDate(a.du)} au ${u.fmtDate(a.au)}</span></div><div class="c"><span class="l">Durée :</span><span class="v">${u.pluriel(n, 'jour')} de classe</span></div><div class="c"><span class="l">Motif :</span><span class="v">${a.motif}${a.precision ? ' (' + a.precision + ')' : ''}</span></div></div>
          <div class="doc-texte" style="font-size:10.4pt;margin:3mm 0">${o.rediger(r.texte, ctx)}</div>
          <div style="text-align:right;font-weight:700;margin-top:2mm">${a.nom}</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;margin-top:auto;border:0.6pt solid #444;font-size:9.4pt">
            <div style="padding:2mm 3mm;min-height:34mm;border-right:0.6pt solid #444"><div style="text-align:center;font-weight:700;margin-bottom:2mm">Avis du directeur d’école</div><div>${coche(a.statut === 'Accordée', 'Favorable')}${coche(a.statut === 'Refusée', 'Défavorable')}</div><div style="margin-top:2mm">Nom, signature et cachet</div><div style="margin-top:9mm">${sc.director || ''}</div></div>
            <div style="padding:2mm 3mm;min-height:34mm"><div style="text-align:center;font-weight:700;margin-bottom:2mm">Décision de l’IEPP</div><div>${coche(false, 'Accord')}${coche(false, 'Refus')}</div><div style="margin-top:2mm">Date, signature et cachet</div></div></div>`)
      };
    }
  });

  def({
    id: 'demande-absence-eleve', lib: 'Demande d’autorisation d’absence (élève)', categorie: 'absence', sujet: 'eleve', icone: 'cal',
    description: 'Demande présentée par le parent, avec la décision du directeur.',
    defauts: { titre: 'DEMANDE D’AUTORISATION D’ABSENCE', signatures: [{ role: 'Le parent / tuteur', nom: '' }, { role: 'Le Directeur', nom: '{directeur}', cachet: true }], qr: { actif: false } },
    rendu(ctx, r, o) {
      const a = ctx.demande, s = ctx.eleve, x = X();
      const coche = (ok, lab) => html`<span class="doc-case" style="margin-right:6mm"><i class="${ok ? 'on' : ''}"></i> ${lab}</span>`;
      return {
        contenu: colonne(html`${o.entete(r)}${o.titre(r.titre, `N° ${a.ref} du ${u.fmtDate(a.cree)}`)}${AK.mise.infos([['Élève', a.nom], ['Matricule', s ? x.matOf(s) : ''], ['Classe', s ? s.classe : ''], ['Période', `du ${u.fmtDate(a.du)} au ${u.fmtDate(a.au)}`], ['Jours de classe', String(AK.absences.joursDemande(a))], ['Motif', a.motif + (a.precision ? ' · ' + a.precision : '')]])}
          <div style="border:0.6pt solid #222;padding:2.4mm 3mm;margin:4mm 0;font-size:10pt">Décision du directeur : ${coche(a.statut === 'Accordée', 'Accordée')}${coche(a.statut === 'Refusée', 'Refusée')} <span style="float:right">Statut actuel : <b>${a.statut}</b></span></div>
          <div style="margin-top:auto">${o.signatures(r, ctx)}</div>`)
      };
    }
  });

  def({
    id: 'convocation-parents', lib: 'Convocation des parents', categorie: 'vie', sujet: 'eleve', icone: 'mail',
    description: 'Convocation à la direction au sujet d’un fait de discipline.',
    defauts: {
      titre: 'CONVOCATION DES PARENTS', signatures: SIG, qr: { actif: false },
      texte: 'Madame, Monsieur,\n\nVous êtes prié(e) de vous présenter à la direction de l’école le …………………… à ………… au sujet de votre enfant **{eleve.nomComplet}**, élève en classe de **{eleve.classe}**.\n\nComptant sur votre collaboration pour l’éducation de votre enfant, veuillez agréer, Madame, Monsieur, l’expression de nos salutations distinguées.'
    },
    rendu(ctx, r, o) {
      const s = ctx.eleve, f = ctx.fait;
      const dest = s.parent || [s.pere && s.pere.nom, s.pere && s.pere.prenoms].filter(Boolean).join(' ') || 'Monsieur / Madame le parent';
      return {
        contenu: colonne(html`${o.entete(r)}${o.titre(r.titre)}<p style="margin-top:4mm">À l’attention de <b>${dest}</b>${AK.pro.telParent(s) ? ' · ' + AK.pro.telParent(s) : ''}</p>
          <div class="doc-texte">${o.rediger(r.texte, ctx)}</div>
          ${f ? html`<div class="doc-infos une"><div class="c"><span class="l">Motif :</span><span class="v">${f.fait}${f.detail ? ' (' + f.detail + ')' : ''}, constaté le ${u.fmtDate(f.date)}</span></div><div class="c"><span class="l">Mesure prise :</span><span class="v">${f.sanction}</span></div></div>` : ''}
          <div style="margin-top:auto">${o.signatures(r, ctx)}</div>`)
      };
    }
  });

  def({
    id: 'emploi-du-temps', lib: 'Emploi du temps de la classe', categorie: 'vie', sujet: 'classe', icone: 'grid',
    description: 'Grille hebdomadaire (lundi, mardi, jeudi, vendredi).',
    defauts: { titre: 'EMPLOI DU TEMPS', page: { orientation: 'paysage' }, signatures: SIG, qr: { actif: false } }, orientations: ['paysage'],
    rendu(ctx, r, o) {
      const c = ctx.classe, E = S().pro.edt[c] || {}, t = X().enseignantDe(c);
      return { ajuster: true, contenu: html`${o.entete(r)}${o.titre(`${r.titre} – ${c}`, `Titulaire : ${t ? t.nom : '—'} · Année scolaire ${S().school.year}`)}<table class="doc-tab"><thead><tr><th>Horaire</th>${C.JOURS_EDT.map(([, j]) => html`<th>${j}</th>`)}</tr></thead><tbody>${C.CRENEAUX.map((h, i) => html`<tr><td><b>${h}</b></td>${C.JOURS_EDT.map(([d]) => html`<td>${E[d + '|' + i] || ''}</td>`)}</tr>`)}</tbody></table>${o.signatures(r, ctx)}` };
    }
  });

  def({
    id: 'cahier-textes', lib: 'Cahier de textes', categorie: 'vie', sujet: 'classe', icone: 'book',
    description: 'Séances consignées de la classe, par date.',
    defauts: { titre: 'CAHIER DE TEXTES', signatures: [{ role: 'L’enseignant(e)', nom: '' }, { role: 'Le Directeur', nom: '{directeur}' }], qr: { actif: false } },
    rendu(ctx, r, o) {
      const c = ctx.classe, L = S().pro.cahier.filter((x) => x.classe === c).sort((a, b) => a.date.localeCompare(b.date));
      return { liste: { avant: html`${o.entete(r)}${o.titre(`${r.titre} – ${c}`, `Année scolaire ${S().school.year}`)}`, tete: html`<tr><th>Date</th><th>Discipline</th><th class="g">Contenu de la séance</th><th class="g">Travail à faire</th></tr>`, lignes: L.map((x) => html`<tr><td>${u.fmtDate(x.date)}</td><td>${x.mat}</td><td class="g">${x.contenu}</td><td class="g">${x.travail}</td></tr>`), apres: o.signatures(r, ctx), suite: html`<div class="doc-note">Cahier de textes ${c} (suite)</div>` } };
    }
  });

  def({
    id: 'recu', lib: 'Reçu de versement', categorie: 'finance', sujet: 'eleve', icone: 'coin', papiers: ['A5', 'A4'],
    description: 'Reçu numéroté (REC-AAAA-NNNNN) ; un reçu annulé est réimprimé avec la mention ANNULÉ.',
    defauts: { titre: 'REÇU DE VERSEMENT', page: { orientation: 'portrait', papier: 'A5', marges: { h: 10, d: 10, b: 9, g: 10 } }, signatures: [{ role: 'Le caissier / Le Directeur', nom: '{directeur}', cachet: true }], hauteurSignature: 18, qr: { actif: false }, entete: { compact: true } },
    statut: (ctx) => (ctx.paiement.annule ? 'annule' : null),
    rendu(ctx, r, o) {
      const p = ctx.paiement, s = ctx.eleve || { nom: '—', prenoms: '', classe: '' }, x = X();
      const du = s.id ? AK.pro.duDe(s) : 0, pa = s.id ? AK.pro.payeDe(s) : 0;
      return {
        contenu: colonne(html`${o.entete(r)}${o.titre(`${r.titre} N° ${p.ref}`)}<table class="doc-tab"><tbody>
          <tr><td class="g" style="width:32%">Reçu de</td><td class="g"><b>${p.payeur || s.parent || 'Le parent'}</b></td></tr>
          <tr><td class="g">Pour l’élève</td><td class="g"><b>${x.nomComplet(s)}</b> · ${s.classe} · ${s.id ? x.matOf(s) : ''}</td></tr>
          <tr><td class="g">Objet</td><td class="g">${p.objet}</td></tr>
          <tr><td class="g">Montant</td><td class="g"><b style="font-size:12pt">${u.fcfa(p.montant)}</b> (${p.mode})</td></tr>
          <tr><td class="g">Date</td><td class="g">${u.fmtDate(p.date)}</td></tr>
          <tr><td class="g">Situation</td><td class="g">Total dû ${u.fcfa(du)} · versé ${u.fcfa(pa)} · reste ${u.fcfa(Math.max(0, du - pa))}</td></tr>
          ${p.annule ? html`<tr><td class="g">Annulation</td><td class="g"><b>ANNULÉ le ${u.fmtDate(p.annule.le.slice(0, 10))}</b> · ${p.annule.motif}</td></tr>` : ''}</tbody></table>
          <div style="margin-top:auto">${o.signatures(r, ctx)}</div>`)
      };
    }
  });

  def({
    id: 'journal-caisse', lib: 'Journal de caisse', categorie: 'finance', sujet: 'ecole', icone: 'coin',
    description: 'Recettes et dépenses dans l’ordre chronologique avec le solde (reçus annulés exclus).',
    defauts: { titre: 'JOURNAL DE CAISSE', signatures: [{ role: 'Le trésorier du COGES', nom: '' }, { role: 'Le Directeur', nom: '{directeur}', cachet: true }], qr: { actif: false } },
    rendu(ctx, r, o) {
      const P = S().pro, x = X();
      const ops = [...P.paiements.filter((p) => !p.annule).map((p) => ({ d: p.date, l: `Versement ${p.ref} · ${x.nomComplet(AK.eleves.trouver(p.sid) || { nom: '', prenoms: '' })}`, r: +p.montant, s: 0 })), ...P.depenses.map((d) => ({ d: d.date, l: d.libelle + (d.justif ? ' (pièce ' + d.justif + ')' : ''), r: 0, s: +d.montant }))].sort((a, b) => a.d.localeCompare(b.d));
      let solde = 0;
      const lignes = ops.map((op) => {
        solde += op.r - op.s;
        return html`<tr><td>${u.fmtDate(op.d)}</td><td class="g">${op.l}</td><td class="d">${op.r ? u.fcfa(op.r) : ''}</td><td class="d">${op.s ? u.fcfa(op.s) : ''}</td><td class="d"><b>${u.fcfa(solde)}</b></td></tr>`;
      });
      return { liste: { avant: html`${o.entete(r)}${o.titre(r.titre, `Année scolaire ${S().school.year} · arrêté au ${u.fmtDate(u.aujourdhui())}`)}`, tete: html`<tr><th>Date</th><th class="g">Opération</th><th>Recette</th><th>Dépense</th><th>Solde</th></tr>`, lignes, apres: html`<div class="doc-recap"><div>Total des recettes<b>${u.fcfa(AK.pro.encaisse())}</b></div><div>Total des dépenses<b>${u.fcfa(AK.pro.depense())}</b></div><div>Solde<b>${u.fcfa(AK.pro.encaisse() - AK.pro.depense())}</b></div></div>${o.signatures(r, ctx)}`, suite: html`<div class="doc-note">Journal de caisse (suite)</div>` } };
    }
  });

  def({
    id: 'attestation-service', lib: 'Attestation de service (personnel)', categorie: 'personnel', sujet: 'agent', icone: 'fileCheck',
    description: 'Atteste que le membre du personnel est en service dans l’établissement. Référence et QR vérifiables.',
    emission: { type: 'ATS', politique: 'registre' },
    defauts: {
      titre: 'ATTESTATION DE SERVICE', filigrane: { type: 'logo', opacite: 5, taille: 60 }, qr: { actif: true, identite: false, taille: 24 },
      texte: 'Je soussigné(e), **{directeur}**, {directeur.titre} de l’{ecole.nomLong} ({iepp}, {drenaet}), atteste que **{agent.nom}**, matricule **{agent.matricule}**, {agent.fonction}, est en service dans mon établissement depuis le {agent.entree}.\n\nEn foi de quoi, la présente attestation lui est délivrée pour servir et valoir ce que de droit.'
    },
    rendu: (ctx, r, o) => ({ contenu: colonne(html`${o.entete(r)}${o.titre(r.titre, r.sousTitre)}<div class="doc-texte">${o.rediger(r.texte, ctx)}</div><div style="margin-top:auto">${o.signatures(r, ctx)}<div style="margin-top:6mm">${AK.mise.verification(ctx.qrTexte, ctx.doc, r.qr.taille)}</div></div>`) })
  });
})(window.AK);
