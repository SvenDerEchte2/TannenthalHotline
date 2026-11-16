/* =====================================================================
   Landespolizei – Supabase-Backend
   Ersetzt DB / Public / Auth / Cop aus polizei.html (gleiche Funktionsnamen und Rückgabeformate).
   Aktiv nur, wenn js/config.js eine Supabase-URL + Key enthält.
   Rechte (Dienstgrade) werden zusätzlich serverseitig per RLS erzwungen – siehe supabase/schema.sql.
   ===================================================================== */
(function () {
  const X = window.SBX; if (!X || !X.enabled) return;
  const { sb, ok, M, S, refresh, signIn, signOut } = X;
  const rows = async (q, mapper) => (ok(await q) || []).map(mapper);
  const nowISO = () => new Date().toISOString();

  /* ---- Auth/Cop-Cache ---- */
  Auth.account = () => S.profile;
  Auth.chars = () => S.chars;
  Auth.active = () => S.chars.find(c => c.id === S.activeId) || null;
  Cop.officer = () => S.officer;

  const need = (min = 0) => Cop.need(min);
  const who = me => `${me.rank} ${me.name}`;
  const charById = async id => { const c = ok(await sb.from('characters').select('*').eq('id', id).maybeSingle()); return c ? M.char(c) : null; };

  const API = {
    /* ----- Konto / Dienstzugang ----- */
    async login(username, password) { await signIn(username, password); },
    async logout() { await signOut(); },
    async activateDuty(charId, code) { ok(await sb.rpc('activate_duty', { p_char_id: charId, p_code: code || '' })); await refresh(); },

    /* ----- Register-Daten (RLS: Beamte dürfen lesen) ----- */
    async getCharacters() { need(); return rows(sb.from('characters').select('*').order('created_at'), M.char); },
    async getVehicles() { need(); return rows(sb.from('vehicles').select('*').order('plate'), M.vehicle); },
    async getLicenses() { need(); const l = ok(await sb.from('licenses').select('*')) || []; return Object.fromEntries(l.map(r => [r.char_id, M.license(r)])); },
    async getBusinesses() { need(); return rows(sb.from('businesses').select('*').order('name'), M.business); },

    /* ----- Vorgänge / Bußgelder ----- */
    async getCases() { need(); return rows(sb.from('cases').select('*').order('created_at', { ascending: false }), M.kase); },
    async addCase(d) {
      const me = need(); const ch = await charById(d.charId); if (!ch) throw new Error('Bitte wählen Sie eine Person aus dem Register.');
      const fine = Math.max(0, Math.round(+d.fine || 0));
      const r = ok(await sb.from('cases').insert({ type: d.type, char_id: ch.id, char_name: `${ch.first} ${ch.last}`, citizen_id: ch.citizenId, plate: d.plate || null, offense: d.offense || null, text: d.text, fine, status: fine > 0 ? 'offen' : 'erfasst', by: who(me), badge: me.badge }).select().single());
      return M.kase(r);
    },
    async setCaseStatus(id, status) { need(status === 'erlassen' ? RANK_SENIOR : 0); const r = ok(await sb.from('cases').update({ status }).eq('id', id).select()); if (!r.length) throw new Error('Vorgang nicht gefunden.'); },
    async removeCase(id) { need(RANK_LEAD); ok(await sb.from('cases').delete().eq('id', id)); },

    /* ----- Fahndung ----- */
    async getWarrants() { need(); return rows(sb.from('warrants').select('*').order('created_at', { ascending: false }), M.warrant); },
    async addWarrant(d) {
      const me = need(RANK_SENIOR); const ch = await charById(d.charId); if (!ch) throw new Error('Bitte wählen Sie eine Person aus dem Register.');
      const act = ok(await sb.from('warrants').select('id').eq('char_id', ch.id).eq('active', true));
      if (act.length) throw new Error('Diese Person ist bereits zur Fahndung ausgeschrieben.');
      ok(await sb.from('warrants').insert({ char_id: ch.id, char_name: `${ch.first} ${ch.last}`, citizen_id: ch.citizenId, level: d.level, reason: d.reason, public: !!d.public, by: who(me) }));
    },
    async closeWarrant(id) { const me = need(RANK_SENIOR); ok(await sb.from('warrants').update({ active: false, closed_by: who(me), closed_at: nowISO() }).eq('id', id)); },
    async setVehicleWanted(id, on, reason) { need(RANK_SENIOR); ok(await sb.rpc('set_vehicle_wanted', { p_id: id, p_wanted: !!on, p_reason: reason || null })); },

    /* ----- Akten: Berichte, Festnahmen, Asservate, Vorstrafen ----- */
    async getRecords(kind) { need(); let q = sb.from('records').select('*').order('created_at', { ascending: false }); if (kind) q = q.eq('kind', kind); return rows(q, M.record); },
    async addRecord(kind, d) {
      const me = need(kind === 'vorstrafe' ? RANK_SENIOR : 0);
      const ch = d.charId ? await charById(d.charId) : null; if (d.charId && !ch) throw new Error('Person nicht im Register gefunden.');
      const req = (v, msg) => { if (!String(v || '').trim()) throw new Error(msg); };
      if (kind === 'bericht') { req(d.title, 'Bitte geben Sie einen Betreff an.'); req(d.text, 'Bitte schreiben Sie den Berichtstext.'); }
      else if (kind === 'festnahme') { if (!ch) throw new Error('Bitte wählen Sie die festgenommene Person aus dem Register.'); req(d.offense, 'Bitte geben Sie den Tatvorwurf an.'); req(d.text, 'Bitte schildern Sie den Hergang.'); }
      else if (kind === 'asservat') { req(d.items, 'Bitte nennen Sie die sichergestellten Gegenstände.'); req(d.text, 'Bitte geben Sie den Grund der Beschlagnahme an.'); }
      else if (kind === 'vorstrafe') { if (!ch) throw new Error('Bitte wählen Sie die verurteilte Person aus dem Register.'); req(d.offense, 'Bitte geben Sie die Straftat an.'); req(d.sentence, 'Bitte wählen Sie die Strafart.'); }
      else throw new Error('Unbekannte Aktenart.');
      const pre = { bericht: 'BE', festnahme: 'FN', asservat: 'AS', vorstrafe: 'VS' }[kind];
      const r = ok(await sb.from('records').insert({ id: `${pre}-${rid(5)}`, kind, sub: d.sub || null, title: (d.title || '').trim() || null, text: (d.text || '').trim() || null, location: d.location || null, offense: (d.offense || '').trim() || null,
        items: (d.items || '').trim() || null, storage: d.storage || null, plate: d.plate || null, sentence: d.sentence || null, sentence_detail: (d.sentenceDetail || '').trim() || null, file_no: (d.fileNo || '').trim() || null,
        date: d.date || new Date().toISOString().slice(0, 10), status: kind === 'asservat' ? 'sichergestellt' : 'erfasst', char_id: ch ? ch.id : null, char_name: ch ? `${ch.first} ${ch.last}` : null, citizen_id: ch ? ch.citizenId : null,
        by: who(me), badge: me.badge }).select().single());
      if (kind === 'festnahme' && d.closeWarrant && ch && rankIdx(me.rank) >= RANK_SENIOR)
        ok(await sb.from('warrants').update({ active: false, closed_by: who(me), closed_at: nowISO() }).eq('char_id', ch.id).eq('active', true));
      return M.record(r);
    },
    async setRecordStatus(id, status) {
      need(RANK_SENIOR); if (!SEIZE_STATUS[status]) throw new Error('Ungültiger Status.');
      const r = ok(await sb.from('records').update({ status }).eq('id', id).eq('kind', 'asservat').select()); if (!r.length) throw new Error('Asservat nicht gefunden.');
    },
    async removeRecord(id) { need(RANK_LEAD); ok(await sb.from('records').delete().eq('id', id)); },

    /* ----- Onlinewache-Eingänge ----- */
    async getTips() { need(); return rows(sb.from('tips').select('*').order('created_at', { ascending: false }), M.tip); },
    async setTipStatus(no, status) { need(); const r = ok(await sb.from('tips').update({ status }).eq('no', no).select()); if (!r.length) throw new Error('Eingang nicht gefunden.'); },
    async addTipNote(no, text, pub) {
      const me = need(); const t = ok(await sb.from('tips').select('notes').eq('no', no).maybeSingle()); if (!t) throw new Error('Eingang nicht gefunden.');
      ok(await sb.from('tips').update({ notes: [...(t.notes || []), { text, public: !!pub, by: who(me), at: nowISO() }] }).eq('no', no));
    },

    /* ----- Pressestelle ----- */
    async getPress() { need(); return Public.getPress(); },
    async addPress(d) {
      const me = need(RANK_PRESS);
      ok(await sb.from('press').insert({ ref: `POL-${new Date().getFullYear()}-${rid(5)}`, tag: d.tag, title: d.title, text: d.text, custom: true, by: who(me) }));
    },
    async removePress(id) { need(RANK_PRESS); ok(await sb.from('press').delete().eq('id', id)); },

    /* ----- Personal & Bewerbungen ----- */
    async getOfficers() {
      need(); const off = ok(await sb.from('officers').select('*')) || [];
      const chars = Object.fromEntries((ok(await sb.from('characters').select('*').in('id', off.map(o => o.char_id))) || []).map(c => [c.id, M.char(c)]));
      return off.map(o => { const c = chars[o.char_id]; return c ? { accountId: o.account_id, charId: o.char_id, rank: o.rank, badge: o.badge, since: o.since, char: c, name: `${c.first} ${c.last}` } : null; })
        .filter(Boolean).sort((a, b) => rankIdx(b.rank) - rankIdx(a.rank) || a.name.localeCompare(b.name, 'de'));
    },
    async setRank(accountId, rank) {
      const me = need(RANK_LEAD); if (!RANKS.includes(rank)) throw new Error('Ungültiger Dienstgrad.');
      if (accountId === me.accountId) throw new Error('Den eigenen Dienstgrad können Sie nicht ändern.');
      ok(await sb.from('officers').update({ rank }).eq('account_id', accountId));
    },
    async removeOfficer(accountId) {
      const me = need(RANK_LEAD); if (accountId === me.accountId) throw new Error('Sie können sich nicht selbst entlassen.');
      ok(await sb.from('officers').delete().eq('account_id', accountId));
    },
    async getMyPoliceApplications() { return S.uid ? rows(sb.from('applications').select('*').eq('account_id', S.uid).eq('faction', 'polizei'), M.application) : []; },
    async getPoliceApplications() { need(RANK_LEAD); return rows(sb.from('applications').select('*').eq('faction', 'polizei').order('created_at', { ascending: false }), M.application); },
    async decideApplication(no, status) { need(RANK_LEAD); ok(await sb.rpc('decide_application', { p_app_no: no, p_status: status })); }
  };

  /* ---- Öffentliche Schnittstelle (ohne Anmeldung nutzbar) ---- */
  const PUB = {
    async getPress() { const db = await rows(sb.from('press').select('*').order('date', { ascending: false }), M.press); return [...db, ...SEED_PRESS].sort((a, b) => String(b.date).localeCompare(String(a.date))); },
    async getPublicWarrants() { return rows(sb.from('public_warrants').select('*').order('created_at', { ascending: false }), w => ({ id: w.id, level: w.level, reason: w.reason, createdAt: w.created_at, charName: w.char_name, photo: w.photo, district: w.district, age: w.age })); },
    async submitTip(d) {
      return ok(await sb.rpc('submit_tip', { p_type: d.type, p_location: d.location, p_when: d.when || null, p_plate: d.plate || null, p_text: d.text, p_name: d.name || null, p_discord: d.discord || null, p_anonymous: !!d.anonymous }));
    },
    async getTip(no) {
      const r = ok(await sb.rpc('get_tip', { p_no: no || '' })); const t = r && r[0]; if (!t) return null;
      return { no: t.no, type: t.type, status: t.status, createdAt: t.created_at, notes: t.notes || [] };
    }
  };

  const missing = [...Object.keys(DB).filter(k => typeof DB[k] === 'function' && !k.startsWith('_') && !(k in API)), ...Object.keys(Public).filter(k => !(k in PUB)).map(k => 'Public.' + k)];
  if (missing.length) console.warn('[Supabase] Ohne Backend-Variante (läuft noch lokal!):', missing);
  window.__SB_MISSING = missing;
  Object.assign(DB, API); Object.assign(Public, PUB);

  /* ---- Start: Sitzung laden, dann neu zeichnen ---- */
  (async () => {
    try { await refresh(); } catch (e) { console.error(e); toast('Verbindung zu Supabase fehlgeschlagen: ' + e.message, 'error'); }
    sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT' && S.uid) setTimeout(async () => { await refresh(); render(); }, 0); });
    render();
  })();
})();
