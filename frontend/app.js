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
  addDoc,
  query,
  orderBy,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
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
let stopMessageListener = null;
let loadRequestId = 0;
let filterTimer = null;
const preferences = JSON.parse(localStorage.getItem('loopback-preferences') || '{}');
const legacyDemoContactIds = new Set(['maya-chen', 'jon-bell', 'alina-ross', 'samir-patel']);

function applyPreferences() {
  document.body.classList.toggle('light-mode', preferences.theme === 'light');
  document.body.classList.toggle('compact-mode', preferences.density === 'compact');
}

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
  return null;
}

async function getUserProfile(uid) {
  const ref = doc(db, 'users', uid);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) {
    return { id: uid, name: 'User', email: '', role: 'member' };
  }
  return snapshot.data();
}

async function saveUserProfile(uid, name, email, role = 'member', createdAt = new Date().toISOString()) {
  const username = String(name || '').trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
  const profile = { id: uid, name, username, email, role, created_at: createdAt };
  await setDoc(doc(db, 'users', uid), profile, { merge: true });
  await setDoc(doc(db, 'userDirectory', uid), { id: uid, name, username, email }, { merge: true });
  if (username) await setDoc(doc(db, 'usernames', username), { uid, email });
  return profile;
}

async function resolveLoginEmail(identifier) {
  const normalized = identifier.trim().toLowerCase();
  if (normalized.includes('@')) return normalized;
  const usernameSnapshot = await getDoc(doc(db, 'usernames', normalized));
  if (!usernameSnapshot.exists()) throw new Error('No account found for that username.');
  return usernameSnapshot.data().email;
}

async function syncUserDirectory(profile, uid) {
  await setDoc(doc(db, 'userDirectory', uid), { id: uid, name: profile.name || 'User', email: profile.email || '' }, { merge: true });
}

async function searchUsers(query) {
  const normalizedQuery = query.trim().toLowerCase();
  const results = document.querySelector('#user-search-results');
  if (!results || !normalizedQuery) { results?.classList.add('hidden'); return; }
  try {
    const snapshot = await getDocs(collection(db, 'userDirectory'));
    const users = snapshot.docs.map((item) => item.data()).filter((user) => user.id !== auth.currentUser?.uid && [user.name, user.email].some((value) => String(value || '').toLowerCase().includes(normalizedQuery)));
    results.innerHTML = users.length ? users.slice(0, 8).map((user) => `<button data-message-user="${esc(user.id)}" class="block w-full border-b border-white/5 px-4 py-3 text-left last:border-0 hover:bg-white/5"><div class="text-xs font-bold text-white">${esc(user.name)}</div><div class="text-[10px] text-slate-500">${esc(user.email)}</div><div class="mt-1 text-[10px] font-bold text-fuchsia-300">Message in LoopBack</div></button>`).join('') : '<div class="px-4 py-3 text-xs text-slate-500">No matching users.</div>';
    results.querySelectorAll('[data-message-user]').forEach((button) => button.addEventListener('click', () => {
      const user = users.find((item) => item.id === button.dataset.messageUser);
      if (user) openChat(user);
    }));
    results.classList.remove('hidden');
  } catch (error) { console.error('User search error:', error); }
}

function chatId(firstUserId, secondUserId) {
  return [firstUserId, secondUserId].sort().join('_');
}

