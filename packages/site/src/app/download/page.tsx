import type { Metadata } from "next";
import Link from "next/link";
import {
  IconAndroid,
  IconChevron,
  IconDiscord,
  IconDownload,
  IconGithub,
  IconLinux,
  IconShield,
} from "@/components/icons";
import { RELEASE, SITE } from "@/lib/config";

export const metadata: Metadata = {
  title: "Download Kant for Android and Linux",
  description:
    "Download Kant, the free end-to-end encrypted messenger, for Android and Linux. Step-by-step install guide and file fingerprints to confirm your download is genuine.",
  alternates: { canonical: "/download" },
};

const breadcrumbs = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: SITE.url },
    { "@type": "ListItem", position: 2, name: "Download", item: `${SITE.url}/download` },
  ],
};

export default function Download() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }} />

      <section className="page-hero">
        <div className="wrap">
          <span className="eyebrow anim-rise">Download</span>
          <h1 className="h-1 anim-rise d1">Get Kant. It’s free.</h1>
          <p className="lede anim-rise d2">
            Version {RELEASE.version} {RELEASE.channel.toLowerCase()} for
            Android and Linux. No account to create — just install, pick a
            password and start talking.
          </p>
        </div>
      </section>

      <section className="section-tight section-alt">
        <div className="wrap">
          <div className="platforms reveal-stagger" style={{ marginTop: 0 }}>
            <div className="platform">
              <div className="platform-head">
                <span className="tile-icon green"><IconAndroid size={28} /></span>
                <div>
                  <h2>Android</h2>
                  <div className="meta">Phones and tablets · {RELEASE.android.size}</div>
                </div>
              </div>
              <p className="body-text" style={{ margin: 0 }}>
                Install directly — no Play Store account needed. See the
                quick guide below if it’s your first time.
              </p>
              <a href={RELEASE.android.url} className="btn btn-primary" download>
                <IconDownload /> Download for Android
              </a>
            </div>

            <div className="platform">
              <div className="platform-head">
                <span className="tile-icon amber"><IconLinux size={28} /></span>
                <div>
                  <h2>Linux</h2>
                  <div className="meta">AppImage · {RELEASE.linux.size}</div>
                </div>
              </div>
              <p className="body-text" style={{ margin: 0 }}>
                One file, no installation. Make it executable and run it on
                almost any modern distribution.
              </p>
              <a href={RELEASE.linux.url} className="btn btn-primary" download>
                <IconDownload /> Download for Linux
              </a>
            </div>

            <div className="platform platform-soon">
              <div>
                <h3 className="h-4">iPhone, Windows and Mac</h3>
                <p className="small-text" style={{ margin: "4px 0 0" }}>
                  Not packaged yet. Windows and Mac can be built from the source
                  code today. Join the community to hear first when they land.
                </p>
              </div>
              <a href={SITE.discordUrl} className="link" target="_blank" rel="noreferrer">
                Get notified on Discord <IconChevron />
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="grid-2" style={{ alignItems: "start" }}>
            <div className="reveal">
              <span className="eyebrow">First time installing on Android?</span>
              <h2 className="h-2" style={{ marginBottom: 28 }}>Four quick steps.</h2>
              <ol className="install-steps">
                <li><span><strong>Tap “Download for Android”</strong> above on your phone.</span></li>
                <li><span><strong>Open the downloaded file</strong> from your notifications or Downloads folder.</span></li>
                <li><span>If Android asks, <strong>allow installs from this source</strong>. It does this for any app that doesn’t come from the Play Store — that’s normal.</span></li>
                <li><span><strong>Tap Install</strong>, open Kant and choose a password. Done.</span></li>
              </ol>
            </div>

            <div className="reveal">
              <span className="eyebrow">Linux</span>
              <h2 className="h-2" style={{ marginBottom: 28 }}>Two commands.</h2>
              <div className="code-block">
                <div><span className="c-muted">$</span> chmod +x {RELEASE.linux.file}</div>
                <div><span className="c-muted">$</span> ./{RELEASE.linux.file}</div>
              </div>
              <p className="small-text" style={{ marginTop: 14 }}>
                Most file managers also let you right-click the file, open
                Properties and tick “Allow executing as program”.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section section-alt">
        <div className="wrap wrap-narrow">
          <div className="section-head reveal">
            <span className="tile-icon green" style={{ marginBottom: 20 }}><IconShield size={22} /></span>
            <h2 className="h-2">Make sure it’s the real thing.</h2>
            <p className="body-text">
              Every release has a unique fingerprint (a SHA-256 checksum). If
              the fingerprint of the file you downloaded matches the one below,
              it’s exactly the file we published — nothing added, nothing
              changed. This step is optional, but good practice.
            </p>
          </div>
          <div className="grid-2 tight reveal-stagger">
            <div className="card">
              <div className="h-4" style={{ marginBottom: 12 }}>{RELEASE.android.file}</div>
              <div className="hash">{RELEASE.android.sha256}</div>
            </div>
            <div className="card">
              <div className="h-4" style={{ marginBottom: 12 }}>{RELEASE.linux.file}</div>
              <div className="hash">{RELEASE.linux.sha256}</div>
            </div>
          </div>
          <div className="code-block reveal" style={{ marginTop: 20 }}>
            <div><span className="c-muted"># Linux / macOS</span></div>
            <div><span className="c-muted">$</span> sha256sum {RELEASE.android.file}</div>
          </div>
          <div className="cta-row" style={{ marginTop: 32 }}>
            <a href={RELEASE.notesUrl} className="link" target="_blank" rel="noreferrer">
              Release notes on GitHub <IconChevron />
            </a>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="grid-2 tight reveal-stagger">
            <div className="card card-hover">
              <span className="tile-icon" style={{ marginBottom: 20 }}><IconDiscord size={22} /></span>
              <h3 className="h-3" style={{ marginBottom: 8 }}>Need a hand?</h3>
              <p className="body-text" style={{ marginBottom: 18 }}>
                The community is happy to help you get set up.
              </p>
              <a href={SITE.discordUrl} className="link" target="_blank" rel="noreferrer">
                Ask on Discord <IconChevron />
              </a>
            </div>
            <div className="card card-hover">
              <span className="tile-icon ink" style={{ marginBottom: 20 }}><IconGithub size={22} /></span>
              <h3 className="h-3" style={{ marginBottom: 8 }}>Build it yourself</h3>
              <p className="body-text" style={{ marginBottom: 18 }}>
                Prefer to compile from source? Everything you need is in the
                repository.
              </p>
              <a href={SITE.githubUrl} className="link" target="_blank" rel="noreferrer">
                View on GitHub <IconChevron />
              </a>
            </div>
          </div>
          <p className="small-text center" style={{ marginTop: 40 }}>
            By downloading Kant you agree to the <Link href="/terms" className="text-accent">Terms of Service</Link>.
          </p>
        </div>
      </section>
    </>
  );
}
