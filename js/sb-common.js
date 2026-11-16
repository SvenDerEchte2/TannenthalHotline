/* =====================================================================
   Gemeinsame Supabase-Helfer für Bürgerportal UND Polizei-Website
   Wird nur aktiv, wenn js/config.js eine URL + Key enthält (sonst Demo-Modus).
   ===================================================================== */
(function () {
  const CFG = window.APP_CONFIG || {};
  const enabled = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase);
  window.SBX = { enabled, CFG };
  if (!enabled) {
    if (CFG.SUPABASE_URL && !window.supabase) console.error('[Supabase] supabase-js wurde nicht geladen (CDN blockiert?) – Demo-Modus aktiv.');
    else console.info('[Demo-Modus] Keine Supabase-Konfiguration – Daten liegen nur im Browser.');
    return;
  }

  // Beide Seiten teilen sich denselben storageKey → einmal anmelden, überall angemeldet
  const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'np-supabase-auth' } });
  const emailOf = u => `${String(u).trim().toLowerCase()}@${CFG.EMAIL_DOMAIN || 'portal.example.com'}`;

  /* ---------- Fehler auf verständliches Deutsch abbilden ---------- */
  const ERRORS = [
    [/characters_name_uq/, 'Ein Bürger mit diesem Namen ist bereits registriert.'],
    [/vehicles_plate_key/, 'Dieses Kennzeichen ist bereits vergeben.'],
    [/businesses_name_uq/, 'Ein Gewerbe mit diesem Namen existiert bereits.'],
    [/businesses_plot_id_key/, 'Dieser Standort wurde gerade vergeben.'],
    [/businesses_phone_key/, 'Diese Telefonnummer ist bereits vergeben.'],
    [/businesses_phone_check/, 'Telefonnummer bitte im Format 555-1234 angeben.'],
    [/applications_open_uq/, 'Für diese Fraktion liegt bereits eine offene Bewerbung Ihres Charakters vor.'],
    [/applications_text_check/, 'Ihre Motivation ist zu kurz (mind. 80 Zeichen).'],
    [/profiles_username_uq|User already registered/i, 'Dieser Benutzername ist bereits vergeben.'],
    [/Invalid login credentials/i, 'Benutzername oder Passwort ist falsch.'],
    [/Password should be at least/i, 'Das Passwort muss mindestens 6 Zeichen lang sein.'],
    [/row-level security|permission denied/i, 'Keine Berechtigung – ist Ihr Konto von der Verwaltung freigeschaltet?'],
    [/Failed to fetch|NetworkError|Load failed/i, 'Keine Verbindung zum Server. Bitte später erneut versuchen.']
  ];
  const tr = e => { const m = (e && e.message) || String(e); const hit = ERRORS.find(([re]) => re.test(m)); return new Error(hit ? hit[1] : m); };
  const ok = res => { if (res.error) throw tr(res.error); return res.data; };

  /* ---------- Zeilen (snake_case) ⇄ Objekte der Oberfläche (camelCase) ---------- */
  const M = {
    profile: r => ({ id: r.id, username: r.username, role: r.role, status: r.status, decidedBy: r.decided_by, createdAt: r.created_at }),
    char: r => ({ id: r.id, accountId: r.account_id, citizenId: r.citizen_id, username: r.username, first: r.first, last: r.last, birth: r.birth, sex: r.sex, district: r.district, photo: r.photo, validUntil: r.valid_until, createdAt: r.created_at }),
    vehicle: r => ({ id: r.id, plate: r.plate, type: r.type, model: r.model, color: r.color, status: r.status, caseNo: r.case_no, lastSeen: r.last_seen, wantedReason: r.wanted_reason || '', ownerCharId: r.owner_char_id, accountId: r.account_id, owner: r.owner_name, citizenId: r.citizen_id, createdAt: r.created_at }),
    business: r => ({ id: r.id, regNo: r.reg_no, name: r.name, legalForm: r.legal_form, industry: r.industry, plotId: r.plot_id, plotName: r.plot_name, phone: r.phone, hours: r.hours, description: r.description, listed: r.listed, status: r.status, staff: r.staff || [], notes: r.notes || [], ownerCharId: r.owner_char_id, accountId: r.account_id, owner: r.owner_name, createdAt: r.created_at }),
    application: r => ({ appNo: r.app_no, accountId: r.account_id, charId: r.char_id, faction: r.faction, name: r.name, discord: r.discord, age: r.age, experience: r.experience, text: r.text, status: r.status, decidedBy: r.decided_by, createdAt: r.created_at }),
    license: r => ({ no: r.no, classes: r.classes || [], issuedAt: r.issued_at }),
    news: r => ({ id: r.id, date: r.date, tag: r.tag, title: r.title, text: r.text, custom: true, by: r.by }),
    press: r => ({ id: r.id, ref: r.ref, date: r.date, tag: r.tag, title: r.title, text: r.text, custom: r.custom, by: r.by }),
    kase: r => ({ id: r.id, type: r.type, charId: r.char_id, charName: r.char_name, citizenId: r.citizen_id, plate: r.plate || '', offense: r.offense || '', text: r.text, fine: r.fine, status: r.status, by: r.by, byAccount: r.by_account, badge: r.badge, createdAt: r.created_at }),
    warrant: r => ({ id: r.id, charId: r.char_id, charName: r.char_name || 'Unbekannt', citizenId: r.citizen_id, level: r.level, reason: r.reason, public: r.public, active: r.active, by: r.by, closedBy: r.closed_by, closedAt: r.closed_at, createdAt: r.created_at }),
    record: r => ({ id: r.id, kind: r.kind, sub: r.sub || '', title: r.title || '', text: r.text || '', location: r.location || '', offense: r.offense || '', items: r.items || '', storage: r.storage || '', plate: r.plate || '', sentence: r.sentence || '', sentenceDetail: r.sentence_detail || '', fileNo: r.file_no || '', date: r.date, status: r.status, charId: r.char_id, charName: r.char_name || '', citizenId: r.citizen_id || '', by: r.by, byAccount: r.by_account, badge: r.badge, createdAt: r.created_at }),
    tip: r => ({ no: r.no, type: r.type, location: r.location, when: r.when_text || '', plate: r.plate || '', text: r.text, name: r.name || '', discord: r.discord || '', anonymous: r.anonymous, status: r.status, notes: r.notes || [], createdAt: r.created_at })
  };

  // camelCase-Patch → snake_case-Spalten (nur erlaubte Felder)
  const toCols = (patch, map) => Object.fromEntries(Object.entries(patch).filter(([k]) => k in map).map(([k, v]) => [map[k], v]));
  const MAPS = {
    vehicle: { plate: 'plate', type: 'type', model: 'model', color: 'color', status: 'status', caseNo: 'case_no', lastSeen: 'last_seen', wantedReason: 'wanted_reason' },
    business: { name: 'name', legalForm: 'legal_form', industry: 'industry', plotId: 'plot_id', plotName: 'plot_name', phone: 'phone', hours: 'hours', description: 'description', listed: 'listed', staff: 'staff' },
    char: { username: 'username', first: 'first', last: 'last', birth: 'birth', sex: 'sex', district: 'district', photo: 'photo' }
  };

  /* ---------- Sitzungs-Cache (die Oberfläche liest Konto/Charaktere synchron) ---------- */
  const S = { uid: null, profile: null, chars: [], officer: null, activeId: null };
  const ACTIVE_KEY = 'np_activechar';
  const loadActive = () => { try { return localStorage.getItem(ACTIVE_KEY); } catch { return null; } };
  const saveActive = id => { try { id ? localStorage.setItem(ACTIVE_KEY, id) : localStorage.removeItem(ACTIVE_KEY); } catch {} };

  async function refresh() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { Object.assign(S, { uid: null, profile: null, chars: [], officer: null }); return; }
    S.uid = session.user.id;
    const [p, c, o] = await Promise.all([
      sb.from('profiles').select('*').eq('id', S.uid).maybeSingle(),
      sb.from('characters').select('*').eq('account_id', S.uid).order('created_at'),
      sb.from('officers').select('*').eq('account_id', S.uid).maybeSingle()
    ]);
    S.profile = p.data ? M.profile(p.data) : null;
    S.chars = (c.data || []).map(M.char);
    S.activeId = S.chars.some(x => x.id === (S.activeId || loadActive())) ? (S.activeId || loadActive()) : (S.chars[0] && S.chars[0].id) || null;
    const od = o.data, ch = od && S.chars.find(x => x.id === od.char_id);
    S.officer = od && ch ? { accountId: od.account_id, charId: od.char_id, rank: od.rank, badge: od.badge, since: od.since, char: ch, name: `${ch.first} ${ch.last}` } : null;
  }
  const setActive = id => { S.activeId = id; saveActive(id); };

  /* ---------- Anmeldung (Benutzername → Pseudo-E-Mail) ---------- */
  async function signIn(username, password) {
    const { error } = await sb.auth.signInWithPassword({ email: emailOf(username || ''), password: password || '' });
    if (error) throw tr(error);
    await refresh();
  }
  async function signOut() { await sb.auth.signOut(); Object.assign(S, { uid: null, profile: null, chars: [], officer: null }); }

  Object.assign(window.SBX, { sb, emailOf, tr, ok, M, MAPS, toCols, S, refresh, setActive, signIn, signOut });
})();
