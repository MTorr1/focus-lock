# Chrome policies on this Mac

Checked on 13 November 2026.

## What this Mac will enforce today

- Device enrollment: not enrolled via DEP, and not enrolled in MDM (`profiles status -type enrollment`).
- `/Library/Managed Preferences` does not exist.
- There is no managed `com.google.Chrome` preferences file.

Chrome on macOS reads force-install policy from a managed configuration profile. A `defaults write` into the normal preferences domain is ignored. This Mac has no managed profile, so Chrome will not force-install Focus Lock, and it will not stop you removing the unpacked extension.

No force-install policy was added. There is nothing here for Chrome to enforce.

## What would be required, and what it still would not do

Force-installing an extension that is not in the Chrome Web Store needs one of these:

- MDM enrollment and a configuration profile for `com.google.Chrome`
- enrollment in Chrome Enterprise Core (Chrome Browser Cloud Management)

The profile would set `ExtensionSettings` to `force_installed`, or `ExtensionInstallForcelist`, pointing at a packed extension update URL. Chrome's own policy description says preventing removal is best effort: the operating system can still change the extension from outside Chrome. An administrator can remove the profile.

Related policies that are sometimes paired with force-install:

- `DeveloperToolsAvailability`, so the service worker storage is harder to edit from inside Chrome
- `IncognitoModeAvailability`, so a private window is not a second, unextended browser
- `URLBlocklist` for `chrome://extensions`, which is incomplete: Chrome does not treat every internal page as a normal blocked URL, and an administrator can still open the policy and remove it

None of these were turned on. They do not apply to an unmanaged personal Mac, and they would not cover Safari, Firefox, or a second Chrome profile.

## What remains possible with administrator access

- Remove or disable the extension.
- Delete a configuration profile, if one is added later.
- Use another browser or another Chrome profile.
- Edit `dist` or the unpacked folder.
- Change rows in the Supabase dashboard if an account is connected.

The extension's own refusal to weaken a lock is the control that holds during normal use. It does not hold against those administrator actions.
