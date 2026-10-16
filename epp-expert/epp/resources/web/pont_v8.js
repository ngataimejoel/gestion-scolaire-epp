/* Pont entre l'interface v8 et l'application AKWA SCHOOL v8 (Python, QWebChannel).
   Chargé dans <head>, avant le code de l'interface : window.APP_DATA est fourni par l'application. */
(function(){
 const D=window.APP_DATA||{};let py=null;const attente=[];
 function pret(f){py?f():attente.push(f)}
 function appel(nom,...args){return new Promise(res=>pret(()=>py[nom](...args,res)))}
 new QWebChannel(qt.webChannelTransport,ch=>{py=ch.objects.pont;attente.splice(0).forEach(f=>f())});
 const secrets=o=>{const c=JSON.parse(JSON.stringify(o));delete c.school.adminPwd;delete c.school.secours;delete c.session;return c};
 let minuterie=null;
 const APP=window.APP={
  appel,
  charger(){
   let o=D.etat;
   if(!o)o={v:5,school:{...ECOLE,idLock:false},students:[],teachers:[],grades:{},compAbs:{},att:{},appel:{},auth:[],conges:[],
    redac:{},persoReps:[],archives:{},lastBackup:'',log:[],messages:[],attente:{},saisie:{}};
   else o=migrate(o);
   o.messages=o.messages||[];o.teachers.forEach(t=>{if(t.compte===undefined)t.compte=null});
   o.school.adminPwd='';o.school.secours='—';o.school.licence=D.licence||o.school.licence;
   o.session=D.session&&D.session.role==='ens'?{role:'ens',tid:D.session.tid}:{role:'dir'};
   return o;
  },
  etatJSON(){return JSON.stringify(secrets(S))},
  enregistrer(){clearTimeout(minuterie);minuterie=null;return appel('enregistrer',APP.etatJSON()).then(err=>{if(err)toast(err)})},
  verifierAdmin(p){return appel('verifierAdmin',p)},
  nomSession(){return (D.session&&D.session.nom)||'Directeur (administrateur)'},
  bandeau(){$('#crumb').insertAdjacentHTML('beforeend',`<span class="sp"></span><span class="sub" style="margin-left:auto;display:flex;gap:8px;align-items:center">${ic('users')}${esc(APP.nomSession())}<button class="btn sm" data-act="deconnexion">Déconnexion</button></span>`)}
 };
 const json=t=>{try{return JSON.parse(t)}catch(e){return {erreur:'Réponse illisible de l’application.'}}};
 function loginDe(nom){const p=nom.replace(/^(M\.|Mme|Mlle)\s+/,'').split(/\s+/);return ((p[1]||'')[0]||'').toLowerCase()+(p[0]||'').toLowerCase().normalize('NFD').replace(/[^a-z]/g,'')}
 function montrerCode(code){modal(`${ic('key')} Code de secours`,`<p>Il permet de choisir un nouveau mot de passe en cas d’oubli, sans Internet. Notez-le et rangez-le en lieu sûr ; il ne sert qu’une fois.</p><p style="font-size:22px;font-weight:700;letter-spacing:2px;text-align:center">${esc(code)}</p>`,{noFoot:true})}

 document.addEventListener('DOMContentLoaded',()=>{
  // enregistrement par l'application (regroupé : une écriture au plus toutes les 0,4 s)
  save=function(){clearTimeout(minuterie);minuterie=setTimeout(APP.enregistrer,400)};
  // fichiers : l'application demande où les enregistrer
  download=function(nom,texte,type='text/plain'){appel('telecharger',nom,String(texte),type).then(p=>{if(p)toast('Enregistré : '+p)})};
  // impression : aperçu de l'application (orientation du document demandée par la page)
  window.print=function(){const a=$('#printArea');appel('imprimer',!!(a&&/landscape/.test(a.innerHTML)))};
  Object.assign(acts,{
   deconnexion(){APP.enregistrer().then(()=>appel('deconnexion'))},
   secoursNew(){askPwd('Créer un nouveau code de secours ? L’ancien ne servira plus.').then(ok=>{if(ok)appel('nouveauSecours').then(r=>{r=json(r);r.erreur?toast(r.erreur):montrerCode(r.code)})})},
   pwdOubli(){closeDlg();setTimeout(()=>modal(`${ic('key')} Mot de passe oublié`,`<p class="sub" style="margin-top:0">Saisissez le code de secours (remis à la création du compte, ou dans Paramètres), puis le nouveau mot de passe.</p>${field('Code de secours','<input name="code" autofocus autocomplete="off" placeholder="XXXX-XXXX-XXXX">',1)}${field('Nouveau mot de passe','<input name="nw" type="password" required minlength="6">',1)}`,
    {ok:'Valider',onok:f=>{appel('recupererAdmin',f.get('code'),f.get('nw')).then(r=>{r=json(r);if(r.erreur)return toast(r.erreur);closeDlg();log('Mot de passe administrateur changé avec le code de secours');setTimeout(()=>montrerCode(r.code),50)});return false}}),30)},
   ensCreer(t){const m=S.teachers.find(x=>x.id===t.dataset.id);
    modal('Créer le compte de '+esc(m.nom),field('Identifiant',`<input name="login" value="${esc(loginDe(m.nom))}" required autofocus>`)+'<p class="sub">Un mot de passe provisoire sera affiché. L’enseignant le changera à sa première connexion et recevra son code de secours.</p>',
     {ok:'Créer',onok:f=>{const l=f.get('login').trim();appel('creerCompte',m.id,l).then(r=>{r=json(r);if(r.erreur)return toast(r.erreur);closeDlg();m.compte={login:l,actif:true,cree:today};log(`Compte enseignant créé : ${l} (${m.classe})`);save();render();
      setTimeout(()=>modal('Compte créé',`<p>Identifiant : <b>${esc(l)}</b><br>Mot de passe provisoire : <b>${esc(r.mdp)}</b></p><p class="sub">Notez-le et remettez-le à ${esc(m.nom)}.</p>`,{noFoot:true}),50)});return false}})},
   ensReinit(t){const m=S.teachers.find(x=>x.id===t.dataset.id);appel('reinitCompte',m.id).then(r=>{r=json(r);if(r.erreur)return toast(r.erreur);modal('Mot de passe provisoire',`<p>Nouveau mot de passe provisoire de <b>${esc(m.nom)}</b> : <b>${esc(r.mdp)}</b></p>`,{noFoot:true});log(`Mot de passe réinitialisé : ${m.compte.login}`)})}
  });
  // formulaires traités par l'application : mot de passe administrateur, activation de la licence
  document.addEventListener('submit',e=>{const f=e.target;if(!['pwdForm','actForm'].includes(f.id))return;
   e.preventDefault();e.stopImmediatePropagation();const d=new FormData(f);
   if(f.id==='pwdForm')appel('changerAdmin',d.get('old'),d.get('nw')).then(err=>{if(err)return toast(err);log('Mot de passe administrateur changé');toast('Mot de passe changé');f.reset()});
   if(f.id==='actForm'){toast('Activation en cours…');appel('activer',d.get('code').trim()).then(r=>{r=json(r);if(r.erreur)return toast(r.erreur);S.school.licence=r.licence;log('Activation : '+r.message);save();toast(r.message);applyTheme();render()})}
  },true);
  // les données enregistrées viennent d'être complétées par l'interface (première ouverture, migration)
  save();
 });
})();
