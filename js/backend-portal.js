/* =====================================================================
   Bürgerportal – Supabase-Backend
   Ersetzt im Live-Betrieb alle PortalAPI-Funktionen (gleiche Namen, gleiche Rückgabeformate),
   damit die Oberfläche in index.html unverändert bleibt.
   Aktiv nur, wenn js/config.js eine Supabase-URL + Key enthält.
   ===================================================================== */
(function () {
  const X = window.SBX; if (!X || !X.enabled) return;
  const { sb, ok, tr, M, MAPS, toCols, S, refresh, setActive, signIn, signOut, emailOf } = X;
  const need = () => Auth.need();
  const today = () => new Date().toISOString();

  /* ---- Auth-Cache: die Oberfläche liest synchron ---- */
  Auth.account = () => S.profile;
  Auth.chars = () => S.chars;
  Auth.active = () => S.chars.find(c => c.id === S.activeId) || S.chars[0] || null;

  /* ---- gemeinsame Abfragen ---- */
  const rows = async (q, mapper) => (ok(await q) || []).map(mapper);
  const one  = async (q, mapper) => { const d = ok(await q); return d ? mapper(d) : null; };
  const mineVehicles = () => rows(sb.from('vehicles').select('*').eq('account_id', S.uid).order('created_at'), M.vehicle);

  const API = {
    /* ===== Konto ===== */
    async register({ username, password, staffCode }) {
      username = (username || '').trim();
      if (!/^[A-Za-z0-9_.-]{3,24}$/.test(username)) throw new Error('Benutzername: 3–24 Zeichen (Buchstaben, Zahlen, _ . -).');
      if ((password || '').length < 6) throw new Error('Das Passwort muss mindestens 6 Zeichen lang sein.');
      if (!ok(await sb.rpc('username_available', { p_username: username }))) throw new Error('Dieser Benutzername ist bereits vergeben.');
      const { data, error } = await sb.auth.signUp({ email: emailOf(username), password, options: { data: { username } } });
      if (error) throw tr(error);
      if (!data.session) throw new Error('Registrierung nicht abgeschlossen: In Supabase muss „Confirm email“ ausgeschaltet sein (Authentication → Providers → Email).');
      if (staffCode && staffCode.trim()) {
        const r = await sb.rpc('claim_staff_role', { p_code: staffCode.trim() });
        if (r.error) { await sb.rpc('delete_my_account'); await signOut(); throw tr(r.error); }       // wie im Demo-Modus: ungültiger Code → kein Konto
      }
      await refresh(); return Auth.account();
    },
    async login(username, password) { await signIn(username, password); if (!S.profile) throw new Error('Benutzerprofil nicht gefunden.'); return Auth.account(); },
    async logout() { await signOut(); },
    async changePassword(oldPw, newPw) {
      Auth.need();
      if ((newPw || '').length < 6) throw new Error('Das neue Passwort muss mindestens 6 Zeichen lang sein.');
      const chk = await sb.auth.signInWithPassword({ email: emailOf(S.profile.username), password: oldPw || '' });
      if (chk.error) throw new Error('Das aktuelle Passwort ist falsch.');
      const { error } = await sb.auth.updateUser({ password: newPw }); if (error) throw tr(error);
    },
    async deleteAccount(password) {
      if (!S.profile) throw new Error('Bitte melden Sie sich an.');
      const chk = await sb.auth.signInWithPassword({ email: emailOf(S.profile.username), password: password || '' });
      if (chk.error) throw new Error('Das Passwort ist falsch.');
      ok(await sb.rpc('delete_my_account')); await signOut(); setActive(null);
    },

    /* ===== Charaktere ===== */
    async getCharacters() { await refresh(); return Auth.chars(); },
    async setActiveChar(id) { need(); if (!S.chars.some(c => c.id === id)) throw new Error('Charakter nicht gefunden.'); setActive(id); },
    async createCitizen(d) {
      need();
      if (S.chars.length >= CONFIG.MAX_CHARACTERS) throw new Error(`Pro Konto sind maximal ${CONFIG.MAX_CHARACTERS} Charaktere möglich.`);
      const c = await one(sb.from('characters').insert({ account_id: S.uid, username: d.username, first: d.first, last: d.last, birth: d.birth, sex: d.sex, district: d.district, photo: d.photo || null, valid_until: d.validUntil }).select().single(), M.char);
      await refresh(); setActive(c.id); return c;
    },
    async getCitizen() { return Auth.active(); },
    async findCharacterByCitizenId(cid) {
      const r = ok(await sb.rpc('lookup_citizen', { p_citizen_id: cid })) || [];
      if (!r[0]) return null; const [first, ...rest] = r[0].name.split(' ');
      return { id: r[0].id, first, last: rest.join(' '), citizenId: String(cid).toUpperCase() };
    },
    async updateCitizen(patch) {
      const c = Auth.active(); if (!c) throw new Error('Keine Bürgerkarte vorhanden.');
      const u = await one(sb.from('characters').update(toCols(patch, MAPS.char)).eq('id', c.id).select().single(), M.char);
      await refresh(); return u;
    },
    async deleteCharacter(id) {
      need(); if (!S.chars.some(c => c.id === id)) throw new Error('Charakter nicht gefunden.');
      const regs = (ok(await sb.from('businesses').select('reg_no').eq('owner_char_id', id)) || []).map(b => b.reg_no);
      if (regs.length) ok(await sb.from('jobs').delete().in('reg_no', regs));                       // Stellenanzeigen der Gewerbe
      ok(await sb.from('characters').delete().eq('id', id));                                        // Fahrzeuge, Gewerbe, Bewerbungen … per ON DELETE CASCADE
      if (S.activeId === id) setActive(null);
      await refresh();
    },

    /* ===== Fahrzeuge ===== */
    async plateExists(plate) { return !!ok(await sb.rpc('plate_taken', { p_plate: plate })); },
    async getVehicles() { return S.uid ? mineVehicles() : []; },
    async registerVehicle(d) {
      need(); if (!Auth.chars().some(c => c.id === d.ownerCharId)) throw new Error('Bitte wählen Sie einen Ihrer Charaktere als Halter.');
      return one(sb.from('vehicles').insert({ plate: d.plate, type: d.type, model: d.model, color: d.color || null, owner_char_id: d.ownerCharId }).select().single(), M.vehicle);
    },

    /* ===== Gewerbe ===== */
    async getRegister() { return rows(sb.from('businesses').select('*').eq('listed', true).order('name'), M.business); },
    async getBusinesses() { return S.uid ? rows(sb.from('businesses').select('*').eq('account_id', S.uid).order('created_at'), M.business) : []; },
    async getOccupiedPlots() { return ok(await sb.rpc('occupied_plots')) || []; },
    async phoneTaken(phone, exceptReg) { return !!ok(await sb.rpc('phone_taken', { p_phone: phone, p_except: exceptReg || null })); },
    async registerBusiness(d) {
      need(); if (!Auth.chars().some(c => c.id === d.ownerCharId)) throw new Error('Bitte wählen Sie einen Ihrer Charaktere als Inhaber.');
      if (!/^\d{3}-\d{4}$/.test(d.phone || '')) throw new Error('Telefonnummer bitte im Format 555-1234 angeben.');
      return one(sb.from('businesses').insert({ name: d.name, legal_form: d.legalForm, industry: d.industry, plot_id: d.plotId, plot_name: d.plotName, phone: d.phone, hours: d.hours, description: d.description, listed: d.listed !== false, owner_char_id: d.ownerCharId }).select().single(), M.business);
    },

    /* ===== Bewerbungen ===== */
    async submitApplication(d) {
      need(); const ch = Auth.active(); if (!ch) throw new Error('Bitte erstellen Sie zuerst einen Charakter.');
      return one(sb.from('applications').insert({ char_id: ch.id, faction: d.faction, name: d.name, discord: d.discord, age: d.age, experience: d.experience, text: d.text }).select().single(), M.application);
    },
    async getApplication(no) { return one(sb.from('applications').select('*').eq('app_no', no).maybeSingle(), M.application); },
    async getApplications() { return S.uid ? rows(sb.from('applications').select('*').eq('account_id', S.uid).order('created_at', { ascending: false }), M.application) : []; },
    async withdrawApplication(no) { need(); ok(await sb.from('applications').delete().eq('app_no', no).eq('status', 'offen')); },

    /* ===== News ===== */
    async getNews() { const db = await rows(sb.from('news').select('*').order('date', { ascending: false }), M.news); return [...db, ...NEWS].sort((a, b) => String(b.date).localeCompare(String(a.date))); },

    /* ===== Führerschein ===== */
    async getLicense() { const c = Auth.active(); return c ? one(sb.from('licenses').select('*').eq('char_id', c.id).maybeSingle(), M.license) : null; },
    async getMyLicenses() {
      const ids = S.chars.map(c => c.id); if (!ids.length) return {};
      const l = ok(await sb.from('licenses').select('*').in('char_id', ids)) || [];
      return Object.fromEntries(l.map(r => [r.char_id, M.license(r)]));
    },
    async saveLicense(classes) {
      need(); const c = Auth.active(); if (!c) throw new Error('Kein aktiver Charakter.');
      const old = ok(await sb.from('licenses').select('*').eq('char_id', c.id).maybeSingle());
      const merged = [...new Set([...(old?.classes || []), ...classes])];
      return one(sb.from('licenses').upsert({ char_id: c.id, classes: merged }, { onConflict: 'char_id' }).select().single(), M.license);
    },

    /* ===== Mängelmelder ===== */
    async getReports() { return S.uid ? rows(sb.from('reports').select('*').eq('account_id', S.uid).order('created_at', { ascending: false }), mapReport) : []; },
    async addReport(r) {
      need(); const ch = Auth.active();
      return one(sb.from('reports').insert({ data: { ...r, by: ch ? fullNameOf(ch) : S.profile.username } }).select().single(), mapReport);
    },
    async removeReport(no) { need(); ok(await sb.from('reports').delete().eq('no', no)); },

    /* ===== Fahrzeuge (erweitert) ===== */
    async updateVehicle(id, patch) {
      need(); const r = ok(await sb.from('vehicles').update(toCols(patch, MAPS.vehicle)).eq('id', id).select());
      if (!r.length) throw new Error('Kein Zugriff auf dieses Fahrzeug.'); return M.vehicle(r[0]);
    },
    async removeVehicle(id) { need(); const r = ok(await sb.from('vehicles').delete().eq('id', id).select()); if (!r.length) throw new Error('Kein Zugriff auf dieses Fahrzeug.'); },
    async transferVehicle(id, citizenId) {
      need(); const name = ok(await sb.rpc('transfer_vehicle', { p_vehicle_id: id, p_citizen_id: citizenId || '' }));
      return { id, owner: name };
    },
    async getReservations() {
      if (!S.uid) return [];
      const l = ok(await sb.from('plate_reservations').select('*').eq('account_id', S.uid).gt('until', today())) || [];
      return l.map(r => ({ plate: r.plate, accountId: r.account_id, until: new Date(r.until).getTime() }));
    },
    async reservePlate(plate) { need(); ok(await sb.rpc('reserve_plate', { p_plate: plate })); },
    async cancelReservation(plate) { need(); ok(await sb.from('plate_reservations').delete().eq('plate', plate)); },

    /* ===== Gewerbe (erweitert) ===== */
    async getOccupancy() { return (ok(await sb.rpc('get_occupancy')) || []).map(r => ({ plotId: r.plot_id, name: r.name, mine: !!r.mine })); },
    async updateBusiness(regNo, patch) {
      need();
      if (patch.phone !== undefined && !/^\d{3}-\d{4}$/.test(patch.phone)) throw new Error('Telefonnummer bitte im Format 555-1234 angeben.');
      const r = ok(await sb.from('businesses').update(toCols(patch, MAPS.business)).eq('reg_no', regNo).select());
      if (!r.length) throw new Error('Kein Zugriff auf dieses Gewerbe.'); return M.business(r[0]);
    },
    async removeBusiness(regNo) {
      need(); ok(await sb.from('jobs').delete().eq('reg_no', regNo));
      const r = ok(await sb.from('businesses').delete().eq('reg_no', regNo).select()); if (!r.length) throw new Error('Kein Zugriff auf dieses Gewerbe.');
    },

    /* ===== Stellenmarkt ===== */
    async getJobs() {
      const db = await rows(sb.from('jobs').select('*').order('created_at', { ascending: false }), j => ({ id: j.id, regNo: j.reg_no, company: j.company, industry: j.industry, title: j.title, desc: j.descr, slots: j.slots, accountId: j.account_id, own: j.account_id === S.uid }));
      return [...db, ...(window.SEEDS ? SEEDS.jobs : [])];
    },
    async postJob(j) { need(); ok(await sb.from('jobs').insert({ reg_no: j.regNo || null, company: j.company, industry: j.industry, title: j.title, descr: j.desc, slots: j.slots })); },
    async removeJob(id) { need(); ok(await sb.from('jobs').delete().eq('id', id)); },
    async getJobApps() { return S.uid ? rows(sb.from('job_applications').select('*').eq('account_id', S.uid), r => ({ ...r.data, accountId: r.account_id, charId: r.char_id, at: r.created_at })) : []; },
    async applyJob(a) { need(); ok(await sb.from('job_applications').insert({ char_id: Auth.active()?.id || null, job_id: String(a.jobId ?? ''), data: a })); },

    /* ===== Ideen-Box ===== */
    async getIdeas() {
      const [ideas, votes] = await Promise.all([sb.from('ideas').select('*').order('created_at', { ascending: false }), sb.from('idea_votes').select('idea_id,account_id')]);
      const v = ok(votes) || [], count = id => v.filter(x => x.idea_id === id).length, mine = id => v.some(x => x.idea_id === id && x.account_id === S.uid);
      const db = (ok(ideas) || []).map(i => ({ id: i.id, title: i.title, cat: i.cat, text: i.body, by: i.by_name, accountId: i.account_id, votes: 0 }));
      return [...db, ...(window.SEEDS ? SEEDS.ideas : [])].map(i => ({ ...i, votes: i.votes + count(i.id), voted: mine(i.id) })).sort((a, b) => b.votes - a.votes);
    },
    async addIdea(i) { need(); ok(await sb.from('ideas').insert({ title: i.title, cat: i.cat, body: i.text, by_name: S.profile.username })); },
    async voteIdea(id) {
      need(); const had = ok(await sb.from('idea_votes').select('idea_id').eq('idea_id', id).eq('account_id', S.uid).maybeSingle());
      if (had) ok(await sb.from('idea_votes').delete().eq('idea_id', id).eq('account_id', S.uid));
      else ok(await sb.from('idea_votes').insert({ idea_id: id, account_id: S.uid }));
    },

    /* ===== Verwaltung (RLS lässt nur Rolle „verwaltung“ durch) ===== */
    async getAllCharacters() { Auth.needStaff(); return rows(sb.from('characters').select('*').order('created_at'), M.char); },
    async getAllAccounts() { Auth.needStaff(); return rows(sb.from('profiles').select('*').order('created_at'), M.profile); },
    async setAccountStatus(id, status) { Auth.needStaff(); ok(await sb.rpc('set_account_status', { p_id: id, p_status: status })); },
    async getAllVehicles() { Auth.needStaff(); return rows(sb.from('vehicles').select('*').order('plate'), M.vehicle); },
    async getAllBusinesses() { Auth.needStaff(); return rows(sb.from('businesses').select('*').order('name'), M.business); },
    async getAllLicenses() { Auth.needStaff(); const l = ok(await sb.from('licenses').select('*')) || []; return Object.fromEntries(l.map(r => [r.char_id, M.license(r)])); },
    async getAllReports() { Auth.needStaff(); return rows(sb.from('reports').select('*').order('created_at', { ascending: false }), mapReport); },
    async getAllApplications() { Auth.needStaff(); return rows(sb.from('applications').select('*').order('created_at', { ascending: false }), M.application); },
    async setReportStatus(no, status) {
      Auth.needStaff(); const r = ok(await sb.from('reports').select('data').eq('no', no).maybeSingle()); if (!r) throw new Error('Meldung nicht gefunden.');
      ok(await sb.from('reports').update({ status, data: { ...r.data, handledBy: S.profile.username } }).eq('no', no));
    },
    async setBusinessStatus(regNo, status) { Auth.needStaff(); const r = ok(await sb.from('businesses').update({ status }).eq('reg_no', regNo).select()); if (!r.length) throw new Error('Gewerbe nicht gefunden.'); },
    async addBusinessNote(regNo, text) {
      Auth.needStaff(); const b = ok(await sb.from('businesses').select('notes').eq('reg_no', regNo).maybeSingle()); if (!b) throw new Error('Gewerbe nicht gefunden.');
      ok(await sb.from('businesses').update({ notes: [...(b.notes || []), { text, by: S.profile.username, at: today() }] }).eq('reg_no', regNo));
    },
    async setApplicationStatus(no, status) { Auth.needStaff(); ok(await sb.rpc('decide_application', { p_app_no: no, p_status: status })); },
    async addNews({ title, tag, text }) { Auth.needStaff(); ok(await sb.from('news').insert({ title, tag, text, by: S.profile.username })); },
    async removeNews(id) { Auth.needStaff(); ok(await sb.from('news').delete().eq('id', id)); }
  };
  const mapReport = r => ({ ...r.data, no: r.no, status: r.status, accountId: r.account_id, createdAt: r.created_at });

  /* ---- Parität prüfen: jede Demo-Funktion braucht eine Supabase-Variante ---- */
  const missing = Object.keys(PortalAPI).filter(k => typeof PortalAPI[k] === 'function' && !(k in API) && !['currentAccount', 'renderTab'].includes(k));
  if (missing.length) console.warn('[Supabase] Ohne Backend-Variante (läuft noch lokal!):', missing);
  window.__SB_MISSING = missing;
  Object.assign(PortalAPI, API);

  /* ---- Oberfläche an den Live-Modus anpassen ---- */
  const resetBtn = document.getElementById('btn-reset-global'); if (resetBtn) resetBtn.classList.add('hidden');
  window.resetDemo = () => toast('Im Live-Betrieb gibt es keine Demo-Daten zum Zurücksetzen.');

  /* ---- Start: Sitzung laden, dann Oberfläche neu zeichnen ---- */
  (async () => {
    try { await refresh(); } catch (e) { console.error(e); toast('Verbindung zu Supabase fehlgeschlagen: ' + e.message, 'error'); }
    // Abmeldung in einem anderen Tab/auf der Polizei-Seite übernehmen (setTimeout: keine Supabase-Aufrufe direkt im Callback)
    sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT' && S.uid) setTimeout(async () => { await refresh(); renderAuthUI(); window.refreshView?.(); }, 0); });
    renderAuthUI(); renderNews(); window.refreshView?.();
  })();
})();
