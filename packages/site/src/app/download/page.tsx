import type { Metadata } from "next";
import Link from "next/link";
import {
  IconAndroid,
  IconApple,
  IconChevron,
  IconDiscord,
  IconDownload,
  IconGithub,
  IconLinux,
  IconShield,
  IconWindows,
} from "@/components/icons";
import { ALL_FILES, PLATFORMS, RELEASE, SITE } from "@/lib/config";

export const metadata: Metadata = {
  title: `Download Kant for ${PLATFORMS}`,
  description:
    `Download Kant, the free end-to-end encrypted messenger, for ${PLATFORMS}. Step-by-step install guide and file fingerprints to confirm your download is genuine.`,
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
            {" "}{PLATFORMS}. No account to create — just install, pick a
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

            {RELEASE.windows && (
              <div className="platform">
                <div className="platform-head">
                  <span className="tile-icon teal"><IconWindows size={28} /></span>
                  <div>
                    <h2>Windows</h2>
                    <div className="meta">Installer · {RELEASE.windows.x64.installer.size}</div>
                  </div>
                </div>
                <p className="body-text" style={{ margin: 0 }}>
                  Windows 10 and 11. If SmartScreen says the publisher is
                  unknown, choose “More info” → “Run anyway”.
                </p>
                <a href={RELEASE.windows.x64.installer.url} className="btn btn-primary" download>
                  <IconDownload /> Download for Windows
                </a>
                <p className="small-text" style={{ margin: 0 }}>
                  No install:{" "}
                  <a href={RELEASE.windows.x64.portable.url} className="link inline" download>portable version</a>
                  {" "}· Windows on ARM:{" "}
                  <a href={RELEASE.windows.arm64.installer.url} className="link inline" download>installer</a>
                  {" "}or{" "}
                  <a href={RELEASE.windows.arm64.portable.url} className="link inline" download>portable</a>
                </p>
              </div>
            )}

            {RELEASE.mac && (
              <div className="platform">
                <div className="platform-head">
                  <span className="tile-icon ink"><IconApple size={28} /></span>
                  <div>
                    <h2>Mac</h2>
                    <div className="meta">Apple Silicon · {RELEASE.mac.arm64.size}</div>
                  </div>
                </div>
                <p className="body-text" style={{ margin: 0 }}>
                  macOS 11 or later. The first time, macOS can’t verify the
                  developer: see the steps below.
                </p>
                <a href={RELEASE.mac.arm64.url} className="btn btn-primary" download>
                  <IconDownload /> Download for Mac
                </a>
                <p className="small-text" style={{ margin: 0 }}>
                  Older Mac with an Intel chip?{" "}
                  <a href={RELEASE.mac.x64.url} className="link inline" download>Intel version</a>
                </p>
              </div>
            )}

            {RELEASE.ios && (
              <div className="platform">
                <div className="platform-head">
                  <span className="tile-icon"><IconApple size={28} /></span>
                  <div>
                    <h2>iPhone</h2>
                    <div className="meta">For sideloading · {RELEASE.ios.size}</div>
                  </div>
                </div>
                <p className="body-text" style={{ margin: 0 }}>
                  iOS 15 or later. Not on the App Store yet: install it with
                  AltStore, SideStore or Sideloadly (see below).
                </p>
                <a href={RELEASE.ios.url} className="btn btn-primary" download>
                  <IconDownload /> Download for iPhone
                </a>
              </div>
            )}

            {RELEASE.mac && RELEASE.ios ? null : RELEASE.windows ? (
              <div className="platform platform-later">
                <div className="platform-head">
                  <span className="tile-icon"><IconApple size={28} /></span>
                  <div>
                    <h2>iPhone &amp; Mac</h2>
                    <div className="meta">Coming later</div>
                  </div>
                </div>
                <p className="body-text" style={{ margin: 0 }}>
                  Not packaged yet. Join the community to hear first when
                  Kant lands on Apple devices.
                </p>
                <a href={SITE.discordUrl} className="link platform-later-link" target="_blank" rel="noreferrer">
                  Get notified on Discord <IconChevron />
                </a>
              </div>
            ) : (
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
            )}
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

          {(RELEASE.mac || RELEASE.ios) && (
            <div className="grid-2" style={{ alignItems: "start", marginTop: 56 }}>
              {RELEASE.mac && (
                <div className="reveal">
                  <span className="eyebrow">Mac</span>
                  <h2 className="h-2" style={{ marginBottom: 28 }}>Open it the first time.</h2>
                  <ol className="install-steps">
                    <li><span><strong>Open the downloaded file</strong> and drag Kant into Applications.</span></li>
                    <li><span><strong>Open Kant.</strong> macOS says it can’t verify the developer, because the app isn’t notarized by Apple yet. Choose <strong>Done</strong>.</span></li>
                    <li><span>Open <strong>System Settings → Privacy &amp; Security</strong>, scroll down and choose <strong>Open Anyway</strong>.</span></li>
                    <li><span><strong>Open Kant again</strong> and confirm. From then on it opens normally.</span></li>
                  </ol>
                </div>
              )}
              {RELEASE.ios && (
                <div className="reveal">
                  <span className="eyebrow">iPhone</span>
                  <h2 className="h-2" style={{ marginBottom: 28 }}>Install it with a sideloading app.</h2>
                  <ol className="install-steps">
                    <li><span><strong>Install a sideloading app</strong> on your computer, such as AltStore, SideStore or Sideloadly, and sign in with your Apple ID.</span></li>
                    <li><span><strong>Download the .ipa file</strong> above and open it with that app to install Kant on your iPhone.</span></li>
                    <li><span>On the iPhone, <strong>trust your Apple ID</strong> in Settings → General → VPN &amp; Device Management. On iOS 16 or later, also turn on <strong>Settings → Privacy &amp; Security → Developer Mode</strong>.</span></li>
                    <li><span>With a free Apple ID, <strong>refresh the app every 7 days</strong> (AltStore and SideStore can do it for you).</span></li>
                  </ol>
                </div>
              )}
            </div>
          )}
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
            {ALL_FILES.map((d) => (
              <div className="card" key={d.file}>
                <div className="h-4" style={{ marginBottom: 12 }}>{d.file}</div>
                <div className="hash">{d.sha256}</div>
              </div>
            ))}
          </div>
          <div className="code-block reveal" style={{ marginTop: 20 }}>
            <div><span className="c-muted"># Linux / macOS</span></div>
            <div><span className="c-muted">$</span> sha256sum {RELEASE.android.file}</div>
            {RELEASE.windows && (
              <>
                <div><span className="c-muted"># Windows (PowerShell)</span></div>
                <div><span className="c-muted">&gt;</span> Get-FileHash {RELEASE.windows.x64.installer.file}</div>
              </>
            )}
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
