-- =============================================================================
--  EXAMPLE TOOLS for the Team page. Safe to run more than once: a tool a member
--  already has under the same name is skipped.
--
--  The examples are shared out between up to three active members (a Developer or
--  the President first, then anyone active), so the list shows several owners, several places
--  and some tools somebody has and some nobody has. Each owner (or the President, Vice President or a Developer) can
--  rename, move or remove them on the Team page. Run in Supabase -> SQL Editor.
-- =============================================================================
do $seed$
declare
  owners uuid[];
  n int;
  i int := 0;
  t record;
begin
  select coalesce(array_agg(id), '{}') into owners from (
    select m.id
      from members m
      left join member_roles r on r.member_id = m.id and r.role in ('developer', 'president', 'vicepresident')
     where m.status = 'active'
     group by m.id
     order by (count(r.role) > 0) desc, min(m.full_name)
     limit 3
  ) picked;
  n := coalesce(array_length(owners, 1), 0);
  if n = 0 then
    raise exception 'There is no active member to own the example tools. Add a member first.';
  end if;

  for t in
    select * from (values
      ('Torque wrench 3/8" (10–110 Nm)', 'workshop',   false),
      ('Cordless drill 18 V',            'workshop',   false),
      ('Digital caliper 150 mm',         'workshop',   false),
      ('Metric socket set',              'workshop',   false),
      ('Multimeter',                     'university', true),
      ('Soldering station',              'workshop',   false),
      ('Heat gun',                       'home',       true),
      ('Angle grinder 125 mm',           'workshop',   false),
      ('Laptop with the ECU software',   'home',       true),
      ('Bench vise',                     'workshop',   false)
    ) as v(item, location, held)
  loop
    i := i + 1;
    -- held = true: the owner has it (at home, at the university); false: nobody has it, it just sits there.
    insert into tools (item, location, owner_id, held_by)
    select t.item, t.location, owners[1 + (i - 1) % n], case when t.held then owners[1 + (i - 1) % n] end
     where not exists (select 1 from tools x where x.item = t.item and x.owner_id = owners[1 + (i - 1) % n]);
  end loop;
end
$seed$;

select t.item, t.location as "where", h.full_name as "who has it", m.full_name as owner
  from tools t join members m on m.id = t.owner_id left join members h on h.id = t.held_by order by m.full_name, t.item;
