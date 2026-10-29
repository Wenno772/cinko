import { createClient } from './supabase.js';

const SB_URL = 'https://gzvvvaqbfyuyruiqcmhg.supabase.co';
const SB_KEY = 'sb_publishable_Vw5cvEV0Lrus6jKUXpC70g_J7stN3XG'; // clé publique, faite pour être visible
const sb = createClient(SB_URL, SB_KEY);

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

const POS = ['GB', 'DEF', 'MIL', 'ALI', 'ATT'];
const POSN = { GB: 'Gardien', DEF: 'Défenseur', MIL: 'Milieu', ALI: 'Ailier', ATT: 'Attaquant' };
const POSD = {
  GB: 'Tu aimes les gants. Ton équipe peut te mettre au but fixe.',
  DEF: 'Tu fermes les espaces et tu relances.',
  MIL: 'Tu relies tout le monde et tu fais tourner le jeu.',
  ALI: 'Tu files sur les côtés et tu centres.',
  ATT: 'Tu finis les actions devant le but.'
};
const STATK = ['VIT', 'TIR', 'PAS', 'DRI', 'DEF', 'ESP'];
const STATL = { VIT: 'VIT', TIR: 'TIR', PAS: 'PAS', DRI: 'DRI', DEF: 'DÉF', ESP: 'ESP' };
const TAGS = [
  { k: 'Buteur', s: 'TIR' }, { k: 'Passeur', s: 'PAS' }, { k: 'Mur', s: 'DEF' },
  { k: 'Pétard', s: 'VIT' }, { k: 'Magicien', s: 'DRI' }, { k: 'Bon esprit', s: 'ESP' }
];
const TIERS = [{ k: 'cuivre', n: 'Cuivre', min: 60 }, { k: 'argent', n: 'Argent', min: 65 }, { k: 'or', n: 'Or', min: 75 }, { k: 'legende', n: 'Légende', min: 85 }];
const tier = (o) => (o >= 85 ? TIERS[3] : o >= 75 ? TIERS[2] : o >= 65 ? TIERS[1] : TIERS[0]);
const OFF = {
  ATT: { VIT: 5, TIR: 12, PAS: -4, DRI: 6, DEF: -18, ESP: -1 }, MIL: { VIT: -2, TIR: -2, PAS: 10, DRI: 6, DEF: -8, ESP: -4 },
  DEF: { VIT: -4, TIR: -12, PAS: 0, DRI: -6, DEF: 16, ESP: 6 }, ALI: { VIT: 12, TIR: 2, PAS: 0, DRI: 8, DEF: -20, ESP: -2 },
  GB: { VIT: -8, TIR: -14, PAS: -1, DRI: -6, DEF: 14, ESP: 15 }
};
// Même formule que la base (aperçu seulement : les vraies stats sont calculées par le serveur).
function statsFor(pos, tags) {
  const st = {};
  STATK.forEach((k) => {
    const up = tags.some((t) => TAGS.find((x) => x.k === t).s === k);
    st[k] = 60 + Math.floor(OFF[pos][k] / 2 + 0.5) - 2 + (up ? 6 : 0);
  });
  return st;
}
const initials = (n) => {
  const w = String(n).trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  return (w.length > 1 ? w[0][0] + w[w.length - 1][0] : w[0].slice(0, 2)).toUpperCase().replace('.', '');
};
const pressed = (v) => ` aria-pressed="${v ? 'true' : 'false'}"`;

/* ---------- carte ---------- */
function cardHTML(p, mini, extra) {
  const t = tier(p.ovr);
  const stats = mini ? '' :
    '<div class="c-stats">' + STATK.map((k) => `<div class="c-stat">${p.stats[k]}<small>${STATL[k]}</small></div>`).join('') + '</div>' +
    `<div class="c-foot">${esc(p.teamLabel || 'Joueur libre')} · Cinko</div>`;
  const shown = mini ? p.name.split(' ')[0] : p.name;
  return `<div class="card-wrap ${mini ? 'mini' : 'full'}${extra ? ' ' + extra : ''}">` +
    `<div class="card t-${t.k}" role="img" aria-label="Carte de ${esc(p.name)}, note ${p.ovr}, ${t.n}, ${POSN[p.pos]}">` +
    '<div class="shape"><div class="inner"><svg class="frame" viewBox="0 0 100 140" preserveAspectRatio="none" aria-hidden="true"><polygon points="3,3 91.2,3 97,8.8 97,137 8.8,137 3,131.2"/></svg>' +
    `<div class="c-top"><div class="c-left"><div class="c-ovr">${p.ovr}</div><div class="c-pos">${p.pos}</div><div class="c-pips" aria-hidden="true">${new Array(TIERS.indexOf(t) + 2).join('<i></i>')}</div></div>` +
    (p.photo_url ? `<div class="c-photo"><img src="${p.photo_url}" alt=""></div>` : `<div class="c-init" aria-hidden="true">${esc(initials(p.name))}</div>`) + '</div>' +
    `<div class="c-name">${esc(shown)}</div>${stats}</div></div></div></div>`;
}