function openChat(user) {
  const currentUser = auth.currentUser;
  if (!currentUser || user.id === currentUser.uid) return;
  document.querySelector('#user-search-results')?.classList.add('hidden');
  document.querySelector('#chat-modal')?.remove();
  document.body.insertAdjacentHTML('beforeend', `<div id="chat-modal" class="fixed inset-0 z-30 grid place-items-center bg-black/70 p-5 backdrop-blur-sm"><section class="glass flex h-[min(680px,calc(100vh-40px))] w-full max-w-lg flex-col rounded-3xl p-5"><div class="flex items-center justify-between border-b border-white/10 pb-4"><div><div class="text-[10px] font-bold uppercase tracking-widest text-fuchsia-300">Private conversation</div><h2 class="mt-1 font-display text-xl font-bold">${esc(user.name)}</h2></div><button id="close-chat" class="grid h-8 w-8 place-items-center rounded-lg bg-white/5 text-slate-400">×</button></div><div id="chat-messages" class="flex-1 space-y-3 overflow-y-auto py-5"><div class="text-center text-xs text-slate-500">Loading messages...</div></div><form id="chat-form" class="flex gap-2 border-t border-white/10 pt-4"><label class="sr-only" for="chat-input">Message</label><input id="chat-input" required maxlength="2000" placeholder="Write a message" class="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none focus:border-fuchsia-400/60"><button class="rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-500 px-4 py-3 text-xs font-extrabold text-white">Send</button></form></section></div>`);
  const conversationId = chatId(currentUser.uid, user.id);
  const messagesRef = collection(db, 'conversations', conversationId, 'messages');
  setDoc(doc(db, 'conversations', conversationId), { participants: [currentUser.uid, user.id], participantNames: { [currentUser.uid]: session.user.name, [user.id]: user.name }, updatedAt: new Date().toISOString() }, { merge: true }).catch((error) => console.error('Conversation setup error:', error));
  stopMessageListener?.();
  stopMessageListener = onSnapshot(query(messagesRef, orderBy('createdAt')), (snapshot) => {
    const messages = snapshot.docs.map((item) => item.data());
    document.querySelector('#chat-messages').innerHTML = messages.length ? messages.map((message) => `<div class="flex ${message.senderId === currentUser.uid ? 'justify-end' : 'justify-start'}"><div class="max-w-[80%] rounded-2xl px-4 py-3 text-sm ${message.senderId === currentUser.uid ? 'bg-fuchsia-500/20 text-fuchsia-50' : 'bg-white/10 text-slate-200'}"><p>${esc(message.text)}</p><div class="mt-1 text-[10px] text-slate-500">${esc(message.senderName)}</div></div></div>`).join('') : '<div class="text-center text-xs text-slate-500">No messages yet. Start the conversation.</div>';
    const messageBox = document.querySelector('#chat-messages');
    messageBox.scrollTop = messageBox.scrollHeight;
  }, (error) => {
    console.error('Message listener error:', error);
    const messageBox = document.querySelector('#chat-messages');
    if (messageBox) messageBox.innerHTML = '<div class="space-y-3 text-center text-xs text-rose-200"><p>Could not load this conversation.</p><button id="retry-chat" class="rounded-lg border border-rose-300/30 px-3 py-2 font-bold hover:bg-white/10">Retry</button></div>';
    document.querySelector('#retry-chat')?.addEventListener('click', () => openChat(user));
  });
  document.querySelector('#close-chat').addEventListener('click', () => { stopMessageListener?.(); stopMessageListener = null; document.querySelector('#chat-modal')?.remove(); });
  document.querySelector('#chat-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = document.querySelector('#chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.disabled = true;
    try { await addDoc(messagesRef, { text, senderId: currentUser.uid, senderName: session.user.name, createdAt: new Date().toISOString() }); await setDoc(doc(db, 'conversations', conversationId), { updatedAt: new Date().toISOString() }, { merge: true }); input.value = ''; }
    catch (error) { showNotice(error.message || 'Could not send message.'); }
    input.disabled = false;
    input.focus();
  });
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
            <span class="mb-2 block text-[10px] font-bold uppercase tracking-widest text-slate-500">Username</span>
            <input id="auth-name" pattern="[A-Za-z0-9_.-]+" class="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none focus:border-fuchsia-400/60" autocomplete="username">
          </label>
          <label>
            <span class="mb-2 block text-[10px] font-bold uppercase tracking-widest text-slate-500">Email or username</span>
            <input id="auth-email" required class="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none focus:border-fuchsia-400/60" autocomplete="username" placeholder="you@example.com or username">
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
      document.querySelector('#auth-name').required = mode === 'register';
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
    const identifier = document.querySelector('#auth-email').value.trim();
    const password = document.querySelector('#auth-password').value;
    const name = document.querySelector('#auth-name')?.value.trim() || '';
    const errorBox = document.querySelector('#auth-error');

    try {
      let userCredential;
      if (mode === 'register') {
        const email = identifier;
        const username = name.toLowerCase().replace(/[^a-z0-9_.-]/g, '');
        if (!username) throw new Error('Choose a username using letters, numbers, dots, dashes, or underscores.');
        if ((await getDoc(doc(db, 'usernames', username))).exists()) throw new Error('That username is already taken.');
        userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const profile = await saveUserProfile(userCredential.user.uid, name, email, 'member');
        session = { token: userCredential.user.accessToken, user: profile };
      } else {
        const email = await resolveLoginEmail(identifier);
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

async function newMessage() {
  const currentUser = auth.currentUser;
  if (!currentUser) return;
  try {
    const snapshot = await getDocs(collection(db, 'userDirectory'));
    const users = snapshot.docs.map((item) => item.data()).filter((user) => user.id !== currentUser.uid);
    document.querySelector('#new-message-modal')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div id="new-message-modal" class="fixed inset-0 z-30 grid place-items-center bg-black/70 p-5 backdrop-blur-sm"><section class="glass w-full max-w-md rounded-3xl p-6"><div class="mb-5 flex items-center justify-between"><div><div class="text-[10px] font-bold uppercase tracking-widest text-fuchsia-300">Your friends list</div><h2 class="mt-1 font-display text-xl font-bold">Write a new message</h2></div><button id="close-new-message" class="grid h-8 w-8 place-items-center rounded-lg bg-white/5 text-slate-400">×</button></div><input id="new-message-search" type="search" placeholder="Search friends" class="mb-3 w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none focus:border-fuchsia-400/60"><div id="new-message-users" class="max-h-72 overflow-y-auto rounded-xl border border-white/10">${renderMessageUsers(users)}</div></section></div>`);
    const render = (queryText = '') => {
      const normalized = queryText.trim().toLowerCase();
      const matches = users.filter((user) => [user.name, user.email].some((value) => String(value || '').toLowerCase().includes(normalized)));
      document.querySelector('#new-message-users').innerHTML = renderMessageUsers(matches);
      bindMessageUsers(matches);
    };
    document.querySelector('#close-new-message').addEventListener('click', () => document.querySelector('#new-message-modal').remove());
    document.querySelector('#new-message-search').addEventListener('input', (event) => render(event.target.value));
    bindMessageUsers(users);
  } catch (error) {
    console.error('New message error:', error);
    showNotice('Could not load your friends list.');
  }
}

function renderMessageUsers(users) {
  return users.length ? users.map((user) => `<button data-new-message-user="${esc(user.id)}" class="flex w-full items-center justify-between border-b border-white/5 px-4 py-3 text-left last:border-0 hover:bg-white/5"><span><span class="block text-xs font-bold text-white">${esc(user.name || 'User')}</span><span class="text-[10px] text-slate-500">${esc(user.email || '')}</span></span><span class="text-[10px] font-bold text-fuchsia-300">Message</span></button>`).join('') : '<div class="px-4 py-5 text-center text-xs text-slate-500">No friends found yet.</div>';
}

function bindMessageUsers(users) {
  document.querySelectorAll('[data-new-message-user]').forEach((button) => button.addEventListener('click', () => {
    const user = users.find((item) => item.id === button.dataset.newMessageUser);
    if (user) { document.querySelector('#new-message-modal')?.remove(); openChat(user); }
  }));
}

async function settingsMenu() {
  const profile = await getUserProfile(auth.currentUser.uid);
  Object.assign(preferences, profile.preferences || {});
  document.querySelector('#settings-modal')?.remove();
  document.body.insertAdjacentHTML('beforeend', `<div id="settings-modal" class="fixed inset-0 z-30 grid place-items-center bg-black/70 p-5 backdrop-blur-sm"><form id="settings-form" class="glass w-full max-w-md rounded-3xl p-6"><div class="mb-5 flex items-center justify-between"><div><div class="text-[10px] font-bold uppercase tracking-widest text-fuchsia-300">Account settings</div><h2 class="mt-1 font-display text-xl font-bold">Your profile</h2></div><button type="button" id="close-settings" class="grid h-8 w-8 place-items-center rounded-lg bg-white/5 text-slate-400">×</button></div><label class="block text-xs font-bold text-slate-400">Display name<input id="settings-name" required value="${esc(profile.name || '')}" class="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none focus:border-fuchsia-400/60"></label><label class="mt-4 block text-xs font-bold text-slate-400">Email<div class="mt-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-500">${esc(profile.email || auth.currentUser.email || '')}</div></label><fieldset class="mt-5 border-t border-white/10 pt-4"><legend class="text-xs font-bold text-slate-400">Appearance</legend><label class="mt-3 flex items-center justify-between text-xs text-slate-300">Light mode<input id="settings-theme" type="checkbox" ${preferences.theme === 'light' ? 'checked' : ''} class="h-4 w-4 accent-fuchsia-500"></label><label class="mt-3 flex items-center justify-between text-xs text-slate-300">Compact contact cards<input id="settings-density" type="checkbox" ${preferences.density === 'compact' ? 'checked' : ''} class="h-4 w-4 accent-fuchsia-500"></label></fieldset><div class="mt-6 flex flex-wrap justify-end gap-2"><button type="button" id="reset-password" class="rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-slate-300">Reset password</button><button type="submit" class="rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-500 px-4 py-2 text-xs font-extrabold text-white">Save changes</button></div></form></div>`);
  document.querySelector('#close-settings').addEventListener('click', () => document.querySelector('#settings-modal').remove());
  document.querySelector('#reset-password').addEventListener('click', async () => { await sendPasswordResetEmail(auth, profile.email || auth.currentUser.email); showNotice('Password reset email sent.', 'success'); });
  document.querySelector('#settings-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const saveButton = document.querySelector('#settings-form button[type="submit"]');
    saveButton.disabled = true;
    saveButton.textContent = 'Saving...';
    const name = document.querySelector('#settings-name').value.trim();
    preferences.theme = document.querySelector('#settings-theme').checked ? 'light' : 'dark';
    preferences.density = document.querySelector('#settings-density').checked ? 'compact' : 'comfortable';
    localStorage.setItem('loopback-preferences', JSON.stringify(preferences));
    applyPreferences();
    try {
      await updateDoc(doc(db, 'users', auth.currentUser.uid), { preferences });
      await saveUserProfile(auth.currentUser.uid, name, profile.email || auth.currentUser.email, profile.role || 'member', profile.created_at || new Date().toISOString());
      session.user.name = name;
      localStorage.setItem('loopback-session', JSON.stringify(session));
      document.querySelector('#settings-modal').remove();
      accountBar();
      showNotice('Profile saved to Firebase.', 'success');
    } catch (error) {
      console.error('Settings save error:', error);
      saveButton.disabled = false;
      saveButton.textContent = 'Save changes';
      showNotice('Could not save your settings. Try again.');
    }
  });
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
        <div class="flex shrink-0 gap-2"><button data-delete-contact="${esc(contact.id)}" class="rounded-xl border border-white/10 px-3 py-2.5 text-xs font-bold text-slate-400 hover:border-rose-400/40 hover:text-rose-200" aria-label="Remove ${esc(contact.name)}">Remove</button><button data-contact="${esc(contact.id)}" class="loop-in rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-500 px-4 py-2.5 text-xs font-extrabold text-white shadow-lg shadow-fuchsia-900/20 transition hover:brightness-110">Loop In <span class="ml-1">↗</span></button></div>
      </div>
    </article>
  `;
}

async function load(filter = 'all') {
  const requestId = ++loadRequestId;
  grid.innerHTML = '<div class="glass rounded-2xl p-6 text-sm text-slate-400">Loading your orbit...</div>';
  const timeout = new Promise((resolve, reject) => setTimeout(() => reject(new Error('Contact loading timed out.')), 8000));
  try {
    const snapshot = await Promise.race([
      (async () => { await ensureSeedData(); return getDocs(collection(db, 'contacts')); })(),
      timeout,
    ]);
    if (requestId !== loadRequestId) return;
    contacts = snapshot.docs.map((docSnap) => docSnap.data()).filter((contact) => !legacyDemoContactIds.has(contact.id)).map(driftFor);
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
    const synced = document.querySelector('#last-synced');
    if (synced) synced.textContent = `Synced ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    document.querySelectorAll('.loop-in').forEach((button) => button.addEventListener('click', () => openDrawer(button.dataset.contact)));
    document.querySelectorAll('[data-delete-contact]').forEach((button) => button.addEventListener('click', () => deleteContact(button.dataset.deleteContact)));
  } catch (error) {
    console.error(error);
    if (requestId !== loadRequestId) return;
    const message = error.message === 'Contact loading timed out.' ? 'Firebase is taking longer than expected.' : 'Could not load your contacts from Firebase.';
    grid.innerHTML = `<div class="glass rounded-2xl border border-rose-400/20 p-6 text-sm text-rose-200"><p>${message}</p><button id="retry-contacts" class="mt-3 rounded-lg border border-rose-300/30 px-3 py-2 text-xs font-bold hover:bg-white/10">Try again</button></div>`;
    document.querySelector('#retry-contacts')?.addEventListener('click', () => load(filter));
  }
}

async function deleteContact(id) {
  const contact = contacts.find((item) => item.id === id);
  if (!contact || !confirm(`Remove ${contact.name} from your contacts?`)) return;
  try {
    await deleteDoc(doc(db, 'contacts', id));
    showNotice('Contact removed from Firebase.', 'success');
    load();
  } catch (error) {
    console.error('Contact delete error:', error);
    showNotice('Could not remove this contact.');
  }
}

function addContact() {
  document.querySelector('#contact-modal')?.remove();
  document.body.insertAdjacentHTML('beforeend', `<div id="contact-modal" class="fixed inset-0 z-30 grid place-items-center bg-black/70 p-5 backdrop-blur-sm"><form id="contact-form" class="glass max-h-[calc(100vh-40px)] w-full max-w-lg overflow-y-auto rounded-3xl p-6"><div class="mb-5 flex items-center justify-between"><div><div class="text-[10px] font-bold uppercase tracking-widest text-fuchsia-300">Your contacts</div><h2 class="mt-1 font-display text-xl font-bold">Add a contact</h2></div><button type="button" id="close-contact" class="grid h-8 w-8 place-items-center rounded-lg bg-white/5 text-slate-400">×</button></div><div class="grid gap-4 sm:grid-cols-2"><label class="text-xs font-bold text-slate-400 sm:col-span-2">Name<input id="contact-name" required class="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none focus:border-fuchsia-400/60"></label><label class="text-xs font-bold text-slate-400">Last contact<input id="contact-date" type="date" value="${new Date().toISOString().slice(0, 10)}" class="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none focus:border-fuchsia-400/60"></label><label class="text-xs font-bold text-slate-400">Relationship tier<select id="contact-tier" class="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white"><option>Inner Loop</option><option selected>Mid Loop</option><option>Outer Loop</option></select></label><label class="text-xs font-bold text-slate-400 sm:col-span-2">What did you discuss?<input id="contact-topic" class="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none focus:border-fuchsia-400/60"></label><label class="text-xs font-bold text-slate-400">Role<input id="contact-role" class="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none focus:border-fuchsia-400/60"></label><label class="text-xs font-bold text-slate-400">Company<input id="contact-company" class="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none focus:border-fuchsia-400/60"></label></div><div class="mt-6 flex justify-end gap-2"><button type="button" id="close-contact-secondary" class="rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-slate-300">Cancel</button><button type="submit" class="rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-500 px-4 py-2 text-xs font-extrabold text-white">Add contact</button></div></form></div>`);
  const close = () => document.querySelector('#contact-modal')?.remove();
  document.querySelector('#close-contact').addEventListener('click', close);
  document.querySelector('#close-contact-secondary').addEventListener('click', close);
  document.querySelector('#contact-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = document.querySelector('#contact-name').value.trim();
    const tier = document.querySelector('#contact-tier').value;
    const date = document.querySelector('#contact-date').value || new Date().toISOString().slice(0, 10);
    const contact = { id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`, name, avatar_url: '', last_interaction_date: date, last_topic: document.querySelector('#contact-topic').value.trim() || 'New contact', relationship_tier: tier, custom_cadence_days: tierDefaults[tier].cadence_days, role: document.querySelector('#contact-role').value.trim(), company: document.querySelector('#contact-company').value.trim(), location: '', interactions: [], deals: [] };
    try { await setDoc(doc(db, 'contacts', contact.id), contact); close(); showNotice('Contact added to Firebase.', 'success'); load(); }
    catch (error) { console.error('Contact add error:', error); showNotice('Could not add this contact.'); }
  });
}

function requestFilter(filter) {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => load(filter), 180);
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
    requestFilter('all');
  });
}

