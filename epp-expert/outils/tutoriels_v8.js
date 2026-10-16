/* Fabrique les vidéos tutoriels (Aide › Tutoriels vidéo) à partir de l'interface v8 elle-même.

   L'interface (epp/resources/web/akwa_v8.html) est ouverte dans Chromium (Playwright) sur l'école de
   démonstration fictive, chaque tutoriel est rejoué écran par écran avec une légende, puis les images sont
   assemblées en vidéos MP4 (H.264, lisibles par Windows) avec ffmpeg. Aucune donnée réelle n'est utilisée.

     node outils/tutoriels_v8.js                 -> epp/resources/videos/tutoriels/*.mp4
     PLAYWRIGHT=/chemin/node_modules/playwright node outils/tutoriels_v8.js
*/
/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');

const RACINE = path.resolve(__dirname, '..');
const PAGE = path.join(RACINE, 'epp', 'resources', 'web', 'akwa_v8.html');
const SORTIE = path.join(RACINE, 'epp', 'resources', 'videos', 'tutoriels');
const L = 1280, H = 720, BANDE = 92, DUREE = 5;

const cadre = (titre) => `<!doctype html><meta charset="utf-8"><style>
 html,body{margin:0;width:${L}px;height:${H}px;overflow:hidden;background:#F2F4EF;font-family:"Segoe UI",Arial,sans-serif}
 iframe{border:0;width:${L}px;height:${H - BANDE}px;display:block}
 #b{position:absolute;left:0;top:${H - BANDE}px;width:${L}px;height:${BANDE}px;background:#0A4D35;border-top:4px solid #E8892F;box-sizing:border-box;padding:10px 28px}
 #t{color:#F6C08A;font-size:14px;font-weight:700}#l{color:#fff;font-size:17px;line-height:1.35;margin-top:4px}
</style><iframe id="f" src="${'file://' + PAGE.replace(/\\/g, '/')}"></iframe><div id="b"><div id="t">${titre}</div><div id="l"></div></div>`;