/* ---------- état ---------- */
const S = {
  ready: false, session: null, profile: null, team: null, members: [],
  authMode: 'login', msg: '', busy: false,
  onb: { step: 0, name: '', pos: 'MIL', rotate: true, tags: [], photo: '' },
  teamMode: 'create', teamMsg: ''
};
const draftCard = () => ({
  name: S.onb.name.trim() || 'Ton nom', pos: S.onb.pos, ovr: 60, stats: statsFor(S.onb.pos, S.onb.tags), photo_url: S.onb.photo, teamLabel: 'Nouvelle carte'
});
const myCard = () => ({ ...S.profile, teamLabel: S.team ? S.team.name : 'Joueur libre' });

function tr(err) {
  const m = (err && err.message) || String(err || '');
  if (/Invalid login credentials/i.test(m)) return 'E-mail ou mot de passe incorrect.';
  if (/already registered|already been registered/i.test(m)) return 'Ce compte existe déjà : connecte-toi.';
  if (/at least \d+ characters|weak/i.test(m)) return 'Mot de passe trop court (6 caractères minimum).';
  if (/valid email|invalid format|Unable to validate email/i.test(m)) return 'Adresse e-mail invalide.';
  if (/rate limit|too many/i.test(m)) return 'Trop de tentatives. Réessaie dans quelques minutes.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Pas de connexion. Réessaie.';
  return m || 'Une erreur est survenue.';
}

/* ---------- données ---------- */
async function loadProfile() {
  const uid = S.session.user.id;
  const { data, error } = await sb.from('profiles').select('*').eq('id', uid).maybeSingle();
  if (error) throw error;
  S.profile = data;
  S.team = null; S.members = [];
  if (data && data.team_id) {
    const t = await sb.from('teams').select('*').eq('id', data.team_id).maybeSingle();
    if (t.error) throw t.error;
    S.team = t.data;
    const m = await sb.from('profiles').select('*').eq('team_id', data.team_id).order('ovr', { ascending: false });
    if (m.error) throw m.error;
    S.members = m.data || [];
  }
}
async function afterSession() {
  try { await loadProfile(); S.msg = ''; } catch (e) { S.msg = tr(e); }
  S.ready = true; render(true);
}

/* ---------- vues ---------- */
function viewAuth() {
  const login = S.authMode === 'login';
  return `<div><p class="kicker">Ta carte se gagne sur le terrain.</p><h1 class="screen-title">${login ? 'Connexion' : 'Crée ton compte'}</h1><p class="lede">${login ? 'Retrouve ta carte et ton équipe.' : 'Ta carte démarre à 60 et évolue match après match.'}</p></div>` +
    '<form id="authForm" class="panel" autocomplete="on">' +
    '<label class="field" style="margin-top:0"><span>E-mail</span><input id="email" type="email" inputmode="email" autocomplete="email" autocapitalize="none" required></label>' +
    `<label class="field"><span>Mot de passe</span><input id="password" type="password" autocomplete="${login ? 'current-password' : 'new-password'}" minlength="6" required></label>` +
    `<p class="msg ${S.msg ? 'err' : ''}" role="alert">${esc(S.msg)}</p>` +
    `<button type="submit" class="btn block" ${S.busy ? 'disabled' : ''}>${login ? 'Me connecter' : 'Créer mon compte'}</button>` +
    `<button type="button" class="linkbtn" data-act="authmode" style="margin-top:10px">${login ? 'Pas encore de compte ? Créer un compte' : 'Déjà un compte ? Me connecter'}</button></form>`;
}

