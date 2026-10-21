/* =====================================================================================
   Outil de vérification AUTONOME : fichier HTML hors ligne remis par l'école à l'IEPP, à un
   autre établissement ou à un parent. Il fonctionne en ouvrant simplement le fichier
   (adresse file://), sans connexion, sans aucune ressource externe.

   Données intégrées par AKWA SCHOOL › Documents › Vérifier › « Créer l'outil »
   (window.AKWA_DONNEES) :
     { format: 'akwa-verification', version: 1, cree, registreDate, ecole: { nom, iepp, drenaet },
       cles: [clés PUBLIQUES de signature], registre: [{ r, t, e, x, h, s, a, v, n? }] }
   Le modèle livré avec l'application n'en contient aucune : il explique alors comment
   produire l'outil de l'école.

   Le contrôle (signature, registre, statut) est confié au moteur commun AK.verif
   (docs/verification.js), le même que dans l'application. Cet écran ne fait que :
     - préparer la source (clés publiques contrôlées, index du registre, date de la copie) ;
     - lire la référence, le texte d'une douchette, la caméra ou une photo ;
     - présenter le résultat avec des avertissements honnêtes : la copie du registre est
       datée (une annulation postérieure n'est pas connue), la signature prouve l'intégrité
       et l'émetteur mais pas la validité administrative, et il faut comparer la personne.
   ===================================================================================== */