async function openDrawer(id) {
  const contact = contacts.find((item) => item.id === id);
  if (!contact) return;

  const messageDraft = generateIcebreaker(contact);
  drawer.classList.remove('closed');
  document.querySelector('#mobile-menu-toggle')?.style.setProperty('display', 'none', 'important');
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
          <label class="mb-4 block text-xs font-bold text-slate-400">Search users<input id="user-search" type="search" placeholder="Search by name, email, or ID" class="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none focus:border-fuchsia-400/60"></label>
          <div class="overflow-x-auto rounded-xl border border-white/10">
            <div class="grid grid-cols-[1fr_1fr_110px_90px] gap-3 border-b border-white/10 bg-white/[.04] px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">
              <span>Account</span><span>Created</span><span>Role</span><span>Recovery</span>
            </div>
            <div id="user-results">${users.map((user) => `
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
              </div>`).join('')}</div>
          </div>
        </div>
      </div>
    `);

    document.querySelector('#close-admin').addEventListener('click', () => document.querySelector('#admin-modal').remove());
    const renderUsers = (query = '') => {
      const normalizedQuery = query.trim().toLowerCase();
      const matches = users.filter((user) => [user.name, user.email, user.id].some((value) => String(value || '').toLowerCase().includes(normalizedQuery)));
      document.querySelector('#user-results').innerHTML = matches.length ? matches.map((user) => `
        <div class="grid grid-cols-[1fr_1fr_110px_90px] items-center gap-3 border-b border-white/5 px-4 py-3 text-xs last:border-0">
          <div><div class="font-semibold text-slate-200">${esc(user.name)}</div><div class="text-[10px] text-slate-500">${esc(user.email)}</div></div>
          <span class="text-slate-500">${esc(user.created_at || '—')}</span>
          <select data-role-user="${esc(user.id)}" class="rounded-lg border border-white/10 bg-black/20 px-2 py-2 text-[10px] text-slate-300"><option ${user.role === 'member' ? 'selected' : ''} value="member">Member</option><option ${user.role === 'admin' ? 'selected' : ''} value="admin">Admin</option></select>
          <button data-reset-user="${esc(user.email)}" class="rounded-lg border border-white/10 px-2 py-2 text-[10px] font-bold text-slate-400 hover:text-white">Reset password</button>
        </div>`).join('') : '<div class="px-4 py-5 text-sm text-slate-500">No matching users.</div>';
      document.querySelectorAll('[data-role-user]').forEach((select) => select.addEventListener('change', async () => {
        await updateDoc(doc(db, 'users', select.dataset.roleUser), { role: select.value });
        showNotice('User role updated.', 'success');
      }));
      document.querySelectorAll('[data-reset-user]').forEach((button) => button.addEventListener('click', async () => {
        try { await sendPasswordResetEmail(auth, button.dataset.resetUser); showNotice('Password reset email sent.', 'success'); }
        catch (error) { showNotice(error.message || 'Could not send password reset email.'); }
      }));
    };
    renderUsers();
    document.querySelector('#user-search').addEventListener('input', (event) => renderUsers(event.target.value));
  } catch (error) {
    showNotice('Admin access is unavailable right now.');
  }
}

function helpMenu() {
  document.querySelector('#help-modal')?.remove();
  document.body.insertAdjacentHTML('beforeend', `<div id="help-modal" class="fixed inset-0 z-30 grid place-items-center bg-black/70 p-5 backdrop-blur-sm"><section class="glass max-h-[min(760px,calc(100vh-40px))] w-full max-w-2xl overflow-y-auto rounded-3xl p-6"><div class="mb-6 flex items-start justify-between gap-4"><div><div class="text-[10px] font-bold uppercase tracking-widest text-fuchsia-300">LoopBack guide</div><h2 class="mt-1 font-display text-2xl font-bold">How to use the app</h2><p class="mt-2 text-sm text-slate-400">Keep your real contacts, context, and conversations in one place.</p></div><button id="close-help" class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/5 text-slate-400">×</button></div><div class="grid gap-4 sm:grid-cols-2"><article class="rounded-2xl bg-white/[.045] p-4"><h3 class="font-display font-bold text-fuchsia-200">1. Create an account</h3><p class="mt-2 text-xs leading-5 text-slate-400">Choose a unique username, email, and password. You can sign in later with either the username or email.</p></article><article class="rounded-2xl bg-white/[.045] p-4"><h3 class="font-display font-bold text-fuchsia-200">2. Add contacts</h3><p class="mt-2 text-xs leading-5 text-slate-400">Use Import CSV to add people to your relationship list. Include name, last interaction date, topic, tier, cadence, role, company, location, and optional avatar URL.</p></article><article class="rounded-2xl bg-white/[.045] p-4"><h3 class="font-display font-bold text-fuchsia-200">3. Understand the dashboard</h3><p class="mt-2 text-xs leading-5 text-slate-400">All Contacts shows your list. Drift Alerts filters people whose follow-up cadence has passed. Drift is calculated from the last interaction, tier, and cadence.</p></article><article class="rounded-2xl bg-white/[.045] p-4"><h3 class="font-display font-bold text-fuchsia-200">4. Message a user</h3><p class="mt-2 text-xs leading-5 text-slate-400">Search the user directory in the left panel or choose Write a new message. Select a registered LoopBack user to open a private conversation and send messages through Firebase.</p></article><article class="rounded-2xl bg-white/[.045] p-4"><h3 class="font-display font-bold text-fuchsia-200">5. Log an interaction</h3><p class="mt-2 text-xs leading-5 text-slate-400">Capture message saves an important Messenger, Snapchat, phone, or other note to a contact and updates the last interaction date and topic.</p></article><article class="rounded-2xl bg-white/[.045] p-4"><h3 class="font-display font-bold text-fuchsia-200">6. Manage your account</h3><p class="mt-2 text-xs leading-5 text-slate-400">Settings updates your display name and sends password reset emails. Admin panel is available only to administrators for user roles and recovery.</p></article></div><div class="mt-5 rounded-2xl border border-violet-400/20 bg-violet-500/5 p-4"><h3 class="font-display font-bold text-violet-200">CSV columns</h3><p class="mt-2 text-xs leading-5 text-slate-400">Required: name. Optional: avatar_url, last_interaction_date, last_topic, relationship_tier, custom_cadence_days, role, company, location. Use Inner Loop, Mid Loop, or Outer Loop for relationship tiers.</p></div></section></div>`);
  document.querySelector('#close-help').addEventListener('click', () => document.querySelector('#help-modal').remove());
}