function photoCtl(has, target) {
  return '<div class="photoctl"><span>Photo (facultatif)</span><div class="row2"><label class="btn sm ghost filebtn">' + (has ? 'Changer la photo' : 'Ajouter une photo') +
    `<input type="file" accept="image/*" data-photo="${target}" aria-label="Choisir une photo"></label>` +
    (has ? `<button type="button" class="btn sm ghost" data-act="photo-del" data-t="${target}">Retirer</button>` : '') + '</div></div>';
}

function viewOnb() {
  const o = S.onb, s = o.step;
  const stepsBar = '<div class="onb-top"><div class="steps" role="img" aria-label="Étape ' + (s + 1) + ' sur 4">' + [0, 1, 2, 3].map((i) => `<i${i <= s ? ' class="on"' : ''}></i>`).join('') + '</div><button type="button" class="linkbtn" data-act="logout">Quitter</button></div>';
  if (s === 3) {
    return stepsBar + '<div><p class="kicker">Ta carte est prête</p><h1 class="screen-title">Bienvenue</h1></div>' +
      `<div class="reveal">${cardHTML(draftCard())}</div>` +
      '<section class="panel"><div class="kicker">Comment monter</div><ol class="how"><li><span>1</span>Joue un match, avec ou sans équipe.</li><li><span>2</span>Les joueurs de ton camp te notent de 1 à 10 après le match.</li><li><span>3</span>Ta carte évolue : Cuivre, Argent, Or, puis Légende.</li></ol><p class="muted small">Tout le monde démarre à 60. Tes points forts donnent la forme de ta carte, pas son niveau.</p></section>' +
      `<p class="msg ${S.msg ? 'err' : ''}" role="alert">${esc(S.msg)}</p>` +
      `<div class="actions"><button type="button" class="btn ghost" data-act="onb-back">Modifier</button><button type="button" class="btn" data-act="onb-finish" ${S.busy ? 'disabled' : ''}>Créer ma carte</button></div>`;
  }
  const titles = ['Nom et photo', 'Ton poste', 'Tes points forts'];
  const ledes = ['Le nom s’affiche sur ta carte, comme sur un maillot. La photo est facultative.', 'Au five, tout le monde tourne souvent au but. Le poste sert surtout à composer l’équipe.', 'Choisis-en 2. Tout le monde démarre à 60 : ça donne la forme de ta carte, pas son niveau.'];
  let body;
  if (s === 0) body = `<label class="field" style="margin-top:0"><span>Nom sur la carte</span><input id="onbName" type="text" maxlength="14" placeholder="Prénom + initiale" value="${esc(o.name)}" autocomplete="off"></label><p class="muted small">14 caractères maximum. Ta carte est visible des autres joueurs.</p>` + photoCtl(!!o.photo, 'onb');
  else if (s === 1) body = '<div class="opts">' + POS.map((p) => `<button type="button" class="opt" data-act="onb-pos" data-v="${p}"${pressed(o.pos === p)}><span class="code">${p}</span><span><b>${POSN[p]}</b><small>${POSD[p]}</small></span></button>`).join('') + `</div><label class="check"><input id="onbRotate" type="checkbox"${o.rotate ? ' checked' : ''}><span>OK pour tourner au but avec les autres</span></label>`;
  else body = '<div class="optgrid">' + TAGS.map((t) => `<button type="button" class="opt" data-act="onb-tag" data-t="${t.k}"${pressed(o.tags.includes(t.k))}><span><b>${t.k}</b><small>Stat ${STATL[t.s]} en plus</small></span></button>`).join('') + `</div><p class="muted small">${o.tags.length} sur 2 choisis.</p>`;
  const valid = s === 0 ? o.name.trim().length >= 2 : s === 2 ? o.tags.length === 2 : true;
  return stepsBar + `<div><p class="kicker">Étape ${s + 1} sur 4</p><h1 class="screen-title" style="margin-bottom:8px">${titles[s]}</h1><p class="lede">${ledes[s]}</p></div>` +
    `<div class="onb-card"><div id="previewSlot">${cardHTML(draftCard(), false, 'preview')}</div></div><section class="panel">${body}</section>` +
    `<div class="actions${s > 0 ? '' : ' solo'}">${s > 0 ? '<button type="button" class="btn ghost" data-act="onb-back">Retour</button>' : ''}<button type="button" id="onbNext" class="btn" data-act="onb-next" ${valid ? '' : 'disabled'}>Continuer</button></div>`;
}

