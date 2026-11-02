-- =============================================================================
-- Winner Pronostic — données de référence (idempotent)
-- Ces valeurs sont des points de départ : elles se modifient ensuite depuis
-- l'espace administrateur (phase 7) ou directement dans Supabase.
-- =============================================================================

-- Sports proposés (les mêmes définitions techniques sont dans src/lib/sports/catalog.ts)
insert into public.sports (code, name, emoji, has_draw, is_enabled, display_order)
values
  ('football',          'Football',           '⚽', true,  true,  10),
  ('basketball',        'Basketball',         '🏀', false, true,  20),
  ('ice_hockey',        'Hockey sur glace',   '🏒', true,  true,  30),
  ('handball',          'Handball',           '🤾', true,  true,  40),
  ('volleyball',        'Volleyball',         '🏐', false, true,  50),
  ('rugby',             'Rugby',              '🏉', true,  true,  60),
  ('baseball',          'Baseball',           '⚾', false, true,  70),
  ('american_football', 'Football américain', '🏈', false, true,  80),
  -- Tennis : nécessite un autre fournisseur de données (API-Sports ne le couvre pas)
  ('tennis',            'Tennis',             '🎾', false, false, 90)
on conflict (code) do nothing;

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
  ('booking_bookmakers',   '["1xbet"]'::jsonb, 'Bookmakers pour lesquels des codes de chargement sont publiés', true),
  ('responsible_gaming_message',
   '"Les paris sportifs comportent des risques : endettement, isolement, dépendance. Ne misez jamais plus que ce que vous pouvez vous permettre de perdre. Interdit aux moins de 18 ans."'::jsonb,
   'Message de prévention affiché dans l''application', true)
on conflict (key) do nothing;

-- Compétitions de football activées au démarrage (identifiants « league »
-- d'API-Football). La synchronisation (phase 2) met à jour noms, logos et
-- saisons depuis l'API ; les compétitions des autres sports (NBA, NHL,
-- EHF…) et le championnat burkinabè s'activent depuis l'espace admin.
insert into public.competitions (sport, external_id, name, type, country_name, country_code, is_enabled, is_featured, display_order)
values
  ('football', 2,   'UEFA Champions League',        'cup',    'World',   null, true, true,  10),
  ('football', 6,   'Coupe d''Afrique des Nations', 'cup',    'World',   null, true, true,  11),
  ('football', 12,  'CAF Champions League',         'cup',    'World',   null, true, false, 12),
  ('football', 39,  'Premier League',               'league', 'England', 'GB', true, true,  20),
  ('football', 140, 'La Liga',                      'league', 'Spain',   'ES', true, true,  21),
  ('football', 61,  'Ligue 1',                      'league', 'France',  'FR', true, true,  22),
  ('football', 135, 'Serie A',                      'league', 'Italy',   'IT', true, false, 23),
  ('football', 78,  'Bundesliga',                   'league', 'Germany', 'DE', true, false, 24),
  ('football', 3,   'UEFA Europa League',           'cup',    'World',   null, true, false, 30),
  ('football', 1,   'Coupe du Monde',               'cup',    'World',   null, true, false, 31)
on conflict (sport, external_id) do nothing;
