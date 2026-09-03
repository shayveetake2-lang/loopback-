import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const grid = document.querySelector('#contact-grid');
const drawer = document.querySelector('#drawer');
const drawerContent = document.querySelector('#drawer-content');
const tierDefaults = {
  'Inner Loop': { cadence_days: 14, weight: 1.5 },
  'Mid Loop': { cadence_days: 60, weight: 1.0 },
  'Outer Loop': { cadence_days: 120, weight: 0.5 },
};

let contacts = [];
let session = JSON.parse(localStorage.getItem('loopback-session') || 'null');

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));

const initials = (name) => name.split(' ').map((part) => part[0]).join('').slice(0, 2);
const tone = (tier) =>
  tier === 'Inner Loop'
    ? 'text-fuchsia-300 bg-fuchsia-400/10 border-fuchsia-400/20'
    : tier === 'Mid Loop'
      ? 'text-violet-200 bg-violet-400/10 border-violet-400/20'
      : 'text-slate-300 bg-white/5 border-white/10';

const sampleContacts = [
  {
    id: 'maya-chen',
    name: 'Maya Chen',
    avatar_url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=160&h=160&fit=crop',
    last_interaction_date: '2026-08-29',
    last_topic: 'Discussed moving to Austin',
    relationship_tier: 'Inner Loop',
    custom_cadence_days: 14,
    role: 'Creative Director',
    company: 'Arc Studio',
    location: 'Brooklyn, NY',
    interactions: [
      { date: '2026-08-29', type: 'Dinner', note: 'Discussed moving to Austin and a tiny natural wine bar in Alfama.' },
    ],
    deals: ['Lisbon residency intro', 'Arc Studio portfolio review'],
  },
  {
    id: 'jon-bell',
    name: 'Jon Bell',
    avatar_url: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=160&h=160&fit=crop',
    last_interaction_date: '2026-07-20',
    last_topic: 'Talked about his new startup pitch',
    relationship_tier: 'Mid Loop',
    custom_cadence_days: 60,
    role: 'Founder',
    company: 'Northstar Labs',
    location: 'Austin, TX',
    interactions: [
      { date: '2026-07-20', type: 'Coffee', note: 'Talked about his new startup pitch and hiring the first PM.' },
    ],
    deals: ['Intro to Priya at Fieldwork', 'Northstar beta feedback'],
  },
  {
    id: 'alina-ross',
    name: 'Alina Ross',
    avatar_url: 'https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=160&h=160&fit=crop',
    last_interaction_date: '2026-07-20',
    last_topic: 'Met at TechX Conference',
    relationship_tier: 'Mid Loop',
    custom_cadence_days: 60,
    role: 'Product Lead',
    company: 'Polymath',
    location: 'London, UK',
    interactions: [
      { date: '2026-07-20', type: 'Conference', note: 'Met at TechX Conference after her talk on humane product rituals.' },
    ],
    deals: ['Product ritual roundtable'],
  },
  {
    id: 'samir-patel',
    name: 'Samir Patel',
    avatar_url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=160&h=160&fit=crop',
    last_interaction_date: '2026-05-26',
    last_topic: 'Shared his neighborhood mutual-aid project',
    relationship_tier: 'Outer Loop',
    custom_cadence_days: 120,
    role: 'Independent Operator',
    company: 'Independent',
    location: 'Chicago, IL',
    interactions: [
      { date: '2026-05-26', type: 'Lunch', note: 'Shared his neighborhood mutual-aid project and the bike trip he was planning.' },
    ],
    deals: ['Mutual-aid toolkit share'],
  },
];

function showNotice(message, kind = 'error') {
  const notice = document.querySelector('#app-notice');
  if (!notice) return;
  notice.textContent = message;
  notice.className = `fixed left-1/2 top-5 z-50 -translate-x-1/2 rounded-xl border px-4 py-3 text-xs font-bold shadow-xl ${kind === 'error' ? 'border-rose-400/30 bg-rose-950/90 text-rose-200' : 'border-emerald-400/30 bg-emerald-950/90 text-emerald-200'}`;
  clearTimeout(showNotice.timer);
  showNotice.timer = setTimeout(() => notice.classList.add('hidden'), 3500);
}

