import type { CSSProperties } from "react";
import { IconChevron, IconLock, IconSend } from "@/components/icons";

// A faithful, CSS-only rendering of the Kant chat screen (same dark palette
// and blue bubbles as packages/app). Pure markup: no image weight, crisp at
// any DPR, and it animates in without JavaScript.
const i = (n: number) => ({ "--i": n }) as CSSProperties;

export function PhoneMockup() {
  return (
    <div className="phone" role="img" aria-label="The Kant app showing an end-to-end encrypted conversation with Maya">
      <div className="phone-screen" aria-hidden="true">
        <div className="phone-island" />
        <div className="phone-status">
          <span>9:41</span>
          <span className="phone-status-icons">
            <svg width="17" height="11" viewBox="0 0 17 11" fill="currentColor"><rect x="0" y="7" width="3" height="4" rx="1" /><rect x="4.5" y="5" width="3" height="6" rx="1" /><rect x="9" y="2.5" width="3" height="8.5" rx="1" /><rect x="13.5" y="0" width="3" height="11" rx="1" /></svg>
            <svg width="24" height="11" viewBox="0 0 24 11" fill="none"><rect x="0.5" y="0.5" width="20" height="10" rx="3" stroke="currentColor" opacity="0.4" /><rect x="2" y="2" width="15" height="7" rx="1.6" fill="currentColor" /><rect x="21.5" y="3.5" width="1.6" height="4" rx="0.8" fill="currentColor" opacity="0.4" /></svg>
          </span>
        </div>

        <div className="phone-head">
          <span className="phone-back"><IconChevron size={18} className="" /></span>
          <span className="phone-avatar">MA</span>
          <span className="phone-who">
            <span className="phone-name">Maya</span>
            <span className="phone-sub"><IconLock size={10} /> End-to-end encrypted</span>
          </span>
        </div>

        <div className="phone-thread">
          <span className="phone-day">Today</span>
          <div className="msg msg-in" style={i(0)}>Landed! Sending you the trip photos now.</div>
          <div className="msg msg-in msg-file" style={i(1)}>
            <span className="msg-file-icon" />
            <span>
              <span className="msg-file-name">lisbon-sunset.jpg</span>
              <br />
              <span className="msg-file-meta">2.4 MB · encrypted</span>
            </span>
          </div>
          <div className="msg msg-out" style={i(2)}>Wow. That view!</div>
          <div className="msg msg-in" style={i(3)}>Dinner Friday? My treat.</div>
          <div className="msg msg-out" style={i(4)}>Deal. See you at 8.</div>
          <span className="msg-meta" style={i(4)}>Delivered</span>
        </div>

        <div className="phone-compose">
          <span className="phone-input">Message</span>
          <span className="phone-send"><IconSend size={15} /></span>
        </div>
      </div>
    </div>
  );
}
