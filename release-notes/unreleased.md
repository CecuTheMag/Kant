# Unreleased (draft for the next version)

Rename this file to `<version>.md` when the version is chosen. Everything here
is on top of 0.7.0.

## Fixed

- **Messages could show up out of order at the start of a chat.** The first message of a new chat waits for the secure session, and after a session change it is sent again, so it could arrive after the ones that followed it and be shown below them. Messages now carry the time they were sent, inside the encryption, and Kant places a late arrival where it belongs. A message from someone still on 0.7.0 or older carries no send time and is shown in the order it arrived, as before.

## Changed

- **A new look across the app.** Setup is now one idea per screen, and the network step recognises a pasted relay address or invite link. Chats have bubble tails and a centred header; holding a message lifts it out with reactions above and actions below. Photos open full screen, where you can zoom and drag them away. The attach button opens a tray that includes the camera.
- **Settings are organised into pages.** Notifications, Appearance, Chats, Privacy & Security, Backup & Transfer and Network each have their own page instead of one long list.
- **Android: Back closes what is on top.** The Back button now closes an open sheet, menu or photo first, instead of leaving the chat. Sheets can also be swiped down.
- **Android: the status and navigation bars match the screen** in both light and dark mode, the app uses the Inter typeface, and the launcher icon supports themed icons.

## Fixed

- **Group previews after unlocking.** The chat list showed "No messages yet" for groups until each one was opened. It now shows the last message straight away.
