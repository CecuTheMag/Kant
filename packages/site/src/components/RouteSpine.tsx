import type { ReactNode } from "react";

const nodes = [
  { name: "you", sub: "Ed25519 identity", color: "var(--fg-secondary)" },
  { name: "relay", sub: "sees ciphertext only", color: "var(--route)" },
  { name: "peer", sub: "verified fingerprint", color: "var(--sig-green-8)" },
] as const;

export function RouteSpine() {
  const items: ReactNode[] = [];
  nodes.forEach((node, i) => {
    items.push(
      <div key={node.name} className="spine-node-lbl">
        <span
          className="spine-node-dot"
          style={{ background: node.color, color: node.color }}
        />
        <span className="spine-node-name">{node.name}</span>
        <span className="spine-node-sub">{node.sub}</span>
      </div>
    );
    if (i < nodes.length - 1) {
      items.push(
        <div key={`track-${i}`} className={`spine-track${i === 1 ? " delay" : ""}`} />
      );
    }
  });

  return (
    <div className="spine-hero anim-rise">
      <div className="spine-row">{items}</div>
      <div className="spine-caption">
        XChaCha20-Poly1305 · noise handshake · relay holds no plaintext, no history, no keys
      </div>
    </div>
  );
}
