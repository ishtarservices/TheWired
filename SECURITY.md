# Security Policy

The Wired handles users' Nostr identity keys, end-to-end encrypted messages,
and Lightning wallet connections. We take reports about any of it seriously
and would rather hear about a false alarm than miss a real issue.

## Supported versions

Only the **latest release** of the desktop app and the services in this
repository receives security fixes. Check the
[releases page](https://github.com/ummilabs/TheWired/releases) for the
current version; the desktop app also self-updates to it.

| Version        | Supported |
| -------------- | --------- |
| Latest release | Yes       |
| Older releases | No        |
| `main` branch  | Best effort (unreleased) |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

1. Preferred: use GitHub's private vulnerability reporting for this
   repository — **Security → Report a vulnerability** — which opens a private
   advisory only maintainers can see.
2. If you cannot use GitHub, reach us through the contacts listed on the
   [support page](https://thewired.app/support). Put "security" in the subject
   so it gets routed first.

Please include what you can of: the affected component (client, relay,
backend, gateway, landing), a reproduction or proof of concept, the impact
you believe it has, and whether it has been disclosed anywhere else. Encrypted
reports are welcome; ask for a key through either channel above.

## What to expect

- **Acknowledgement** within 5 business days.
- **Triage and a severity assessment** within 10 business days, including
  whether we agree it is a vulnerability.
- **Fix and release** on a timeline we agree with you, prioritised by
  severity; critical issues in released software are hotfixed.
- **Coordinated disclosure** 90 days after the report, or sooner once a fix
  has shipped and users have had a reasonable window to update. We will
  credit you in the advisory and release notes unless you prefer otherwise.

If you do not hear back within the acknowledgement window, resend through the
other channel.

## Scope

In scope:

- The desktop client (`client/`), including the Tauri shell, the embedded
  relay, key storage and signing, NIP-17/NIP-44 encryption, the NIP-46
  bunker and NIP-47 wallet integrations, and the AI assistant's tool gating.
- The relay (`services/relay`), backend (`services/backend`), gateway
  (`services/gateway`), landing site (`services/landing`) and proxy config
  (`services/proxy`) as built from this repository.
- Release and build tooling in `.github/workflows` (for example, anything that
  could let an untrusted change reach a signed release).

Out of scope:

- Third-party Nostr relays, Lightning wallets, bunkers and LLM providers the
  app connects to on the user's behalf.
- Denial of service that needs volumetric traffic, and findings that only
  affect users running an unsupported version.
- Reports from automated scanners without a demonstrated impact, and missing
  best-practice headers or configuration with no exploitable consequence.
- Social engineering of maintainers or users, and physical access to a
  user's device.

Testing against the hosted service is fine as long as it stays on accounts
you control and does not degrade the service for others. Please do not
access, modify or retain other users' data, even if a bug makes it possible;
stop and report once you have enough to show the issue.

## Dependencies

Dependency and base-image updates are tracked by Dependabot
(`.github/dependabot.yml`), and CI runs `pnpm audit`, `cargo audit` and
`govulncheck` on every change. If you find a vulnerability in a dependency
that affects The Wired in a way those tools miss, report it through the
channels above.