function helpPage() {
  document.querySelector('#help-page')?.remove();
  const helpTheme = preferences.theme === 'light' ? 'bg-[#f7f9fc] text-[#1f2430]' : 'bg-[#090712] text-white';
  document.body.insertAdjacentHTML('beforeend', `<main id="help-page" class="fixed inset-0 z-40 overflow-y-auto ${helpTheme} p-5 sm:p-10"><div class="mx-auto max-w-4xl"><button id="close-help-page" class="glass mb-8 rounded-xl px-4 py-2 text-xs font-bold text-slate-300">← Back to dashboard</button><div class="mb-10"><div class="text-[10px] font-bold uppercase tracking-[.2em] text-fuchsia-300">LoopBack guide</div><h1 class="mt-2 font-display text-4xl font-bold">How to use LoopBack</h1><p class="mt-3 max-w-2xl text-sm leading-6 text-slate-400">Use this guide to set up your account, add contacts, stay on top of follow-ups, and message other LoopBack users.</p></div><div class="grid gap-4 sm:grid-cols-2"><article class="glass rounded-2xl p-5"><h2 class="font-display text-lg font-bold">Create an account</h2><p class="mt-2 text-sm leading-6 text-slate-400">Choose a unique username, email, and password. You can sign in with either your username or email later.</p></article><article class="glass rounded-2xl p-5"><h2 class="font-display text-lg font-bold">Add contacts</h2><p class="mt-2 text-sm leading-6 text-slate-400">Select Import CSV. Your file must include a name column. Add the optional date, topic, relationship tier, cadence, role, company, location, and avatar URL columns when available.</p></article><article class="glass rounded-2xl p-5"><h2 class="font-display text-lg font-bold">Read your dashboard</h2><p class="mt-2 text-sm leading-6 text-slate-400">All Contacts shows your imported list. Drift Alerts shows contacts whose follow-up cadence has passed. Loop In opens their context and suggested icebreaker.</p></article><article class="glass rounded-2xl p-5"><h2 class="font-display text-lg font-bold">Message people</h2><p class="mt-2 text-sm leading-6 text-slate-400">Search for a registered user in the sidebar or select Write a new message. Choose a person to open a private conversation backed by Firebase.</p></article><article class="glass rounded-2xl p-5"><h2 class="font-display text-lg font-bold">Capture interactions</h2><p class="mt-2 text-sm leading-6 text-slate-400">Capture message records an important note from Messenger, Snapchat, phone, or another source and updates the contact's last interaction.</p></article><article class="glass rounded-2xl p-5"><h2 class="font-display text-lg font-bold">Manage preferences</h2><p class="mt-2 text-sm leading-6 text-slate-400">Settings lets you update your display name, choose light or dark mode, use compact cards, and send a password reset email.</p></article></div><section class="glass mt-4 rounded-2xl p-5"><h2 class="font-display text-lg font-bold">CSV format</h2><p class="mt-2 text-sm leading-6 text-slate-400">Required: name. Optional: avatar_url, last_interaction_date, last_topic, relationship_tier, custom_cadence_days, role, company, location.</p><pre class="mt-4 overflow-x-auto rounded-xl bg-black/20 p-4 text-xs text-fuchsia-200">name,last_interaction_date,last_topic,relationship_tier,custom_cadence_days,role,company,location</pre></section></div></main>`);
  const helpSurface = document.querySelector('#help-page');
  helpSurface.style.backgroundColor = preferences.theme === 'light' ? '#f7f9fc' : '#090712';
  helpSurface.style.backgroundImage = preferences.theme === 'light'
    ? 'linear-gradient(135deg, #f7f9fc 0%, #e8edf5 100%)'
    : 'linear-gradient(135deg, #0b0817 0%, #120b28 48%, #080710 100%)';
  const explanations = {
    'Create an account': 'Think of this like making your own clubhouse name. Pick a username, add your email, and make a password. Your username and email both work when you come back.',
    'Add contacts': 'A contact is a person you want to remember. Import CSV is like handing LoopBack a small list. Put each person on one row, and make sure every row has a name.',
    'Read your dashboard': 'All Contacts is your whole people list. Drift Alerts is a gentle reminder that says, "You may want to say hello to this person." Loop In shows the useful things you remember.',
    'Message people': 'Search for a LoopBack user, pick their name, and a private chat opens. Type your message and press Send. Only the people in that chat can read it.',
    'Capture interactions': 'When you talk to someone somewhere else, save the important part here. LoopBack remembers the date and topic so your next hello feels personal.',
    'Manage preferences': 'Settings is your control room. Light mode makes the screen bright, compact cards make the list smaller, and Save changes remembers your choices.',
  };
  helpSurface.querySelectorAll('article').forEach((article) => {
    const heading = article.querySelector('h2');
    const explanation = explanations[heading?.textContent.trim()];
    if (!heading || !explanation) return;
    article.setAttribute('role', 'button');
    article.setAttribute('tabindex', '0');
    article.setAttribute('aria-expanded', 'false');
    const detail = document.createElement('p');
    detail.className = 'help-detail mt-3 hidden border-t border-white/10 pt-3 text-sm leading-6 text-fuchsia-100';
    detail.textContent = explanation;
    article.append(detail);
    const toggle = () => {
      const expanded = article.getAttribute('aria-expanded') === 'true';
      article.setAttribute('aria-expanded', String(!expanded));
      detail.classList.toggle('hidden', expanded);
    };
    article.addEventListener('click', toggle);
    article.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); }
    });
  });
  document.querySelector('#close-help-page').addEventListener('click', () => helpSurface.remove());
}