function driftFor(contact) {
  const lastDate = new Date(contact.last_interaction_date);
  const elapsed = Math.max(Math.floor((Date.now() - lastDate.getTime()) / 86400000), 0);
  const tier = tierDefaults[contact.relationship_tier] || tierDefaults['Mid Loop'];
  const cadence = contact.custom_cadence_days || tier.cadence_days;
  const score = Math.min(Math.round(((elapsed / cadence) * 100 * tier.weight) * 10) / 10, 100);
  return {
    ...contact,
    days_since_contact: elapsed,
    cadence_days: cadence,
    priority_weight: tier.weight,
    drift_score: score,
    is_overdue: elapsed >= cadence,
  };
}

async function ensureSeedData() {
  try {
    const snapshot = await getDocs(collection(db, 'contacts'));
    if (!snapshot.empty) return;
    const batch = writeBatch(db);
    sampleContacts.forEach((contact) => {
      const docRef = doc(collection(db, 'contacts'), contact.id);
      batch.set(docRef, contact);
    });
    await batch.commit();
  } catch (error) {
    console.error('Seed data error:', error);
  }
}

async function getUserProfile(uid) {
  const ref = doc(db, 'users', uid);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) {
    return { id: uid, name: 'User', email: '', role: 'member' };
  }
  return snapshot.data();
}

async function saveUserProfile(uid, name, email, role = 'member') {
  const profile = { id: uid, name, email, role, created_at: new Date().toISOString() };
  await setDoc(doc(db, 'users', uid), profile, { merge: true });
  return profile;
}

