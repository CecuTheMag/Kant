import type { Metadata } from "next";
import { InviteCard } from "./InviteCard";

export const metadata: Metadata = {
  title: "You’re invited to Kant",
  description: "Someone wants to talk to you privately on Kant — the end-to-end encrypted messenger with no one in the middle.",
  alternates: { canonical: "/add" },
  // Invite pages are personal; keep them out of search results.
  robots: { index: false, follow: true },
};

export default function AddPage() {
  return (
    <section className="page-hero" style={{ paddingBottom: 96 }}>
      <div className="wrap">
        <InviteCard />
      </div>
    </section>
  );
}
