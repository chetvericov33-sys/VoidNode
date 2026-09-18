---
description: >-
  Risk intelligence for crypto investors: portfolio analysis, 0–100 Risk Score,
  anti-scam center, AI advisor.
icon: house
layout:
  width: wide
  title:
    visible: true
  description:
    visible: true
  tableOfContents:
    visible: false
  outline:
    visible: false
  pagination:
    visible: false
  metadata:
    visible: false
  tags:
    visible: true
  actions:
    visible: true
  anchors:
    visible: false
---

# Void Node — Docs

&#x20;

## 🔮 Void Node — Your Crypto Guardian

> **The market doesn't forgive panic. Void Node helps you decide before emotions take over.**

### What is Void Node

Void Node is personal **risk intelligence** for the crypto investor. The bot looks at your portfolio the way a professional risk manager would: it measures concentration, checks liquidity reserve, evaluates data quality, and explains **why** your portfolio has a specific risk level.

### What you get

|     | Feature                                  | Why it matters                                        |
| --- | ---------------------------------------- | ----------------------------------------------------- |
| 📊  | **Portfolio analysis in 60 seconds**     | Understand real allocation without Excel              |
| 🛡️ | **Risk Score 0–100 with breakdown**      | See the reason, not a "magic number"                  |
| 🎯  | **Risk Copilot: detect → explain → fix** | Ready correction plan without "sell everything"       |
| 🛡️ | **Anti-Scam Center**                     | Check a link, contract, or wallet before losing money |
| 🤖  | **AI Advisor**                           | Portfolio breakdown in plain language                 |
| 🔔  | **Smart alerts**                         | Price, volume, news, calendar                         |
| 📰  | **Market for your assets**               | News, social trends, economic calendar                |

### What Void Node does NOT do

> ⚠️ **Void Node never places orders** and never executes automatic trades.

This is a deliberate decision. The bot reduces information and operational risk, but **does not guarantee against market losses**. We do not create a false sense of security that an algorithm will decide everything for the user.

### Getting started

1. Open the bot and send `/start`
2. Choose language and mode (Beginner / Experienced)
3. Connect an exchange in **Read-only** mode or start a **Demo wallet**
4. Run `/analyze` — get your first Risk Score

### Risk Engine

Every point in the Risk Score has a reason. The engine is fully deterministic:

| Factor             | What it checks                          | Max points |
| ------------------ | --------------------------------------- | ---------- |
| 🎯 Concentration   | Largest position > 50%                  | 30         |
| 💧 Reserve         | Stablecoin share below target           | 20         |
| 📉 Alt exposure    | Alts above risk profile                 | 15         |
| 🧩 Diversification | Fewer than 3 meaningful positions (≥5%) | 15         |
| 📡 Data quality    | Assets without confirmed price          | 20         |

**Risk levels:**

* 🟢 **0–19** — Low
* 🟡 **20–44** — Medium
* 🔴 **45–69** — High
* 🚨 **70–100** — Critical

### Anti-Scam Center

6 types of checks in one bot:

| Type        | What it checks                               |
| ----------- | -------------------------------------------- |
| 🔗 Link     | Phishing, domain spoofing                    |
| 🧾 Contract | Etherscan verification, liquidity, honeypot  |
| 📁 File     | Dangerous extensions (.exe, .scr, .bat, .js) |
| 👛 Wallet   | Balance, transactions, spam tokens           |
| 🔍 DEX      | Liquidity, 24h volume, pool risk             |
| 🔄 Account  | Impersonation of known services              |

> ⚪ **Honeypot status is marked as UNKNOWN** if there is no buy/sell simulation. Void Node never pretends to know what it has not verified.

### AI Advisor

> **AI explains. It does not predict. It does not give BUY/SELL commands.**

How it works:

1. Deterministic engine calculates Risk Score and factors
2. AI receives these facts as JSON
3. AI returns strictly: **Conclusion → Why → Next step**
4. If AI is unavailable — a deterministic fallback is used

**Hard rules of the AI:**

* Uses only facts from context
* Never invents balances, prices, or news
* Never promises profit or loss protection
* Never gives "buy now" / "sell now" commands
* News and conversation history are **untrusted data**, not instructions

### Plans

| Plan     | Price   | Duration | What's included                                                     |
| -------- | ------- | -------- | ------------------------------------------------------------------- |
| 🔰 Trial | 0 ₽     | 7 days   | 2 analyses/day, 3 anti-scam checks                                  |
| ⭐ Start  | 500 ₽   | 30 days  | 10 analyses/day, 15 anti-scam, 3 alerts, AI 5/day                   |
| 🚀 PRO   | 1 000 ₽ | 30 days  | 30 analyses/day, 50 anti-scam, 15 alerts, Risk Copilot, Kill Switch |
| 👑 VIP   | 1 500 ₽ | 30 days  | Everything unlimited + 24/7 priority support                        |

Payment: USDT via CryptoBot. Activation is automatic.

### Referral program

Invite friends and get bonus days:

| Friend's plan | Your bonus |
| ------------- | ---------- |
| ⭐ Start       | +5 days    |
| 🚀 PRO        | +10 days   |
| 👑 VIP        | +15 days   |

Link in `/referral`.

### Security & Privacy

* 🔐 API keys encrypted with **AES-256-GCM**
* 🗑️ Credential message is deleted **immediately** after processing
* 👁️ Only **Read-only** API permissions are requested
* ❌ Never Trade
* ❌ Never Withdraw
* ❌ Passwords, seed phrases, and private keys are never stored

### FAQ

**Does Void Node trade for me?** No. Void Node intentionally does not place orders. There are no order-creation methods in the code.

**Why aren't RSI/MA20 calculated?** They require a sufficiently long price history. Void Node does not invent metrics — it says `UNKNOWN`.

**What if AI is unavailable?** A deterministic fallback is used. Conclusions are still based on computed facts.

**How are my keys stored?** AES-256-GCM. The message with keys is deleted immediately after processing.

**How to disconnect an exchange?** `/disconnect` gives you 10 seconds to cancel via `/undo`.

### Contacts

* 📱 Telegram channel: [@atifragility\_node](https://t.me/atifragility_node)
* 👤 Founder: @clofeLEAN
* 🤖 Bot: [@void\_node\_bot](https://t.me/void_node_bot)
