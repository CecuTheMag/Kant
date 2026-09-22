import Image from "next/image";
import Link from "next/link";
import { SITE } from "@/lib/config";

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <div className="footer-grid">
          <div>
            <div className="nav-brand" style={{ marginBottom: "var(--s-5)" }}>
              <Image src="/logo.png" alt="" width={26} height={26} />
              {SITE.name}
            </div>
            <p className="small-text" style={{ maxWidth: "32ch" }}>
              A serverless, end-to-end encrypted P2P messenger. No central
              message store — not even the relay.
            </p>
          </div>

          <div>
            <div className="footer-col-title">Wiki</div>
            <div className="footer-links">
              <Link href="/how-it-works" className="footer-link">How it works</Link>
              <Link href="/why-kant" className="footer-link">Why Kant</Link>
              <Link href="/security" className="footer-link">Security &amp; privacy</Link>
            </div>
          </div>

          <div>
            <div className="footer-col-title">Project</div>
            <div className="footer-links">
              <Link href="/community" className="footer-link">Community</Link>
              <a href={SITE.githubUrl} className="footer-link" target="_blank" rel="noreferrer">Source (GitHub)</a>
              <a href={SITE.discordUrl} className="footer-link" target="_blank" rel="noreferrer">Discord</a>
            </div>
          </div>

          <div>
            <div className="footer-col-title">Protocol</div>
            <div className="footer-links">
              <span className="footer-link mono" style={{ fontSize: 12.5 }}>libp2p</span>
              <span className="footer-link mono" style={{ fontSize: 12.5 }}>libsodium</span>
              <span className="footer-link mono" style={{ fontSize: 12.5 }}>X3DH + Double Ratchet</span>
            </div>
          </div>

          <div>
            <div className="footer-col-title">Legal</div>
            <div className="footer-links">
              <Link href="/terms" className="footer-link">Terms of Service</Link>
              <a href={`${SITE.githubUrl}/blob/main/LICENSE`} className="footer-link" target="_blank" rel="noreferrer">Licence</a>
            </div>
          </div>
        </div>

        <hr className="divider" />

        <div className="footer-bottom" style={{ paddingTop: "var(--s-7)" }}>
          <span className="small-text">© {new Date().getFullYear()} {SITE.name}. Community build distributed under the project license.</span>
          <span className="small-text mono">relay-first · self-hostable · no plaintext at the relay</span>
        </div>
      </div>
    </footer>
  );
}
