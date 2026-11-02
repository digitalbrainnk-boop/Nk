-- =============================================================================
-- Winner Pronostic — schéma initial
-- -----------------------------------------------------------------------------
-- Principes :
--   * Row Level Security (RLS) activée sur TOUTES les tables du schéma public.
--   * Les données football (compétitions, équipes, matchs…) sont en lecture
--     publique et ne sont écrites que par le serveur (clé secrète / service_role).
--   * Les données personnelles (profils, favoris, paiements…) ne sont lisibles
--     que par leur propriétaire (et par les administrateurs quand c'est utile).
--   * Les écritures sensibles (paiements, abonnements, coupons, pronostics)
--     passent uniquement par le serveur après validation.
--   * Un pronostic publié ne peut plus être modifié ni supprimé (transparence) :
--     seul son résultat peut être renseigné.
-- =============================================================================

create extension if not exists pg_trgm with schema extensions;

-- -----------------------------------------------------------------------------
-- Types énumérés
-- -----------------------------------------------------------------------------
create type public.user_role as enum ('user', 'admin');
create type public.pick_result as enum ('pending', 'won', 'lost', 'void');
create type public.risk_level as enum ('prudent', 'equilibre', 'audacieux');
create type public.coupon_period as enum ('jour', 'weekend', 'long_terme');
create type public.subscription_status as enum ('active', 'expired', 'cancelled');
create type public.payment_status as enum ('pending', 'succeeded', 'failed', 'cancelled', 'refunded');
create type public.payment_provider as enum ('cinetpay', 'fedapay');

-- -----------------------------------------------------------------------------
-- Fonctions utilitaires
-- -----------------------------------------------------------------------------

-- Met à jour automatiquement la colonne updated_at.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Liste des marchés gérés par le moteur de pronostics (phase 4).
--   1X2   : victoire domicile / nul / victoire extérieur
--   DC    : double chance (1X, 12, X2)
--   OU05… : plus/moins de 0.5, 1.5, 2.5, 3.5 buts
--   BTTS  : les deux équipes marquent
--   HTFT  : mi-temps / fin de match
create or replace function public.is_valid_market(p_market text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_market in ('1X2', 'DC', 'OU05', 'OU15', 'OU25', 'OU35', 'BTTS', 'HTFT');
$$;

-- =============================================================================
-- 1. UTILISATEURS
-- =============================================================================

create table public.profiles (
  id                    uuid primary key references auth.users (id) on delete cascade,
  display_name          text not null check (char_length(display_name) between 2 and 50),
  email                 text,
  phone                 text,
  birth_date            date not null,
  country_code          text not null default 'BF' check (country_code ~ '^[A-Z]{2}$'),
  role                  public.user_role not null default 'user',
  -- Préférences de notifications (phase 7)
  notify_kickoff        boolean not null default true,
  notify_goals          boolean not null default true,
  kickoff_lead_minutes  smallint not null default 30 check (kickoff_lead_minutes between 5 and 180),
  terms_accepted_at     timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- Jeu responsable : 18 ans minimum. La contrainte reste vraie dans le temps
  -- (on ne rajeunit pas), elle est donc sûre même lors d'une restauration.
  constraint profiles_must_be_adult check (birth_date <= (current_date - interval '18 years'))
);

comment on table public.profiles is 'Profil public/privé de chaque utilisateur (1 ligne par compte auth).';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Rôle administrateur de l'utilisateur courant. SECURITY DEFINER pour éviter
-- la récursion des politiques RLS sur profiles.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

-- Création automatique du profil à l'inscription (e-mail ou téléphone).
-- Les métadonnées viennent du formulaire d'inscription (validé côté serveur
-- avec zod) ; on revérifie ici l'âge minimum : sans date de naissance valide
-- de majeur, l'inscription est refusée.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta        jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_birth_date  date;
  v_name        text;
  v_country     text;
begin
  begin
    v_birth_date := (v_meta ->> 'birth_date')::date;
  exception when others then
    v_birth_date := null;
  end;

  if v_birth_date is null or v_birth_date > (current_date - interval '18 years') then
    raise exception 'AGE_REQUIREMENT: vous devez avoir au moins 18 ans pour créer un compte'
      using errcode = 'check_violation';
  end if;

  if coalesce((v_meta ->> 'terms_accepted')::boolean, false) is not true then
    raise exception 'TERMS_REQUIRED: les conditions d''utilisation doivent être acceptées'
      using errcode = 'check_violation';
  end if;

  v_name := left(btrim(coalesce(v_meta ->> 'display_name', '')), 50);
  if char_length(v_name) < 2 then
    v_name := 'Parieur ' || left(replace(new.id::text, '-', ''), 6);
  end if;

  v_country := upper(coalesce(v_meta ->> 'country_code', 'BF'));
  if v_country !~ '^[A-Z]{2}$' then
    v_country := 'BF';
  end if;

  insert into public.profiles (id, display_name, email, phone, birth_date, country_code, terms_accepted_at)
  values (new.id, v_name, new.email, new.phone, v_birth_date, v_country, now());

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Garde l'e-mail et le téléphone du profil synchronisés avec auth.users.
create or replace function public.handle_user_contact_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
     set email = new.email,
         phone = new.phone
   where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_contact_updated
  after update of email, phone on auth.users
  for each row
  when (old.email is distinct from new.email or old.phone is distinct from new.phone)
  execute function public.handle_user_contact_update();

-- =============================================================================
-- 2. DONNÉES FOOTBALL (synchronisées depuis API-Football — phase 2)
-- =============================================================================

create table public.competitions (
  id                integer primary key,            -- identifiant « league » d'API-Football
  name              text not null,
  type              text not null default 'league' check (type in ('league', 'cup')),
  country_name      text not null,
  country_code      text,                           -- ISO 3166-1 alpha-2 (null pour « World »)
  country_flag_url  text,
  logo_url          text,
  current_season    smallint,
  is_enabled        boolean not null default false, -- affichée dans l'application (géré par l'admin)
  is_featured       boolean not null default false, -- mise en avant sur l'accueil
  display_order     smallint not null default 100,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index competitions_enabled_idx on public.competitions (display_order, name) where is_enabled;
create trigger competitions_set_updated_at
  before update on public.competitions
  for each row execute function public.set_updated_at();

create table public.teams (
  id              integer primary key,              -- identifiant « team » d'API-Football
  name            text not null,
  short_code      text,
  country_name    text,
  logo_url        text,
  is_national     boolean not null default false,
  venue_name      text,
  -- Classement Elo calculé par le moteur (phase 4)
  elo_rating      numeric(7, 2) not null default 1500,
  elo_updated_at  timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Recherche d'équipe rapide (ILIKE '%…%')
create index teams_name_trgm_idx on public.teams using gin (lower(name) extensions.gin_trgm_ops);
create trigger teams_set_updated_at
  before update on public.teams
  for each row execute function public.set_updated_at();

create table public.fixtures (
  id              integer primary key,              -- identifiant « fixture » d'API-Football
  competition_id  integer not null references public.competitions (id) on delete cascade,
  season          smallint not null,
  round           text,
  kickoff_at      timestamptz not null,
  status_short    text not null default 'NS',
  status_long     text,
  -- Regroupement des statuts API-Football pour filtrer facilement
  status_group    text generated always as (
    case
      when status_short in ('1H', 'HT', '2H', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE') then 'live'
      when status_short in ('FT', 'AET', 'PEN') then 'finished'
      when status_short = 'PST' then 'postponed'
      when status_short in ('CANC', 'ABD', 'AWD', 'WO') then 'cancelled'
      else 'scheduled'
    end
  ) stored,
  elapsed         smallint,                         -- minute de jeu
  elapsed_extra   smallint,                         -- temps additionnel
  home_team_id    integer not null references public.teams (id),
  away_team_id    integer not null references public.teams (id),
  home_goals      smallint,
  away_goals      smallint,
  ht_home_goals   smallint,
  ht_away_goals   smallint,
  venue_name      text,
  venue_city      text,
  referee         text,
  last_synced_at  timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint fixtures_distinct_teams check (home_team_id <> away_team_id)
);

create index fixtures_kickoff_idx on public.fixtures (kickoff_at);
create index fixtures_competition_kickoff_idx on public.fixtures (competition_id, kickoff_at);
create index fixtures_live_idx on public.fixtures (kickoff_at) where status_group = 'live';
create index fixtures_home_team_idx on public.fixtures (home_team_id, kickoff_at desc);
create index fixtures_away_team_idx on public.fixtures (away_team_id, kickoff_at desc);
create trigger fixtures_set_updated_at
  before update on public.fixtures
  for each row execute function public.set_updated_at();

-- Buts, cartons, remplacements, VAR
create table public.fixture_events (
  id            bigint generated always as identity primary key,
  fixture_id    integer not null references public.fixtures (id) on delete cascade,
  minute        smallint not null,
  extra_minute  smallint,
  team_id       integer references public.teams (id),
  player_name   text,
  assist_name   text,
  type          text not null,                      -- Goal, Card, subst, Var
  detail        text,                               -- Normal Goal, Penalty, Own Goal, Yellow Card, Red Card…
  comments      text,
  event_key     text not null,                      -- clé de dédoublonnage calculée à la synchro
  created_at    timestamptz not null default now(),
  unique (fixture_id, event_key)
);

create index fixture_events_fixture_idx on public.fixture_events (fixture_id, minute);

create table public.standings (
  competition_id      integer not null references public.competitions (id) on delete cascade,
  season              smallint not null,
  group_name          text not null default '',
  team_id             integer not null references public.teams (id) on delete cascade,
  rank                smallint not null,
  points              smallint not null default 0,
  goals_diff          smallint not null default 0,
  played              smallint not null default 0,
  won                 smallint not null default 0,
  drawn               smallint not null default 0,
  lost                smallint not null default 0,
  goals_for           smallint not null default 0,
  goals_against       smallint not null default 0,
  home_played         smallint not null default 0,
  home_won            smallint not null default 0,
  home_drawn          smallint not null default 0,
  home_lost           smallint not null default 0,
  home_goals_for      smallint not null default 0,
  home_goals_against  smallint not null default 0,
  away_played         smallint not null default 0,
  away_won            smallint not null default 0,
  away_drawn          smallint not null default 0,
  away_lost           smallint not null default 0,
  away_goals_for      smallint not null default 0,
  away_goals_against  smallint not null default 0,
  form                text,                         -- ex : « WWDLW »
  description         text,                         -- ex : « Promotion - Champions League »
  updated_at          timestamptz not null default now(),
  primary key (competition_id, season, group_name, team_id)
);

-- Cotes des bookmakers fournies par l'API (affichage + détection des value bets)
create table public.fixture_odds (
  fixture_id      integer not null references public.fixtures (id) on delete cascade,
  bookmaker_id    integer not null,
  bookmaker_name  text not null,
  market          text not null check (public.is_valid_market(market)),
  selection       text not null,
  odd             numeric(7, 3) not null check (odd > 1),
  updated_at      timestamptz not null default now(),
  primary key (fixture_id, bookmaker_id, market, selection)
);

-- Cache des réponses brutes d'API-Football (compositions, blessés,
-- confrontations directes…) pour respecter les quotas. Serveur uniquement.
create table public.api_cache (
  cache_key   text primary key,
  payload     jsonb not null,
  fetched_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);

create index api_cache_expires_idx on public.api_cache (expires_at);

-- Journal des synchronisations (suivi des tâches cron et du quota API)
create table public.sync_runs (
  id              bigint generated always as identity primary key,
  job             text not null,
  status          text not null default 'running' check (status in ('running', 'success', 'error')),
  api_requests    integer not null default 0,
  items_upserted  integer not null default 0,
  error           text,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz
);

create index sync_runs_job_idx on public.sync_runs (job, started_at desc);

-- =============================================================================
-- 3. ABONNEMENTS ET PAIEMENTS (phase 6)
-- =============================================================================

create table public.plans (
  code           text primary key check (code ~ '^[a-z_]{2,30}$'),
  name           text not null,
  price_xof      integer not null check (price_xof > 0),
  duration_days  smallint not null check (duration_days > 0),
  is_active      boolean not null default true,
  display_order  smallint not null default 100,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger plans_set_updated_at
  before update on public.plans
  for each row execute function public.set_updated_at();

create table public.payments (
  id                       uuid primary key default gen_random_uuid(),
  -- Les paiements sont des pièces comptables : on les garde même si le compte est supprimé.
  user_id                  uuid references auth.users (id) on delete set null,
  plan_code                text not null references public.plans (code),
  provider                 public.payment_provider not null,
  provider_transaction_id  text not null unique,     -- identifiant que NOUS envoyons à l'agrégateur
  provider_reference       text,                     -- identifiant renvoyé par l'agrégateur
  amount_xof               integer not null check (amount_xof > 0),
  currency                 text not null default 'XOF' check (currency = 'XOF'),
  operator                 text,                     -- orange_money, moov_money…
  phone                    text,
  status                   public.payment_status not null default 'pending',
  raw_payload              jsonb,                    -- dernière notification reçue (sans secret)
  paid_at                  timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index payments_user_idx on public.payments (user_id, created_at desc);
create index payments_status_idx on public.payments (status, created_at desc);
create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

create table public.subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  plan_code   text not null references public.plans (code),
  payment_id  uuid unique references public.payments (id) on delete set null,
  status      public.subscription_status not null default 'active',
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint subscriptions_valid_period check (ends_at > starts_at)
);

create index subscriptions_user_idx on public.subscriptions (user_id, ends_at desc);
create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- L'utilisateur courant a-t-il un abonnement premium en cours ?
create or replace function public.is_premium()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.subscriptions
    where user_id = (select auth.uid())
      and status = 'active'
      and starts_at <= now()
      and ends_at > now()
  );
$$;

-- =============================================================================
-- 4. PRONOSTICS, HISTORIQUE ET COUPONS (phases 4 et 5)
-- =============================================================================

-- Sortie brute du modèle pour un match (toutes les probabilités de tous les marchés)
create table public.predictions (
  id                   uuid primary key default gen_random_uuid(),
  fixture_id           integer not null references public.fixtures (id) on delete cascade,
  model_version        text not null,
  expected_home_goals  numeric(5, 3) not null check (expected_home_goals >= 0),
  expected_away_goals  numeric(5, 3) not null check (expected_away_goals >= 0),
  home_elo             numeric(7, 2),
  away_elo             numeric(7, 2),
  -- ex : {"1X2": {"1": 0.47, "X": 0.27, "2": 0.26}, "OU25": {"OVER": 0.52, "UNDER": 0.48}, …}
  probabilities        jsonb not null,
  -- Données d'entrée utilisées (forme, absences…) pour l'explication et le débogage
  inputs               jsonb,
  computed_at          timestamptz not null default now(),
  unique (fixture_id, model_version)
);

create index predictions_fixture_idx on public.predictions (fixture_id);

-- Pronostics PUBLIÉS = historique public. Une ligne publiée est figée :
-- seul le résultat (result, settled_at) peut ensuite être renseigné.
create table public.prediction_picks (
  id                   uuid primary key default gen_random_uuid(),
  prediction_id        uuid not null references public.predictions (id) on delete restrict,
  fixture_id           integer not null references public.fixtures (id) on delete restrict,
  competition_id       integer not null references public.competitions (id) on delete restrict,
  market               text not null check (public.is_valid_market(market)),
  selection            text not null,
  probability          numeric(5, 4) not null check (probability > 0 and probability < 1),
  best_odd             numeric(7, 3) check (best_odd > 1),
  bookmaker_name       text,
  implied_probability  numeric(5, 4) check (implied_probability > 0 and implied_probability < 1),
  edge                 numeric(6, 4),               -- espérance : probabilité × cote − 1
  is_value_bet         boolean not null default false,
  confidence           smallint not null check (confidence between 1 and 5),
  is_premium           boolean not null default true,
  published_at         timestamptz not null default now(),
  result               public.pick_result not null default 'pending',
  settled_at           timestamptz,
  unique (fixture_id, market)
);

create index prediction_picks_published_idx on public.prediction_picks (published_at desc);
create index prediction_picks_stats_idx on public.prediction_picks (market, competition_id) where result <> 'pending';

-- Transparence : interdiction de réécrire l'histoire.
create or replace function public.protect_published_pick()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'PICK_IMMUTABLE: un pronostic publié ne peut pas être supprimé (marquez-le « void »)';
  end if;

  if (new.prediction_id, new.fixture_id, new.competition_id, new.market, new.selection,
      new.probability, new.best_odd, new.bookmaker_name, new.implied_probability, new.edge,
      new.is_value_bet, new.confidence, new.published_at)
     is distinct from
     (old.prediction_id, old.fixture_id, old.competition_id, old.market, old.selection,
      old.probability, old.best_odd, old.bookmaker_name, old.implied_probability, old.edge,
      old.is_value_bet, old.confidence, old.published_at)
  then
    raise exception 'PICK_IMMUTABLE: seuls le résultat et l''accès premium d''un pronostic publié peuvent changer';
  end if;

  return new;
end;
$$;

create trigger prediction_picks_protect_update
  before update on public.prediction_picks
  for each row execute function public.protect_published_pick();

create trigger prediction_picks_protect_delete
  before delete on public.prediction_picks
  for each row execute function public.protect_published_pick();

-- Coupons : générés par l'utilisateur (user_id renseigné) ou éditoriaux (user_id null, créés par l'admin)
create table public.coupons (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid references auth.users (id) on delete cascade,
  title                  text check (char_length(title) <= 80),
  target_odds            numeric(8, 2) not null check (target_odds >= 1.1 and target_odds <= 1000),
  risk_level             public.risk_level not null,
  period                 public.coupon_period not null,
  total_odds             numeric(10, 3) not null check (total_odds > 1),
  estimated_probability  numeric(6, 5) not null check (estimated_probability > 0 and estimated_probability < 1),
  is_featured            boolean not null default false,
  featured_by            uuid references auth.users (id) on delete set null,
  status                 public.pick_result not null default 'pending',
  created_at             timestamptz not null default now(),
  settled_at             timestamptz
);

create index coupons_user_idx on public.coupons (user_id, created_at desc);
create index coupons_featured_idx on public.coupons (created_at desc) where is_featured;

create table public.coupon_selections (
  id           bigint generated always as identity primary key,
  coupon_id    uuid not null references public.coupons (id) on delete cascade,
  fixture_id   integer not null references public.fixtures (id) on delete cascade,
  pick_id      uuid references public.prediction_picks (id) on delete set null,
  market       text not null check (public.is_valid_market(market)),
  selection    text not null,
  odd          numeric(7, 3) not null check (odd > 1),
  probability  numeric(5, 4) not null check (probability > 0 and probability < 1),
  result       public.pick_result not null default 'pending',
  -- Une seule sélection par match dans un coupon (évite les paris corrélés)
  unique (coupon_id, fixture_id)
);

create index coupon_selections_fixture_idx on public.coupon_selections (fixture_id);

-- =============================================================================
-- 5. FAVORIS ET NOTIFICATIONS (phase 7)
-- =============================================================================

create table public.favorite_teams (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  team_id     integer not null references public.teams (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, team_id)
);

create index favorite_teams_team_idx on public.favorite_teams (team_id);

create table public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint      text not null unique check (endpoint ~ '^https://'),
  p256dh        text not null,
  auth_key      text not null,
  user_agent    text,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- Évite d'envoyer deux fois la même alerte
create table public.notification_log (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  fixture_id  integer references public.fixtures (id) on delete cascade,
  kind        text not null check (kind in ('kickoff', 'goal', 'result', 'coupon', 'info')),
  event_key   text not null default '',
  sent_at     timestamptz not null default now(),
  unique (user_id, fixture_id, kind, event_key)
);

-- =============================================================================
-- 6. ADMINISTRATION ET SÉCURITÉ
-- =============================================================================

create table public.app_settings (
  key          text primary key check (key ~ '^[a-z0-9_]{2,50}$'),
  value        jsonb not null,
  description  text,
  is_public    boolean not null default false,
  updated_by   uuid references auth.users (id) on delete set null,
  updated_at   timestamptz not null default now()
);

create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();

create table public.admin_audit_log (
  id            bigint generated always as identity primary key,
  admin_id      uuid references auth.users (id) on delete set null,
  action        text not null,
  target_table  text,
  target_id     text,
  details       jsonb,
  created_at    timestamptz not null default now()
);

create index admin_audit_log_created_idx on public.admin_audit_log (created_at desc);

-- Limitation du nombre de requêtes (fenêtre fixe), partagée entre toutes les
-- instances serverless. Utilisée uniquement par le serveur.
create table public.rate_limits (
  key           text primary key,
  window_start  timestamptz not null,
  hits          integer not null
);

create or replace function public.rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hits integer;
begin
  if p_limit < 1 or p_window_seconds < 1 then
    raise exception 'rate_limit_hit: paramètres invalides';
  end if;

  insert into public.rate_limits as r (key, window_start, hits)
  values (p_key, now(), 1)
  on conflict (key) do update
    set hits = case
                 when r.window_start <= now() - make_interval(secs => p_window_seconds) then 1
                 else r.hits + 1
               end,
        window_start = case
                         when r.window_start <= now() - make_interval(secs => p_window_seconds) then now()
                         else r.window_start
                       end
  returning hits into v_hits;

  return v_hits <= p_limit;
end;
$$;

-- Nettoyage des compteurs expirés (appelé par une tâche planifiée)
create or replace function public.prune_rate_limits(p_older_than_seconds integer default 86400)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.rate_limits
   where window_start < now() - make_interval(secs => p_older_than_seconds);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- =============================================================================
-- 7. DROITS D'ACCÈS (GRANT) ET ROW LEVEL SECURITY
-- =============================================================================

-- Supabase accorde par défaut tous les droits aux rôles anon/authenticated sur
-- les nouvelles tables : on repart de zéro puis on n'accorde que le nécessaire.
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'competitions', 'teams', 'fixtures', 'fixture_events', 'standings',
    'fixture_odds', 'api_cache', 'sync_runs', 'plans', 'payments', 'subscriptions',
    'predictions', 'prediction_picks', 'coupons', 'coupon_selections', 'favorite_teams',
    'push_subscriptions', 'notification_log', 'app_settings', 'admin_audit_log', 'rate_limits'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end;
$$;

-- Fonctions internes : exécutables uniquement par le serveur.
revoke execute on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
revoke execute on function public.prune_rate_limits(integer) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_user_contact_update() from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;
grant execute on function public.prune_rate_limits(integer) to service_role;

-- --- profiles ----------------------------------------------------------------
-- Lecture : soi-même (ou admin). Modification : uniquement les colonnes
-- « préférences » ; le rôle, l'âge et le contact ne sont pas modifiables.
grant select on public.profiles to authenticated;
grant update (display_name, country_code, notify_kickoff, notify_goals, kickoff_lead_minutes)
  on public.profiles to authenticated;

create policy "profiles: lecture de son profil"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

create policy "profiles: mise à jour de son profil"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- --- Données football : lecture publique ---------------------------------------
grant select on public.competitions, public.teams, public.fixtures, public.fixture_events,
  public.standings, public.fixture_odds, public.plans
  to anon, authenticated;

create policy "competitions: lecture des compétitions actives"
  on public.competitions for select to anon, authenticated
  using (is_enabled or (select public.is_admin()));

-- L'admin choisit les compétitions affichées et leur ordre.
grant update (is_enabled, is_featured, display_order) on public.competitions to authenticated;
create policy "competitions: gestion par l'admin"
  on public.competitions for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "teams: lecture publique"
  on public.teams for select to anon, authenticated using (true);

create policy "fixtures: lecture publique"
  on public.fixtures for select to anon, authenticated using (true);

create policy "fixture_events: lecture publique"
  on public.fixture_events for select to anon, authenticated using (true);

create policy "standings: lecture publique"
  on public.standings for select to anon, authenticated using (true);

create policy "fixture_odds: lecture publique"
  on public.fixture_odds for select to anon, authenticated using (true);

create policy "plans: lecture des offres actives"
  on public.plans for select to anon, authenticated
  using (is_active or (select public.is_admin()));

grant update (name, price_xof, is_active, display_order) on public.plans to authenticated;
create policy "plans: gestion par l'admin"
  on public.plans for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- --- api_cache, rate_limits : serveur uniquement (aucune politique) -----------

-- --- sync_runs : lecture admin ------------------------------------------------
grant select on public.sync_runs to authenticated;
create policy "sync_runs: lecture admin"
  on public.sync_runs for select to authenticated
  using ((select public.is_admin()));

-- --- payments, subscriptions : lecture de ses propres données (admin : tout) ---
-- Les écritures se font uniquement côté serveur (webhooks vérifiés).
grant select on public.payments, public.subscriptions to authenticated;

create policy "payments: lecture de ses paiements"
  on public.payments for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

create policy "subscriptions: lecture de ses abonnements"
  on public.subscriptions for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

-- --- predictions : premium/admin, ou public une fois le match terminé ---------
grant select on public.predictions to anon, authenticated;
create policy "predictions: premium ou match terminé"
  on public.predictions for select to anon, authenticated
  using (
    (select public.is_premium())
    or (select public.is_admin())
    or exists (
      select 1 from public.fixtures f
      where f.id = predictions.fixture_id and f.status_group = 'finished'
    )
  );

-- --- prediction_picks : gratuits pour tous, premium pour les abonnés,
--     et TOUT l'historique réglé est public (transparence).
grant select on public.prediction_picks to anon, authenticated;
create policy "prediction_picks: lecture selon l'offre"
  on public.prediction_picks for select to anon, authenticated
  using (
    not is_premium
    or result <> 'pending'
    or (select public.is_premium())
    or (select public.is_admin())
  );

-- --- coupons ------------------------------------------------------------------
-- Création côté serveur uniquement (le moteur calcule cotes et probabilités) ;
-- l'utilisateur peut lire et supprimer ses coupons, tout le monde lit les
-- coupons mis en avant.
grant select, delete on public.coupons to authenticated;
grant select on public.coupons to anon;
grant select on public.coupon_selections to anon, authenticated;

create policy "coupons: lecture de ses coupons et des coupons mis en avant"
  on public.coupons for select to anon, authenticated
  using (is_featured or user_id = (select auth.uid()) or (select public.is_admin()));

create policy "coupons: suppression de ses coupons"
  on public.coupons for delete to authenticated
  using (user_id = (select auth.uid()) and not is_featured);

create policy "coupon_selections: lecture si le coupon est visible"
  on public.coupon_selections for select to anon, authenticated
  using (exists (select 1 from public.coupons c where c.id = coupon_selections.coupon_id));

-- --- favorite_teams, push_subscriptions : gérés par l'utilisateur -------------
grant select, insert, delete on public.favorite_teams to authenticated;
create policy "favorite_teams: lecture des siens"
  on public.favorite_teams for select to authenticated
  using (user_id = (select auth.uid()));
create policy "favorite_teams: ajout pour soi"
  on public.favorite_teams for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "favorite_teams: suppression des siens"
  on public.favorite_teams for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, delete on public.push_subscriptions to authenticated;
create policy "push_subscriptions: lecture des siens"
  on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));
create policy "push_subscriptions: ajout pour soi"
  on public.push_subscriptions for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "push_subscriptions: suppression des siens"
  on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));

-- --- notification_log : lecture des siens -------------------------------------
grant select on public.notification_log to authenticated;
create policy "notification_log: lecture des siens"
  on public.notification_log for select to authenticated
  using (user_id = (select auth.uid()));

-- --- app_settings : réglages publics lisibles par tous, gestion admin ---------
grant select on public.app_settings to anon, authenticated;
grant update (value, description, is_public, updated_by) on public.app_settings to authenticated;
create policy "app_settings: lecture des réglages publics"
  on public.app_settings for select to anon, authenticated
  using (is_public or (select public.is_admin()));
create policy "app_settings: gestion par l'admin"
  on public.app_settings for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()) and updated_by = (select auth.uid()));

-- --- admin_audit_log : lecture admin (écriture serveur) -----------------------
grant select on public.admin_audit_log to authenticated;
create policy "admin_audit_log: lecture admin"
  on public.admin_audit_log for select to authenticated
  using ((select public.is_admin()));
