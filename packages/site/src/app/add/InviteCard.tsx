"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { IconCheck, IconDownload, IconLock } from "@/components/icons";

type Invite = { key: string; name?: string; fragment: string };

// Everything after "#" stays in the browser — it is never sent to this server.
function readInvite(): Invite | null {
  const fragment = window.location.hash.replace(/^#/, "");
  const params = new URLSearchParams(fragment);
  const key = params.get("k")?.toLowerCase() ?? "";
  if (!/^[0-9a-f]{64}$/.test(key)) return null;
  return { key, name: params.get("n")?.slice(0, 40) || undefined, fragment };
}

const initials = (name?: string) =>
  (name ?? "").trim().split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join("").toUpperCase();

export function InviteCard() {
  const [invite, setInvite] = useState<Invite | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setInvite(readInvite());
    const onHash = () => setInvite(readInvite());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (invite === undefined) return <div style={{ minHeight: 420 }} />;

  if (!invite) {
    return (
      <div className="anim-rise">
        <span className="eyebrow">Invite</span>
        <h1 className="h-1">This invite link looks incomplete.</h1>
        <p className="lede">Ask your friend to send their Kant link again — or download Kant and share yours.</p>
        <div className="cta-row center stack">
          <Link href="/download" className="btn btn-primary">Download Kant</Link>
        </div>
      </div>
    );
  }

  const copy = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); } catch { /* ignore */ }
    window.setTimeout(() => setCopied(false), 2000);
  };
  const shortKey = `${invite.key.slice(0, 4)} ${invite.key.slice(4, 8)}`.toUpperCase();

  return (
    <div className="anim-rise">
      <div className="closer-icon" style={{ width: 96, height: 96, borderRadius: "50%", background: "linear-gradient(180deg,#6aa5ff,#0a67d8)", color: "#fff", fontSize: 36, fontWeight: 600 }}>
        {initials(invite.name) || <IconLock size={36} />}
      </div>
      <h1 className="h-1">{invite.name ? `${invite.name} invited you to Kant` : "You’re invited to Kant"}</h1>
      <p className="lede">
        Kant is a private messenger with no phone number and no one in the middle. Messages are locked on your device and
        only open on theirs.
      </p>

      <div className="cta-row center stack" style={{ marginTop: 34 }}>
        <a href={`kant://add#${invite.fragment}`} className="btn btn-primary">Open in Kant</a>
        <Link href="/download" className="btn btn-light"><IconDownload /> Get Kant — it’s free</Link>
      </div>

      <div className="note" style={{ maxWidth: 520, margin: "48px auto 0", textAlign: "left" }}>
        <h2 className="h-4">Using Kant on a computer?</h2>
        <p className="small-text">
          Copy this link, then in Kant tap <b>New message → Add contact</b> and paste it. You’ll be connected with
          {invite.name ? ` ${invite.name}` : " them"} (Kant ID <span className="mono">{shortKey}</span>).
        </p>
        <button type="button" className="btn btn-dark btn-sm" style={{ alignSelf: "flex-start", marginTop: 6 }} onClick={copy}>
          {copied ? <><IconCheck /> Copied</> : "Copy invite link"}
        </button>
      </div>

      <p className="small-text" style={{ marginTop: 28 }}>
        This invite stays in your browser — it’s never sent to our servers.{" "}
        <Link href="/security" className="text-accent">How Kant protects you</Link>
      </p>
    </div>
  );
}
