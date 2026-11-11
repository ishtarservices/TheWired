-- Recompute app.spaces.member_count from app.space_members.
--
-- Invite redeems, kicks, bans and a few other paths used to change membership
-- without touching the counter, so it drifted (e.g. 5 members, count 0). Every
-- path now recounts on change; this corrects the rows that drifted before.
--
-- Relay-native (nip29) spaces are skipped: their membership lives on the relay
-- and their count is mirrored_member_count. Only rows that differ are touched,
-- so re-running is a no-op.
UPDATE app.spaces AS s
SET member_count = c.n
FROM (
  SELECT sp.id, count(m.pubkey)::int AS n
  FROM app.spaces AS sp
  LEFT JOIN app.space_members AS m ON m.space_id = sp.id
  WHERE sp.space_mode <> 'nip29'
  GROUP BY sp.id
) AS c
WHERE s.id = c.id
  AND s.member_count IS DISTINCT FROM c.n;
