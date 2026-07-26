import { plural, t } from './i18n';

// The server's side of the translation.
//
// Server messages travel as English text plus a machine-readable `code`. The
// English is what curl, a script or an MCP agent sees, and it is a real
// sentence rather than an identifier — an agent that hits `owner_only_backup`
// should not have to guess. The browser ignores the text and renders the
// reader's own language from the code.
//
// So the server never learns what language anybody speaks, and adding a
// language means adding entries to a catalog — not touching Go.
//
// A code with no entry here falls back to the server's English. That is the
// same bargain the rest of the interface makes: a missing translation degrades
// to a correct sentence in the wrong language, never to a broken one.

/** Values that came alongside the code, for the messages that carry a count. */
export type ErrorData = Record<string, unknown>;

export function serverMessage(code: string, fallback: string, data?: ErrorData): string {
  const n = typeof data?.pages === 'number' ? (data.pages as number) : 0;
  switch (code) {
    // ---- registration and sign-in ----
    case 'signup_not_allowed':
      return t('This email address cannot register on its own. Ask for an invitation.');
    case 'bad_credentials':
      return t('Wrong email or wrong password.');
    case 'account_disabled':
      return t('This account has been deactivated — talk to an admin.');
    case '2fa_required':
      return t('Please enter the 6-digit code from your authenticator app.');
    case '2fa_invalid':
      return t('Wrong code — try again.');

    // ---- the owner role ----
    case 'owner_only_backup':
      return t('Only the owner can download an instance backup — it contains every workspace.');
    case 'owner_cannot_be_disabled':
      return t('The owner cannot be deactivated — hand the owner role on first.');
    case 'owner_cannot_be_deleted':
      return t('The owner cannot be deleted — hand the owner role to another account first.');
    case 'owner_rights_locked':
      return t('The owner’s rights cannot be revoked — hand the owner role on first.');
    case 'owner_must_be_admin':
      return t(
        'Only an account that is already an instance admin can take the instance over — make it one first.',
      );
    case 'owner_only_credentials':
      return t(
        'Only the owner can change another account’s password or email. As an admin you can send an invitation.',
      );
    case 'disabled_cannot_own':
      return t('A deactivated account cannot take over the instance.');

    // ---- personal spaces ----
    case 'personal_not_adoptable':
      return t('A personal space is not adopted — it belongs to an account.');
    case 'personal_no_break_glass':
      return t(
        'A personal space cannot be looked into even in an emergency — it belongs to exactly one account.',
      );
    case 'personal_no_autojoin':
      return t('A personal space cannot be opened to everyone.');
    case 'personal_role_fixed':
      return t('That is this person’s personal space — their role in it stays as it is.');
    case 'personal_no_remove':
      return t('That is this person’s personal space — they cannot be removed from it.');
    case 'personal_invite_owner_only':
      return t('A personal space is not handed out from outside — only its owner invites anyone there.');

    // ---- workspaces and membership ----
    case 'workspace_has_members':
      return t(
        'This workspace still has members. If nobody is in charge, appoint one of them in user management — for a look inside there is emergency access.',
      );
    case 'workspace_delete_from_inside':
      return t('This workspace still has members — it can only be deleted from the inside.');
    case 'owner_only_autojoin':
      return t('Only the owner can open a workspace to everyone.');
    case 'not_workspace_admin':
      return t('Only the owner or an admin of this workspace can change its members.');
    case 'last_admin_other':
      return t('That is the last admin of this workspace. Make somebody else an admin first.');
    case 'no_self_grant':
      return t('You cannot grant yourself access here — use emergency access, which is logged.');
    case 'last_admin':
      return t(
        'You are the last admin of this workspace. Make somebody else an admin first — or delete the workspace if it should go.',
      );
    case 'already_member':
      return t('You are already a member of this workspace — emergency access is not needed.');

    // These two carry a count, which is why it travels beside the code: a
    // number baked into an English sentence cannot go through German's — or
    // Polish's — plural rules.
    case 'private_pages_left_self':
      return t('You have {pages} here. They stay in the workspace and will only be visible to its admins afterwards.', {
        pages: plural(n, '{n} private page', '{n} private pages'),
      });
    case 'private_pages_left_other':
      return t('This person has {pages} here. They stay in the workspace and will only be visible to its admins afterwards.', {
        pages: plural(n, '{n} private page', '{n} private pages'),
      });

    // ---- other ----
    case 'impact_unavailable':
      return t('The consequences of this deletion could not be determined — please try again.');
    case 'file_too_large':
      return fallback; // already built and translated on this side
    default:
      return fallback;
  }
}
