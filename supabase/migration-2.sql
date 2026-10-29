-- CINKO : migration 2 = matchs par lien, score, notes anonymes, évolution des cartes.
-- À coller dans Supabase > SQL Editor > Run (après schema.sql). Peut être relancée sans risque.

-- ============ STATUT « terminé » ============
alter table public.matches drop constraint if exists matches_status_check;
alter table public.matches add constraint matches_status_check check (status in ('open','scored','confirmed','done'));
alter table public.match_players add column if not exists delta int;

-- ============ LECTURE : seuls les participants voient un match ============
create or replace function public.is_participant(p_match uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.match_players where match_id = p_match and user_id = auth.uid());
$$;
revoke all on function public.is_participant(uuid) from public, anon;
grant execute on function public.is_participant(uuid) to authenticated;

drop policy if exists "lecture matchs" on public.matches;
drop policy if exists "lecture participants" on public.match_players;
drop policy if exists "lecture de ses matchs" on public.matches;
drop policy if exists "lecture des participants de ses matchs" on public.match_players;
create policy "lecture de ses matchs" on public.matches for select to authenticated
  using (created_by = auth.uid() or public.is_participant(id));
create policy "lecture des participants de ses matchs" on public.match_players for select to authenticated
  using (user_id = auth.uid() or public.is_participant(match_id));

-- Plus d'écriture directe : tout passe par les fonctions ci-dessous.
drop policy if exists "créer un match" on public.matches;
drop policy if exists "rejoindre un match ouvert" on public.match_players;
revoke insert on public.matches from authenticated;
revoke insert on public.match_players from authenticated;

-- Les notes : on ne peut noter qu'un coéquipier, une seule fois, tant que le match n'est pas clôturé.
drop policy if exists "noter son camp" on public.ratings;
create policy "noter son camp" on public.ratings for insert to authenticated
  with check (
    rater_id = auth.uid()
    and exists (select 1 from public.match_players a join public.match_players b on a.match_id = b.match_id and a.camp = b.camp
                where a.match_id = ratings.match_id and a.user_id = auth.uid() and b.user_id = ratings.rated_id)
    and exists (select 1 from public.matches m where m.id = ratings.match_id and m.status in ('scored','confirmed'))
  );

-- ============ CRÉER / REJOINDRE ============
create or replace function public.create_match(p_camp text default 'a')
returns public.matches language plpgsql security definer set search_path = public as $$
declare m public.matches;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid()) then raise exception 'Crée d''abord ta carte'; end if;
  if p_camp not in ('a','b') then raise exception 'Camp invalide'; end if;
  insert into public.matches (created_by) values (auth.uid()) returning * into m;
  insert into public.match_players (match_id, user_id, camp) values (m.id, auth.uid(), p_camp);
  return m;
end $$;

-- Rejoindre ou changer de camp (tant que le match est ouvert). 7 joueurs max par camp.
create or replace function public.join_match(p_code text, p_camp text)
returns public.matches language plpgsql security definer set search_path = public as $$
declare m public.matches;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid()) then raise exception 'Crée d''abord ta carte'; end if;
  if p_camp not in ('a','b') then raise exception 'Camp invalide'; end if;
  select * into m from public.matches where code = upper(trim(p_code)) for update;
  if not found then raise exception 'Match introuvable'; end if;
  if m.status <> 'open' and not exists (select 1 from public.match_players where match_id = m.id and user_id = auth.uid()) then
    raise exception 'Ce match est déjà lancé'; end if;
  if m.status <> 'open' then return m; end if;
  if (select count(*) from public.match_players where match_id = m.id and camp = p_camp and user_id <> auth.uid()) >= 7 then
    raise exception 'Ce camp est complet'; end if;
  insert into public.match_players (match_id, user_id, camp) values (m.id, auth.uid(), p_camp)
    on conflict (match_id, user_id) do update set camp = excluded.camp;
  return m;
end $$;

-- ============ SCORE ============
create or replace function public.submit_score(p_match uuid, p_a int, p_b int)
returns public.matches language plpgsql security definer set search_path = public as $$
declare m public.matches;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or not public.is_participant(p_match) then raise exception 'Match introuvable'; end if;
  if p_a is null or p_b is null or p_a not between 0 and 99 or p_b not between 0 and 99 then raise exception 'Score invalide'; end if;
  if m.status = 'open' or (m.status = 'scored' and m.scored_by = auth.uid()) then
    update public.matches set score_a = p_a, score_b = p_b, status = 'scored', scored_by = auth.uid(), confirmed_by = null
      where id = p_match returning * into m;
    return m;
  end if;
  raise exception 'Le score est déjà enregistré';
end $$;

