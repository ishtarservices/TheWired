#!/bin/bash
# Production activity report, run ON the server from /opt/thewired:
#
#   ./activity-report.sh            # last 30 days of per-account detail
#   ./activity-report.sh 7          # last 7 days
#   ./activity-report.sh 30 > report.txt
#
# Read-only. Queries the relay (relay.*) and backend (app.*) schemas in the
# same Postgres, plus Redis for who is hitting the API right now, and prints
# container + disk health. Nothing is written anywhere.
set -euo pipefail
cd /opt/thewired
DAYS="${1:-30}"
COMPOSE="docker compose -f docker-compose.prod.yml"
PGUSER="${POSTGRES_USER:-thewired}"
PGDB="${POSTGRES_DB:-thewired}"

psql() { $COMPOSE exec -T postgres psql -U "$PGUSER" -d "$PGDB" -v ON_ERROR_STOP=0 -v days="$DAYS" -P pager=off "$@"; }
hr() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }

hr "Containers"
$COMPOSE ps --format 'table {{.Service}}\t{{.Status}}'
hr "Disk / DB size"
df -h / | tail -1
psql -Atc "SELECT pg_size_pretty(pg_database_size(current_database())) AS db, (SELECT pg_size_pretty(pg_total_relation_size('relay.events'))) AS relay_events;"

psql <<'SQL'
\pset footer off
\echo
\echo '== Relay totals =='
SELECT count(*) AS events, count(DISTINCT pubkey) AS distinct_pubkeys,
       to_timestamp(min(created_at))::date AS first_event,
       to_timestamp(max(created_at)) AS last_event,
       count(*) FILTER (WHERE h_tag IS NULL) AS public_scope,
       count(*) FILTER (WHERE h_tag IS NOT NULL) AS space_scope
FROM relay.events;

\echo
\echo '== Events per day (last 14 days) — authors = distinct pubkeys that day =='
SELECT to_timestamp(created_at)::date AS day, count(*) AS events,
       count(DISTINCT pubkey) AS authors,
       count(*) FILTER (WHERE kind = 1) AS notes,
       count(*) FILTER (WHERE kind = 9) AS chat,
       count(*) FILTER (WHERE kind = 7) AS reactions,
       count(*) FILTER (WHERE kind = 1059) AS dm_wraps,
       count(*) FILTER (WHERE kind = 0) AS profiles
FROM relay.events
WHERE created_at > extract(epoch FROM now() - interval '14 days')
GROUP BY 1 ORDER BY 1 DESC;

\echo
\echo '== Kind breakdown (all time vs last :days days) =='
SELECT kind, count(*) AS total,
       count(*) FILTER (WHERE created_at > extract(epoch FROM now() - :days * interval '1 day')) AS recent,
       count(DISTINCT pubkey) AS authors
FROM relay.events GROUP BY kind ORDER BY total DESC LIMIT 30;

\echo
\echo '== Account signals (how many pubkeys show each sign of being a real app user) =='
SELECT 'relay: has kind 0 (profile)'      AS signal, count(DISTINCT pubkey) FROM relay.events WHERE kind = 0
UNION ALL SELECT 'relay: has kind 10002 (relay list; written on app login)', count(DISTINCT pubkey) FROM relay.events WHERE kind = 10002
UNION ALL SELECT 'relay: has kind 10050 (DM relay list; written on app login)', count(DISTINCT pubkey) FROM relay.events WHERE kind = 10050
UNION ALL SELECT 'relay: has kind 3 (follows)', count(DISTINCT pubkey) FROM relay.events WHERE kind = 3
UNION ALL SELECT 'relay: posted a kind 1 note', count(DISTINCT pubkey) FROM relay.events WHERE kind = 1
UNION ALL SELECT 'relay: sent a DM wrap (1059)', count(DISTINCT pubkey) FROM relay.events WHERE kind = 1059
UNION ALL SELECT 'app: nip05 name@thewired.app', count(*) FROM app.nip05_identities
UNION ALL SELECT 'app: member of a space', count(DISTINCT pubkey) FROM app.space_members
UNION ALL SELECT 'app: notification prefs row', count(*) FROM app.notification_preferences
UNION ALL SELECT 'app: mobile push device (soot)', count(DISTINCT pubkey) FROM app.push_devices
UNION ALL SELECT 'app: seen on Wired desktop (X-Wired-Client)', count(DISTINCT pubkey) FROM app.account_clients WHERE client = 'desktop'
UNION ALL SELECT 'app: seen on mobile (X-Wired-Client)', count(DISTINCT pubkey) FROM app.account_clients WHERE client = 'mobile'
UNION ALL SELECT 'relay: authors last :days days with NO app record (external client, or pre-tracking)',
       count(DISTINCT pubkey) FROM relay.events e
       WHERE created_at > extract(epoch FROM now() - :days * interval '1 day')
         AND NOT EXISTS (SELECT 1 FROM app.account_clients c WHERE c.pubkey = e.pubkey)