// ---------------------------------------------------------------- tutoriels : [écran ou action, légende]
const aller = (r) => `location.hash='#${r}'`;
const TUTORIELS = [
  ['01_Premiers pas', [
    [aller('accueil'), 'Le tableau de bord résume l’année : effectifs, filles, présence du jour, résultats, demandes en attente et choses à faire.'],
    [aller('parametres'), 'Paramètres : nom de l’école, IEPP, DRENAET, directeur et en-tête des documents. L’identité de l’école est verrouillée après la première saisie.'],
    ["document.querySelector('#cgForm')?.scrollIntoView({block:'center'})", 'Paramètres › Calendrier : ajoutez les jours fériés et les congés ; ils ne comptent pas comme jours de classe.'],
    ["document.querySelector('#pwdForm')?.scrollIntoView({block:'center'})", 'Le mot de passe administrateur protège les corrections et les suppressions. Le code de secours permet de le retrouver sans Internet.'],
    [aller('admin-rapports'), 'Le menu à gauche donne accès à tout : élèves et personnel, notes et bulletins, absences, rapports et administration.'],
  ]],
  ['02_Inscrire un élève', [
    [aller('eleves-liste'), 'Élèves & personnel › Élèves : la liste des élèves inscrits. Filtrez par classe ou tapez un nom pour chercher.'],
    ["acts.addStu();setTimeout(()=>{const f=document.querySelector('dialog form');if(!f)return;const v={nom:'YAO',prenoms:'Ange Emmanuel',naissance:'2019-04-12',lieu:'Ouaninou'};Object.entries(v).forEach(([k,x])=>{if(f.elements[k])f.elements[k].value=x});if(f.elements.classe)f.elements.classe.value='CP1'},50)",
      '« Nouvel élève » : nom, prénoms, sexe, date et lieu de naissance, classe, parents. Le matricule de l’école est attribué automatiquement.'],
    ["closeDlg();" + aller('eleves-classes'), 'Élèves & personnel › Classes : effectifs par classe et par sexe, enseignant de chaque classe.'],
    [aller('eleves-personnel'), 'Élèves & personnel › Personnel : enseignants et agents, fonction, grade, classe tenue et téléphone.'],
  ]],
  ['03_Saisir les notes et imprimer les bulletins', [
    [aller('notes-saisie'), 'Notes & bulletins › Saisie des notes : choisissez la classe et l’évaluation, tapez chaque note ; moyenne et rang se calculent seuls.'],
    [aller('notes-resultats'), 'Résultats & bulletins : moyenne de classe, taux de réussite, classement et mentions, pour une évaluation ou l’année (MGA).'],
    ["const s=S.students.find(x=>x.statut==='Inscrit');modal('Aperçu du bulletin','<div class=\"paper\">'+bulletin(s,1)+'</div>',{wide:true,noFoot:true})",
      '« Tous les bulletins » imprime un bulletin par élève, avec l’en-tête et les logos de l’école.'],
    ["closeDlg();" + aller('admin-rapports'), 'Rapports & administration › Rapports officiels : rapport de rentrée, de composition, mensuel, de fin d’année, CM2 et notes par classe.'],
  ]],
  ['04_Absences et demandes d\'autorisation', [
    [aller('absences-appel'), 'Absences › Appel du jour : cochez les absents de chaque classe puis validez l’appel.'],
    [aller('absences-autorisations'), 'Absences › Autorisations : les demandes des élèves et du personnel, en attente, accordées ou refusées.'],
    ["acts.addAuth({dataset:{}})", 'Nouvelle demande : la personne, les dates et le motif. Les jours de classe sont comptés sans week-ends ni jours fériés.'],
  ]],
  ['05_Fin d\'année et passage', [
    [aller('notes-fin'), 'Notes & bulletins › Fin d’année : décisions proposées par classe (admis, redoublants) à partir de la moyenne annuelle.'],
    ["document.querySelector('main')?.scrollTo(0,400)", 'Corrigez une décision si besoin, validez chaque classe, puis passez à l’année suivante ; l’année terminée reste consultable.'],
  ]],
  ['06_Sauvegarder ses données', [
    [aller('admin-donnees'), 'Rapports & administration › Import, export & sauvegarde : « Sauvegarder » crée une copie complète de toutes les données.'],
    ["document.querySelector('[data-ch=impFile]')?.scrollIntoView({block:'center'})", 'Import des élèves depuis Excel (colonnes de l’export national) avec aperçu ligne par ligne ; exports vers Excel.'],
  ]],
  ['07_Comptes des enseignants', [
    [aller('eleves-enseignants'), 'Élèves & personnel › Enseignants : le directeur crée le compte de chaque enseignant, limité à sa classe.'],
    ["ui.ensTab='validation';render()", 'Validation des notes : les notes saisies par un enseignant attendent l’accord du directeur ; la période de saisie s’ouvre et se ferme par classe.'],
    ["ui.ensTab='messages';render()", 'Messages : notes de service à tous les enseignants ou à un seul, avec accusé de lecture.'],
  ]],
];

(async () => {
  fs.mkdirSync(SORTIE, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'akwa_tuto_'));
  const nav = await chromium.launch({ args: ['--lang=fr-FR'] });
  try {
    for (const [nom, etapes] of TUTORIELS) {
      const ctx = await nav.newContext({ viewport: { width: L, height: H }, locale: 'fr-FR' });
      const p = await ctx.newPage();
      const html = path.join(tmp, 'cadre.html');
      fs.writeFileSync(html, cadre(nom.replace(/^\d+_/, '')));
      await p.goto('file://' + html);
      const f = () => p.frame({ url: /akwa_v8\.html/ });
      await f().evaluate(() => { localStorage.clear(); });
      await f().evaluate(() => location.reload());
      await p.waitForTimeout(700);
      await f().evaluate(() => {   // pas d'impression ni de profil de démonstration à l'écran
        window.print = () => {};
        document.head.insertAdjacentHTML('beforeend', '<style>label:has([data-ch=profil]){display:none!important}</style>');
      });
      const images = [];
      for (const [i, [js, legende]] of etapes.entries()) {
        await f().evaluate(js);
        await p.evaluate((t) => { document.getElementById('l').textContent = t; }, legende);
        await p.waitForTimeout(450);
        const img = path.join(tmp, `${nom}_${i}.png`.replace(/[^\w.-]/g, '_'));
        await p.screenshot({ path: img });
        images.push(img);
      }
      const liste = path.join(tmp, 'liste.txt');
      fs.writeFileSync(liste, images.flatMap((x) => [`file '${x}'`, `duration ${DUREE}`]).concat(`file '${images.at(-1)}'`).join('\n'));
      const mp4 = path.join(SORTIE, nom + '.mp4');
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', liste, '-vf', 'fps=25,format=yuv420p',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '28', '-movflags', '+faststart', mp4]);
      console.log('Vidéo :', mp4);
      await ctx.close();
    }
  } finally {
    await nav.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
