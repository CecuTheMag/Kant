# Kant Relay Configuration Guide

## 🎯 What Changed

The Settings tab in Kant now includes a complete **Relay Configuration panel** that lets users:
- **Use a public relay** (someone else's server)
- **Run their own relay** on their device (desktop app)
- **Share their relay** with others behind port forwarding
- **Configure everything with built-in tutorials**

No more need for VPS knowledge or terminal commands. Everything is in the app.

---

## 📍 Three Relay Modes

### 1. 🌐 Public Relay (Cloud)
**Use someone else's relay server**

- Friend/organization runs a relay → shares URL
- You paste the URL in Settings → "Public Relay" mode
- Everyone connects to that central point

**Setup:**
1. Get relay URL from friend/admin
2. Settings ⚙️ → Relay Configuration → "Public Relay"
3. Enter URL → Apply & Connect
4. Start chatting

**Who runs the relay:**
- One person sets up a VPS (or uses their computer with port forwarding)
- Everyone else connects to their relay URL

---

### 2. 🏠 Local Relay (Your Device)
**Run a relay on your own computer**

**Requirements:**
- Desktop app (browser won't work)
- Your computer stays on for others to use it

**Setup (Desktop App):**
1. Settings ⚙️ → Relay Configuration → "Local Relay"
2. Follow the guide
3. **Enable "Share my relay"** button
4. Your relay URL appears → share with friends
5. Friends add that URL to their "Public Relay" settings

**For friends to access you from outside your home:**
- Open port 3001 in your router (via port forwarding)
- Guide included in Settings → expand "How to enable remote access"
- Choose your router type for step-by-step instructions

---

### 3. ⚙️ Custom / Manual Config
**Manually enter any relay URL**

For:
- Local network IPs: `http://192.168.1.100:3001`
- Local dev: `http://127.0.0.1:3001`
- Hardcoded URLs you test with

---

## 🚀 Common Scenarios

### Scenario A: Family Chat Group (No VPS)
```
Device 1 (Dad)     Device 2 (Mom)     Device 3 (Sister)
   🏠 Local          ☁️ Public           ☁️ Public
   Relay Server    → Dad's Relay URL → Dad's Relay URL

Dad enables port forwarding in router settings:
- Port: 3001 → his computer
- URL: dad.duckdns.org:3001 (or static IP)
```

**Steps:**
1. Dad's Kant Desktop → Settings → Local Relay → Start
2. Dad opens router → Port Forwarding → 3001 → his computer
3. Dad copies relay URL from Settings
4. Mom & Sister paste URL in Public Relay settings
5. All three can chat over Dad's relay

---

### Scenario B: Organization Uses Shared Relay
```
                    ☁️ Public Relay
                   (org.example.com)
                           ↑
        ┌──────────────────┼──────────────────┐
        ↓                  ↓                  ↓
    Alice          Bob                   Carol
  ☁️ Public      ☁️ Public              ☁️ Public
```

**Steps:**
1. IT deploys relay server (VPS with domain)
2. IT shares URL with team: `https://org-relay.example.com`
3. Everyone enters that URL in "Public Relay" mode
4. Organization controls the relay

---

### Scenario C: Developer Testing
```
Terminal 1: ./start.sh 1
→ Relay on :3000, HTTP on :3001

App 1 (Browser)          App 2 (Browser)
http://127.0.0.1:3001  http://127.0.0.1:3001
(both connect to same relay)
```

**How:**
1. CLI/Dev: Run `./start.sh 1` in terminal
2. App Settings → Custom mode
3. Enter: `http://127.0.0.1:3001`
4. Both browser windows connect to same relay

---

## 🔧 Port Forwarding Built Into Settings

For users who want to **share their local relay with friends outside their home:**

1. Settings → Local Relay → "How to enable remote access"
2. Choose your router brand
3. Follow the guide (generates step-by-step for your router)
4. Port 3001 is now accessible from the internet
5. Share your public IP or domain

**Example for TP-Link Router:**
- Admin console → Network → Port Forwarding
- External Port: 3001
- Internal IP: 192.168.1.100 (your computer)
- Internal Port: 3001
- Save

---

## 🛡️ Privacy & Security

| | Public Relay | Local Relay |
|---|---|---|
| Who sees relay traffic? | Relay operator | Just you |
| Can relay see messages? | ❌ No (encrypted) | ❌ No (encrypted) |
| Does relay store anything? | No (stateless) | No (stateless) |
| Best for | Organizations, public groups | Family, small groups |
| Availability | Depends on operator | Depends on your device |

---

## 🚀 Deployment Options (No VPS Required!)

### Option 1: Someone's Always-On Computer
- Person A has a computer that's always on
- Enables Local Relay in Kant → port forwards port 3001
- Everyone in group points to Person A's relay
- **Cost:** $0 (just electricity)

### Option 2: Cheap VPS (When You Want It Always Online)
- $4–6/month VPS (Hetzner, Fly.io, DigitalOcean)
- Run `./start.sh --host 0.0.0.0 --public relay.yourdomain.com`
- Everyone connects to your domain
- **Cost:** $4–6/month, always running

### Option 3: Use a Friend's Relay
- Someone already running a relay
- They share the URL
- You use it in "Public Relay" mode
- **Cost:** $0 (trust your friend)

---

## 🎓 In-App Tutorials

Everything is now self-documenting:

- **Settings → Local Relay:** Step-by-step guide
- **Settings → Port Forwarding:** Specific instructions per router brand
- **Settings → Public Relay:** Copy/paste URL guide
- **Settings → Current Relay:** See your current configuration

No external links to docs needed (though they're available).

---

## 📝 Environment Variable (.env) Still Works

For developers/deployments using `.env`:

```
# Browser/web app
VITE_RELAY_URL=https://relay.yourdomain.com
VITE_RELAY_HTTP_PORT=3001
```

The Settings UI will override these, but they still work as defaults.

---

## ✅ What Users No Longer Need To Do

❌ Learn what a VPS is
❌ SSH into servers
❌ Run terminal commands for basic setup
❌ Read documentation to understand port forwarding
❌ Contact support about relay configuration

✅ Everything in the app with guides
✅ Visual mode selector
✅ Copy-paste configuration
✅ Router-specific instructions

---

## 🔌 Desktop vs Browser

| Feature | Desktop App | Browser |
|---|---|---|
| Run local relay | ✅ Yes | ❌ No (no server access) |
| Use public relay | ✅ Yes | ✅ Yes (HTTPS only) |
| Use local IP relay | ✅ Yes | ❌ No (browsers block ws://) |
| Share relay with others | ✅ Yes | ❌ No (no server access) |

**For relay sharing with friends → use Desktop app**

---

## 🐛 Troubleshooting

### "Can't connect to relay"
- Check URL is typed correctly
- Check relay status: Settings → Current Relay
- If local relay: make sure Share is enabled
- If public relay: check your internet connection

### "Friends can't reach my relay"
- Desktop app only (browser can't host relay)
- Port 3001 not forwarded? Check: Settings → Port Forwarding Guide
- Firewall blocking? Check router firewall settings
- Get your public IP: https://ipchicken.com

### "Relay URL keeps resetting"
- Close app properly (not force quit)
- Check `.env` file — it might override settings
- Clear browser cache if browser version

---

## 📚 Next Steps

1. **For Personal Use:** Run local relay on your computer
2. **For Family/Small Group:** Share one person's relay (port forward)
3. **For Organization:** Deploy public relay on VPS (Fly.io free tier is great)
4. **For Testing:** Use multiple local instances with custom mode

All configuration is now **in the Settings ⚙️ tab of the app.** No terminal needed! 🎉