function authScreen() {
  if (document.querySelector('#auth-screen')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <div id="auth-screen" class="fixed inset-0 z-40 grid place-items-center bg-[#090712]/95 p-5 backdrop-blur-xl">
      <div class="glass w-full max-w-md rounded-3xl p-7 shadow-2xl shadow-violet-950/30">
        <div class="mb-8 flex items-center gap-3">
          <div class="grid h-12 w-12 place-items-center rounded-full border border-dashed border-fuchsia-400/70 font-display text-2xl font-bold text-fuchsia-300">L</div>
          <div>
            <div class="font-display text-xl font-bold">LoopBack<span class="text-fuchsia-400">.ai</span></div>
            <div class="text-[10px] uppercase tracking-[.2em] text-slate-500">your relationship orbit</div>
          </div>
        </div>
        <div class="mb-6 flex rounded-xl bg-white/5 p-1">
          <button data-auth-mode="login" class="auth-mode active flex-1 rounded-lg bg-violet-500/20 px-3 py-2 text-xs font-bold text-white">Sign in</button>
          <button data-auth-mode="register" class="auth-mode flex-1 rounded-lg px-3 py-2 text-xs font-bold text-slate-500">Create account</button>
        </div>
        <form id="auth-form" class="space-y-4">
          <label id="auth-name-wrap" class="hidden">
            <span class="mb-2 block text-[10px] font-bold uppercase tracking-widest text-slate-500">Name</span>
            <input id="auth-name" class="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none focus:border-fuchsia-400/60" autocomplete="name">
          </label>
          <label>
            <span class="mb-2 block text-[10px] font-bold uppercase tracking-widest text-slate-500">Email</span>
            <input id="auth-email" type="email" required class="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none focus:border-fuchsia-400/60" autocomplete="email">
          </label>
          <label>
            <span class="mb-2 block text-[10px] font-bold uppercase tracking-widest text-slate-500">Password</span>
            <input id="auth-password" type="password" minlength="8" required class="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none focus:border-fuchsia-400/60" autocomplete="current-password">
          </label>
          <p id="auth-error" class="hidden text-xs font-semibold text-rose-300"></p>
          <button type="submit" class="w-full rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-500 px-4 py-3 text-xs font-extrabold uppercase tracking-[.2em] text-white shadow-lg shadow-fuchsia-900/20">Continue</button>
        </form>
      </div>
    </div>
  `);

  let mode = 'login';
  const nameWrap = document.querySelector('#auth-name-wrap');
  document.querySelectorAll('[data-auth-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      mode = button.dataset.authMode;
      nameWrap.classList.toggle('hidden', mode !== 'register');
      document.querySelectorAll('.auth-mode').forEach((item) => {
        item.classList.remove('active', 'bg-violet-500/20', 'text-white');
        item.classList.add('text-slate-500');
      });
      button.classList.add('active', 'bg-violet-500/20', 'text-white');
      button.classList.remove('text-slate-500');
    });
  });

  document.querySelector('#auth-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = document.querySelector('#auth-email').value.trim();
    const password = document.querySelector('#auth-password').value;
    const name = document.querySelector('#auth-name')?.value.trim() || '';
    const errorBox = document.querySelector('#auth-error');

    try {
      let userCredential;
      if (mode === 'register') {
        userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const profile = await saveUserProfile(userCredential.user.uid, name, email, 'member');
        session = { token: userCredential.user.accessToken, user: profile };
      } else {
        userCredential = await signInWithEmailAndPassword(auth, email, password);
        const profile = await getUserProfile(userCredential.user.uid);
        session = { token: userCredential.user.accessToken, user: { ...profile, id: userCredential.user.uid } };
      }

      localStorage.setItem('loopback-session', JSON.stringify(session));
      document.querySelector('#auth-screen').remove();
      bootstrap();
    } catch (error) {
      errorBox.textContent = error.message || 'Unable to authenticate';
      errorBox.classList.remove('hidden');
    }
  });
}

function accountBar() {
  if (!session?.user) return;
  const header = document.querySelector('header');
  if (!header) return;
  const existing = document.querySelector('#account-bar');
  if (existing) existing.remove();

  header.insertAdjacentHTML('beforeend', `
    <div id="account-bar" class="absolute right-5 top-5 z-30 flex items-center gap-2 sm:right-8">
      <span class="hidden text-xs text-slate-400 sm:block">${esc(session.user.name)}</span>
      ${session.user.role === 'admin' ? '<button id="admin-button" class="rounded-xl border border-fuchsia-400/20 bg-fuchsia-400/10 px-3 py-2 text-[10px] font-bold text-fuchsia-200 hover:border-fuchsia-400/50">Admin panel</button>' : ''}
      <button id="logout" class="rounded-xl border border-white/10 px-3 py-2 text-[10px] font-bold text-slate-400 hover:text-white">Log out</button>
    </div>
  `);

  document.querySelector('#logout').addEventListener('click', async () => {
    await signOut(auth);
    localStorage.removeItem('loopback-session');
    session = null;
    location.reload();
  });

  document.querySelector('#admin-button')?.addEventListener('click', adminPanel);
}

function card(contact) {
  const urgency = contact.drift_score >= 100 ? 'Critical drift' : `${Math.round(contact.drift_score)}% drift`;
  return `
    <article class="card glass rounded-2xl p-5 hover:border-violet-400/40">
      <div class="flex items-start justify-between">
        <div class="flex items-center gap-3">
          <img class="h-12 w-12 rounded-full border-2 border-violet-400/30 object-cover" src="${esc(contact.avatar_url)}" alt="${esc(contact.name)}" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'">
          <span class="hidden h-12 w-12 place-items-center rounded-full bg-violet-500/20 font-display font-bold text-violet-200">${initials(contact.name)}</span>
          <div>
            <h3 class="font-display font-bold">${esc(contact.name)}</h3>
            <p class="mt-0.5 text-xs text-slate-500">${esc(contact.role)} · ${esc(contact.company)}</p>
          </div>
        </div>
        <span class="rounded-full border px-2.5 py-1 text-[10px] font-bold ${tone(contact.relationship_tier)}">${esc(contact.relationship_tier)}</span>
      </div>
      <div class="my-5 flex items-center gap-3">
        <div class="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
          <div class="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-400" style="width:${Math.max(8, contact.drift_score)}%"></div>
        </div>
        <span class="text-[10px] font-bold uppercase tracking-wider text-fuchsia-300">${urgency}</span>
      </div>
      <div class="flex items-center justify-between gap-3">
        <div class="text-xs text-slate-500">Last contact <strong class="font-semibold text-slate-300">${contact.last_interaction_date}</strong><span class="mx-1 text-slate-700">·</span>${contact.days_since_contact} days ago</div>
        <button data-contact="${esc(contact.id)}" class="loop-in rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-500 px-4 py-2.5 text-xs font-extrabold text-white shadow-lg shadow-fuchsia-900/20 transition hover:brightness-110">Loop In <span class="ml-1">↗</span></button>
      </div>
    </article>
  `;
}

async function load(filter = 'all') {
  try {
    await ensureSeedData();
    const snapshot = await getDocs(collection(db, 'contacts'));
    contacts = snapshot.docs.map((docSnap) => docSnap.data()).map(driftFor);
    const visible = filter === 'alerts' ? contacts.filter((item) => item.is_overdue) : contacts;
    const urgent = contacts.filter((item) => item.is_overdue);

    grid.innerHTML = visible.length
      ? visible.map(card).join('')
      : '<div class="glass rounded-2xl p-6 text-sm text-slate-400">No contacts in this view yet.</div>';

    document.querySelector('#contact-count').textContent = contacts.length;
    document.querySelector('#alert-count').textContent = urgent.length;
    document.querySelector('#total-stat').textContent = contacts.length;
    document.querySelector('#follow-stat').textContent = urgent.length;
    document.querySelector('#contact-summary').textContent = `${contacts.length} contacts`;
    document.querySelectorAll('.loop-in').forEach((button) => button.addEventListener('click', () => openDrawer(button.dataset.contact)));
  } catch (error) {
    console.error(error);
    showNotice('Could not load your contacts from Firebase.');
  }
}

function generateIcebreaker(contact) {
  const firstName = contact.name.split(' ')[0];
  const casual = `Hey ${firstName} — I was thinking about our conversation: ${contact.last_topic}. How has that been unfolding?`;
  const professional = `Hi ${firstName}, I enjoyed our conversation around ${contact.last_topic}. How is that progressing on your end?`;
  return { casual_warm: casual, professional_direct: professional, draft: contact.relationship_tier === 'Inner Loop' ? casual : professional };
}

function csvFields(line) {
  const fields = [];
  let field = '';
  let quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { fields.push(field.trim()); field = ''; }
    else field += char;
  }
  fields.push(field.trim());
  return fields.map((value) => value.replace(/^"|"$/g, '').replace(/""/g, '"'));
}

async function importContacts(file) {
  const lines = (await file.text()).split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error('CSV must include a header row and at least one contact.');
  const headers = csvFields(lines.shift()).map((header) => header.toLowerCase().replace(/\s+/g, '_'));
  const batch = writeBatch(db);
  let imported = 0;
  lines.forEach((line) => {
    const values = csvFields(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
    if (!row.name) return;
    const id = row.id || `${row.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}-${imported}`;
    const contact = {
      id, name: row.name, avatar_url: row.avatar_url || '', last_interaction_date: row.last_interaction_date || new Date().toISOString().slice(0, 10),
      last_topic: row.last_topic || 'Imported contact', relationship_tier: row.relationship_tier || 'Outer Loop',
      custom_cadence_days: Number(row.custom_cadence_days) || 120, role: row.role || '', company: row.company || '', location: row.location || '', interactions: [], deals: [],
    };
    batch.set(doc(db, 'contacts', id), contact, { merge: true });
    imported += 1;
  });
  if (!imported) throw new Error('No contacts with a name were found.');
  await batch.commit();
  showNotice(`${imported} contact${imported === 1 ? '' : 's'} imported.`, 'success');
  load();
}

function captureMessage() {
  const options = contacts.map((contact) => `<option value="${esc(contact.id)}">${esc(contact.name)}</option>`).join('');
  document.body.insertAdjacentHTML('beforeend', `<div id="capture-modal" class="fixed inset-0 z-30 grid place-items-center bg-black/70 p-5 backdrop-blur-sm"><form id="capture-form" class="glass w-full max-w-lg rounded-3xl p-6"><div class="mb-5 flex items-center justify-between"><h2 class="font-display text-xl font-bold">Capture a message</h2><button type="button" id="close-capture" class="grid h-8 w-8 place-items-center rounded-lg bg-white/5 text-slate-400">×</button></div><label class="mb-4 block text-xs font-bold text-slate-400">Contact<select id="capture-contact" required class="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white">${options}</select></label><label class="mb-4 block text-xs font-bold text-slate-400">Where did it come from?<select id="capture-source" class="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white"><option>Messenger</option><option>Snapchat</option><option>Phone</option><option>Other</option></select></label><textarea id="capture-note" required rows="5" placeholder="Paste the important part of the message here" class="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none focus:border-fuchsia-400/60"></textarea><div class="mt-4 flex flex-wrap justify-end gap-2"><button type="button" id="share-message" class="rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-slate-300">Open share sheet</button><button type="submit" class="rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-500 px-4 py-2 text-xs font-extrabold text-white">Save interaction</button></div></form></div>`);
  document.querySelector('#close-capture').addEventListener('click', () => document.querySelector('#capture-modal').remove());
  document.querySelector('#share-message').addEventListener('click', async () => {
    const text = document.querySelector('#capture-note').value.trim();
    if (!text) return showNotice('Paste a message first.');
    if (!navigator.share) return showNotice('Your browser does not support the share sheet. Paste the message here instead.');
    await navigator.share({ title: 'LoopBack message capture', text });
  });
  document.querySelector('#capture-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const id = document.querySelector('#capture-contact').value;
    const contact = contacts.find((item) => item.id === id);
    const note = document.querySelector('#capture-note').value.trim();
    const interaction = { date: new Date().toISOString().slice(0, 10), type: document.querySelector('#capture-source').value, note };
    await updateDoc(doc(db, 'contacts', id), { interactions: [...(contact.interactions || []), interaction], last_interaction_date: interaction.date, last_topic: note.slice(0, 100) });
    document.querySelector('#capture-modal').remove();
    showNotice('Interaction saved to Firebase.', 'success');
    load();
  });
}

async function openDrawer(id) {
  const contact = contacts.find((item) => item.id === id);
  if (!contact) return;

  const messageDraft = generateIcebreaker(contact);
  drawer.classList.remove('closed');
  drawerContent.innerHTML = `
    <div class="flex items-center gap-3">
      <img class="h-14 w-14 rounded-full border-2 border-fuchsia-400/40 object-cover" src="${esc(contact.avatar_url)}" alt="${esc(contact.name)}">
      <div>
        <h2 class="font-display text-xl font-bold">${esc(contact.name)}</h2>
        <p class="text-xs text-slate-400">${esc(contact.role)} · ${esc(contact.location)}</p>
      </div>
    </div>
    <div class="mt-7 grid grid-cols-2 gap-3">
      <div class="rounded-xl bg-white/[.045] p-3"><div class="text-[10px] uppercase tracking-widest text-slate-500">Orbit status</div><div class="mt-1 text-sm font-bold text-fuchsia-300">${esc(contact.relationship_tier)}</div></div>
      <div class="rounded-xl bg-white/[.045] p-3"><div class="text-[10px] uppercase tracking-widest text-slate-500">Cadence</div><div class="mt-1 text-sm font-bold">Every ${contact.cadence_days} days</div></div>
    </div>
    <div class="mt-8">
      <div class="mb-3 flex items-center justify-between"><h3 class="font-display text-sm font-bold">Recent signals</h3><span class="text-[10px] uppercase tracking-wider text-slate-500">${contact.interactions.length} logged</span></div>
      <div class="space-y-3">${contact.interactions.map((item) => `<div class="border-l border-violet-400/40 pl-3"><div class="flex justify-between text-[10px] font-bold uppercase tracking-wider text-violet-300"><span>${esc(item.type)}</span><span class="text-slate-600">${esc(item.date)}</span></div><p class="mt-1 text-xs leading-5 text-slate-400">${esc(item.note)}</p></div>`).join('')}</div>
    </div>
    <div class="mt-8">
      <h3 class="mb-3 font-display text-sm font-bold">Active threads</h3>
      <div class="space-y-2">${contact.deals.map((deal) => `<div class="flex items-center gap-2 rounded-lg bg-white/[.045] px-3 py-2 text-xs text-slate-300"><span class="text-fuchsia-300">✦</span>${esc(deal)}</div>`).join('')}</div>
    </div>
    <div class="mt-8 rounded-2xl border border-violet-400/20 bg-violet-500/5 p-4">
      <div class="mb-2 text-[10px] font-bold uppercase tracking-[.2em] text-violet-300">Suggested note</div>
      <p class="text-sm text-slate-200">${esc(messageDraft.draft)}</p>
    </div>
  `;
}

async function adminPanel() {
  try {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      showNotice('Please sign in to access the admin panel.');
      return;
    }

    const currentProfile = await getUserProfile(currentUser.uid);
    if (currentProfile.role !== 'admin') {
      showNotice('Admin access is required.');
      return;
    }

    const usersSnapshot = await getDocs(collection(db, 'users'));
    const users = usersSnapshot.docs.map((docSnap) => docSnap.data());

    document.body.insertAdjacentHTML('beforeend', `
      <div id="admin-modal" class="fixed inset-0 z-30 grid place-items-center bg-black/70 p-5 backdrop-blur-sm">
        <div class="glass w-full max-w-2xl rounded-3xl p-6">
          <div class="mb-5 flex items-center justify-between">
            <div>
              <div class="text-[10px] font-bold uppercase tracking-widest text-fuchsia-300">Workspace control</div>
              <h2 class="mt-1 font-display text-xl font-bold">Admin panel</h2>
            </div>
            <button id="close-admin" class="grid h-8 w-8 place-items-center rounded-lg bg-white/5 text-slate-400">×</button>
          </div>
          <div class="overflow-x-auto rounded-xl border border-white/10">
            <div class="grid grid-cols-[1fr_1fr_110px_90px] gap-3 border-b border-white/10 bg-white/[.04] px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">
              <span>Account</span><span>Created</span><span>Role</span><span>Recovery</span>
            </div>
            ${users.map((user) => `
              <div class="grid grid-cols-[1fr_1fr_110px_90px] items-center gap-3 border-b border-white/5 px-4 py-3 text-xs last:border-0">
                <div>
                  <div class="font-semibold text-slate-200">${esc(user.name)}</div>
                  <div class="text-[10px] text-slate-500">${esc(user.email)}</div>
                </div>
                <span class="text-slate-500">${esc(user.created_at || '—')}</span>
                <select data-role-user="${esc(user.id)}" class="rounded-lg border border-white/10 bg-black/20 px-2 py-2 text-[10px] text-slate-300">
                  <option ${user.role === 'member' ? 'selected' : ''} value="member">Member</option>
                  <option ${user.role === 'admin' ? 'selected' : ''} value="admin">Admin</option>
                </select>
                <button data-reset-user="${esc(user.email)}" class="rounded-lg border border-white/10 px-2 py-2 text-[10px] font-bold text-slate-400 hover:text-white">Reset password</button>
              </div>`).join('')}
          </div>
        </div>
      </div>
    `);

    document.querySelector('#close-admin').addEventListener('click', () => document.querySelector('#admin-modal').remove());
    document.querySelectorAll('[data-role-user]').forEach((select) => {
      select.addEventListener('change', async () => {
        const userId = select.dataset.roleUser;
        await updateDoc(doc(db, 'users', userId), { role: select.value });
        showNotice('User role updated.', 'success');
      });
    });
    document.querySelectorAll('[data-reset-user]').forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          await sendPasswordResetEmail(auth, button.dataset.resetUser);
          showNotice('Password reset email sent.', 'success');
        } catch (error) {
          showNotice(error.message || 'Could not send password reset email.');
        }
      });
    });
  } catch (error) {
    showNotice('Admin access is unavailable right now.');
  }
}

function bootstrap() {
  accountBar();
  document.querySelector('#close-drawer')?.addEventListener('click', () => drawer.classList.add('closed'));
  document.querySelector('#refresh')?.addEventListener('click', () => load());
  document.querySelector('#capture-message')?.addEventListener('click', captureMessage);
  document.querySelector('#import-contacts')?.addEventListener('click', () => document.querySelector('#contact-file')?.click());
  document.querySelector('#contact-file')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try { await importContacts(file); } catch (error) { showNotice(error.message || 'Could not import contacts.'); }
    event.target.value = '';
  });

  const nav = [...document.querySelectorAll('.nav-item')];
  nav[0]?.addEventListener('click', () => {
    nav.forEach((item) => item.classList.remove('active'));
    nav[0].classList.add('active');
    load();
  });
  nav[1]?.addEventListener('click', () => {
    nav.forEach((item) => item.classList.remove('active'));
    nav[1].classList.add('active');
    load('alerts');
  });
  nav[2]?.addEventListener('click', () => showNotice('Account settings are available from your profile controls.', 'success'));

  load();
}

onAuthStateChanged(auth, async (user) => {
  if (user) {
    const profile = await getUserProfile(user.uid);
    session = {
      token: user.accessToken,
      user: { ...profile, id: user.uid },
    };
    localStorage.setItem('loopback-session', JSON.stringify(session));
    bootstrap();
    return;
  }

  localStorage.removeItem('loopback-session');
  session = null;
  document.querySelector('#auth-screen')?.remove();
  authScreen();
});

document.body.insertAdjacentHTML('beforeend', '<div id="app-notice" class="hidden"></div>');
