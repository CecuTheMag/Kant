# Unreleased (draft for the next version)

Rename this file to `<version>.md` when the version is chosen. Everything here
is on top of 0.7.0.

## Fixed

- **Messages could show up out of order at the start of a chat.** The first message of a new chat waits for the secure session, and after a session change it is sent again, so it could arrive after the ones that followed it and be shown below them. Messages now carry the time they were sent, inside the encryption, and Kant places a late arrival where it belongs. A message from someone still on 0.7.0 or older carries no send time and is shown in the order it arrived, as before.