UNION ALL SELECT 'app: web push subscription', count(DISTINCT pubkey) FROM app.push_subscriptions
UNION ALL SELECT 'app: cached profile', count(*) FROM app.cached_profiles
UNION ALL SELECT 'app: music uploader', count(DISTINCT pubkey) FROM app.music_uploads
UNION ALL SELECT 'app: account deletion requested', count(*) FROM app.account_deletions
UNION ALL SELECT 'mod: suspended (active)', count(*) FROM relay.suspended_pubkeys WHERE lifted_at IS NULL;

\echo
\echo '== Mobile push devices by platform =='
SELECT platform, provider, count(*) AS devices, count(DISTINCT pubkey) AS pubkeys,
       max(last_seen_at)::date AS last_seen, string_agg(DISTINCT app_version, ',') AS versions
FROM app.push_devices GROUP BY 1,2 ORDER BY devices DESC;

\echo
\echo '== Accounts by app (X-Wired-Client on authenticated API calls; first_seen / last_seen) =='
\echo '   our apps only — an account never seen here used an external Nostr client (or predates tracking)'
SELECT client, platform, count(DISTINCT pubkey) AS pubkeys,
       count(DISTINCT pubkey) FILTER (WHERE last_seen > now() - :days * interval '1 day') AS active_recent,
       min(first_seen)::date AS first_seen, max(last_seen)::date AS last_seen,
       string_agg(DISTINCT version, ',') AS versions
FROM app.account_clients GROUP BY 1,2 ORDER BY pubkeys DESC;
SELECT count(DISTINCT pubkey) AS app_accounts,
       count(DISTINCT pubkey) FILTER (WHERE client = 'desktop') AS desktop,
       count(DISTINCT pubkey) FILTER (WHERE client = 'mobile') AS mobile,
       count(DISTINCT pubkey) FILTER (WHERE pubkey IN (SELECT pubkey FROM app.account_clients WHERE client = 'desktop')
                                        AND pubkey IN (SELECT pubkey FROM app.account_clients WHERE client = 'mobile')) AS both
FROM app.account_clients;

\echo
\echo '== "client" tag on relay events (our apps set none; a value = external client or bot script) =='
SELECT coalesce((SELECT e->>1 FROM jsonb_array_elements(tags) e WHERE e->>0 = 'client' LIMIT 1), '(none)') AS client,
       count(*) AS events, count(DISTINCT pubkey) AS pubkeys
FROM relay.events WHERE kind IN (1, 9, 7, 30023)
GROUP BY 1 ORDER BY events DESC LIMIT 15;

