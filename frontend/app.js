const API = 'http://127.0.0.1:8000';
const grid = document.querySelector('#contact-grid');
const drawer = document.querySelector('#drawer');
const drawerContent = document.querySelector('#drawer-content');
let contacts = [];

const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const initials = (name) => name.split(' ').map((part) => part[0]).join('').slice(0, 2);
const tone = (tier) => tier === 'Inner Loop' ? 'text-fuchsia-300 bg-fuchsia-400/10 border-fuchsia-400/20' : tier === 'Mid Loop' ? 'text-violet-200 bg-violet-400/10 border-violet-400/20' : 'text-slate-300 bg-white/5 border-white/10';

function card(contact) {
  const urgency = contact.drift_score >= 100 ? 'Critical drift' : `${Math.round(contact.drift_score)}% drift`;
  return `<article class="card glass rounded-2xl p-5 hover:border-violet-400/40"><div class="flex items-start justify-between"><div class="flex items-center gap-3"><img class="h-12 w-12 rounded-full border-2 border-violet-400/30 object-cover" src="${esc(contact.avatar_url)}" alt="${esc(contact.name)}" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"><span class="hidden h-12 w-12 place-items-center rounded-full bg-violet-500/20 font-display font-bold text-violet-200">${initials(esc(contact.name))}</span><div><h3 class="font-display font-bold">${esc(contact.name)}</h3><p class="mt-0.5 text-xs text-slate-500">${esc(contact.role)} · ${esc(contact.company)}</p></div></div><span class="rounded-full border px-2.5 py-1 text-[10px] font-bold ${tone(contact.relationship_tier)}">${esc(contact.relationship_tier)}</span></div><div class="my-5 flex items-center gap-3"><div class="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/10"><div class="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-400" style="width:${Math.max(8, contact.drift_score)}%"></div></div><span class="text-[10px] font-bold uppercase tracking-wider text-fuchsia-300">${urgency}</span></div><div class="flex items-center justify-between"><div class="text-xs text-slate-500">Last contact <strong class="font-semibold text-slate-300">${contact.last_interaction_date}</strong><span class="mx-1 text-slate-700">·</span>${contact.days_since_contact} days ago</div><button data-contact="${esc(contact.id)}" class="loop-in rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-500 px-4 py-2.5 text-xs font-extrabold text-white shadow-lg shadow-fuchsia-900/20 transition hover:brightness-110">Loop In <span class="ml-1">↗</span></button></div></article>`;
}

async function load() {
  try {
    const response = await fetch(`${API}/api/contacts/drift`);
    if (!response.ok) throw new Error('API unavailable');
    contacts = await response.json();
    const urgent = contacts.filter((contact) => contact.is_overdue);
    grid.innerHTML = contacts.map(card).join('');
    document.querySelector('#contact-count').textContent = contacts.length;
    document.querySelector('#alert-count').textContent = urgent.length;
    document.querySelector('#total-stat').textContent = contacts.length;
    document.querySelector('#follow-stat').textContent = urgent.length;
    document.querySelectorAll('.loop-in').forEach((button) => button.addEventListener('click', () => openDrawer(button.dataset.contact)));
  } catch (error) {
    grid.innerHTML = `<div class="glass rounded-2xl border-fuchsia-400/20 p-6 text-sm text-fuchsia-200">Could not reach LoopBack API. Start FastAPI on port 8000, then sync again.</div>`;
  }
}

async function openDrawer(id) {
  const contact = contacts.find((item) => item.id === id);
  if (!contact) return;
  drawer.classList.remove('closed');
  drawerContent.innerHTML = `<div class="flex items-center gap-3"><img class="h-14 w-14 rounded-full border-2 border-fuchsia-400/40 object-cover" src="${esc(contact.avatar_url)}" alt=""><div><h2 class="font-display text-xl font-bold">${esc(contact.name)}</h2><p class="text-xs text-slate-400">${esc(contact.role)} · ${esc(contact.location)}</p></div></div><div class="mt-7 grid grid-cols-2 gap-3"><div class="rounded-xl bg-white/[.045] p-3"><div class="text-[10px] uppercase tracking-widest text-slate-500">Orbit status</div><div class="mt-1 text-sm font-bold text-fuchsia-300">${esc(contact.relationship_tier)}</div></div><div class="rounded-xl bg-white/[.045] p-3"><div class="text-[10px] uppercase tracking-widest text-slate-500">Cadence</div><div class="mt-1 text-sm font-bold">Every ${contact.cadence_days} days</div></div></div><div class="mt-8"><div class="mb-3 flex items-center justify-between"><h3 class="font-display text-sm font-bold">Recent signals</h3><span class="text-[10px] uppercase tracking-wider text-slate-500">${contact.interactions.length} logged</span></div><div class="space-y-3">${contact.interactions.map((item) => `<div class="border-l border-violet-400/40 pl-3"><div class="flex justify-between text-[10px] font-bold uppercase tracking-wider text-violet-300"><span>${esc(item.type)}</span><span class="text-slate-600">${esc(item.date)}</span></div><p class="mt-1 text-xs leading-5 text-slate-400">${esc(item.note)}</p></div>`).join('')}</div></div><div class="mt-8"><h3 class="mb-3 font-display text-sm font-bold">Active threads</h3><div class="space-y-2">${contact.deals.map((deal) => `<div class="flex items-center gap-2 rounded-lg bg-white/[.045] px-3 py-2 text-xs text-slate-300"><span class="text-fuchsia-300">✦</span>${esc(deal)}</div>`).join('')}</div></div><div class="mt-8"><div class="mb-3 flex items-center justify-between"><h3 class="font-display text-sm font-bold">AI icebreaker draft</h3><span class="rounded-full bg-emerald-400/10 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-emerald-300">ready</span></div><textarea id="draft" class="h-32 w-full resize-none rounded-xl border border-white/10 bg-black/20 p-4 text-sm leading-6 text-slate-200 outline-none focus:border-fuchsia-400/50" aria-label="Icebreaker draft">Generating a thoughtful opener...</textarea><button id="copy-draft" class="mt-3 w-full rounded-xl border border-white/10 py-3 text-xs font-bold text-slate-300 transition hover:border-fuchsia-400/40 hover:text-white">Copy draft</button></div>`;
  try { const result = await fetch(`${API}/api/icebreaker/generate`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({contact_id:id})}); document.querySelector('#draft').value = (await result.json()).draft; } catch { document.querySelector('#draft').value = 'Could not generate a draft. Check that the API is running.'; }
  document.querySelector('#copy-draft').addEventListener('click', async (event) => { await navigator.clipboard.writeText(document.querySelector('#draft').value); event.currentTarget.textContent = 'Copied to clipboard'; event.currentTarget.classList.add('copy-ok'); });
}

document.querySelector('#close-drawer').addEventListener('click', () => drawer.classList.add('closed'));
document.querySelector('#refresh').addEventListener('click', load);
load();