function bootstrap() {
  applyPreferences();
  ['contact-count', 'alert-count', 'total-stat', 'follow-stat'].forEach((id) => {
    const element = document.querySelector(`#${id}`);
    if (element) element.textContent = 'Loading';
  });
  accountBar();
  const header = document.querySelector('header');
  if (header && !document.querySelector('#welcome-section')) header.insertAdjacentHTML('afterend', '<section id="welcome-section" class="glass mb-6 rounded-2xl border border-fuchsia-400/20 bg-fuchsia-500/5 p-5 sm:p-6"><div class="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between"><div><div class="text-[10px] font-bold uppercase tracking-[.2em] text-fuchsia-300">A better way to stay close</div><h2 class="mt-2 font-display text-2xl font-bold">Welcome to your relationship orbit.</h2><p class="mt-2 max-w-2xl text-sm leading-6 text-slate-400">LoopBack helps you remember the people who matter, notice when a connection needs care, and start your next conversation with confidence.</p></div><button id="welcome-help" class="shrink-0 rounded-xl border border-fuchsia-400/30 px-3 py-2 text-xs font-bold text-fuchsia-200 hover:bg-fuchsia-400/10">Explore the guide</button></div><div class="mt-5 grid gap-3 sm:grid-cols-3"><div class="rounded-xl bg-white/[.045] p-3"><div class="text-sm font-bold text-slate-200">Remember</div><p class="mt-1 text-xs leading-5 text-slate-500">Keep useful context in one calm place.</p></div><div class="rounded-xl bg-white/[.045] p-3"><div class="text-sm font-bold text-slate-200">Notice</div><p class="mt-1 text-xs leading-5 text-slate-500">See who may appreciate a thoughtful hello.</p></div><div class="rounded-xl bg-white/[.045] p-3"><div class="text-sm font-bold text-slate-200">Reconnect</div><p class="mt-1 text-xs leading-5 text-slate-500">Turn a reminder into a personal message.</p></div></div></section>');
  document.querySelector('#welcome-help')?.addEventListener('click', () => helpPage());
  if (header && !document.querySelector('#add-contact')) header.insertAdjacentHTML('beforeend', '<button id="add-contact" class="glass rounded-xl px-3 py-2 text-xs font-bold text-slate-300 hover:border-fuchsia-400/50">Add contact</button>');
  const sidebar = document.querySelector('aside');
  const existingMenuToggle = document.querySelector('#mobile-menu-toggle');
  if (!existingMenuToggle) {
    document.body.insertAdjacentHTML('beforeend', '<button id="mobile-menu-toggle" type="button" class="glass fixed left-4 top-4 z-20 flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold text-slate-300 lg:hidden" aria-controls="workspace-sidebar" aria-expanded="false"><span class="text-base leading-none">☰</span> Menu</button>');
  }
  sidebar?.setAttribute('id', 'workspace-sidebar');
  const menuToggle = document.querySelector('#mobile-menu-toggle');
  const closeMobileMenu = () => {
    sidebar?.classList.add('hidden');
    sidebar?.classList.remove('flex');
    menuToggle?.setAttribute('aria-expanded', 'false');
  };
  menuToggle?.addEventListener('click', () => {
    const isOpen = sidebar?.classList.toggle('flex');
    sidebar?.classList.toggle('hidden', !isOpen);
    menuToggle.setAttribute('aria-expanded', String(Boolean(isOpen)));
  });
  document.querySelector('#close-drawer')?.addEventListener('click', () => {
    drawer.classList.add('closed');
    document.querySelector('#mobile-menu-toggle')?.style.removeProperty('display');
  });
  document.querySelector('#refresh')?.addEventListener('click', () => load());
  document.querySelector('#capture-message')?.addEventListener('click', captureMessage);
  document.querySelector('#add-contact')?.addEventListener('click', addContact);
  document.querySelector('#new-message')?.addEventListener('click', newMessage);
  document.querySelector('#user-search-input')?.addEventListener('input', (event) => searchUsers(event.target.value));
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
    closeMobileMenu();
    load();
  });
  nav[1]?.addEventListener('click', () => {
    nav.forEach((item) => item.classList.remove('active'));
    nav[1].classList.add('active');
    closeMobileMenu();
    requestFilter('alerts');
  });
  nav[2]?.addEventListener('click', () => { closeMobileMenu(); settingsMenu(); });
  nav[3]?.addEventListener('click', () => { closeMobileMenu(); helpPage(); });

  load();
}

onAuthStateChanged(auth, async (user) => {
  if (user) {
    const profile = await getUserProfile(user.uid);
    Object.assign(preferences, profile.preferences || {});
    localStorage.setItem('loopback-preferences', JSON.stringify(preferences));
    await syncUserDirectory(profile, user.uid);
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