function viewCarte() {
  const p = S.profile, t = tier(p.ovr), nx = TIERS[TIERS.indexOf(t) + 1];
  const pct = nx ? Math.round(((p.ovr - t.min) / (nx.min - t.min)) * 100) : 100;
  const left = nx ? nx.min - p.ovr : 0;
  return `<div><p class="kicker">${S.team ? esc(S.team.name) : 'Joueur libre'} · ${POSN[p.pos]}</p><h1 class="screen-title">Ma carte</h1></div>` +
    `<div id="cardSlot">${cardHTML(myCard())}</div>` +
    `<section class="panel tierbar"><div class="tb-top"><b>${t.n}</b><span>${nx ? nx.n + ' à ' + nx.min : 'Niveau maximum'}</span></div>` +
    `<div class="prog" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>` +
    `<p class="muted small">${nx ? `Plus que ${left} point${left > 1 ? 's' : ''} pour passer ${nx.n}.` : 'Tu es au sommet.'} ${p.matches} match${p.matches > 1 ? 's' : ''} joué${p.matches > 1 ? 's' : ''}.</p></section>` +
    '<section class="panel"><div class="kicker">Tes notes</div><p class="muted" style="margin:0">Aucune note pour l’instant. Après ton premier match, les joueurs de ton camp te notent et ta carte évolue. Cette partie arrive très bientôt.</p></section>' +
    '<section class="panel"><div class="kicker">Ton profil</div>' +
    `<label class="field"><span>Nom sur la carte</span><input id="nameInput" type="text" maxlength="14" value="${esc(p.name)}" autocomplete="off"></label>` +
    '<div class="field"><span id="posLbl">Poste préféré</span><div class="seg" role="group" aria-labelledby="posLbl">' + POS.map((x) => `<button type="button" data-act="pos" data-v="${x}"${pressed(p.pos === x)}>${x}</button>`).join('') + '</div></div>' +
    `<label class="check"><input id="rotateChk" type="checkbox"${p.rotate ? ' checked' : ''}><span>OK pour tourner au but</span></label>` +
    photoCtl(!!p.photo_url, 'me') +
    '<p class="muted small">Ta carte et tes notes sont publiques : tous les joueurs les voient.</p>' +
    `<p class="msg ${S.msg ? 'err' : ''}" role="alert">${esc(S.msg)}</p></section>` +
    `<p class="muted small">Connecté : ${esc(S.session.user.email)}</p>`;
}

function viewEquipe() {
  if (S.team) {
    const t = S.team, n = S.members.length;
    return `<div><p class="kicker">Équipe de 5${t.city ? ' · ' + esc(t.city) : ''}</p><h1 class="screen-title">${esc(t.name)}</h1></div>` +
      `<section class="teamhead"><div class="bignum"><span>${t.elo}</span><small>Niveau d’équipe</small></div><div class="rec"><div class="line"><span><b>${n}</b>joueur${n > 1 ? 's' : ''}</span></div><small>${t.matches} match${t.matches > 1 ? 's' : ''} joué${t.matches > 1 ? 's' : ''}</small></div></section>` +
      `<section class="panel"><div class="kicker">Code d’invitation</div><div class="codebox" style="margin-top:0"><code>${esc(t.code)}</code><button type="button" class="btn sm ghost" data-act="copy-code">Copier</button></div><p class="muted small">Envoie ce code à tes coéquipiers : ils le saisissent dans l’onglet Équipe pour te rejoindre (8 joueurs maximum).</p></section>` +
      '<section><div class="kicker">Effectif</div><div class="roster">' + S.members.map((m) => cardHTML({ ...m, teamLabel: t.name }, true)).join('') + '</div></section>';
  }
  const create = S.teamMode === 'create';
  return '<div><p class="kicker">Facultatif</p><h1 class="screen-title">Équipe</h1><p class="lede">Tu peux jouer sans équipe. Une équipe te donne en plus un classement à plusieurs et des défis.</p></div>' +
    '<section class="panel"><div class="seg" role="group" aria-label="Rejoindre ou créer"><button type="button" data-act="teammode" data-v="create"' + pressed(create) + '>Créer l’équipe</button><button type="button" data-act="teammode" data-v="join"' + pressed(!create) + '>J’ai un code</button></div>' +
    (create
      ? '<label class="field"><span>Nom de l’équipe</span><input id="teamName" type="text" maxlength="20" placeholder="Les Cages FC" autocomplete="off"></label><label class="field"><span>Ville (facultatif)</span><input id="teamCity" type="text" maxlength="30" placeholder="Bussy-Saint-Georges" autocomplete="off"></label>'
      : '<label class="field"><span>Code d’invitation</span><input id="teamCode" type="text" maxlength="10" autocomplete="off" autocapitalize="characters"></label>') +
    `<p class="msg ${S.teamMsg ? 'err' : ''}" role="alert">${esc(S.teamMsg)}</p>` +
    `<button type="button" class="btn block" data-act="${create ? 'team-create' : 'team-join'}" ${S.busy ? 'disabled' : ''}>${create ? 'Créer l’équipe' : 'Rejoindre'}</button></section>`;
}

