/* =====================================================================
   Verbindung zu Supabase
   ---------------------------------------------------------------------
   1. Supabase → Project Settings → API:  "Project URL" und "anon public" Key eintragen.
      (Der anon-Key ist für den Browser gedacht. Den "service_role"-Key NIEMALS hier eintragen!)
   2. Leer lassen = Demo-Modus (Daten nur im Browser, localStorage).
   ===================================================================== */
window.APP_CONFIG = {
  SUPABASE_URL: 'https://wjoqaygsjmyirhobnzjc.supabase.co',            // z. B. https://abcdxyz.supabase.co
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indqb3FheWdzam15aXJob2JuempjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ4MzE5NTYsImV4cCI6MjExMDQwNzk1Nn0.sVGt1PAUVrkhdlhrDMvQMcxLn-xxhXt2ThJLsEVyx3s',       // lange "anon public" Zeichenkette
  EMAIL_DOMAIN: 'portal.tannenthal.de'   // Hilfsdomain: Benutzername → benutzername@portal.tannenthal.de (es werden keine Mails verschickt)
};
