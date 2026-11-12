# Unreleased (draft for the next version)

Rename this file to `<version>.md` when the version is chosen. Everything here
is on top of 0.6.0.

**Security fixes for groups and files, and housekeeping across the project.**

## Fixed

- **Group messages could be sent under another member's name.** Kant now
  accepts a group message, edit, deletion, reaction or read receipt only when
  it arrives from the device of the member it names, and only from members of
  that group. Before, any member could post, edit or delete as someone else.
- **Anyone could re-point a group member's address.** A group "I'm online"
  notice is now accepted only from the member it names and only with an
  address that leads to them, as direct messages already required.
- **Files could be sent under a contact's name.** A file is accepted only from
  the device of the sender it names.
- **Leaving a group now tells the group.** Members stop sending to you and the
  group's creator changes the key. Before, leaving only deleted the group on
  your own device.
- **Group history stays readable after the key changes.** Earlier messages
  turned into "[encrypted]" on every device once a group's key was changed,
  and a message sent at the moment of the change could be lost. Devices now
  keep the group's earlier keys for reading history, and accept a message
  sent with the previous key for ten minutes after a change.
- **Members who were offline now get the group key.** A group created (or
  re-keyed) while a member was offline delivers their key when they come back,
  including a group created while you were offline yourself.
- **Read receipts in groups** never arrived; they do now.
- **Desktop notifications after a relay restart.** Kant registers for
  notifications again whenever it reconnects, not only when its address changes.

## New

- **Screen security (Android).** Settings → Security → Screen security hides
  Kant in the recent-apps list and blocks screenshots.
- **A Content-Security-Policy in every build**, so no injected or remote script
  can run in the app.
- **Desktop apps run on Electron 45** (33 no longer received security fixes).

## For relay operators

- **`RELAY_ADMIN_TOKEN`** is the operator token for `/admin/*` and, behind a
  tunnel, `/metrics`. `scripts/deploy-relay.sh` and `scripts/relay-tunnel.sh`
  move an existing `RELAY_LAB_CONTROL_TOKEN` over the next time they run.
  `RELAY_LAB_CONTROL_TOKEN` still works but also enables the test lab's
  restart endpoint, so don't set it on a real relay.
- Relay and push-proxy images are built on Node 22 (Node 20 reached end of life).

## After updating

- 0.6.x apps and relays keep working with this version. One thing to know:
  members still on 0.6.x are not told when someone leaves a group, and keep
  showing them as a member.