-- Un joueur de l'autre camp confirme le score.
create or replace function public.confirm_score(p_match uuid)
returns public.matches language plpgsql security definer set search_path = public as $$
declare m public.matches; mine text; theirs text;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or not public.is_participant(p_match) then raise exception 'Match introuvable'; end if;
  if m.status <> 'scored' then raise exception 'Rien à confirmer'; end if;
  select camp into mine from public.match_players where match_id = p_match and user_id = auth.uid();
  select camp into theirs from public.match_players where match_id = p_match and user_id = m.scored_by;
  if mine = theirs then raise exception 'Le score doit être confirmé par un joueur de l''autre camp'; end if;
  update public.matches set status = 'confirmed', confirmed_by = auth.uid() where id = p_match returning * into m;
  return m;
end $$;

-- ============ CLÔTURE : médiane, valeurs aberrantes écartées, ±3 max, niveau d'équipe ============
create or replace function public.finalize_match(p_match uuid)
returns public.matches language plpgsql security definer set search_path = public as $$
declare
  m public.matches; pl record; notes numeric[]; med numeric; kept numeric[]; avg numeric; d int; n int;
  ta uuid; tb uuid; ea numeric; res numeric; elo_a int; elo_b int; k constant int := 32; s text;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or not public.is_participant(p_match) then raise exception 'Match introuvable'; end if;
  if m.status = 'done' then raise exception 'Ce match est déjà clôturé'; end if;
  if m.status not in ('scored','confirmed') then raise exception 'Entre d''abord le score'; end if;

  for pl in select user_id from public.match_players where match_id = p_match loop
    select array_agg(note order by note) into notes from public.ratings where match_id = p_match and rated_id = pl.user_id;
    d := 0; n := coalesce(cardinality(notes), 0);
    if n >= 3 then
      med := (notes[(n + 1) / 2] + notes[(n + 2) / 2]) / 2;
      select array_agg(x) into kept from unnest(notes) x where abs(x - med) <= 2.5;
      select avg(x) into avg from unnest(kept) x;
      d := greatest(-3, least(3, round((avg - 6) * 1.5)::int));
    end if;
    update public.match_players set delta = d where match_id = p_match and user_id = pl.user_id;
    update public.profiles set
      ovr = greatest(40, least(99, ovr + d)),
      matches = matches + 1,
      stats = (select jsonb_object_agg(key, greatest(40, least(99, value::int + d))) from jsonb_each_text(stats))
    where id = pl.user_id;
  end loop;

  -- Niveau d'équipe : seulement si le score est confirmé et que chaque camp est (au moins 4) de la même équipe.
  if m.status = 'confirmed' then
    select team_id into ta from public.profiles p join public.match_players mp on mp.user_id = p.id
      where mp.match_id = p_match and mp.camp = 'a' and p.team_id is not null group by team_id having count(*) >= 4 limit 1;
    select team_id into tb from public.profiles p join public.match_players mp on mp.user_id = p.id
      where mp.match_id = p_match and mp.camp = 'b' and p.team_id is not null group by team_id having count(*) >= 4 limit 1;
    if ta is not null and tb is not null and ta <> tb then
      select elo into elo_a from public.teams where id = ta;
      select elo into elo_b from public.teams where id = tb;
      ea := 1 / (1 + power(10, (elo_b - elo_a) / 400.0));
      res := case when m.score_a > m.score_b then 1 when m.score_a = m.score_b then 0.5 else 0 end;
      update public.teams set elo = elo + round(k * (res - ea))::int, matches = matches + 1 where id = ta;
      update public.teams set elo = elo + round(k * ((1 - res) - (1 - ea)))::int, matches = matches + 1 where id = tb;
      update public.matches set team_a = ta, team_b = tb where id = p_match;
    end if;
  end if;

  update public.matches set status = 'done' where id = p_match returning * into m;
  return m;
end $$;

revoke all on function public.create_match(text) from public, anon;
revoke all on function public.join_match(text, text) from public, anon;
revoke all on function public.submit_score(uuid, int, int) from public, anon;
revoke all on function public.confirm_score(uuid) from public, anon;
revoke all on function public.finalize_match(uuid) from public, anon;
grant execute on function public.create_match(text) to authenticated;
grant execute on function public.join_match(text, text) to authenticated;
grant execute on function public.submit_score(uuid, int, int) to authenticated;
grant execute on function public.confirm_score(uuid) to authenticated;
grant execute on function public.finalize_match(uuid) to authenticated;

-- Mes propres notes envoyées (pour savoir qui j'ai déjà noté ; jamais celles des autres).
create or replace function public.my_ratings(p_match uuid)
returns table (rated_id uuid) language sql stable security definer set search_path = public as $$
  select rated_id from public.ratings where match_id = p_match and rater_id = auth.uid();
$$;
revoke all on function public.my_ratings(uuid) from public, anon;
grant execute on function public.my_ratings(uuid) to authenticated;
