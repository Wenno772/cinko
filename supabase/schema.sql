-- CINKO : schéma de base (à coller dans Supabase > SQL Editor > Run)
-- Principe : les joueurs LISENT ce qui est public, mais toute écriture sensible
-- (niveau, stats, équipes, notes) passe par des fonctions serveur. Personne ne peut
-- se donner un niveau ou lire les notes individuelles des autres.

create extension if not exists pgcrypto;

-- ============ TABLES ============
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 20),
  city text,
  code text not null unique default upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 6)),
  elo int not null default 1500,
  matches int not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 14),
  pos text not null default 'MIL' check (pos in ('GB','DEF','MIL','ALI','ATT')),
  rotate boolean not null default true,
  tags text[] not null default '{}' check (cardinality(tags) <= 2),
  photo_url text,
  ovr int not null default 60 check (ovr between 40 and 99),
  stats jsonb not null default '{"VIT":60,"TIR":60,"PAS":60,"DRI":60,"DEF":60,"ESP":60}',
  matches int not null default 0,
  team_id uuid references public.teams(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default upper(substr(encode(gen_random_bytes(3), 'hex'), 1, 4)),
  created_by uuid not null references auth.users(id),
  team_a uuid references public.teams(id),
  team_b uuid references public.teams(id),
  score_a int check (score_a between 0 and 99),
  score_b int check (score_b between 0 and 99),
  status text not null default 'open' check (status in ('open','scored','confirmed')),
  scored_by uuid references auth.users(id),
  confirmed_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.match_players (
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  camp text not null check (camp in ('a','b')),
  primary key (match_id, user_id)
);

create table public.ratings (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  rater_id uuid not null references auth.users(id) on delete cascade,
  rated_id uuid not null references auth.users(id) on delete cascade,
  note numeric(3,1) not null check (note between 1 and 10),
  tags text[] not null default '{}' check (cardinality(tags) <= 2),
  created_at timestamptz not null default now(),
  unique (match_id, rater_id, rated_id),
  check (rater_id <> rated_id)
);

-- ============ STATS DE DÉPART (calculées côté serveur, pas par le joueur) ============
create or replace function public.start_stats(p_pos text, p_tags text[])
returns jsonb language plpgsql immutable as $$
declare
  off jsonb;
  k text;
  bonus jsonb := '{"Buteur":"TIR","Passeur":"PAS","Mur":"DEF","Pétard":"VIT","Magicien":"DRI","Bon esprit":"ESP"}';
  res jsonb := '{}';
  up boolean;
  t text;
begin
  off := case p_pos
    when 'ATT' then '{"VIT":5,"TIR":12,"PAS":-4,"DRI":6,"DEF":-18,"ESP":-1}'
    when 'MIL' then '{"VIT":-2,"TIR":-2,"PAS":10,"DRI":6,"DEF":-8,"ESP":-4}'
    when 'DEF' then '{"VIT":-4,"TIR":-12,"PAS":0,"DRI":-6,"DEF":16,"ESP":6}'
    when 'ALI' then '{"VIT":12,"TIR":2,"PAS":0,"DRI":8,"DEF":-20,"ESP":-2}'
    else '{"VIT":-8,"TIR":-14,"PAS":-1,"DRI":-6,"DEF":14,"ESP":15}' end::jsonb;
  foreach k in array array['VIT','TIR','PAS','DRI','DEF','ESP'] loop
    up := false;
    foreach t in array coalesce(p_tags, '{}') loop
      if bonus ->> t = k then up := true; end if;
    end loop;
    res := res || jsonb_build_object(k, 60 + floor((off ->> k)::numeric / 2 + 0.5)::int - 2 + case when up then 6 else 0 end);
  end loop;
  return res;
end $$;

create or replace function public.profiles_before_insert()
returns trigger language plpgsql as $$
begin
  new.ovr := 60;
  new.matches := 0;
  new.team_id := null;
  new.stats := public.start_stats(new.pos, new.tags);
  return new;
end $$;

create trigger trg_profiles_before_insert before insert on public.profiles
  for each row execute function public.profiles_before_insert();

-- ============ SÉCURITÉ (RLS) ============
alter table public.teams enable row level security;
alter table public.profiles enable row level security;
alter table public.matches enable row level security;
alter table public.match_players enable row level security;
alter table public.ratings enable row level security;

create policy "lecture équipes" on public.teams for select to authenticated using (true);
create policy "lecture profils" on public.profiles for select to authenticated using (true);
create policy "créer son profil" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "modifier son profil" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "lecture matchs" on public.matches for select to authenticated using (true);
create policy "créer un match" on public.matches for insert to authenticated with check (created_by = auth.uid() and status = 'open');
create policy "lecture participants" on public.match_players for select to authenticated using (true);
create policy "rejoindre un match ouvert" on public.match_players for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.matches m where m.id = match_id and m.status = 'open'));
-- ratings : aucune policy de lecture => personne ne lit les notes individuelles (anonymat).
create policy "noter son camp" on public.ratings for insert to authenticated
  with check (
    rater_id = auth.uid()
    and exists (select 1 from public.match_players a join public.match_players b on a.match_id = b.match_id and a.camp = b.camp
                where a.match_id = ratings.match_id and a.user_id = auth.uid() and b.user_id = ratings.rated_id)
    and exists (select 1 from public.matches m where m.id = ratings.match_id and m.status in ('scored','confirmed'))
  );

-- Colonnes modifiables par le joueur : uniquement les infos de présentation.
revoke insert, update on public.profiles from authenticated;
grant insert (id, name, pos, rotate, tags, photo_url) on public.profiles to authenticated;
grant update (name, pos, rotate, photo_url) on public.profiles to authenticated;
revoke insert, update, delete on public.teams from authenticated;
revoke update, delete on public.matches from authenticated;
revoke update, delete on public.match_players from authenticated;
revoke update, delete on public.ratings from authenticated;

-- ============ ÉQUIPES : création et adhésion par code ============
create or replace function public.create_team(p_name text, p_city text default null)
returns public.teams language plpgsql security definer set search_path = public as $$
declare t public.teams;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  insert into public.teams (name, city, created_by) values (trim(p_name), nullif(trim(p_city), ''), auth.uid()) returning * into t;
  update public.profiles set team_id = t.id where id = auth.uid();
  return t;
end $$;

create or replace function public.join_team(p_code text)
returns public.teams language plpgsql security definer set search_path = public as $$
declare t public.teams;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  select * into t from public.teams where code = upper(trim(p_code));
  if not found then raise exception 'Code inconnu'; end if;
  if (select count(*) from public.profiles where team_id = t.id) >= 8 then raise exception 'Équipe complète'; end if;
  update public.profiles set team_id = t.id where id = auth.uid();
  return t;
end $$;

revoke all on function public.create_team(text, text) from public, anon;
revoke all on function public.join_team(text) from public, anon;
grant execute on function public.create_team(text, text) to authenticated;
grant execute on function public.join_team(text) to authenticated;

-- Étape suivante (migration 2) : fonctions confirm_match / finalize_match qui appliquent
-- les notes (médiane, écart > 2,5 ignoré, ±3 points max) et le niveau d'équipe.
