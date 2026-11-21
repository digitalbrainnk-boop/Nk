-- =============================================================================
-- Winner Pronostic — migration 3 : exploitation (synchronisation, résultats,
-- statistiques de réussite, abonnements, réglages)
-- =============================================================================

-- --- Suivi de synchronisation ------------------------------------------------
alter table public.competitions
  add column if not exists season_synced_at timestamptz,
  add column if not exists standings_synced_at timestamptz;

alter table public.events
  add column if not exists odds_synced_at timestamptz,
  add column if not exists settled_at timestamptz;

create index if not exists events_upcoming_idx on public.events (starts_at) where status_group = 'scheduled';
create index if not exists events_to_settle_idx on public.events (starts_at) where status_group = 'finished' and settled_at is null;

-- --- Statistiques de réussite (historique public) ------------------------------
-- Taux de réussite par sport, marché et compétition. SECURITY INVOKER : seuls
-- les pronostics visibles par l'appelant (l'historique réglé est public) comptent.
create or replace function public.pick_stats(p_since timestamptz default '-infinity')
returns table (
  level          text,
  sport          text,
  market         text,
  competition_id bigint,
  competition    text,
  settled        bigint,
  won            bigint,
  lost           bigint,
  void           bigint,
  win_rate       numeric,
  avg_odd        numeric,
  roi            numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with picks as (
    select p.sport, p.market, p.competition_id, c.name as competition, p.result, p.best_odd
    from public.prediction_picks p
    join public.competitions c on c.id = p.competition_id
    where p.result <> 'pending' and p.published_at >= p_since
  )
  select
    case
      when grouping(sport) = 1 then 'global'
      when grouping(market) = 0 then 'market'
      when grouping(competition_id) = 0 then 'competition'
      else 'sport'
    end as level,
    sport,
    market,
    competition_id,
    max(competition) as competition,
    count(*) filter (where result in ('won', 'lost')) as settled,
    count(*) filter (where result = 'won') as won,
    count(*) filter (where result = 'lost') as lost,
    count(*) filter (where result = 'void') as void,
    round(
      (count(*) filter (where result = 'won'))::numeric
        / nullif(count(*) filter (where result in ('won', 'lost')), 0),
      4
    ) as win_rate,
    round(avg(best_odd) filter (where result in ('won', 'lost')), 2) as avg_odd,
    -- Retour sur mise théorique (1 unité par pronostic à la meilleure cote connue)
    round(
      (sum(case when result = 'won' and best_odd is not null then best_odd - 1
                when result = 'lost' and best_odd is not null then -1 else 0 end))
        / nullif(count(*) filter (where result in ('won', 'lost') and best_odd is not null), 0),
      4
    ) as roi
  from picks
  group by grouping sets ((), (sport), (sport, market), (sport, competition_id))
$$;

grant execute on function public.pick_stats(timestamptz) to anon, authenticated, service_role;

-- --- Abonnements : activation atomique et idempotente -------------------------
-- Appelée par le serveur quand l'agrégateur a CONFIRMÉ le paiement. Un même
-- paiement ne peut créer qu'un seul abonnement (verrou + contrainte unique).
create or replace function public.activate_subscription(p_payment_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment       public.payments%rowtype;
  v_plan          public.plans%rowtype;
  v_existing      uuid;
  v_start         timestamptz;
  v_subscription  uuid;
begin
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND';
  end if;

  select id into v_existing from public.subscriptions where payment_id = p_payment_id;
  if v_existing is not null then
    return v_existing; -- déjà traité (notification reçue deux fois)
  end if;

  if v_payment.user_id is null then
    raise exception 'PAYMENT_WITHOUT_USER';
  end if;

  select * into v_plan from public.plans where code = v_payment.plan_code;
  if v_payment.amount_xof < v_plan.price_xof then
    raise exception 'AMOUNT_MISMATCH';
  end if;

  -- L'abonnement prolonge l'abonnement en cours s'il y en a un.
  select greatest(now(), coalesce(max(ends_at), now())) into v_start
    from public.subscriptions
   where user_id = v_payment.user_id and status = 'active' and ends_at > now();

  insert into public.subscriptions (user_id, plan_code, payment_id, status, starts_at, ends_at)
  values (v_payment.user_id, v_plan.code, v_payment.id, 'active', v_start, v_start + make_interval(days => v_plan.duration_days))
  returning id into v_subscription;

  update public.payments
     set status = 'succeeded', paid_at = coalesce(paid_at, now())
   where id = p_payment_id;

  return v_subscription;
end;
$$;

revoke execute on function public.activate_subscription(uuid) from public, anon, authenticated;
grant execute on function public.activate_subscription(uuid) to service_role;

-- Abonnement offert par un administrateur (geste commercial, test…)
create or replace function public.grant_subscription(p_user_id uuid, p_plan_code text, p_admin_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan  public.plans%rowtype;
  v_start timestamptz;
  v_id    uuid;
begin
  select * into v_plan from public.plans where code = p_plan_code;
  if not found then
    raise exception 'PLAN_NOT_FOUND';
  end if;
  select greatest(now(), coalesce(max(ends_at), now())) into v_start
    from public.subscriptions
   where user_id = p_user_id and status = 'active' and ends_at > now();
  insert into public.subscriptions (user_id, plan_code, status, starts_at, ends_at)
  values (p_user_id, v_plan.code, 'active', v_start, v_start + make_interval(days => v_plan.duration_days))
  returning id into v_id;
  insert into public.admin_audit_log (admin_id, action, target_table, target_id, details)
  values (p_admin_id, 'grant_subscription', 'subscriptions', v_id::text, jsonb_build_object('user_id', p_user_id, 'plan', p_plan_code));
  return v_id;
end;
$$;

revoke execute on function public.grant_subscription(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.grant_subscription(uuid, text, uuid) to service_role;

-- Marque les abonnements terminés (le contrôle premium vérifie déjà la date de fin).
create or replace function public.expire_subscriptions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.subscriptions set status = 'expired' where status = 'active' and ends_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.expire_subscriptions() from public, anon, authenticated;
grant execute on function public.expire_subscriptions() to service_role;

-- Fin de l'abonnement en cours de l'utilisateur connecté (affichage du compte)
create or replace function public.premium_until()
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select max(ends_at) from public.subscriptions
   where user_id = (select auth.uid()) and status = 'active' and ends_at > now();
$$;

grant execute on function public.premium_until() to authenticated;

-- --- Réglages supplémentaires -------------------------------------------------
insert into public.app_settings (key, value, description, is_public)
values
  ('odds_bookmakers', '["1xBet", "Bet365", "Pinnacle"]'::jsonb, 'Bookmakers dont les cotes sont enregistrées (par ordre de préférence)', false),
  ('live_sync_seconds', '60'::jsonb, 'Intervalle minimal entre deux mises à jour des matchs en direct', false),
  ('max_published_picks_per_day', '30'::jsonb, 'Nombre maximal de pronostics publiés par jour', false),
  ('sync_days_ahead', '3'::jsonb, 'Nombre de jours de programme synchronisés à l''avance', false)
on conflict (key) do nothing;

-- --- Classements Elo : mise à jour groupée par le moteur de pronostics ---------
create or replace function public.update_team_elo(p_ratings jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.teams t
     set elo_rating = (r.value)::numeric(7, 2),
         elo_updated_at = now()
    from jsonb_each_text(p_ratings) r
   where t.id = r.key::bigint;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.update_team_elo(jsonb) from public, anon, authenticated;
grant execute on function public.update_team_elo(jsonb) to service_role;

-- --- Teaser : nombre de pronostics publiés (sans en dévoiler le contenu) ------
create or replace function public.published_pick_counts(p_from timestamptz, p_to timestamptz)
returns table (total bigint, premium bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) as total, count(*) filter (where p.is_premium) as premium
  from public.prediction_picks p
  join public.events e on e.id = p.event_id
  where e.starts_at >= p_from and e.starts_at < p_to and p.result = 'pending';
$$;

grant execute on function public.published_pick_counts(timestamptz, timestamptz) to anon, authenticated;