\echo
\echo '== Per-account activity, last :days days (top 40 by events) =='
\echo '   app_signals: D=Wired desktop M=mobile (X-Wired-Client) N=nip05 S=space member P=push device/sub F=notif prefs L=login kinds(10002/10050)  X=SUSPENDED'
\echo '   no D and no M = external Nostr client (or last seen before app tracking shipped)'
\echo '   minutes = distinct minute-of-hour the account posts at; 1-3 with many posts = cron bot'
WITH recent AS (
  SELECT * FROM relay.events
  WHERE created_at > extract(epoch FROM now() - :days * interval '1 day')
), per AS (
  SELECT pubkey,
         count(*) AS events,
         count(*) FILTER (WHERE kind = 1) AS notes,
         count(*) FILTER (WHERE kind = 9) AS chat,
         count(*) FILTER (WHERE kind = 7) AS reacts,
         count(*) FILTER (WHERE kind = 1059) AS dms,
         count(DISTINCT kind) AS kinds,
         count(DISTINCT to_timestamp(created_at)::date) AS days,
         count(DISTINCT extract(minute FROM to_timestamp(created_at))) FILTER (WHERE kind IN (1, 9)) AS minutes,
         round(avg(length(content)) FILTER (WHERE kind IN (1, 9))) AS avg_len,
         max(created_at) AS last_at
  FROM recent GROUP BY pubkey
)
SELECT left(p.pubkey, 12) AS pubkey,
       left(coalesce(cp.display_name, cp.name,
            (SELECT content::jsonb->>'name' FROM relay.events k0 WHERE k0.pubkey = p.pubkey AND k0.kind = 0 LIMIT 1)), 18) AS name,
       p.events, p.notes, p.chat, p.reacts, p.dms, p.kinds, p.days,
       round(p.events::numeric / greatest(p.days, 1), 1) AS per_day,
       p.minutes, p.avg_len,
       (SELECT to_timestamp(min(created_at))::date FROM relay.events a WHERE a.pubkey = p.pubkey) AS first_seen,
       to_char(to_timestamp(p.last_at), 'MM-DD HH24:MI') AS last_seen,
       concat_ws('',
         CASE WHEN EXISTS (SELECT 1 FROM app.account_clients c WHERE c.pubkey = p.pubkey AND c.client = 'desktop') THEN 'D' END,
         CASE WHEN EXISTS (SELECT 1 FROM app.account_clients c WHERE c.pubkey = p.pubkey AND c.client = 'mobile') THEN 'M' END,
         CASE WHEN EXISTS (SELECT 1 FROM app.nip05_identities n WHERE n.pubkey = p.pubkey) THEN 'N' END,
         CASE WHEN EXISTS (SELECT 1 FROM app.space_members m WHERE m.pubkey = p.pubkey) THEN 'S' END,
         CASE WHEN EXISTS (SELECT 1 FROM app.push_devices d WHERE d.pubkey = p.pubkey)
                OR EXISTS (SELECT 1 FROM app.push_subscriptions s WHERE s.pubkey = p.pubkey) THEN 'P' END,
         CASE WHEN EXISTS (SELECT 1 FROM app.notification_preferences f WHERE f.pubkey = p.pubkey) THEN 'F' END,
         CASE WHEN EXISTS (SELECT 1 FROM relay.events l WHERE l.pubkey = p.pubkey AND l.kind IN (10002, 10050)) THEN 'L' END,
         CASE WHEN EXISTS (SELECT 1 FROM relay.suspended_pubkeys x WHERE x.pubkey = p.pubkey AND x.lifted_at IS NULL) THEN 'X' END
       ) AS app_signals
FROM per p
LEFT JOIN app.cached_profiles cp ON cp.pubkey = p.pubkey
ORDER BY p.events DESC LIMIT 40;

\echo
\echo '== Full pubkeys of the top 15 (for accounts.js / suspendPubkey) =='
SELECT pubkey, count(*) AS events FROM relay.events
WHERE created_at > extract(epoch FROM now() - :days * interval '1 day')
GROUP BY 1 ORDER BY 2 DESC LIMIT 15;

\echo
\echo '== Likely bots: regular cadence, few distinct minutes, many notes =='
SELECT left(pubkey, 12) AS pubkey, count(*) AS notes,
       count(DISTINCT extract(minute FROM to_timestamp(created_at))) AS minutes,
       count(DISTINCT extract(hour FROM to_timestamp(created_at))) AS hours,
       round(count(*)::numeric / greatest(count(DISTINCT to_timestamp(created_at)::date), 1), 1) AS per_day,
       left(regexp_replace(min(content), E'[\\n\\r]+', ' ', 'g'), 70) AS sample
FROM relay.events
WHERE kind = 1 AND created_at > extract(epoch FROM now() - :days * interval '1 day')
GROUP BY pubkey
HAVING count(*) >= 10 AND count(DISTINCT extract(minute FROM to_timestamp(created_at))) <= 5
ORDER BY notes DESC;

\echo
\echo '== Last 25 public notes (kind 1, no h tag) =='
SELECT to_char(to_timestamp(created_at), 'MM-DD HH24:MI') AS at, left(pubkey, 10) AS pubkey,
       left(regexp_replace(content, E'[\\n\\r]+', ' ', 'g'), 90) AS content
