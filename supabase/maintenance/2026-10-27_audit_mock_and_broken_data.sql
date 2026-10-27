-- READ-ONLY AUDIT. Only SELECTs: it changes nothing and is safe to run on the live project.
--
-- Run in Supabase -> SQL Editor on the project the app uses. It prints one row per check
-- with a count; nothing personal is shown. A count of 0 is good. Send the output back
-- and the cleanup is written from the real numbers, not from guesses.
--
-- "mock" = the demo roster from scripts/make_mock_data_sql.py (logins @sdumotorbike.test),
--          the e2e fixtures (@test.local, titles starting [E2E).
-- "broken" = rows that disagree with themselves or with the rules the app assumes.

select * from (
  -- ------------------------------------------------------------------ mock data
  select 10 as n, 'mock' as kind, 'demo logins (@sdumotorbike.test)' as what,
         (select count(*) from auth.users where email ilike '%@sdumotorbike.test') as rows_found
  union all select 11, 'mock', 'test-fixture logins (@test.local)',
         (select count(*) from auth.users where email ilike '%@test.local')
  union all select 12, 'mock', 'roster members whose login is a demo or test one',
         (select count(*) from members m join auth.users u on u.id = m.id
           where u.email ilike '%@sdumotorbike.test' or u.email ilike '%@test.local')
  union all select 13, 'mock', 'tasks owned by a demo or test member',
         (select count(*) from tasks t join auth.users u on u.id = t.owner_id
           where u.email ilike '%@sdumotorbike.test' or u.email ilike '%@test.local')
  union all select 14, 'mock', 'tasks, meetings or members titled [E2E ...',
         (select count(*) from tasks where title like '[E2E%')
         + (select count(*) from meetings where title like '[E2E%')
         + (select count(*) from members where full_name like '[E2E%' or full_name like 'E2E %')
  union all select 15, 'mock', 'proposals raised by a demo or test member',
         (select count(*) from task_proposals p join auth.users u on u.id = p.raised_by
           where u.email ilike '%@sdumotorbike.test' or u.email ilike '%@test.local')

  -- ---------------------------------------------------------------- broken data
  union all select 20, 'broken', 'active tasks with no department',
         (select count(*) from tasks where subteam_key is null and archived_at is null)
  union all select 21, 'broken', 'active tasks with no owner',
         (select count(*) from tasks where owner_id is null and archived_at is null)
  union all select 22, 'broken', 'done tasks with no completion time',
         (select count(*) from tasks where state = 'done' and completed_at is null)
  union all select 23, 'broken', 'tasks with a completion time that are not done',
         (select count(*) from tasks where state <> 'done' and completed_at is not null)
  union all select 24, 'broken', 'blocked tasks with no reason',
         (select count(*) from tasks where state = 'blocked' and (blocked_reason is null or btrim(blocked_reason) = ''))
  union all select 25, 'broken', 'active tasks owned by a retired member',
         (select count(*) from tasks t join members m on m.id = t.owner_id
           where m.status = 'alumni' and t.archived_at is null and t.state not in ('done', 'cancelled'))
  union all select 26, 'broken', 'tasks that end before they start',
         (select count(*) from tasks where starts_on is not null and due_date is not null and due_date < starts_on)
  union all select 27, 'broken', 'active tasks in a season that is not current',
         (select count(*) from tasks t join seasons s on s.id = t.season_id
           where s.is_current = false and t.archived_at is null and t.state not in ('done', 'cancelled'))
  union all select 28, 'broken', 'proposals with no department',
         (select count(*) from task_proposals where subteam_key is null)
  union all select 29, 'broken', 'roster members with no login',
         (select count(*) from members m where not exists (select 1 from auth.users u where u.id = m.id))
  union all select 30, 'broken', 'logins with no roster row',
         (select count(*) from auth.users u where not exists (select 1 from members m where m.id = u.id))
  union all select 31, 'broken', 'active departments with no Head',
         (select count(*) from subteams where archived_at is null and lead_id is null)
  union all select 32, 'broken', 'departments whose Head is retired',
         (select count(*) from subteams s join members m on m.id = s.lead_id
           where s.archived_at is null and m.status = 'alumni')
  union all select 33, 'broken', 'seasons marked current (must be exactly 1)',
         (select count(*) from seasons where is_current)
) checks
order by n;