const tabNow = () => (location.hash === '#equipe' ? 'equipe' : 'carte');

function render(top) {
  const y = window.scrollY, view = $('#view');
  const authed = !!S.session, hasProfile = !!S.profile;
  document.body.classList.toggle('onb', !authed || !hasProfile);
  $('#nav').hidden = !(authed && hasProfile);
  $('#hright').innerHTML = authed && hasProfile ? '<button type="button" class="linkbtn" data-act="logout">Déconnexion</button>' : '';
  if (!S.ready) view.innerHTML = '<p class="muted" style="text-align:center;margin-top:60px">Chargement…</p>';
  else if (!authed) view.innerHTML = viewAuth();
  else if (!hasProfile) view.innerHTML = viewOnb();
  else view.innerHTML = tabNow() === 'equipe' ? viewEquipe() : viewCarte();
  document.querySelectorAll('.tab').forEach((a) => (a.dataset.tab === tabNow() ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  window.scrollTo(0, top ? 0 : y);
}

let tt;
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 2800); }

/* ---------- photo ---------- */
function handlePhoto(inp) {
  const f = inp.files && inp.files[0], target = inp.dataset.photo;
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    const im = new Image();
    im.onload = async () => {
      try {
        const W = 360, H = 450, c = document.createElement('canvas'); c.width = W; c.height = H;
        const x = c.getContext('2d'), s = Math.max(W / im.width, H / im.height);
        x.drawImage(im, (W - im.width * s) / 2, 0, im.width * s, im.height * s);
        const url = c.toDataURL('image/jpeg', 0.8);
        if (target === 'onb') { S.onb.photo = url; render(); }
        else await saveProfile({ photo_url: url });
      } catch (e) { toast('Photo illisible, essaie une autre image'); }
    };
    im.onerror = () => toast('Photo illisible, essaie une autre image');
    im.src = rd.result;
  };
  rd.readAsDataURL(f);
}

async function saveProfile(patch) {
  S.msg = '';
  const { error } = await sb.from('profiles').update(patch).eq('id', S.session.user.id);
  if (error) { S.msg = tr(error); render(); return; }
  Object.assign(S.profile, patch);
  render();
}

/* ---------- événements ---------- */
document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'authForm') return;
  e.preventDefault();
  if (S.busy) return;
  const email = $('#email').value.trim(), password = $('#password').value;
  S.busy = true; S.msg = ''; render();
  try {
    if (S.authMode === 'login') {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } else {
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) throw error;
      if (!data.session) S.msg = 'Compte créé. Si Supabase demande une confirmation, vérifie ta boîte mail, puis connecte-toi.';
    }
  } catch (err) { S.msg = tr(err); }
  S.busy = false; render();
});