FROM relay.events WHERE kind = 1 AND h_tag IS NULL
ORDER BY created_at DESC LIMIT 25;

\echo
\echo '== Clock skew: events dated in the future / before 2020 (relay accepts them as sent) =='
SELECT CASE WHEN created_at > extract(epoch FROM now()) + 900 THEN 'future' ELSE 'pre-2020' END AS bucket,
       count(*) AS events, count(DISTINCT pubkey) AS pubkeys, min(kind) AS min_kind, max(kind) AS max_kind,
       to_timestamp(max(created_at))::date AS latest
FROM relay.events
WHERE created_at > extract(epoch FROM now()) + 900 OR created_at < 1577836800
GROUP BY 1;

\echo
\echo '== Gift-wrap recipients (who the 1059 flood is addressed to, last 7 days) =='
SELECT left(p, 12) AS recipient, count(*) AS wraps
FROM relay.events, unnest(p_tags) AS p
WHERE kind = 1059 AND created_at > extract(epoch FROM now() - interval '7 days')
GROUP BY p ORDER BY wraps DESC LIMIT 12;

\echo
\echo '== Spaces (app.spaces is authoritative) =='
SELECT space_mode, count(*) AS spaces, count(*) FILTER (WHERE listed) AS listed,
       sum(member_count) AS members, max(to_timestamp(created_at / 1000))::date AS newest
FROM app.spaces GROUP BY 1;
SELECT left(id, 14) AS id, left(name, 24) AS name, space_mode, member_count, listed,
       to_timestamp(created_at / 1000)::date AS created,
       (SELECT count(*) FROM relay.events e WHERE e.h_tags && ARRAY[s.id]
          AND e.created_at > extract(epoch FROM now() - interval '7 days')) AS events_7d
FROM app.spaces s ORDER BY member_count DESC, created_at DESC LIMIT 15;

\echo
\echo '== Music =='
SELECT (SELECT count(*) FROM relay.events WHERE kind = 31683) AS tracks,
       (SELECT count(*) FROM relay.events WHERE kind = 33123) AS projects,
       (SELECT count(DISTINCT pubkey) FROM relay.events WHERE kind IN (31683, 33123)) AS artists,
       (SELECT count(*) FROM app.music_uploads) AS uploads,
       (SELECT coalesce(sum(play_count), 0) FROM app.music_play_daily) AS plays,
       (SELECT count(DISTINCT pubkey) FROM app.music_play_listeners) AS listeners;

\echo
\echo '== Moderation (resolution "foreign" = outside reporter about outside content, closed at ingest) =='
SELECT status, coalesce(resolution, '-') AS resolution, category, count(*) FROM app.reports GROUP BY 1,2,3 ORDER BY 1,2,3;
SELECT coalesce(triage->>'origin', 'unclassified') AS origin, source, count(*) FROM app.reports GROUP BY 1,2 ORDER BY 3 DESC;
SELECT left(pubkey, 16) AS pubkey, left(reason, 40) AS reason, suspended_by, suspended_at::date
FROM relay.suspended_pubkeys WHERE lifted_at IS NULL ORDER BY suspended_at DESC;
SELECT count(*) AS tombstoned_events FROM relay.tombstones WHERE restored_at IS NULL;

\echo
\echo '== Registered relays (decentralized spaces) =='
SELECT status, count(*) FROM app.space_relays GROUP BY 1;
SQL

hr "Pubkeys hitting the API in the last minute (gateway rate-limit buckets)"
$COMPOSE exec -T redis redis-cli --scan --pattern 'ratelimit:*' | grep -v ':ip:' | awk -F: '{print $NF}' | sort -u | cut -c1-16 || true

hr "Relay connections (open websockets to the relay container)"
$COMPOSE exec -T relay sh -c 'cat /proc/net/tcp 2>/dev/null | awk "NR>1 && \$4==\"01\"" | wc -l' 2>/dev/null || echo "n/a"

hr "Gateway: NIP-98 auth failures in the last 24h"
$COMPOSE logs --since 24h --no-log-prefix gateway 2>/dev/null | grep -c "NIP-98 verify failed" || true
