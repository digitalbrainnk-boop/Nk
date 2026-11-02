-- =============================================================================
-- Winner Pronostic — données de référence (idempotent)
-- Ces valeurs sont des points de départ : elles se modifient ensuite depuis
-- l'espace administrateur (phase 7) ou directement dans Supabase.
-- =============================================================================

-- Offres premium (prix en francs CFA, à ajuster selon votre stratégie)
insert into public.plans (code, name, price_xof, duration_days, display_order)
values
  ('weekly',  'Premium semaine', 1000,  7, 10),
  ('monthly', 'Premium mois',    3000, 30, 20)
on conflict (code) do nothing;

-- Réglages de l'application
insert into public.app_settings (key, value, description, is_public)
values
  ('free_picks_per_day',   '3'::jsonb,    'Nombre de pronostics gratuits publiés chaque jour', true),
  ('free_coupons_per_day', '1'::jsonb,    'Nombre de coupons générés par jour pour un compte gratuit', true),
  ('ads_enabled',          'true'::jsonb, 'Afficher la publicité aux utilisateurs gratuits', true),
  ('min_age',              '18'::jsonb,   'Âge minimum pour créer un compte', true),
  ('responsible_gaming_message',
   '"Les paris sportifs comportent des risques : endettement, isolement, dépendance. Ne misez jamais plus que ce que vous pouvez vous permettre de perdre. Interdit aux moins de 18 ans."'::jsonb,
   'Message de prévention affiché dans l''application', true)
on conflict (key) do nothing;

-- Compétitions activées au démarrage (identifiants « league » d'API-Football).
-- La synchronisation (phase 2) met à jour noms, logos et saisons depuis l'API ;
-- les autres compétitions (dont le championnat burkinabè si l'API le couvre)
-- s'activent depuis l'espace admin.
insert into public.competitions (id, name, type, country_name, country_code, is_enabled, is_featured, display_order)
values
  (2,   'UEFA Champions League',     'cup',    'World',   null, true, true,  10),
  (6,   'Coupe d''Afrique des Nations', 'cup', 'World',   null, true, true,  11),
  (12,  'CAF Champions League',      'cup',    'World',   null, true, false, 12),
  (39,  'Premier League',            'league', 'England', 'GB', true, true,  20),
  (140, 'La Liga',                   'league', 'Spain',   'ES', true, true,  21),
  (61,  'Ligue 1',                   'league', 'France',  'FR', true, true,  22),
  (135, 'Serie A',                   'league', 'Italy',   'IT', true, false, 23),
  (78,  'Bundesliga',                'league', 'Germany', 'DE', true, false, 24),
  (3,   'UEFA Europa League',        'cup',    'World',   null, true, false, 30),
  (1,   'Coupe du Monde',            'cup',    'World',   null, true, false, 31)
on conflict (id) do nothing;
