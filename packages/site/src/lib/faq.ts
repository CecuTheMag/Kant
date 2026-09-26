// Plain-language FAQ. Rendered on the homepage and emitted as FAQPage
// structured data, so keep answers as plain text.
export const FAQ = [
  {
    q: "Is Kant really free?",
    a: "Yes. Kant is free and open source under the AGPL-3.0, for anyone. Organisations can buy optional admin and governance tools, or a commercial licence if they'd rather not publish their changes, but the messenger itself is never paywalled.",
  },
  {
    q: "Do I need a phone number or an email address?",
    a: "No. The first time you open Kant you choose a password, and the app creates your identity right on your device. You then share your personal key with the people you want to talk to. No phone number, no email, no account.",
  },
  {
    q: "Can anyone read my messages — even the people who make Kant?",
    a: "No. Messages are locked on your device and can only be unlocked on the device of the person you sent them to. When a relay helps two devices reach each other, it only ever passes along encrypted data it can't read, and it doesn't keep your message history.",
  },
  {
    q: "What is a relay?",
    a: "Phones often sit behind home routers and mobile networks that block direct connections. A relay is a small helper that introduces devices and passes sealed messages between them when a direct line isn't possible — like a sorting office that only ever handles sealed envelopes. Anyone can run their own.",
  },
  {
    q: "Which devices does Kant work on?",
    a: "Kant is available today for Android and Linux. Windows and macOS builds can be made from the source code, and an iPhone version isn't available yet. You can follow progress on the Kant Discord.",
  },
  {
    q: "Is Kant safe to use today?",
    a: "Kant is in public beta. It is built on well-studied encryption — the X3DH handshake and the Double Ratchet, the same design Signal made famous — and the code is public so anyone can check it. It hasn't had an independent security audit yet. We say so openly, and you can read the full threat model.",
  },
  {
    q: "Why does Android warn me when I install it?",
    a: "Kant isn't on the Google Play Store yet, so Android shows its standard prompt for any app installed directly from the web. That's expected. You can confirm your download is genuine by checking its fingerprint on the download page.",
  },
];