document.addEventListener('click', async (e) => {
  const b = e.target.closest && e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const a = b.dataset.act, o = S.onb;
  if (a === 'authmode') { S.authMode = S.authMode === 'login' ? 'signup' : 'login'; S.msg = ''; render(); }
  else if (a === 'logout') { await sb.auth.signOut(); }
  else if (a === 'onb-pos') { o.pos = b.dataset.v; render(); }
  else if (a === 'onb-tag') { const i = o.tags.indexOf(b.dataset.t); if (i > -1) o.tags.splice(i, 1); else { o.tags.push(b.dataset.t); if (o.tags.length > 2) o.tags.shift(); } render(); }
  else if (a === 'onb-next') { o.step++; S.msg = ''; render(true); }
  else if (a === 'onb-back') { o.step = Math.max(0, o.step - (o.step === 3 ? 3 : 1)); S.msg = ''; render(true); }
  else if (a === 'onb-finish') {
    S.busy = true; S.msg = ''; render();
    const { error } = await sb.from('profiles').insert({ id: S.session.user.id, name: o.name.trim(), pos: o.pos, rotate: o.rotate, tags: o.tags, photo_url: o.photo || null });
    if (error && error.code !== '23505') { S.msg = tr(error); S.busy = false; render(); return; }
    try { await loadProfile(); } catch (err) { S.msg = tr(err); }
    S.busy = false; S.onb = { step: 0, name: '', pos: 'MIL', rotate: true, tags: [], photo: '' };
    location.hash = '#carte'; render(true); toast('Bienvenue dans la ligue');
  }
  else if (a === 'pos') { await saveProfile({ pos: b.dataset.v }); }
  else if (a === 'photo-del') { if (b.dataset.t === 'me') await saveProfile({ photo_url: null }); else { S.onb.photo = ''; render(); } }
  else if (a === 'teammode') { S.teamMode = b.dataset.v; S.teamMsg = ''; render(); }
  else if (a === 'team-create' || a === 'team-join') {
    S.teamMsg = ''; S.busy = true;
    const create = a === 'team-create';
    const name = create ? $('#teamName').value.trim() : '', city = create ? $('#teamCity').value.trim() : '', code = create ? '' : $('#teamCode').value.trim();
    if (create && name.length < 2) { S.teamMsg = 'Donne un nom à ton équipe (2 caractères minimum).'; S.busy = false; render(); return; }
    if (!create && code.length < 3) { S.teamMsg = 'Saisis le code reçu de ton capitaine.'; S.busy = false; render(); return; }
    render();
    const { error } = create ? await sb.rpc('create_team', { p_name: name, p_city: city || null }) : await sb.rpc('join_team', { p_code: code });
    S.busy = false;
    if (error) { S.teamMsg = tr(error); render(); return; }
    try { await loadProfile(); } catch (err) { S.teamMsg = tr(err); }
    render(true); toast(create ? 'Équipe créée' : 'Bienvenue dans l’équipe');
  }
  else if (a === 'copy-code') {
    const c = S.team.code;
    try { await navigator.clipboard.writeText(c); toast('Code copié : ' + c); } catch (err) { toast('Code : ' + c); }
  }
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'onbName') { S.onb.name = t.value; const p = $('#previewSlot'); if (p) p.innerHTML = cardHTML(draftCard(), false, 'preview'); const n = $('#onbNext'); if (n) n.disabled = S.onb.name.trim().length < 2; }
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset && t.dataset.photo) { handlePhoto(t); return; }
  if (t.id === 'onbRotate') S.onb.rotate = t.checked;
  else if (t.id === 'rotateChk') await saveProfile({ rotate: t.checked });
  else if (t.id === 'nameInput') {
    const v = t.value.trim();
    if (v.length < 2) { S.msg = 'Le nom doit faire au moins 2 caractères.'; render(); return; }
    await saveProfile({ name: v });
  }
});

window.addEventListener('hashchange', () => render(true));

sb.auth.onAuthStateChange((evt, session) => {
  if (evt === 'INITIAL_SESSION') return;
  const same = session && S.session && session.user.id === S.session.user.id;
  S.session = session;
  if (same && S.profile) return;
  setTimeout(() => {
    if (session) afterSession();
    else { S.profile = null; S.team = null; S.members = []; S.onb = { step: 0, name: '', pos: 'MIL', rotate: true, tags: [], photo: '' }; S.msg = ''; render(true); }
  }, 0);
});

(async function boot() {
  render(true);
  try {
    const { data } = await sb.auth.getSession();
    S.session = data.session;
    if (S.session) await afterSession(); else { S.ready = true; render(true); }
  } catch (e) { S.ready = true; S.msg = tr(e); render(true); }
})();
