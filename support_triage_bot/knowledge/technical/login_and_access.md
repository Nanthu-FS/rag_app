# Login & Access Issues

## Can't log in

1. Confirm you're using the right email — Nimbus accounts are tied to a single email.
2. Use **Forgot password** on the login page to reset. The reset link is valid for
   60 minutes.
3. Clear cookies for `app.nimbus.io` or try an incognito window to rule out a stale
   session.
4. If you see "account locked", you've hit 5 failed attempts; the lock clears
   automatically after 15 minutes.

## Two-factor authentication (2FA)

Enable 2FA under **Settings → Security**. We support authenticator apps (TOTP) and
hardware keys. If you lost your 2FA device, use one of the backup codes saved when
you enrolled. No backup codes? A workspace admin can reset 2FA for you.

## Single sign-on (SSO)

SSO (SAML/OIDC) is available on Growth and Enterprise. Configure it under
**Settings → Security → SSO**. Once SSO is enforced, members sign in through your
identity provider and password login is disabled for the workspace.

## "Access denied" to a project

Project access is controlled by workspace roles (Owner, Admin, Member, Viewer) plus
per-project sharing. Ask a project Admin to add you, or check **Project → Share**.
