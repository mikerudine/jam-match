-- Suggested windows must start in the future (Europe/Kyiv).

create or replace function jam.suggest_window_for_users(p_user_ids uuid[])
returns table (
  window_start timestamptz,
  window_end timestamptz,
  match_count integer,
  matched_user_ids uuid[]
)
language plpgsql
stable
security definer
set search_path = jam
as $$
declare
  v_uids uuid[];
  v_n integer;
  v_min integer;
  v_day date;
  v_last date;
  v_today date;
  v_first_hour integer;
  v_start integer;
  v_h integer;
  v_common uuid[];
  v_slot uuid[];
  v_count integer;
  v_dur integer;
  v_best_count integer := 0;
  v_best_day date;
  v_best_start integer;
  v_best_end integer;
  v_best_users uuid[];
  v_best_dur integer := 0;
  v_kyiv_now timestamp;
begin
  select coalesce(array_agg(distinct x order by x), '{}')
  into v_uids
  from unnest(p_user_ids) as x
  where x is not null;

  v_n := coalesce(cardinality(v_uids), 0);
  if v_n = 0 then
    return;
  end if;

  v_min := case when v_n = 1 then 1 else 2 end;
  v_kyiv_now := timezone('Europe/Kyiv', now());
  v_today := v_kyiv_now::date;
  v_day := v_today;
  v_last := v_day + 27;

  while v_day <= v_last loop
    if v_day = v_today then
      v_first_hour := extract(hour from v_kyiv_now)::integer + 1;
    else
      v_first_hour := 0;
    end if;

    if v_first_hour <= 23 then
      for v_start in v_first_hour..23 loop
        v_common := v_uids;
        for v_h in v_start..23 loop
          select coalesce(array_agg(u order by u), '{}')
          into v_slot
          from unnest(v_uids) as u
          where jam.user_free_at(u, v_day, v_h);

          select coalesce(array_agg(x order by x), '{}')
          into v_common
          from (
            select unnest(v_common) as x
            intersect
            select unnest(v_slot)
          ) q;

          v_count := coalesce(cardinality(v_common), 0);
          if v_count < v_min then
            exit;
          end if;

          v_dur := v_h - v_start + 1;
          if v_count > v_best_count
             or (
               v_count = v_best_count
               and (
                 v_best_day is null
                 or v_day < v_best_day
                 or (
                   v_day = v_best_day
                   and (
                     v_dur > v_best_dur
                     or (v_dur = v_best_dur and v_start < v_best_start)
                   )
                 )
               )
             )
          then
            v_best_count := v_count;
            v_best_day := v_day;
            v_best_start := v_start;
            v_best_end := v_h + 1;
            v_best_dur := v_dur;
            v_best_users := v_common;
          end if;
        end loop;
      end loop;
    end if;
    v_day := v_day + 1;
  end loop;

  if v_best_day is null then
    return;
  end if;

  window_start := timezone(
    'Europe/Kyiv',
    v_best_day + make_time(v_best_start, 0, 0)
  );
  if v_best_end >= 24 then
    window_end := timezone(
      'Europe/Kyiv',
      (v_best_day + 1) + make_time(0, 0, 0)
    );
  else
    window_end := timezone(
      'Europe/Kyiv',
      v_best_day + make_time(v_best_end, 0, 0)
    );
  end if;
  match_count := v_best_count;
  matched_user_ids := v_best_users;
  return next;
end;
$$;