(function (AK) {
  'use strict';
  const u = AK.u, { html } = u, ic = AK.ic, V = AK.valid;
  const $ = (s, e) => u.$(s, e);

  /* Libellés des types de document : copie de AK.registre.TYPES (docs/registre.js), module
     qui n'est pas embarqué dans l'outil. Le moteur de vérification s'en sert s'il existe. */
  const TYPES = {
    CEL: 'Carte d’identité scolaire',
    CPE: 'Carte professionnelle',
    CSC: 'Certificat de scolarité',
    ATF: 'Attestation de fréquentation',
    CTR: 'Certificat de transfert (exeat)',
    FIS: 'Fiche scolaire',
    FII: 'Fiche individuelle de l’élève',
    FIN: 'Fiche d’inscription',
    BUL: 'Bulletin de notes',
    BUA: 'Bulletin annuel',
    ATS: 'Attestation de service',
    REC: 'Reçu de versement'
  };
  const libelleType = (t) => TYPES[t] || t || 'Document';
  if (!AK.registre) AK.registre = { TYPES, libelleType };

  const COPIE_ANCIENNE = 30; // jours au-delà desquels la copie du registre est signalée comme ancienne
  const HISTORIQUE_MAX = 12;
  const VERDICTS = { valide: ['ok', 'Valable'], douteux: ['avert', 'À vérifier'], invalide: ['mauvais', 'Non valable'], inconnu: ['', 'Inconnu'] };
  const STATUTS_CLE = { active: 'Active', retiree: 'Retirée', compromise: 'COMPROMISE' };
  const STATUTS_DOC = { valide: 'En vigueur', annule: 'Annulé', remplace: 'Remplacé' };

  /* ---------- Données intégrées : contrôle de forme, index du registre ---------- */
  const estTexte = (v) => typeof v === 'string' && v.length > 0;
  const cleBienFormee = (c) => c && estTexte(c.id) && c.pub && typeof c.pub === 'object' && estTexte(c.pub.x) && estTexte(c.pub.y) && estTexte(c.pub.crv);

  function chargerDonnees(brut) {
    if (brut == null) return { etat: 'modele' };
    if (typeof brut !== 'object' || brut.format !== 'akwa-verification' || brut.version !== 1 || !Array.isArray(brut.registre) || !Array.isArray(brut.cles)) return { etat: 'illisible' };
    const e = brut.ecole && typeof brut.ecole === 'object' ? brut.ecole : {};
    const ecole = { nom: String(e.nom || '').trim(), iepp: String(e.iepp || '').trim(), drenaet: String(e.drenaet || '').trim() };
    const index = new Map();
    const comptes = { valide: 0, annule: 0, remplace: 0 };
    let ignorees = 0;
    for (const x of brut.registre) {
      const ref = x && estTexte(x.r) ? V.normRef(x.r) : '';
      if (!V.refValide(ref)) {
        ignorees++;
        continue;
      }
      index.set(ref, x);
      if (comptes[x.s] != null) comptes[x.s]++;
    }
    const cles = brut.cles.filter(cleBienFormee).map((c) => ({ ...c, ecole: c.ecole || ecole.nom, controle: 'en-cours' }));
    ignorees += brut.cles.length - cles.length;
    return {
      etat: 'ok', ecole, cles, index, comptes, ignorees,
      registreDate: u.estISO(brut.registreDate) ? brut.registreDate : null,
      cree: typeof brut.cree === 'string' && !isNaN(Date.parse(brut.cree)) ? brut.cree : null
    };
  }

  const D = chargerDonnees(window.AKWA_DONNEES);
  const cryptoDispo = AK.crypto && AK.crypto.dispo();

  /* L'empreinte affichée d'une clé sert à authentifier l'outil (comparée à celle que l'école
     communique). Elle est recalculée ici : une clé dont l'empreinte ne correspond pas est
     écartée (fichier altéré) et n'est jamais utilisée pour valider une signature. */
  const clesControlees = D.etat !== 'ok' || !cryptoDispo ? Promise.resolve() : Promise.all(D.cles.map(async (c) => {
    try {
      const calc = await AK.crypto.empreinteCle(c.pub);
      c.controle = calc === c.empreinte ? 'ok' : 'alteree';
      c.empreinteCalculee = calc;
    } catch (e) {
      c.controle = 'alteree';
    }
  }));

  /** Entrée de la copie du registre → format attendu par AK.verif.verifier. */
  const entree = (x) => (x ? {
    e: estTexte(x.e) ? x.e : '', n: estTexte(x.n) ? x.n : '', h: estTexte(x.h) ? x.h : '', v: Array.isArray(x.v) ? x.v : [],
    s: x.s, a: estTexte(x.a) ? x.a : null, motif: '', remplacePar: '', x: estTexte(x.x) ? x.x : null, demo: false
  } : null);
  const source = () => ({
    cles: D.cles.filter((c) => c.controle === 'ok'),
    trouver: (ref) => entree(D.index.get(V.normRef(ref))),
    registreDate: D.registreDate,
    aujourdhui: u.aujourdhui(),
    ecole: D.ecole
  });
  const ageCopie = () => (D.registreDate ? u.ecartJours(D.registreDate, u.aujourdhui()) : null);

  /* ---------- Affichage général ---------- */
  const ecoleNom = () => D.ecole.nom || 'École non nommée';
  const sousTitre = () => [D.ecole.iepp && `IEPP : ${D.ecole.iepp}`, D.ecole.drenaet && `DRENAET : ${D.ecole.drenaet}`].filter(Boolean).join(' · ');
  const dateCopie = () => (D.registreDate ? u.fmtDate(D.registreDate) : 'date inconnue');

  const boutonTheme = () => html`<button type="button" class="btn btn-ic vf-theme" data-action="vf-theme" aria-pressed="${themeSombre() ? 'true' : 'false'}" aria-label="Thème sombre" title="Thème sombre">${ic('moon')}</button>`;

  function vueModele() {
    return html`<header class="vf-entete"><div class="vf-entete-in">
        <div class="vf-marque">${ic('shieldCheck', 'vf-logo')}<div><p class="vf-sur">AKWA SCHOOL · outil de vérification</p><h1>Modèle sans données</h1></div></div>
        ${boutonTheme()}</div></header>
      <main class="vf-corps vf-etroit" id="vf-principal">
        <section class="carte pile" aria-labelledby="vf-modele-titre">
          <h2 id="vf-modele-titre">Ce fichier ne peut encore vérifier aucun document</h2>
          <p class="mb0">C’est le <b>modèle</b> de l’outil de vérification livré avec AKWA SCHOOL. Il ne contient ni les clés publiques de signature d’une école ni de copie de son registre : sans elles, aucun document ne peut être contrôlé.</p>
          <h3>Pour obtenir l’outil de votre école</h3>
          <ol class="vf-etapes">
            <li>Ouvrez AKWA SCHOOL avec le compte du <b>directeur</b>.</li>
            <li>Allez dans <b>Documents › Vérifier</b>, rubrique « Vérification par d’autres personnes » (ou dans <b>Documents › Registre</b>, bouton « Outil de vérification autonome »).</li>
            <li>Cliquez sur <b>Créer l’outil</b> ; choisissez d’inclure ou non les noms des titulaires.</li>
            <li>Remettez le fichier créé (<span class="mono">AKWA_verification_…html</span>) à l’IEPP, à l’établissement ou au parent concerné. Il s’ouvre dans un navigateur, sans connexion.</li>
          </ol>
          ${encadre('Le fichier produit contient les clés publiques de l’école et une copie datée du registre (références et statuts). Il ne contient aucune clé privée ni aucun mot de passe. Refaites-le après chaque annulation importante : il ne connaît que les annulations antérieures à sa création.', '', 'info')}
        </section>
      </main>${pied()}`;
  }

  function vueIllisible() {
    return html`<header class="vf-entete"><div class="vf-entete-in"><div class="vf-marque">${ic('shieldX', 'vf-logo')}<div><p class="vf-sur">AKWA SCHOOL · outil de vérification</p><h1>Fichier inutilisable</h1></div></div>${boutonTheme()}</div></header>
      <main class="vf-corps vf-etroit" id="vf-principal">
        ${encadre(html`<b>Les données de vérification de ce fichier sont illisibles.</b> Il a pu être modifié, abîmé pendant une copie ou produit par une version incompatible. N’utilisez pas ce fichier : demandez un nouvel exemplaire à l’école émettrice.`, 'erreur', 'shieldX')}
      </main>${pied()}`;
  }

  const encadre = (contenu, ton = '', icone = 'info') => html`<div class="encadre ${ton}">${ic(icone)}<div>${contenu}</div></div>`;
  const pied = () => html`<footer class="vf-pied"><p class="mb0">AKWA SCHOOL @VERSION · outil de vérification hors ligne. Aucune donnée n’est envoyée : la lecture du QR code et les contrôles se font sur cet appareil.</p></footer>`;

  function bandeauCles() {
    if (!D.cles.length) return html`<span class="vf-info-l">${ic('key')}<span>Aucune clé de signature : vérification par la référence et le registre uniquement.</span></span>`;
    return html`${D.cles.map((c) => html`<span class="vf-info-l">${ic('key')}<span>Clé ${c.id} · <span class="mono vf-empreinte">${c.empreinteCalculee || c.empreinte || '—'}</span> ${tagCle(c)}</span></span>`)}`;
  }
  function tagCle(c) {
    if (c.controle === 'alteree') return html`<span class="tag mauvais">${ic('xCircle')}Empreinte incohérente</span>`;
    if (c.statut === 'compromise') return html`<span class="tag mauvais">${ic('warn')}Compromise</span>`;
    if (c.statut === 'retiree') return html`<span class="tag">Retirée</span>`;
    return html`<span class="tag ok">${ic('checkCircle')}${STATUTS_CLE[c.statut] || c.statut || 'Active'}</span>`;
  }

  function alertesGenerales() {
    const a = [];
    if (!cryptoDispo) a.push(encadre(html`<b>Ce navigateur ne permet pas de contrôler les signatures électroniques</b> (Web Crypto indisponible). Seules la référence et la copie du registre peuvent être vérifiées. Ouvrez cet outil dans Chrome, Edge ou Firefox récent.`, 'avert', 'warn'));
    const alterees = D.cles.filter((c) => c.controle === 'alteree');
    if (alterees.length) a.push(encadre(html`<b>Fichier altéré : ${alterees.map((c) => c.id).join(', ')}.</b> L’empreinte enregistrée ne correspond pas à la clé publique. Cette clé est ignorée : aucune signature n’est validée avec elle. Demandez un nouvel exemplaire de l’outil à l’école.`, 'erreur', 'shieldX'));
    if (D.ignorees) a.push(encadre(`${u.pluriel(D.ignorees, 'élément illisible')} de la copie ${D.ignorees > 1 ? 'ont été ignorés' : 'a été ignoré'} (fichier peut-être abîmé).`, 'avert', 'warn'));
    const age = ageCopie();
    if (age != null && age > COPIE_ANCIENNE) a.push(encadre(html`<b>Copie du registre ancienne (${u.pluriel(age, 'jour')}).</b> Les annulations décidées depuis le ${dateCopie()} ne sont pas connues de cet outil : demandez une version à jour à l’école.`, 'avert', 'cal'));
    return a.length ? html`<div class="pile">${a}</div>` : '';
  }

  function vuePrincipale() {
    const st = sousTitre();
    const c = D.comptes;
    const camOk = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    return html`<header class="vf-entete"><div class="vf-entete-in">
        <div class="vf-marque">${ic('shieldCheck', 'vf-logo')}<div><p class="vf-sur">Vérification des documents</p><h1>${ecoleNom()}</h1>${st ? html`<p class="vf-sous">${st}</p>` : ''}</div></div>
        ${boutonTheme()}</div>
        <div class="vf-infos" aria-label="Informations sur cet outil">
          <span class="vf-info-l">${ic('cal')}<span>Copie du registre du <b>${dateCopie()}</b> · ${u.pluriel(D.index.size, 'référence')}</span></span>
          <span id="vf-cles" class="vf-cles">${bandeauCles()}</span>
        </div></header>
      <main class="vf-corps" id="vf-principal">
        <div id="vf-alertes">${alertesGenerales()}</div>
        <div class="vf-grille">
          <div class="pile">
            <section class="carte" aria-labelledby="vf-saisie-titre">
              <h2 id="vf-saisie-titre" class="vf-titre">${ic('search')}Référence ou contenu du QR code</h2>
              <form id="vf-form" class="pile" autocomplete="off" novalidate>
                <div class="champ">
                  <label for="vf-texte">Référence du document (AK-XXX-AAAA-NNNNNN-C) ou texte lu par une douchette</label>
                  <input id="vf-texte" name="texte" class="inp vf-saisie" type="text" inputmode="text" spellcheck="false" autocapitalize="characters" maxlength="1000" placeholder="AK-CSC-2026-000012-7" aria-describedby="vf-texte-aide vf-texte-err">
                  <p class="aide mb0" id="vf-texte-aide">La référence est imprimée à côté du QR code. Une douchette (lecteur de codes) peut aussi écrire ici le contenu du QR code.</p>
                  <p class="erreur-champ mb0" id="vf-texte-err" hidden></p>
                </div>
                <div class="ligne"><button type="submit" class="btn btn-pri">${ic('shieldCheck')}Vérifier</button><button type="button" class="btn btn-ghost" data-action="vf-effacer">Effacer</button></div>
              </form>
            </section>
            <section class="carte vf-depot" id="vf-depot" aria-labelledby="vf-camera-titre">
              <h2 id="vf-camera-titre" class="vf-titre">${ic('cam')}Caméra ou photo du QR code</h2>
              <div class="pile">
                <div class="vf-camera" id="vf-camera" hidden><video playsinline muted aria-label="Image de la caméra : placez le QR code dans le cadre"></video><div class="vf-viseur" aria-hidden="true"></div></div>
                <div class="ligne">
                  ${camOk ? html`<button type="button" class="btn" data-action="vf-camera" id="vf-btn-camera" aria-pressed="false">${ic('cam')}<span>Scanner avec la caméra</span></button>` : ''}
                  <label class="btn vf-fichier">${ic('image')}Importer une photo du QR<input type="file" accept="image/*" id="vf-photo" class="sr"></label>
                </div>
                <p class="petit mb0 vf-etat" id="vf-etat-lecture" role="status" aria-live="polite"></p>
                <p class="mut petit mb0">${camOk ? '' : 'Caméra non disponible dans ce navigateur : importez une photo du QR code. '}Le QR code est lu sur cet appareil ; aucune image n’est envoyée. Vous pouvez aussi déposer une image ici ou la coller (Ctrl+V).</p>
              </div>
            </section>
            <section class="carte" id="vf-historique-zone" aria-labelledby="vf-hist-titre" hidden>
              <h2 id="vf-hist-titre" class="vf-titre">${ic('clock')}Vérifications de cette session</h2>
              <ul class="vf-historique" id="vf-historique"></ul>
              <p class="mut petit mb0">Non conservées : la liste s’efface à la fermeture de l’outil.</p>
            </section>
          </div>
          <section class="carte vf-resultat" aria-labelledby="vf-res-titre">
            <h2 id="vf-res-titre" class="vf-titre" tabindex="-1">${ic('shieldCheck')}Résultat</h2>
            <div id="vf-resultat">${attente()}</div>
          </section>
        </div>
        <section class="carte" aria-labelledby="vf-apropos-titre">
          <h2 id="vf-apropos-titre" class="vf-titre">${ic('info')}À propos de cet outil</h2>
          <div class="vf-apropos">
            <div class="pile-sm">
              <h3>Copie du registre</h3>
              <p class="mb0">Copie du <b>${dateCopie()}</b>${D.cree ? html` (créée le ${u.fmtHorodatage(D.cree)})` : ''} : ${u.pluriel(D.index.size, 'référence')}, dont ${c.valide} en vigueur, ${u.pluriel(c.annule, 'annulée')}, ${u.pluriel(c.remplace, 'remplacée')} par un duplicata.</p>
              <p class="mut petit mb0">Elle contient les références, les empreintes et les statuts des documents${[...D.index.values()].some((x) => estTexte(x.n)) ? ', ainsi que le nom des titulaires' : ' (sans le nom des titulaires)'}. Les documents de démonstration n’y figurent pas.</p>
            </div>
            <div class="pile-sm">
              <h3>Clés de signature de l’école</h3>
              ${D.cles.length ? html`<ul class="vf-liste-cles">${D.cles.map(itemCle)}</ul>` : html`<p class="mb0">Aucune : les documents de cette école ne sont pas signés électroniquement.</p>`}
              <p class="mut petit mb0">Pour être sûr que cet outil vient bien de l’école, comparez l’empreinte ci-dessus avec celle qu’elle vous a communiquée (AKWA SCHOOL › Paramètres › Sécurité). Elle figure aussi sous le QR code des documents signés.</p>
            </div>
          </div>
        </section>
      </main>${pied()}`;
  }
  const itemCle = (k) => html`<li><b>${k.id}</b> ${tagCle(k)}<br><span class="mono vf-empreinte">${k.empreinteCalculee || k.empreinte || '—'}</span><br><span class="mut petit">${detailCle(k)}</span></li>`;
  function detailCle(k) {
    const d = (v) => (v ? u.fmtDate(String(v).slice(0, 10)) : '');
    return [k.creeeLe && `Créée le ${d(k.creeeLe)}`, k.retireeLe && `retirée le ${d(k.retireeLe)}`, k.compromiseLe && `déclarée compromise le ${d(k.compromiseLe)}`].filter(Boolean).join(' · ') || 'Dates non précisées';
  }

  const attente = () => html`<div class="vf-vide">${ic('shieldCheck', 'vf-vide-i')}<p class="mb0"><b>En attente d’un document</b></p><p class="mut petit mb0">Le résultat détaille séparément l’intégrité (signature), l’émetteur (clé), l’inscription au registre et le statut (annulé, remplacé, expiré).</p></div>`;

  /* ---------- Résultat ---------- */
  function lignesDetail(R) {
    const x = R.ref ? D.index.get(R.ref) : null;
    const q = R.champs || {};
    const L = [];
    L.push(['Type', libelleType(R.type)]);
    L.push(['Référence', R.ref]);
    const emis = (x && x.e) || q.E;
    if (emis) L.push(['Émis le', u.fmtDate(emis)]);
    const fin = (x && x.x) || q.X;
    if (fin) L.push(['Valable jusqu’au', u.fmtDate(fin)]);
    if (x && estTexte(x.n)) L.push(['Titulaire (registre)', x.n]);
    if (q.N) L.push(['Titulaire (QR code)', q.N]);
    if (q.M) L.push(['Matricule (QR code)', q.M]);
    if (x) L.push([`Statut au registre du ${dateCopie()}`, `${STATUTS_DOC[x.s] || x.s || '—'}${x.s !== 'valide' && x.a ? ' le ' + u.fmtDate(x.a) : ''}`]);
    else L.push([`Registre du ${dateCopie()}`, 'Référence absente de cette copie']);
    if (q.K) {
      const k = D.cles.find((c) => c.id === q.K);
      L.push(['Signature', k ? `Clé ${k.id} · ${k.empreinteCalculee || k.empreinte}` : `Clé ${q.K} (inconnue de cet outil)`]);
    } else if (R.format === 'qr') L.push(['Signature', 'Aucune (QR code non signé)']);
    return L;
  }

  function conseils(R) {
    const C = [];
    if (R.verdict === 'invalide') C.push(encadre(html`<b>Ne vous fiez pas à ce document.</b> Signalez-le à l’école émettrice (${ecoleNom()}) en indiquant sa référence.`, 'erreur', 'shieldX'));
    else if (R.verdict === 'inconnu') C.push(encadre('Ce document n’est pas connu de cette copie du registre et ne porte pas de signature vérifiable ici. Contactez l’école émettrice avant de l’accepter.', 'avert', 'help'));
    else if (R.verdict === 'douteux') C.push(encadre('Certains contrôles n’ont pas pu aboutir (voir les points signalés). Contactez l’école émettrice avant d’accepter ce document.', 'avert', 'warn'));
    const age = ageCopie();
    C.push(encadre(html`<b>Registre daté.</b> Cet outil contient la copie du registre du ${dateCopie()}${age != null && age > 0 ? html` (il y a ${u.pluriel(age, 'jour')})` : ''} : un document annulé ou remplacé après cette date apparaît encore « en vigueur » ici. En cas de doute, demandez à l’école une version à jour de l’outil.`, age != null && age > COPIE_ANCIENNE ? 'avert' : '', 'cal'));
    C.push(encadre('La signature électronique prouve que le contenu du QR code n’a pas été modifié et qu’il a été émis avec la clé de l’école. Elle ne prouve pas la validité administrative du document (exactitude des informations, décision de l’autorité compétente).', '', 'shield'));
    C.push(encadre('Comparez le nom, le matricule, la classe et la photo avec la personne et le document présentés : un QR code authentique peut avoir été recopié sur un autre document.', '', 'user'));
    return C;
  }

  function resultatHtml(R) {
    const reconnu = !!R.ref;
    return html`<div class="pile">
      ${AK.verif.rendu(R)}
      ${reconnu ? html`<div><h3 class="vf-sous-titre">Informations à comparer avec le document présenté</h3>
        <dl class="vf-details">${lignesDetail(R).map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl></div>` : ''}
      ${reconnu ? html`<div class="pile-sm">${conseils(R)}</div>` : encadre('Saisissez la référence imprimée à côté du QR code (par exemple AK-CSC-2026-000012-7), ou scannez le QR code du document.', '', 'info')}
      <div class="ligne"><button type="button" class="btn btn-sm" data-action="vf-copier">${ic('copy')}Copier le résultat</button><span class="petit mut" id="vf-copie-etat" role="status" aria-live="polite"></span></div>
    </div>`;
  }

  /** Résumé texte (à coller dans un message ou un rapport d'inspection). */
  function texteResultat(R, quand) {
    const l = [`Vérification d’un document AKWA SCHOOL — ${u.fmtHorodatage(quand)}`, `Outil de vérification : ${ecoleNom()} · copie du registre du ${dateCopie()}`, `Résultat : ${R.titre}`];
    if (R.ref) l.push(R.resume);
    R.points.forEach((p) => l.push(`- ${p.titre} : ${p.detail}`));
    if (R.ref) lignesDetail(R).forEach(([k, v]) => l.push(`  ${k} : ${v}`));
    l.push(`Rappel : un document annulé après le ${dateCopie()} n’est pas connu de cet outil ; la signature ne prouve pas la validité administrative.`);
    return l.join('\n');
  }

  /* ---------- Vérification ---------- */
  let dernier = null; // { R, t, origine }
  const historique = [];
  let enCours = 0;

  function erreurSaisie(message) {
    const inp = $('#vf-texte'), err = $('#vf-texte-err');
    if (!inp || !err) return;
    if (message) u.poser(err, html`${ic('warn')}<span>${message}</span>`);
    err.hidden = !message;
    if (message) inp.setAttribute('aria-invalid', 'true');
    else inp.removeAttribute('aria-invalid');
  }
  const annoncer = (t) => {
    const z = $('#vf-annonce');
    if (z) z.textContent = t;
  };
  const etatLecture = (t, ton = '') => {
    const z = $('#vf-etat-lecture');
    if (!z) return;
    z.textContent = t || '';
    z.className = `petit mb0 vf-etat ${ton}`;
  };

  /** Vérifie un texte (référence ou contenu du QR) ; origine : saisie, caméra, photo. */
  async function verifierTexte(t, origine) {
    const texte = String(t || '').trim();
    if (!texte) {
      erreurSaisie('Saisissez une référence ou collez le contenu du QR code.');
      const inp = $('#vf-texte');
      if (inp) inp.focus();
      return null;
    }
    erreurSaisie('');
    const n = ++enCours;
    await clesControlees;
    let R;
    try {
      R = await AK.verif.verifier(texte, source());
    } catch (e) {
      // seule cause attendue : Web Crypto indisponible pendant le contrôle d'une signature
      R = {
        entree: texte.slice(0, 600), verdict: 'douteux', titre: 'Vérification incomplète : prudence', resume: 'La signature n’a pas pu être contrôlée sur cet appareil.', ref: null,
        points: [{ cle: 'integrite', etat: 'av', titre: 'Intégrité', detail: (e && e.message) || 'Contrôle de la signature impossible dans ce navigateur.' }]
      };
    }
    if (n !== enCours) return R; // une vérification plus récente a été lancée entre-temps
    dernier = { R, t: Date.now(), origine };
    historique.unshift(dernier);
    if (historique.length > HISTORIQUE_MAX) historique.length = HISTORIQUE_MAX;
    afficher(dernier);
    dessinerHistorique();
    return R;
  }

  function afficher(item) {
    dernier = item;
    const z = $('#vf-resultat');
    if (!z) return;
    u.poser(z, resultatHtml(item.R));
    annoncer(`Résultat : ${item.R.titre}. ${item.R.ref ? item.R.resume : ''}`);
  }

  function dessinerHistorique() {
    const zone = $('#vf-historique-zone'), liste = $('#vf-historique');
    if (!zone || !liste) return;
    zone.hidden = !historique.length;
    u.poser(liste, historique.map((h, i) => {
      const [ton, lib] = VERDICTS[h.R.verdict] || VERDICTS.inconnu;
      const heure = new Date(h.t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      return html`<li><button type="button" class="vf-hist" data-action="vf-revoir" data-i="${i}" aria-current="${h === dernier ? 'true' : 'false'}"><span class="tag ${ton}">${lib}</span><span class="mono vf-hist-ref">${h.R.ref || 'Contenu non reconnu'}</span><span class="mut petit">${h.origine} · ${heure}</span></button></li>`;
    }));
  }

  /* ---------- Caméra : lecture continue, arrêt propre ---------- */
  let camera = null; // { flux, actif, minuteur, n }
  let ouverture = false;
  let detecteur;

  /** Lecture rapide d'une image de la vidéo : lecteur intégré du navigateur s'il existe, sinon décodeur AKWA (une taille par image, en alternance). */
  async function lireImageVideo(video, n) {
    if (detecteur === undefined) {
      detecteur = null;
      try {
        if ('BarcodeDetector' in window) detecteur = new window.BarcodeDetector({ formats: ['qr_code'] });
      } catch (e) { /* lecteur intégré indisponible */ }
    }
    if (detecteur) {
      try {
        const r = await detecteur.detect(video);
        if (r && r[0] && r[0].rawValue) return r[0].rawValue;
      } catch (e) { /* image suivante */ }
    }
    return AK.qrdecode.decoder(AK.qrdecode.imageData(video, n % 2 ? 640 : 960));
  }

  function boutonCamera(actif) {
    const b = $('#vf-btn-camera');
    if (!b) return;
    b.setAttribute('aria-pressed', actif ? 'true' : 'false');
    b.lastElementChild.textContent = actif ? 'Arrêter la caméra' : 'Scanner avec la caméra';
  }

  async function demarrerCamera() {
    const zone = $('#vf-camera'), video = zone && $('video', zone), b = $('#vf-btn-camera');
    if (!video || ouverture || camera) return;
    ouverture = true;
    if (b) b.classList.add('occupe');
    etatLecture('Ouverture de la caméra…');
    let flux;
    try {
      flux = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
    } catch (e) {
      const nom = e && e.name;
      etatLecture(nom === 'NotAllowedError' || nom === 'SecurityError' ? 'Accès à la caméra refusé : autorisez-le dans le navigateur, ou importez une photo du QR code.'
        : nom === 'NotFoundError' || nom === 'OverconstrainedError' ? 'Aucune caméra trouvée sur cet appareil : importez une photo du QR code.'
          : nom === 'NotReadableError' ? 'La caméra est utilisée par une autre application : fermez-la, puis réessayez.'
            : 'Caméra indisponible : importez une photo du QR code.', 'erreur');
      return;
    } finally {
      ouverture = false;
      if (b) b.classList.remove('occupe');
    }
    const session = { flux, actif: true, minuteur: 0, n: 0 };
    camera = session;
    zone.hidden = false;
    video.srcObject = flux;
    await video.play().catch(() => {});
    if (camera !== session) return; // arrêtée pendant le démarrage
    boutonCamera(true);
    etatLecture('Caméra active : placez le QR code dans le cadre, bien éclairé et net.');
    const boucle = async () => {
      if (camera !== session || !session.actif) return;
      if (video.readyState >= 2 && video.videoWidth) {
        let t = null;
        try {
          t = await lireImageVideo(video, session.n++);
        } catch (e) { /* image suivante */ }
        if (camera !== session) return;
        if (t) {
          arreterCamera('QR code lu : caméra arrêtée.');
          if (navigator.vibrate) navigator.vibrate(80);
          const inp = $('#vf-texte');
          if (inp) inp.value = t;
          await verifierTexte(t, 'caméra');
          const titre = $('#vf-res-titre');
          if (titre) titre.focus();
          return;
        }
      }
      session.minuteur = setTimeout(boucle, 200);
    };
    boucle();
  }

  function arreterCamera(message) {
    const etaitActive = !!camera;
    if (camera) {
      camera.actif = false;
      clearTimeout(camera.minuteur);
      camera.flux.getTracks().forEach((t) => t.stop());
      camera = null;
    }
    const zone = $('#vf-camera'), video = zone && $('video', zone);
    if (video) {
      video.pause();
      video.srcObject = null;
    }
    if (zone) zone.hidden = true;
    boutonCamera(false);
    if (etaitActive) etatLecture(message || 'Caméra arrêtée.');
  }
  // libère la caméra dès que l'outil n'est plus visible (onglet changé, téléphone verrouillé, fermeture)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && camera) arreterCamera('Caméra arrêtée : l’outil n’était plus affiché.');
  });
  window.addEventListener('pagehide', () => arreterCamera());

  /* ---------- Photo : import, dépôt ou collage d'une image ---------- */
  async function lirePhoto(fichier) {
    if (!fichier) return;
    if (!/^image\//.test(fichier.type || '')) {
      etatLecture('Ce fichier n’est pas une image : choisissez une photo du QR code (JPEG, PNG…).', 'erreur');
      return;
    }
    if (camera) arreterCamera();
    etatLecture('Lecture de l’image…');
    let t = null;
    try {
      t = await AK.qrdecode.lireFichier(fichier);
    } catch (e) {
      etatLecture('Image illisible : le fichier est peut-être abîmé ou dans un format non pris en charge.', 'erreur');
      return;
    }
    if (!t) {
      etatLecture('Aucun QR code lisible dans cette image : reprenez la photo de plus près, bien éclairée et nette, ou saisissez la référence imprimée à côté du QR code.', 'erreur');
      return;
    }
    etatLecture('QR code lu dans l’image.', 'ok');
    const inp = $('#vf-texte');
    if (inp) inp.value = t;
    await verifierTexte(t, 'photo');
    const titre = $('#vf-res-titre');
    if (titre) titre.focus();
  }

  /* ---------- Copie du résultat ---------- */
  async function copierResultat() {
    if (!dernier) return;
    const texte = texteResultat(dernier.R, dernier.t);
    let ok = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(texte);
        ok = true;
      }
    } catch (e) { /* méthode de secours ci-dessous */ }
    if (!ok) {
      const z = document.createElement('textarea');
      z.value = texte;
      z.setAttribute('readonly', '');
      z.className = 'sr';
      document.body.append(z);
      z.select();
      try {
        ok = document.execCommand('copy');
      } catch (e) {
        ok = false;
      }
      z.remove();
    }
    const etat = $('#vf-copie-etat');
    if (etat) etat.textContent = ok ? 'Résultat copié : collez-le dans un message ou un rapport.' : 'Copie impossible dans ce navigateur : sélectionnez le texte du résultat à la main.';
  }

  /* ---------- Thème ---------- */
  function themeSombre() {
    const t = document.documentElement.dataset.theme;
    if (t) return t === 'dark';
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function basculerTheme() {
    const sombre = !themeSombre();
    document.documentElement.dataset.theme = sombre ? 'dark' : 'light';
    u.$$('[data-action="vf-theme"]').forEach((b) => b.setAttribute('aria-pressed', sombre ? 'true' : 'false'));
  }

  /* ---------- Événements (délégation) ---------- */
  const ACTIONS = {
    'vf-camera': () => (camera ? arreterCamera('Caméra arrêtée.') : demarrerCamera()),
    'vf-effacer'() {
      const inp = $('#vf-texte');
      if (!inp) return;
      inp.value = '';
      erreurSaisie('');
      inp.focus();
    },
    'vf-copier': () => copierResultat(),
    'vf-revoir'(el) {
      const h = historique[Number(el.dataset.i)];
      if (!h) return;
      afficher(h);
      dessinerHistorique();
      const inp = $('#vf-texte');
      if (inp) inp.value = h.R.entree || '';
    },
    'vf-theme': () => basculerTheme()
  };
  const signaler = (e) => etatLecture((e && e.message) || 'Opération impossible.', 'erreur');

  function brancher() {
    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (!el || !ACTIONS[el.dataset.action]) return;
      e.preventDefault();
      Promise.resolve().then(() => ACTIONS[el.dataset.action](el)).catch(signaler);
    });
    const form = $('#vf-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const inp = $('#vf-texte');
        verifierTexte(inp.value, 'saisie').then((R) => {
          if (R && inp === document.activeElement) inp.select(); // douchette : le scan suivant remplace le texte
        }).catch(signaler);
      });
      $('#vf-texte').addEventListener('input', () => erreurSaisie(''));
    }
    const photo = $('#vf-photo');
    if (photo) photo.addEventListener('change', () => {
      const f = photo.files && photo.files[0];
      photo.value = ''; // permet de choisir à nouveau la même image
      lirePhoto(f).catch(signaler);
    });
    // dépôt d'une image n'importe où sur la page (sans quitter l'outil)
    const depot = $('#vf-depot');
    window.addEventListener('dragover', (e) => {
      if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault();
      if (depot) depot.classList.add('survol');
    });
    window.addEventListener('dragleave', (e) => {
      if (depot && !e.relatedTarget) depot.classList.remove('survol');
    });
    window.addEventListener('drop', (e) => {
      if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
      e.preventDefault();
      if (depot) depot.classList.remove('survol');
      lirePhoto(e.dataTransfer.files[0]).catch(signaler);
    });
    // collage d'une capture d'écran (le collage de texte dans la saisie reste normal)
    document.addEventListener('paste', (e) => {
      const items = e.clipboardData ? [...e.clipboardData.items] : [];
      const img = items.find((it) => it.kind === 'file' && /^image\//.test(it.type));
      if (!img) return;
      e.preventDefault();
      lirePhoto(img.getAsFile()).catch(signaler);
    });
  }

  /* ---------- Démarrage ---------- */
  function demarrer() {
    const racine = document.getElementById('vf-racine');
    if (!racine) return;
    if (D.etat === 'modele') {
      u.poser(racine, vueModele());
      document.title = 'Outil de vérification (modèle sans données) · AKWA SCHOOL';
    } else if (D.etat !== 'ok') {
      u.poser(racine, vueIllisible());
      document.title = 'Outil de vérification inutilisable · AKWA SCHOOL';
    } else {
      u.poser(racine, vuePrincipale());
      document.title = `Vérification des documents · ${ecoleNom()}`;
      clesControlees.then(() => {
        const zc = $('#vf-cles'), za = $('#vf-alertes');
        if (zc) u.poser(zc, bandeauCles());
        if (za) u.poser(za, alertesGenerales());
        const apropos = $('.vf-liste-cles');
        if (apropos) u.poser(apropos, D.cles.map(itemCle));
        document.documentElement.dataset.pret = '1';
      });
    }
    brancher();
    if (D.etat !== 'ok') document.documentElement.dataset.pret = '1';
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer);
  else demarrer();

  /* Accès pour les tests automatisés et le diagnostic (lecture seule). */
  AK.verificateur = { etat: () => D.etat, verifierTexte, arreterCamera, cameraActive: () => !!camera };
})(window.AK);
