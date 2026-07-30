# Breach Precedents

A citable library of real-world security incidents, indexed so a red-team review can attach **documented consequence** to a finding instead of hypothetical harm.

This file is the evidence base for the `tide-red-team` skill's *Damage* column. `tide-security-analyst` and `grc-review` may cite it too.

---

## How to use this file

1. You found a weakness in the target app. Name its **single point of failure** — the one artifact or party that, once compromised, defeats the control.
2. Look that failure mode up in the **Single-Point-of-Failure Index** below.
3. Cite the precedent by ID. State what it cost the victim.
4. State what Tide changes **and what it does not**. Both fields are mandatory.

### Hard rules for citing a precedent

- **Match the mechanism, not the industry.** A fintech finding is not "like Equifax" because both are financial. It is like Equifax only if the same artifact failed the same way. A precedent cited on sector similarity alone is a misuse of this file.
- **Never project the damage figure onto the target.** "Equifax paid $575M" is context for the class of failure. It is not a forecast for the app under review. Write "documented consequence of this failure class" — never "you will lose $X."
- **Never imply Tide would have prevented the whole incident.** Most of these have a non-Tide root cause (an unpatched CVE, a phished employee, a missing MFA toggle). Tide changes *what the intrusion yields*, not usually *whether it happens*. The `Tide does NOT change` field exists to stop this overclaim, and it is not optional.
- **Respect the confidence tag.** A `LOW` record's headline number is an attacker's claim or contested reporting. Say so in the report or do not cite the number.
- **Some records are anti-precedents.** Category AVAIL and CRYPTO include incidents where distributing an artifact across many parties helps little or actively hurts. Those are in here deliberately. Citing them honestly is what makes the rest of the library credible.

<a name="average-cost-anchors"></a>
### Average-cost anchors (for the "average cost on every finding" rule)

Use a precedent for the **mechanism** ("this failure is real, here is where it played out") and one of these **industry averages** for the **money** — never a precedent's one-off total. **Vary the anchor per finding**: match the target's sector and the finding's class, and rotate IBM (for cost) with Verizon DBIR (for prevalence — "how attackers actually get in") so a report does not repeat one figure on every card. All figures are industry averages, **not** a forecast for the org under review. VERIFIED against the sources named (WebSearch, 2026-07).

| Anchor | Figure | Best used for | Source |
|---|---|---|---|
| Global average breach | **USD $4.44M** | generic / when no sector or class fits better | IBM Cost of a Data Breach 2025 |
| US average | **USD $10.22M** | US-based target | IBM 2025 |
| **Public sector** (govt, registry, civic, education) | **USD $2.86M** (lowest sector) | government / registry / public-service targets | IBM 2025 |
| Healthcare | **USD $7.42M** (**$398/record**) | health / clinical data | IBM 2025 |
| **Credential-initiated breach** | **USD $4.67M** | committed secrets, stolen tokens, default/backdoor accounts, weak auth | IBM 2025 |
| Per compromised record | **~$160** customer PII / **~$168** employee PII | hash-store / record-exposure findings ("each record has a price") | IBM 2025 |
| Time to contain (stolen-credential breach) | **~8 months** (≈246 days) | credential/secret findings — the dwell-time angle | IBM 2025 |
| **Stolen credentials = #1 initial vector** | **22% of breaches** (2 yrs running) | any credential/secret/token finding — prevalence | Verizon DBIR 2025 |
| Human element in breaches | **60%** | phishing / social / recovery-path findings | Verizon DBIR 2025 |
| Third-party-involved breaches | **doubled** year-on-year | vulnerable-dependency / outdated-component findings | Verizon DBIR 2025 |
| Ransomware present | **44%** of breaches (median ransom **$115k**) | availability / backup findings | Verizon DBIR 2025 |
| **SME / mid-market breach (REAL insurance claims)** | **~USD $246K** 5-yr avg; **$264K** 2024 avg SME incident | small/mid-market or self-hosted targets — the relatable counter to IBM's enterprise figure | NetDiligence Cyber Claims Study 2025 (10,402 claims) |
| Ransomware — mean recovery cost (excl. ransom) | **USD $1.53M** (down from $2.73M) | availability / ransomware / backup findings | Sophos State of Ransomware 2025 |
| Ransomware — mean ransom paid | **USD $1.0M** (~85% of the demand) | ransomware / extortion findings | Sophos State of Ransomware 2025 |
| Total cybercrime losses (scale/context) | **USD $16.6B** in 2024 (+33%); **BEC $2.7B** | national-scale framing, BEC / phishing findings | FBI IC3 2024 Internet Crime Report |

**Additional datasets — regional, dwell-time, and independent ransomware corroboration.** VERIFIED against the sources named (WebSearch, 2026-07).

| Anchor | Figure | Best used for | Source |
|---|---|---|---|
| **UK / regional breach cost** | most-disruptive breach avg **£1,600** (all); **£3,550** excl. zero-cost; **£12,590** large firms; **median £0** | UK/EU or SME targets — and the honesty counterweight (most breaches cost little; the *mean* is a tail effect) | UK Gov Cyber Security Breaches Survey 2025 |
| **Dwell time (attacker undetected)** | global **median 11 days** (26 if externally notified, 10 if found internally) | detection/logging/monitoring findings — distinct from IBM's 246-day full *lifecycle* | Mandiant M-Trends 2025 |
| Ransom payment (independent, quarterly) | 2025 median ranged **$140K–$400K** by quarter; payment rate fell to ~23–28% | ransomware findings — independent corroboration of Sophos | Coveware 2025 quarterly reports |
| Ransomware ecosystem scale | **>$820M** on-chain in 2025 (−8% YoY); victims **+50%** (record); only **28%** of victims paid; median payment **$59,556** | national/ecosystem framing; "attacks up, payments down" nuance | Chainalysis 2026 Crypto Crime Report |

⚠️ **Two distinctions to keep straight.** (1) **Dwell time ≠ breach lifecycle.** Mandiant's ~11-day median is how long an attacker is present before detection; IBM's ~246–292 days is identify-*and*-contain across the whole incident. Never conflate them. (2) **Mean vs median diverge hugely at the low end.** The UK survey's median breach cost is £0 and the mean is £1,600 — most breaches cost little and a few are catastrophic. Cite the median (or say "most breaches cost near zero; the tail is what hurts") when the honest picture matters, exactly as with the library-derived medians below.

**Pick the source that matches the target's size and the finding's class — the datasets are not interchangeable.** IBM/Ponemon's $4.44M is a *modeled total-cost* figure weighted toward large enterprises; **NetDiligence's ~$246K is real cyber-insurance claims data dominated by SMEs** (98% of claims), and the **UK survey's median is £0** — so for a small team, startup, or self-hosted app the enterprise millions are misleading and the SME/median figures are the honest anchor. Use IBM for enterprise/regulated targets, NetDiligence for SME/mid-market, the UK survey for regional/SME and the "most breaches are cheap, the tail is not" point, Verizon DBIR for *how* attackers get in (prevalence), Sophos/Coveware/Chainalysis for ransomware/availability, Mandiant for dwell-time/detection, FBI IC3 for national-scale context, and this library's own derived medians (below) for litigation/penalty exposure. State the source every time. Do not invent figures beyond these tables; if a needed average is absent, verify it against a named report before using it, or omit the number and describe the class qualitatively.

#### Averages derived from this library's own records

Computed from the verified dollar figures in the records below, grouped by **type** (averaging across types — a fine vs a settlement vs a crypto theft — is meaningless, so don't). **Report the median, not the mean**: each group has a dominant outlier (Equifax, Bybit, UnitedHealth), and the mean is dragged by it. VERIFIED (arithmetic from the cited records, 2026-07).

| Group | n | **Median** | Mean | Records included |
|---|---|---|---|---|
| **US consumer-breach class-action settlements** | 10 | **USD $133M** | $169M | Equifax 575, T-Mobile 350, Capital One 190, AT&T 177, Uber-2016 148, Yahoo 117.5, MGM 45, Robinhood 45, 23andMe 30, Ashley Madison 11.2 |
| **Regulatory penalties (USD-native)** | 5 | **USD $31.5M** | $30M | Capital One OCC 80, Yahoo/Altaba SEC 35, T-Mobile FCC 31.5, Ashley Madison FTC 1.6, First American SEC+NYDFS 1.49 |
| **Crypto / digital-asset thefts** | 5 | **USD $126M** | $461M | Bybit 1,500, Ronin 540, Multichain 126, QuadrigaCX ~125, Fortress/Retool 15 |
| **Company-disclosed direct cost** | 4 | **USD $178M** | $863M | UnitedHealth 3,090, Coinbase ~290, RSA/EMC 66.3, Colonial ransom 4.4 |

**Read these correctly — they are NOT a substitute for the IBM per-breach average.** IBM's $4.44M is the *total cost of a representative breach* (detection, response, lost business, small and large). The figures above are the **litigation, penalty, and theft tail of the most catastrophic, most-documented breaches** — this library deliberately curates notable incidents, so the sample is selection-biased **high**. Use them only for the honest claim they support: *"when a breach of this class has ended up in court, the consumer settlement has run to a median of ~$133M (Equifax $575M, T-Mobile $350M, Capital One $190M…)"* — the **exposure/tail**, explicitly distinct from the expected per-incident cost. Never state one of these as "your breach will cost $X." Excluded from the arithmetic: contested/attacker-claimed counts, market-cap-loss figures, mixed-currency EU fines (e.g. Facebook €251M, BA £20M — cite individually), and pre-exploitation advisories with no incident cost. Currency at time of event for crypto.

### Record schema

| Field | Meaning |
|---|---|
| **Single point of failure** | The one artifact/party whose compromise defeated the control. This is the join key. |
| **What happened** | Root cause, technically precise. |
| **Damage** | Quantified, with the source that states the figure. |
| **Maps to** | `SG-xx` (gap IDs in `canon/security-gap-mapping.md`) and `T-xx` (threat catalog in `skills/tide-red-team/SKILL.md`). |
| **Tide changes** | What Tide removes or distributes so this failure stops paying. |
| **Tide does NOT change** | The part that remains the operator's problem. Mandatory. |
| **Confidence** | HIGH (multiple primary sources) / MEDIUM (secondary reporting) / LOW (contested or attacker-claimed) |

---

## Index A — by single point of failure

| The one thing that failed | Precedents |
|---|---|
| One password/credential store, offline-crackable | `BP-CRED-01` Equifax, `BP-CRED-02` Yahoo, `BP-CRED-03` LinkedIn, `BP-CRED-04` Adobe, `BP-CRED-05` Ashley Madison |
| One private signing key = forge any identity | `BP-KEY-06` Storm-0558, `BP-KEY-03` SolarWinds Golden SAML, `BP-KEY-01` RSA SecurID |
| One static secret in code / config / image | `BP-KEY-02` Uber 2016, `BP-KEY-04` Codecov, `BP-KEY-09` Sisense |
| One bearer token or session cookie, replayable anywhere | `BP-KEY-05` CircleCI, `BP-KEY-07` Okta support, `BP-KEY-08` Cloudflare Thanksgiving, `BP-KEY-11` Salesloft Drift |
| One missing MFA toggle on one door | `BP-CRED-12` Change Healthcare, `BP-CRED-10` Medibank, `BP-CRED-13` Snowflake campaign |
| One over-privileged machine/service identity | `BP-CRED-06` Capital One, `BP-KEY-10` Dropbox Sign, `BP-KEY-08` Cloudflare |
| One human with legitimate broad read access | `BP-KEY-12` Coinbase insider |
| One compromised interface deciding what humans approve | `BP-KEY-13` Bybit |
| One unauthenticated / unchecked API endpoint | `BP-CRED-09` Optus |
| One reused password, no second factor | `BP-CRED-11` 23andMe |
| One aggregation store holding data on non-customers | `BP-CRED-14` National Public Data, `BP-CRED-07` Marriott/Starwood |
| One unsegmented network behind one weak edge | `BP-CRED-08` T-Mobile 2021 |
| One build server or code-signing pipeline | `BP-CHAIN-01` SolarWinds, `BP-CHAIN-09` CCleaner, `BP-CHAIN-10` ASUS, `BP-CHAIN-04` 3CX |
| One upstream maintainer account | `BP-CHAIN-02` XZ Utils, `BP-CHAIN-11` event-stream, `BP-CHAIN-12`/`14` npm, `BP-CHAIN-15` Shai-Hulud |
| One third-party script in your own origin | `BP-CHAIN-06` British Airways, `BP-CHAIN-07` Ticketmaster, `BP-CHAIN-13` polyfill.io |
| One aggregation appliance holding many orgs' data | `BP-CHAIN-05` MOVEit, `BP-CHAIN-03` Kaseya |
| One admin/support console with cross-account reach | `BP-ADMIN-01` Twitter, `BP-SESS-06` Mailchimp, `BP-SESS-10` Robinhood, `BP-KEY-12` Coinbase, `BP-ADMIN-05` Retool |
| One help-desk agent who can reset MFA | `BP-ADMIN-03` MGM, `BP-ADMIN-04` Caesars, `BP-SESS-02` Scattered Spider, `BP-SESS-05` EA |
| One person who can also edit the audit log | `BP-ADMIN-07` Ubiquiti |
| One orphaned/legacy high-privilege identity | `BP-ADMIN-06` Midnight Blizzard, `BP-KEY-08` Cloudflare |
| Offboarding latency / standing bulk-read | `BP-ADMIN-09` Cash App, `BP-ADMIN-08` Tesla |
| A guessable identifier with no ownership check | `BP-AUTHZ-01` First American, `BP-AUTHZ-05` Parler, `BP-CRED-09` Optus |
| Authentication mistaken for authorization | `BP-AUTHZ-02` USPS, `BP-AUTHZ-07` T-Mobile API |
| A control enforced only in the client/UI | `BP-AUTHZ-04` Peloton, `BP-AUTHZ-08` Twitter API, `BP-AUTHZ-12` Power Apps |
| The token/artifact declares its own verification | `BP-AUTHZ-10` jsonwebtoken, `BP-AUTHZ-11` Keycloak, `BP-CRYPTO-09` |
| The IdP itself signs a false claim | `BP-AUTHZ-09` Sign in with Apple, `BP-KEY-06` Storm-0558 |
| A phishable second factor (SMS/TOTP/push) | `BP-SESS-01` 0ktapus, `BP-SESS-03`/`04` Reddit, `BP-ADMIN-02` Uber, `BP-CHAIN-14` npm |
| One mailbox or phone number upstream of recovery | `BP-SESS-08` Terpin, `BP-SESS-09` The Community, `BP-SESS-07` SEC, `BP-SESS-11` Coinbase |
| One person holding all the "distributed" shares | `BP-KEYLOSS-01` QuadrigaCX, `BP-KEYLOSS-04` Multichain, `BP-KEYLOSS-05` Ronin |
| One shared code path under all the keys | `BP-KEYLOSS-02` Parity, `BP-AVAIL-04` Cloudflare |
| Backups reachable from the same credential | `BP-KEYLOSS-07` Code Spaces |
| An untested or too-slow recovery path | `BP-KEYLOSS-08` Colonial Pipeline, `BP-AVAIL-07` Azure AD |
| One artifact pushed to every node at once | `BP-AVAIL-01` CrowdStrike, `BP-AVAIL-04`/`05` Cloudflare, `BP-AVAIL-06` Fastly |
| Recovery path depends on the thing being recovered | `BP-AVAIL-02` Meta BGP, `BP-AVAIL-08` Rogers, `BP-AVAIL-07` Azure AD |
| Nominally independent nodes sharing a failure domain | `BP-AVAIL-03` AWS us-east-1, `BP-AVAIL-09` Optus outage |
| One broken primitive used by every party | `BP-CRYPTO-01` Heartbleed, `BP-CRYPTO-02` Debian PRNG, `BP-CRYPTO-03` ROCA, `BP-CRYPTO-05` SHA-1 |
| A trapdoored or unaudited constant | `BP-CRYPTO-04` Juniper Dual_EC |
| A nonce that leaks the key through signatures | `BP-CRYPTO-06` PS3, `BP-CRYPTO-07` PuTTY |
| Weak entropy at generation time | `BP-CRYPTO-08` Milk Sad, `BP-CRYPTO-02` Debian PRNG |
| A behaviour difference that becomes an oracle | `BP-CRYPTO-10` ROBOT |

## Index B — by threat-catalog ID (`T-xx`)

| T-xx | Precedents |
|---|---|
| **T-01** Database breach | `BP-CRED-01`…`BP-CRED-14`, `BP-CHAIN-05`, `BP-KEY-10` |
| **T-02** App/IdP server compromise | `BP-KEY-06`, `BP-KEY-03`, `BP-KEY-01`, `BP-KEY-02`, `BP-AUTHZ-09`, `BP-AUTHZ-11`, `BP-ADMIN-06` |
| **T-03** Rogue/compromised admin | `BP-ADMIN-01`, `BP-KEY-12`, `BP-ADMIN-02`, `BP-ADMIN-03`/`04`, `BP-ADMIN-05`, `BP-ADMIN-07`, `BP-CHAIN-03`, `BP-CHAIN-08` |
| **T-04** Supply-chain code injection | `BP-CHAIN-01`…`BP-CHAIN-16`, `BP-KEY-13` |
| **T-05** Stolen token / session replay | `BP-KEY-05`, `BP-KEY-07`, `BP-KEY-08`, `BP-KEY-11`, `BP-AUTHZ-03`, `BP-SESS-01`, `BP-SESS-05` |
| **T-07** Insider / vendor employee | `BP-KEY-12`, `BP-ADMIN-07`, `BP-ADMIN-08`/`09`, `BP-KEY-09`, `BP-KEY-11`, `BP-SESS-09` |
| **T-08** Full infrastructure compromise | `BP-KEYLOSS-05` Ronin, `BP-KEYLOSS-04` Multichain, `BP-AVAIL-03` (failure domains) |
| **T-09** UI-gating / authz bypass | `BP-CRED-09` Optus, `BP-AUTHZ-01`…`BP-AUTHZ-12` |
| **T-11** Account-recovery abuse | `BP-SESS-02`, `BP-SESS-07`, `BP-SESS-08`, `BP-SESS-09`, `BP-SESS-11`, `BP-ADMIN-03` |
| **T-12** Ragnarök / quorum capture | `BP-KEYLOSS-05` Ronin, `BP-KEYLOSS-04` Multichain, `BP-KEYLOSS-01` QuadrigaCX, `BP-KEY-13` Bybit |
| **T-14** Malicious client code / credential capture | `BP-KEY-13` Bybit, `BP-CHAIN-06`, `BP-CHAIN-07`, `BP-CHAIN-13`, `BP-SESS-01` |
| **T-15** Unaudited-primitive risk | `BP-CRYPTO-04` Juniper, `BP-CRYPTO-03` ROCA, `BP-CRYPTO-05` SHA-1 |
| **T-16** Forseti sandbox / determinism | `BP-KEYLOSS-02` Parity, `BP-AVAIL-04` Cloudflare, `BP-CRYPTO-06`/`07` nonces, `BP-CRYPTO-10` ROBOT |
| **T-19** Availability / no break-glass | `BP-AVAIL-01`…`BP-AVAIL-09`, `BP-KEYLOSS-07`, `BP-KEYLOSS-08`, `BP-CRED-12` |
| **T-20** Long-horizon / crypto-agility | `BP-CRYPTO-05` SHA-1, `BP-CRYPTO-03` ROCA |

## Index C — by gap ID (`SG-xx`)

| SG-xx | Precedents |
|---|---|
| **SG-01** Central password verification | `BP-CRED-01`…`BP-CRED-05`, `BP-CRED-11`, `BP-CRED-12` |
| **SG-02** Signing key held whole | `BP-KEY-06`, `BP-KEY-03`, `BP-KEY-01`, `BP-AUTHZ-09` |
| **SG-03** Bearer tokens, no proof-of-possession | `BP-KEY-05`, `BP-KEY-07`, `BP-KEY-08`, `BP-KEY-11`, `BP-AUTHZ-03`, `BP-SESS-05` |
| **SG-04** Client-side-only authorization | `BP-AUTHZ-04`, `BP-AUTHZ-08`, `BP-AUTHZ-12`, `BP-CHAIN-07`, `BP-KEY-13` |
| **SG-05** Unprotected / partially protected APIs | `BP-CRED-09`, `BP-AUTHZ-01`, `BP-AUTHZ-02`, `BP-AUTHZ-06`, `BP-AUTHZ-07`, `BP-SESS-12` |
| **SG-06** Server-readable sensitive data | `BP-CRED-12`, `BP-CRED-10`, `BP-KEY-09`, `BP-KEY-14`, `BP-CHAIN-05` |
| **SG-07** Unilateral admin power | `BP-ADMIN-01`, `BP-KEY-12`, `BP-ADMIN-03`/`04`, `BP-ADMIN-07`, `BP-SESS-10`, `BP-CHAIN-03` |
| **SG-08** Standing privileged credentials in code | `BP-KEY-02`, `BP-KEY-04`, `BP-KEY-09`, `BP-ADMIN-02`, `BP-CHAIN-06` |
| **SG-09** Procedural-only policy on high-value ops | `BP-KEY-13` Bybit, `BP-ADMIN-01`, `BP-KEY-12` |
| **SG-11** Homegrown auth or crypto | `BP-CRED-04` Adobe, `BP-CRED-05` Ashley Madison, `BP-CRYPTO-08` Milk Sad |
| **SG-13** JWT algorithm confusion | `BP-AUTHZ-10`, `BP-AUTHZ-11`, `BP-CRYPTO-09`, `BP-AUTHZ-09` |
| **SG-14** Tamperable audit trail | `BP-ADMIN-07` Ubiquiti, `BP-ADMIN-08` Tesla |
| **SG-15** Weak session lifecycle | `BP-KEY-05`, `BP-SESS-01`, `BP-SESS-03`/`04`, `BP-SESS-05`, `BP-CRED-11` |
| **SG-16** No step-up / second approval | `BP-KEY-13` Bybit, `BP-ADMIN-01`, `BP-SESS-11`, `BP-CRED-13` |
| **SG-17** User-held secrets stored server-readable | `BP-KEY-14` LastPass |
| **SG-18** Machine identity via shared static secrets | `BP-KEY-08`, `BP-KEY-10`, `BP-KEY-11`, `BP-ADMIN-06`, `BP-CHAIN-15` |

## Index D — anti-precedents (things Tide does NOT fix)

Cite these when a report risks overclaiming. Each is a major incident where distributing key material would have helped little or not at all.

| Claim it refutes | Precedent |
|---|---|
| "Distribution improves resilience" | `BP-AVAIL-01` CrowdStrike — a correctness bug pushed everywhere at once |
| "Our quorum can always recover us" | `BP-AVAIL-02` Meta, `BP-AVAIL-07` Azure AD — custodians could not authenticate |
| "20 nodes means 20 failure domains" | `BP-AVAIL-03` AWS, `BP-AVAIL-09` Optus — correlated dependencies and identical failsafes |
| "k-of-n means k parties must be corrupted" | `BP-KEYLOSS-05` Ronin, `BP-KEYLOSS-04` Multichain — effective threshold ≠ configured threshold |
| "Splitting the key protects the secret" | `BP-CRYPTO-02` Debian PRNG, `BP-CRYPTO-08` Milk Sad — weak entropy defeats sharding |
| "No single party holds the key" | `BP-CRYPTO-06`/`07` nonce bias — the key leaks through the signatures |
| "Threshold signing prevents forgery" | `BP-CRYPTO-05` SHA-1, `BP-CRYPTO-09` JWT `alg` — broken hash or verifier makes signing irrelevant |
| "Multi-party approval prevents fraud" | `BP-KEY-13` Bybit — all approvers were lied to by one compromised interface |
| "Confidentiality controls address ransomware" | `BP-CRED-12` Change Healthcare — $3.09B was mostly availability |
| "Catastrophic CVEs cause catastrophic loss" | `BP-CHAIN-16` Log4Shell — CSRB found no confirmed significant CI attack |

---

# Category CRED — Credential stores and data-at-rest

## BP-CRED-01 — Equifax (2017)

**Single point of failure**: One unsegmented internal database tier reachable from one unpatched web app. Plaintext credentials found on that host unlocked 48+ unrelated databases. A separately expired TLS-inspection certificate blinded egress monitoring for 76 days.

**What happened**: Unpatched Apache Struts CVE-2017-5638 on the internet-facing dispute portal (patch available 7 Mar 2017, exploited 10 Mar 2017). Attributed by DOJ (Feb 2020 indictment) to four members of China's PLA 54th Research Institute.

**Damage**: At least 147M names and dates of birth; 145.5M SSNs; 209,000 payment card numbers (FTC). Global settlement of **at least $575M, up to $700M** — $300M consumer fund (+$125M contingent), $175M to 48 states, $100M CFPB civil penalty.

**Maps to**: SG-01, SG-08 | T-01

**Tide changes**: The credential store is the part that pays. With PRISM threshold verification there are no password hashes to dump and crack, and the plaintext credentials sitting on a compromised host that unlocked 48 further databases would not be complete usable secrets.

**Tide does NOT change**: Tide does not patch Struts, segment your network, or renew your monitoring certificates. The intrusion still happens; the PII in a non-Tide-protected database is still exfiltrated. Cite this for *credential-store blast radius*, not for perimeter security.

**Sources**: [FTC press release](https://www.ftc.gov/news-events/news/press-releases/2019/07/equifax-pay-575-million-part-settlement-ftc-cfpb-states-related-2017-data-breach) · [House Oversight report](https://oversight.house.gov/wp-content/uploads/2018/12/Equifax-Report.pdf) · [Equifax investor release](https://investor.equifax.com/news-events/press-releases/detail/237/equifax-releases-details-on-cybersecurity-incident)

**Confidence**: HIGH

---

## BP-CRED-02 — Yahoo (2013 & 2014)

**Single point of failure**: One user-account database holding MD5 hashes *and* recoverable security questions/answers. For 2014, additionally the account-management secret that let attackers **mint forged session cookies for arbitrary users without any password**.

**What happened**: Theft of the account database (MD5-hashed passwords — fast and unsuitable). The 2014 incident escalated to cookie forgery using stolen source code and secrets. DOJ (Mar 2017) indicted two Russian FSB officers and two criminal hackers for the 2014 breach; 2013 unattributed.

**Damage**: 2013: Yahoo ultimately stated **all 3 billion accounts**. 2014: **at least 500 million accounts**. **$35M SEC civil penalty** against Altaba for disclosure failure; **$117.5M** class-action settlement; Verizon cut its acquisition price by **$350M**.

**Maps to**: SG-01, SG-02, SG-15 | T-01, T-02, T-05

**Tide changes**: Two distinct wins. No password hashes exist to steal. And the forged-cookie path — one secret that mints authenticated sessions for any user — is exactly the artifact threshold VVK signing removes; no single component holds a complete token-minting capability.

**Tide does NOT change**: Security questions and other self-service recovery data are application data. If your app stores recovery answers server-readable, Tide's presence does not change that.

**Sources**: [SEC press release](https://www.sec.gov/news/press-release/2018-71) · [DOJ indictment](https://www.justice.gov/opa/pr/us-charges-russian-fsb-officers-and-their-criminal-conspirators-hacking-yahoo-and-millions)

**Confidence**: HIGH on counts and penalties; MEDIUM on exact hash/cookie mechanics (from Yahoo statements and the indictment, not a technical post-mortem)

---

## BP-CRED-03 — LinkedIn (2012)

**Single point of failure**: One password table using **unsalted SHA-1**. No per-user salt meant one dictionary run cracked millions in parallel.

**What happened**: Database exfiltration; commodity GPU cracking recovered the great majority offline. Yevgeniy Nikulin convicted July 2020, sentenced to 88 months.

**Damage**: ~6.5M hashes posted in 2012; **~100M further email/password pairs** surfaced in 2016 from the same intrusion. DOJ charged Nikulin with credential theft for **117M LinkedIn users**, plus 68M Dropbox and ~30M Formspring. The resold plaintext fuelled years of credential stuffing — including the Dropbox compromise via a reused LinkedIn password.

**Maps to**: SG-01 | T-01

**Tide changes**: No stored hash means no offline cracking, so no downstream credential-stuffing corpus is generated from your breach. This record is the best available evidence that a credential store's damage is *not bounded by the breached org* — it propagates to every other service where users reused the password.

**Tide does NOT change**: Users may still reuse a password elsewhere, and credential stuffing *into* your app from someone else's breach is a separate problem (see `BP-CRED-11`).

**Sources**: [DOJ conviction announcement](https://www.justice.gov/usao-ndca/pr/russian-hacker-found-guilty-damaging-multiple-computer-networks) · [CyberScoop sentencing](https://cyberscoop.com/nikulin-sentence-russian-cybercrime-linkedin-hacker/)

**Confidence**: HIGH on conviction and the 117M figure; MEDIUM on precise crack rate

---

## BP-CRED-04 — Adobe (2013)

**Single point of failure**: One symmetric key covering the entire password column — **3DES in ECB mode, no salt, no per-record IV** — plus plaintext password hints stored alongside. Identical passwords produced identical ciphertext; the hints were the crib. Researchers recovered passwords en masse **without ever obtaining the key**.

**What happened**: Passwords were *encrypted, not hashed*. Unattributed.

**Damage**: Adobe confirmed **38M active users**' IDs and encrypted passwords and ~**2.9M** encrypted credit-card records. The public dump contained ~150M credential records (a dump row count, not an Adobe-confirmed user count — treat as disputed). Consumer class action settled Aug 2015, terms undisclosed.

**Maps to**: SG-01, SG-11 | T-01

**Tide changes**: The failure class is "one key protects every credential." Tide's answer is that no such key exists — verification is threshold-distributed, and there is no single decryption capability to hold, mis-mode, or leak.

**Tide does NOT change**: Tide does not stop a team from building a homegrown crypto scheme *elsewhere* in the app. This record is the canonical argument for SG-11 (homegrown auth/crypto), not just SG-01.

**Sources**: [Krebs on Security](https://krebsonsecurity.com/2013/10/adobe-breach-impacted-at-least-38-million-users/) · [Sophos technical analysis of the 3DES-ECB failure](https://nakedsecurity.sophos.com/2013/11/04/anatomy-of-a-password-disaster-adobes-giant-sized-cryptographic-blunder/)

**Confidence**: HIGH on mechanism and 38M; the 150M figure is LOW

---

## BP-CRED-05 — Ashley Madison (2015)

**Single point of failure**: One legacy MD5 `$loginkey` token that **shadowed** an otherwise-correct bcrypt password store. The strong hash was intact and irrelevant — a single redundant token field defeated it. Separately, encryption keys were stored in plaintext on servers and in employee email (FTC complaint).

**What happened**: `$loginkey` was an MD5 over the username and the bcrypt output — and for pre-June-2012 accounts, over the *plaintext* password. Attackers cracked the cheap MD5 instead of the expensive bcrypt. "The Impact Team," never identified.

**Damage**: **36M** user profiles exposed (FTC). CynoSure Prime cracked **11.2M** passwords in ~10 days via the MD5 tokens. **$1.6M** paid to FTC and 13 states (of a $17.5M judgment, largely suspended for inability to pay); **$11.2M** class-action settlement. Multiple suicides were reported in the aftermath.

**Maps to**: SG-01, SG-11 | T-01

**Tide changes**: Removes the credential artifact entirely, so there is no legacy field that can shadow it. The lesson generalizes: **the security of a password store is the security of its weakest derived field**, and audits routinely miss the derived field.

**Tide does NOT change**: Tide does not find and remove legacy auth columns in your existing schema. Migration must explicitly retire them — flag this in any `migrate-from-existing-auth` engagement.

**Sources**: [FTC press release + complaint](https://www.ftc.gov/news-events/news/press-releases/2016/12/operators-ashleymadisoncom-settle-ftc-state-charges-resulting-2015-data-breach-exposed-36-million) · [CynoSure Prime technical write-up](https://blog.cynosureprime.com/2015/09/how-we-cracked-millions-of-ashley.html)

**Confidence**: HIGH

---

## BP-CRED-06 — Capital One (2019)

**Single point of failure**: One over-privileged IAM role whose short-lived credentials were retrievable over plain HTTP from the EC2 instance metadata endpoint (IMDSv1) by anything that could make the WAF issue a request. **One SSRF = full credential issuance** across 700+ S3 buckets.

**What happened**: Misconfigured WAF permitted server-side request forgery to the metadata service. Paige Thompson, a former AWS engineer, convicted June 2022.

**Damage**: ~**106M** individuals in the US and Canada; ~140,000 SSNs, ~80,000 linked bank account numbers, ~1M Canadian SINs. **$80M OCC civil money penalty** plus consent order; **$190M** class-action settlement.

**Maps to**: SG-08, SG-18 | T-01, T-07

**Tide changes**: Little on the intrusion path — this is a cloud IAM misconfiguration. What Tide changes is the *value of the destination*: E2EE'd data under keys the server cannot assemble is not readable by a stolen role credential.

**Tide does NOT change**: IMDS configuration, WAF rules, IAM least-privilege, or S3 bucket policy. **Cite this one carefully.** It is a strong precedent for "machine credentials are a single point of failure" and a weak one for anything Tide directly replaces.

**Sources**: [OCC consent order](https://www.occ.gov/news-issuances/news-releases/2020/nr-occ-2020-101.html) · [DOJ case page](https://www.justice.gov/usao-wdwa/united-states-v-paige-thompson) · [Krebs technical analysis](https://krebsonsecurity.com/2019/08/what-we-can-learn-from-the-capital-one-hack/)

**Confidence**: HIGH

---

## BP-CRED-07 — Marriott / Starwood (2014–2018)

**Single point of failure**: One inherited guest reservation database that nobody re-baselined after the merger. **The acquisition transferred an already-compromised system along with the customers.** Attackers were resident from 2014 and persisted through the 2016 acquisition undetected.

**What happened**: ICO and FTC cited inadequate monitoring, poor access control, missing MFA, weak segmentation, and unencrypted data. Widely reported as Chinese state-linked; formally unattributed in the regulatory actions.

**Damage**: **More than 339M guest records globally** (FTC/state AGs), including ~131.5M US records and ~18.5M encrypted passport numbers. **£18.4M ICO fine** (reduced from a £99.2M notice of intent); **$52M** settlement with 49 state AGs; FTC consent order with a 20-year security program but **no monetary penalty**.

**Maps to**: SG-06 | T-01, T-07

**Tide changes**: E2EE'd guest data would not be readable by a resident attacker holding server access. The dwell-time problem is unchanged; the *yield* is.

**Tide does NOT change**: Detection, M&A security due diligence, or network monitoring. Cite this specifically for **inherited-system risk in acquisitions** — a scenario most threat models omit entirely.

**Sources**: [FTC press release + consent order](https://www.ftc.gov/news-events/news/press-releases/2024/10/ftc-takes-action-against-marriott-starwood-over-multiple-data-breaches) · [Connecticut AG multistate settlement](https://portal.ct.gov/ag/press-releases/2024-press-releases/multistate-settlement-with-marriott-for-data-breach-of-starwood-guest-reservation-database)

**Confidence**: HIGH

---

## BP-CRED-08 — T-Mobile US (2021)

**Single point of failure**: One exposed network edge device leading, **without further authentication barriers**, to the customer data stores. No segmentation between perimeter and crown jewels.

**What happened**: Attacker found an unprotected internet-exposed GPRS/router entry point and pivoted into an unsegmented internal environment. John Binns publicly claimed the intrusion; later charged. The FCC consent decree describes foundational failures across access control, segmentation, and authentication.

**Damage**: **76.6M** US consumers from the 2021 breach alone (FCC). **$350M class-action settlement** plus $150M committed security spending. **$31.5M FCC settlement** (Sep 2024) covering the 2021, 2022 and 2023 breaches. A separate 2023 breach affected 37M.

**Maps to**: SG-05, SG-06 | T-01

**Tide changes**: Account PINs and authentication material are the Tide-relevant subset — those become non-existent artifacts rather than stored ones.

**Tide does NOT change**: Network segmentation and edge exposure. The bulk PII (names, DOB, SSN, licence numbers) is application data; Tide protects it only if the app actually E2EEs it.

**Sources**: [FCC settlement and consent decree](https://www.fcc.gov/document/fcc-settlement-t-mobile-data-breaches) · [T-Mobile newsroom](https://www.t-mobile.com/news/network/cyberattack-against-tmobile-and-our-customers)

**Confidence**: HIGH on numbers; MEDIUM on initial entry mechanics (largely from Binns's own account)

---

## BP-CRED-09 — Optus (2022) — *the flagship authorization-bypass precedent*

**Single point of failure**: **One API endpoint whose authorization check was ineffective.** No second control existed behind it, so a single missing check exposed the entire customer table. The attacker simply incremented identifiers in the URL.

**What happened**: An unauthenticated, internet-facing API on an Optus subdomain. ACMA alleges a 2018 coding error rendered its access controls ineffective; Optus found and fixed the same defect on its main domain in August 2021 **but did not identify the subdomain instance**. Unattributed.

**Damage**: ~**9.5M** current and former customers; ~2.1M had one or more identity document numbers exposed. ACMA filed Federal Court proceedings May 2024; OAIC filed separate civil penalty proceedings. **Penalties were not finalised — do not cite a fine figure.** Identity-document replacement costs reported in the hundreds of millions AUD; treat as an unverified range.

**Maps to**: SG-04, SG-05 | T-09

**Tide changes**: This is a **T-09 app-level finding**, and it is the single most useful precedent in this file for that class. Tide supplies threshold-signed JWTs that an API can verify server-side with no remote key fetch — but only if the app actually performs the check on **every** endpoint.

**Tide does NOT change**: Nothing, if the endpoint has no authorization check at all. Optus is the precedent you cite **against an application**, not in favour of Tide. Route the fix to `tide-route-and-api-protection`. The "fixed on main domain, missed on subdomain" detail is the point: enumerate every route, not every *known* route.

**Sources**: [ACMA Federal Court proceedings](https://www.acma.gov.au/articles/2024-05/acma-commences-federal-court-proceedings-against-optus) · [OAIC civil penalty action](https://www.oaic.gov.au/news/media-centre/oaic-takes-civil-penalty-action-against-optus) · [iTnews on the ACMA concise statement](https://www.itnews.com.au/news/optus-breach-allegedly-enabled-by-access-control-coding-error-608985)

**Confidence**: MEDIUM-HIGH — the API root cause is a regulator's **allegation in live litigation**, not a proven finding. The 9.5M figure is HIGH.

---

## BP-CRED-10 — Medibank (2022)

**Single point of failure**: One contractor's username and password on a VPN whose **second factor was optional by configuration** — it accepted a device certificate *or* a username/password, so the stolen password alone sufficed. The credentials carried high privilege.

**What happened**: Infostealer malware harvested a contractor's Medibank credentials from a personal browser profile. Attributed by the Australian Government (Jan 2023 sanctions) to Aleksandr Ermakov, linked to the REvil ecosystem. Medibank refused to pay; data was published on the dark web.

**Damage**: OAIC alleges serious interference with the privacy of **9.7M Australians**. Civil penalty proceedings filed June 2024 seeking up to A$2.22M per contravention — **unresolved; no final penalty exists, do not cite one.** Medibank reported cybercrime costs of roughly **A$126M across FY23** with further amounts guided for FY24.

**Maps to**: SG-01, SG-06 | T-01, T-07

**Tide changes**: A stolen static password is not sufficient to authenticate under threshold verification, and privileged actions requiring quorum cannot be exercised by one stolen contractor identity.

**Tide does NOT change**: Infostealer malware on a contractor's personal device, or the decision to grant a contractor high privilege. The published health data (diagnosis and procedure codes) is protected only to the degree the app E2EEs it.

**Sources**: [OAIC civil penalty action](https://www.oaic.gov.au/news/media-centre/oaic-takes-civil-penalty-action-against-medibank) · [Australian Government sanctions](https://www.foreignminister.gov.au/minister/penny-wong/media-release/first-use-australias-cyber-sanctions-powers)

**Confidence**: HIGH on mechanism and scale; penalty unresolved

---

## BP-CRED-11 — 23andMe (2023) — *the blast-radius-through-graph precedent*

**Single point of failure**: One reused password per account with no second factor — but the instructive part is the **DNA Relatives graph**. ~14,000 directly compromised accounts leaked data on ~6.9M people. **One credential compromised hundreds of other people's records**, none of whom did anything wrong.

**What happened**: Credential stuffing with passwords reused from unrelated prior breaches. No MFA requirement, weak password rules, and per the joint ICO/OPC investigation, missed warning signs for months.

**Damage**: ~**14,000** accounts directly accessed; profile data of ~**6.9M** individuals exposed via DNA Relatives. **£2.31M ICO monetary penalty** (June 2025); **$30M** US class-action settlement; **$18M** from a 42-state AG coalition. 23andMe filed for Chapter 11 in March 2025. Curated lists targeting people of Ashkenazi Jewish and Chinese descent were offered for sale.

**Maps to**: SG-01, SG-04, SG-15 | T-01

**Tide changes**: Credential stuffing depends on a password being *verifiable by a single party* that an attacker can query at scale. Threshold verification plus per-user key material changes that economics substantially.

**Tide does NOT change**: **The graph amplification is an application design decision, not an auth problem.** Any feature that lets one authenticated account read other people's data multiplies every auth failure by the fan-out. Cite this whenever the target app has a sharing, relatives, org-hierarchy, or team-visibility feature — the auth finding's real severity is the fan-out, and Tide does not reduce it.

**Sources**: [ICO penalty notice (PDF)](https://ico.org.uk/media2/kclbljpo/23andme-penalty-notice.pdf) · [OPC Canada PIPEDA Findings #2025-001](https://www.priv.gc.ca/en/opc-actions-and-decisions/investigations/investigations-into-businesses/2025/pipeda-2025-001/)

**Confidence**: HIGH

---

## BP-CRED-12 — Change Healthcare (2024) — *the largest healthcare breach on record*

**Single point of failure**: **One Citrix remote-access portal with a valid username/password and no second factor.** A single missing MFA toggle on one server took down roughly a third of US healthcare claims processing.

**What happened**: On 12 Feb 2024 attackers used compromised credentials to log into a Citrix portal that did not have MFA enabled (admitted by UnitedHealth CEO Andrew Witty in congressional testimony). Nine days of lateral movement and exfiltration preceded ransomware deployment on 21 Feb. ALPHV/BlackCat, with a second extortion round by RansomHub.

**Damage**: **192.7M individuals** notified to HHS OCR (final figure, July 2025) — **79% of all individuals affected by large US healthcare breaches in 2024**. UnitedHealth reported ~**$3.09 billion** in total 2024 cyberattack impacts, including ~$2.457B direct response costs. A **$22M** ransom was paid to ALPHV and publicly traced; a second demand followed. Weeks of national claims/pharmacy outage; UHG advanced over $6B in interim provider funding.

**Maps to**: SG-01, SG-06, SG-16 | T-01, T-19

**Tide changes**: A stolen static password does not authenticate. Beyond that, the PHI is only protected to the degree it is E2EE'd under keys no server can assemble.

**Tide does NOT change**: Ransomware encryption of your own systems, and therefore **not the availability collapse that caused most of the $3.09B**. This is the record to cite when someone assumes confidentiality controls address ransomware — they do not. Pair with the AVAIL category.

**Sources**: [HHS Change Healthcare FAQ + OCR breach portal](https://www.hhs.gov/hipaa/for-professionals/special-topics/change-healthcare-cybersecurity-incident-frequently-asked-questions/index.html) · [UnitedHealth FY2024 results](https://www.unitedhealthgroup.com/newsroom/2025/2025-01-16-uhg-reports-2024-results.html) · [Witty testimony, Senate Finance Committee](https://www.finance.senate.gov/imo/media/doc/witty_testimony.pdf)

**Confidence**: HIGH

---

## BP-CRED-13 — Snowflake customer-tenant campaign (2024)

**Single point of failure**: One static username/password per data-warehouse tenant, with **MFA optional at the customer's discretion**. An entire corporate data lake sat behind one unrotated single-factor credential — and the platform design at the time gave the *provider* no way to compel a second factor.

**What happened**: **Not a Snowflake breach.** Attackers used valid customer credentials harvested by infostealer malware from non-Snowflake systems, some dating to 2020, against tenants with no MFA, no credential rotation, and no network allow-listing. UNC5537 (Mandiant); Connor Moucka and John Binns charged (DOJ, Nov 2024).

**Damage**: ~165 customer tenants. **AT&T**: records of "nearly all" mobile and MVNO customers — approximately **109M customer accounts** (Form 8-K) — call/text metadata, not content or SSNs; a ransom reported at ~$370,000 was paid for deletion; AT&T later agreed to a **$177M** class-action settlement. **Ticketmaster**: attacker claimed 560M customers — **never confirmed by Live Nation; treat the 560M figure as an attacker claim only.**

**Maps to**: SG-01, SG-16, SG-18 | T-01

**Tide changes**: Removes the static-shared-secret model for tenant access. The deeper lesson is architectural: a platform whose security depends on **every customer voluntarily configuring a control correctly** will have a long tail of customers who did not.

**Tide does NOT change**: Infostealer malware on customer endpoints. Note the shared-responsibility trap — Snowflake was not breached and was widely blamed anyway. That reputational mechanic applies to any platform vendor.

**Sources**: [Mandiant UNC5537 report](https://cloud.google.com/blog/topics/threat-intelligence/unc5537-snowflake-data-theft-extortion) · [AT&T Form 8-K](https://investors.att.com/~/media/Files/A/ATT-IR-V2/financial-reports/sec-filings/2024/8k-2024-07-12.pdf) · [Snowflake statement](https://www.snowflake.com/en/blog/detecting-unauthorized-user-activity/)

**Confidence**: HIGH on AT&T and mechanism; **LOW on the 560M Ticketmaster figure**

---

## BP-CRED-14 — National Public Data (2024)

**Single point of failure**: One aggregation database at a broker that had merged records on hundreds of millions of people **who were never its customers**. The victims had no relationship with NPD, no notice, and no ability to rotate anything — **an SSN cannot be reset**. A sister site was separately found publishing a plaintext archive of its own admin credentials in an open web directory.

**What happened**: Unauthorized access to the broker's aggregated records store beginning around December 2023. Actor "USDoD" listed the data in April 2024.

**Damage**: The seller advertised **2.9 billion records** — **heavily disputed.** Troy Hunt's analysis of the actual corpus found ~134M unique email addresses with substantial duplication; 2.9B counts rows, not people. NPD's own Maine AG notification cited **1.3M individuals**; other filings gave different numbers. Jerico Pictures filed Chapter 11 in October 2024 and NPD ceased operations. **No regulatory fine was collected** — the company simply dissolved.

**Maps to**: SG-06 | T-01

**Tide changes**: Little directly. Include this record for two arguments: **irrevocable identifiers** (an SSN, a DOB, a genome cannot be rotated after exposure — which is the case for making them non-existent artifacts rather than stored ones), and **enforcement asymmetry** (the company folded and no fine was paid, so "regulatory risk" is a weak motivator compared to architectural risk).

**Tide does NOT change**: Anything about third parties who aggregate data about your users without their involvement.

**Sources**: [Troy Hunt's analysis of the actual corpus](https://www.troyhunt.com/inside-the-3-billion-people-national-public-data-breach/) · [Krebs — NPD sister site leaking its own admin passwords](https://krebsonsecurity.com/2024/08/national-public-data-published-its-own-passwords/)

**Confidence**: MEDIUM overall; **the 2.9 billion count is LOW — present it as an unverified seller claim or not at all**

---

# Category KEY — Signing keys, secrets, and tokens

## BP-KEY-01 — RSA SecurID seed theft (2011)

**Single point of failure**: **One vendor-held database mapping token serial numbers to seed values.** RSA had to hold the seeds to manufacture tokens, so one compromise at one vendor silently downgraded two-factor authentication to one-factor for tens of millions of tokens at 25,000+ customer organizations who had done nothing wrong.

**What happened**: A phishing email with a malicious Excel attachment exploiting Adobe Flash zero-day CVE-2011-0609 landed on a low-privilege workstation; the actor pivoted to the seed-record systems. Assessed as nation-state; never formally indicted.

**Damage**: Token replacement offered across ~**25,000** client organizations, covering **tens of millions** of tokens. **EMC took a $66.3M charge against Q2 2011 earnings**. Lockheed Martin suffered a follow-on intrusion in May 2011 using the stolen seed data, shut down remote access, reissued tokens and forced a password reset for **133,000** employees.

**Maps to**: SG-02, SG-18 | T-02, T-07

**Tide changes**: This is the archetype of **vendor-held shared secret custody**, and it is the clearest historical argument for never-whole-key. The security of 25,000 organizations rested on one vendor's database because the architecture required the vendor to know the secret.

**Tide does NOT change**: Phishing of employees. Note also that the *customers* did nothing wrong and had no remedy — cite this when a target says "our IdP vendor handles that."

**Sources**: [RSA open letter to customers](https://www.rsa.com/en-us/company/news/open-letter-to-rsa-customers) · [Washington Post on the $66M charge](https://www.washingtonpost.com/blogs/post-tech/post/cyber-attack-on-rsa-cost-emc-66-million/2011/07/26/gIQA1ceKbI_blog.html)

**Confidence**: HIGH on cost and response; MEDIUM on exactly which artifacts were exfiltrated (never fully detailed publicly)

---

## BP-KEY-02 — Uber (2016)

**Single point of failure**: **One long-lived AWS access key checked into source control.** Private-repo access plus one static credential equalled full read on the production data backup — no MFA, no rotation, no scoped role, no egress alarm.

**What happened**: Attackers obtained engineers' GitHub credentials via credential stuffing from prior breaches, read the private repo, extracted the AWS keys, and pulled an S3 backup of the rider/driver database. Brandon Glover and Vasile Mereacre pleaded guilty (DOJ, 2019).

**Damage**: ~**57M** rider and driver records; ~600,000 driver's licence numbers. Uber paid the attackers **$100,000** through HackerOne with NDAs, concealing the breach for over a year. **$148M** settlement with all 50 state AGs — at the time the largest multi-state data breach settlement. **£385,000** ICO fine, **€600,000** Dutch DPA fine. **CSO Joe Sullivan was criminally convicted** (Oct 2022) of obstruction of justice and misprision of a felony.

**Maps to**: SG-08, SG-18 | T-01, T-02

**Tide changes**: Removes the class of "one static credential grants full data access." Nothing removes a secret from a Git history except not having the secret.

**Tide does NOT change**: Secrets hygiene in your repos. Cite this record additionally for the **personal legal exposure of the security officer** — the Sullivan conviction is the strongest available argument that concealment is not a viable response strategy, which matters when advising on incident-response posture.

**Sources**: [DOJ on Sullivan's conviction](https://www.justice.gov/usao-ndca/pr/former-chief-security-officer-uber-convicted-federal-charges-covering-data-breach) · [DOJ on the hackers' guilty pleas](https://www.justice.gov/usao-ndca/pr/hackers-who-extorted-uber-and-linkedin-plead-guilty-computer-fraud-charges) · [FTC revised settlement](https://www.ftc.gov/news-events/news/press-releases/2018/04/uber-agrees-expanded-settlement-ftc-related-privacy-security-claims)

**Confidence**: HIGH

---

## BP-KEY-03 — SolarWinds / Golden SAML (2020) — *the token-forgery archetype*

**Single point of failure**: **One AD FS token-signing private key on one on-prem server.** Every federated cloud service downstream trusted anything that key signed. Compromising it converted the identity system into a forgery oracle — and the resulting logins were **indistinguishable from legitimate ones, because no authentication actually occurred at the IdP**. No password, no MFA, no authentication event to alert on.

**What happened**: Trojanized SolarWinds Orion updates gave initial access; the actor then stole the AD FS token-signing key and minted arbitrary SAML assertions for any user, including highly privileged ones. Some victims also had attacker-controlled domains or service-principal credentials added to Azure AD for persistence. APT29 / Cozy Bear, attributed by the US Government to Russia's SVR.

**Damage**: ~**18,000** organizations received the trojanized update; **fewer than 100** were subjected to hands-on-keyboard activity, including **9 US federal agencies** (Treasury, Commerce/NTIA, Justice, Homeland Security, Energy/NNSA, State). FireEye's red-team tooling and some Microsoft source code were taken. SolarWinds disclosed **$3.5M** of direct costs in the first months and far more thereafter; the **SEC charged SolarWinds and its CISO with fraud** in Oct 2023 (most claims dismissed July 2024). Share price fell ~25% in the week after disclosure.

**Maps to**: SG-02, SG-10, SG-14 | T-02, T-04

**Tide changes**: This is the single most direct precedent for threshold JWT signing. With no complete signing key in existence, there is no artifact to steal that yields a forgery oracle. Each ORK independently verifies claims before partial-signing, so a compromised IdP host cannot mint tokens.

**Tide does NOT change**: The supply-chain intrusion itself, or the persistence mechanisms. Note the detection lesson that Tide *does* address indirectly: forged-token logins generate no authentication event, so **log-based detection is structurally blind to key theft** — which is why the answer has to be removing the key, not watching it.

**Sources**: [CISA Alert AA21-008A](https://www.cisa.gov/news-events/cybersecurity-advisories/aa21-008a) · [CISA Alert AA20-352A](https://www.cisa.gov/news-events/cybersecurity-advisories/aa20-352a) · [SEC v. SolarWinds and Brown](https://www.sec.gov/newsroom/press-releases/2023-227) · [Mandiant on the SAML forgery](https://cloud.google.com/blog/topics/threat-intelligence/unc2452-merged-into-apt29/)

**Confidence**: HIGH on mechanism and attribution; MEDIUM on total dollar cost (not comprehensively quantified anywhere)

---

## BP-KEY-04 — Codecov (2021)

**Single point of failure**: **One GCS credential baked into a public container image**, guarding one script that thousands of CI pipelines fetched and executed with full access to their own secrets. Codecov's own key compromise became every customer's secret compromise.

**What happened**: An error in Codecov's Docker image creation left a Google Cloud Storage credential extractable from the published image. The attacker used it to modify the `bash` uploader served to every customer's CI, appending a `curl` that POSTed `$(env)` and `git remote -v` to an attacker host. Unattributed.

**Damage**: The malicious script ran undetected for **~65 days**. Codecov had ~29,000 customers; the exfiltrated subset is not public. Confirmed downstream victims include **HashiCorp — which had to rotate its GPG package-signing key** — plus Twilio, Rapid7, Confluent, Monday.com. Detected only because a customer noticed the served script's SHA-sum did not match the one published on GitHub.

**Maps to**: SG-08, SG-18 | T-02, T-04

**Tide changes**: Nothing about CI secret storage directly — but the *cascade* is the lesson. One vendor key compromised thousands of orgs' cloud keys, and one of those was another vendor's package-signing key, compromising *its* downstream. Every static secret in that chain was a complete, stealable artifact.

**Tide does NOT change**: CI/CD pipeline security. Cite this for **secret-cascade depth** — a finding about one exposed credential should always ask what that credential can read, and what secrets *those* systems hold.

**Sources**: [Codecov security update](https://about.codecov.io/security-update/) · [HashiCorp HCSEC-2021-12 GPG key rotation](https://discuss.hashicorp.com/t/hcsec-2021-12-codecov-security-event-and-hashicorp-gpg-key-exposure/23512) · [Rapid7 disclosure](https://www.rapid7.com/blog/post/2021/05/13/rapid7-discloses-limited-source-code-and-credential-exposure/)

**Confidence**: HIGH on mechanism and timeline; downstream victim count inherently incomplete

---

## BP-KEY-05 — CircleCI (2022–2023)

**Single point of failure**: **One session cookie on one laptop** — a bearer token with no binding to device, network, or user presence. **MFA had already been satisfied and was therefore irrelevant.** Secondarily: encryption keys resident in process memory on the same hosts as the ciphertext, reducing encryption-at-rest to a compliance checkbox against an attacker with code execution.

**What happened**: Infostealer malware on one engineer's laptop — undetected by antivirus — stole a valid, 2FA-backed SSO session cookie. The actor replayed it remotely, then used that engineer's legitimate ability to generate production access tokens to escalate and exfiltrate customer secrets. Unattributed.

**Damage**: CircleCI instructed **all customers to rotate all secrets** on the platform. **GitHub rotated ~5,000 project keys and OAuth tokens** on customers' behalf; Atlassian/Bitbucket similarly revoked tokens. No public dollar figure or fine. The exfiltrated subset was never quantified.

**Maps to**: SG-03, SG-06, SG-15 | T-05, T-07

**Tide changes**: **This is the clearest precedent for DPoP / proof-of-possession.** A stolen cookie replayed from an attacker's machine is exactly what token binding defeats — replay without a fresh proof fails. It is also a precedent for keys-in-memory: threshold key material is never assembled in one process, so a memory dump yields no usable key.

**Tide does NOT change**: Endpoint malware, or the engineer's legitimate privilege to mint production tokens. **Cite this whenever a target says "we have MFA."** MFA was present, satisfied, and completely bypassed — because the artifact stolen was issued *after* the MFA check.

**Sources**: [CircleCI incident report](https://circleci.com/blog/jan-4-2023-incident-report/) · [GitHub advisory on rotated tokens](https://github.blog/2023-01-10-rotating-credentials-for-github-com-and-new-ghes-patches/)

**Confidence**: HIGH on mechanism (vendor post-mortem); LOW on scale (never quantified)

---

## BP-KEY-06 — Microsoft Storm-0558 (2023) — *the strongest single-key precedent in existence*

**Single point of failure**: **One private signing key.** Not a database, not an account — a single asymmetric key, **seven years old, never rotated**, held by one party, that the relying-party code failed to scope-check. Possession of it was equivalent to being every user of Exchange Online simultaneously: no password, no MFA, and **no authentication event at the identity provider**.

**What happened**: Two compounding failures. (1) The actor obtained a 2016-vintage MSA *consumer* signing key — **Microsoft could not determine how, and the CSRB found no evidence supporting Microsoft's initial public claim that it leaked via a crash dump.** (2) A token-validation flaw in Microsoft's own libraries failed to check the key's scope, so a consumer-only key was accepted for **enterprise Azure AD** tokens. Storm-0558, assessed as PRC state-affiliated.

**Damage**: **22 enterprise organizations** and **503 related consumer accounts** compromised. Approximately **60,000 emails** downloaded from the US State Department alone across at least 10 accounts. The DHS **Cyber Safety Review Board concluded the intrusion was preventable and that Microsoft's security culture was "inadequate and requires an overhaul,"** and that Microsoft made public statements it knew or should have known were inaccurate, leaving the inaccurate blog post uncorrected until March 2024. Microsoft subsequently made advanced cloud logging free — its previous paywalling had prevented several victims from detecting the intrusion themselves. **No fine was levied.**

**Maps to**: SG-02, SG-10, SG-13 | T-02, T-05

**Tide changes**: Every element of this incident is an argument for never-whole-key. There is no single key to steal, no key whose age or rotation status matters, and per-ORK independent claim verification means a scope-check bug in one component does not authorize cross-tenant minting.

**Tide does NOT change**: Validation logic in *your* relying party. Note the honest parallel: Storm-0558's second failure was a **verification bug**, and Tide's model also depends on verifiers checking correctly — Tide distributes that check across ORKs rather than relying on one library, which is a real improvement but not an exemption.

**Sources**: [CSRB, *Review of the Summer 2023 Microsoft Exchange Online Intrusion* (PDF)](https://www.cisa.gov/sites/default/files/2025-03/CSRBReviewOfTheSummer2023MEOIntrusion508.pdf) · [MSRC on the key acquisition (later corrected)](https://msrc.microsoft.com/blog/2023/09/results-of-major-technical-investigations-for-storm-0558-key-acquisition/) · [Microsoft Threat Intelligence technical analysis](https://www.microsoft.com/en-us/security/blog/2023/07/14/analysis-of-storm-0558-techniques-for-unauthorized-email-access/)

**Confidence**: HIGH — the CSRB report is an authoritative primary investigation. **State the key-acquisition method as unknown**; the CSRB explicitly contradicts Microsoft's earlier crash-dump explanation.

---

## BP-KEY-07 — Okta support system (2023)

**Single point of failure**: **One service account credential that leaked out of the corporate boundary via browser password-manager sync to a personal Google account.** Downstream, a second single point: **HAR files — a standard support artifact — carry live bearer session tokens**, customers were routinely instructed to upload them, and there was no sanitization step.

**What happened**: An employee signed into their personal Google profile in Chrome on an Okta-managed laptop, and the support system's service account credentials were saved into that personal profile. The actor logged in and downloaded support case files including HAR files with live session tokens. Unattributed.

**Damage**: **134 Okta customers** had files accessed; the actor hijacked the live Okta sessions of **5 customers**. Cloudflare, 1Password and BeyondTrust each published their own incident reports. A later disclosure revealed the actor also downloaded a report containing names and emails of **essentially all Okta customer support users** (99.6% of records with full name and email). Okta's share price fell **~11%** on the day of disclosure and further on subsequent revisions.

**Maps to**: SG-03, SG-08, SG-18 | T-05, T-07

**Tide changes**: Session tokens bound by DPoP are not replayable from an attacker's machine, so a leaked HAR file yields a token that does not work elsewhere.

**Tide does NOT change**: Browser profile sync policy, or what your support team asks customers to upload. **Cite this for the second-order lesson**: debugging artifacts are a credential channel nobody threat-models. When reviewing an app, ask what its support process collects.

**Sources**: [Okta root cause and remediation](https://sec.okta.com/articles/2023/11/unauthorized-access-oktas-support-case-management-system-root-cause/) · [Krebs on Security](https://krebsonsecurity.com/2023/10/hackers-stole-access-tokens-from-oktas-support-unit/)

**Confidence**: HIGH

---

## BP-KEY-08 — Cloudflare Thanksgiving incident (2023)

**Single point of failure**: **Four unrotated non-human credentials** — machine identities with no owner, no expiry, and no login event to alert on. The control that was supposed to save Cloudflare (mass credential rotation after `BP-KEY-07`) **failed on exactly the credentials nobody remembered existed**.

**What happened**: Cloudflare rotated over 5,000 credentials in response to the Okta breach but missed 1 service token and 3 service accounts, believing them unused. The actor used a Moveworks service token for remote access, a Smartsheet service account with Jira admin, and a Bitbucket service account with source-control access. Assessed by Cloudflare as a nation-state actor.

**Damage**: **No customer data or systems were accessed.** The actor viewed 36 of 2,059,357 Jira tickets, 202 wiki pages, and **120 of 11,904 source repositories** (downloading 76), focused on network architecture, security and identity management. Response: rotated **every production credential — over 5,000**, forensically triaged 4,893 systems, reimaged and rebooted every machine in the global network, and replaced all hardware in a not-yet-production data centre. No dollar figure disclosed.

**Maps to**: SG-08, SG-18 | T-05, T-07

**Tide changes**: Little directly — this is machine-identity lifecycle management.

**Tide does NOT change**: Credential inventory completeness. **This record's value is as a positive precedent and an inventory lesson.** Cloudflare did nearly everything right and still missed four credentials out of 5,000+. When reviewing an app, treat "we rotated our secrets" as an unverified claim, and specifically hunt non-human identities — they have no owner to notice their absence. Also cite it as the model for transparent self-disclosure.

**Sources**: [Cloudflare post-mortem](https://blog.cloudflare.com/thanksgiving-2023-security-incident/) · [Cloudflare's earlier Okta response](https://blog.cloudflare.com/how-cloudflare-mitigated-yet-another-okta-compromise/)

**Confidence**: HIGH — unusually granular and self-critical vendor post-mortem

---

## BP-KEY-09 — Sisense (2024)

**Single point of failure**: **One hard-coded secret in one Git repository** that unlocked the S3 bucket where a SaaS provider stored **every customer's connection credentials to their own databases**. The archetype of concentrated third-party secret custody: one string compromised an entire customer base's credentials.

**What happened**: Attackers accessed Sisense's self-hosted GitLab, found a hard-coded token granting access to Sisense's S3 buckets, and exfiltrated terabytes. Unattributed.

**Damage**: Affected customer count and dollar cost **never publicly quantified**; Sisense published no technical post-mortem. Reportedly included **millions of access tokens, email account passwords, and SSL certificates**. **CISA issued a public advisory** urging all Sisense customers to reset any credentials used to access Sisense services — an unusual step reflecting concern about critical-infrastructure customers. No fine.

**Maps to**: SG-06, SG-08, SG-18 | T-07

**Tide changes**: The failure class — a vendor holding customers' credentials to *their own* systems — is precisely what E2EE under keys the vendor cannot assemble removes.

**Tide does NOT change**: Secrets in repos. **Cite this whenever the target integrates a BI, analytics, iPaaS, or ETL tool.** Those products require credentials into your data stores by design, which makes the vendor a copy of your credential set. Ask where those credentials are stored and who can read them.

**Sources**: [CISA advisory](https://www.cisa.gov/news-events/alerts/2024/04/11/cisa-adds-known-exploited-vulnerability-catalog-and-releases-advisory-sisense-customers) · [Krebs on Security](https://krebsonsecurity.com/2024/04/why-cisa-is-warning-cisos-about-a-breach-at-sisense/)

**Confidence**: MEDIUM — CISA's advisory is primary and confirms seriousness, but the GitLab→S3 chain rests on Krebs's sourcing; Sisense never confirmed it publicly

---

## BP-KEY-10 — Dropbox Sign (2024)

**Single point of failure**: **One non-human service account belonging to a configuration automation tool**, holding standing elevated privilege into the production customer database. No human would notice it logging in, and its privilege was scoped to what automation *might* need rather than what it needed at that moment.

**What happened**: The actor compromised a backend service account in Dropbox Sign's automated configuration tooling, which carried the ability to execute applications and run automated services, and granted access to the customer database. Unattributed.

**Damage**: **All Dropbox Sign users** for the base data set (no user count published): email addresses, usernames, phone numbers, hashed passwords, account settings; for subsets, **API keys, OAuth tokens, and MFA data**. Names and emails of people who merely *received or signed* a document without ever creating an account were also exposed. Dropbox's Form 8-K stated no material impact on operations or financial condition. Response required resetting all passwords, logging out all sessions, and **rotating all API keys and OAuth tokens** — a forced-migration burden on every customer with an integration. No fine.

**Maps to**: SG-08, SG-18 | T-01, T-07

**Tide changes**: Removes the standing-privilege model — high-value operations gated by quorum cannot be performed by one compromised automation identity.

**Tide does NOT change**: Your automation's privilege scoping. **Cite this for the non-user exposure lesson**: people who never had an account were still in the breach. When scoping blast radius, count everyone whose data the system touches, not just registered users.

**Sources**: [Dropbox Form 8-K](https://www.sec.gov/Archives/edgar/data/1467623/000146762324000024/dbx-20240424.htm) · [Dropbox Sign security update](https://sign.dropbox.com/blog/a-recent-security-incident-involving-dropbox-sign)

**Confidence**: HIGH on what was taken; user count never disclosed

---

## BP-KEY-11 — Salesloft Drift (2025)

**Single point of failure**: **One vendor's store of long-lived OAuth refresh tokens.** Each was a pre-authorized, non-expiring grant into a customer's CRM requiring no password and no MFA, producing log entries indistinguishable from legitimate activity. Compromising one integration provider's token vault yielded simultaneous authenticated access to **700+ independent tenants — none of whom had been breached themselves**.

**What happened**: The actor compromised Salesloft's GitHub account (Mar–Jun 2025), then reached Drift's AWS environment where customer OAuth refresh tokens were stored. Using them, they authenticated *as the Drift integration* into hundreds of Salesforce instances and used the **Bulk API** to export objects at speed, then mined the exports for embedded secrets. UNC6395 (Google Threat Intelligence Group).

**Damage**: **More than 700 organizations**. Named confirmed victims include **Cloudflare, Zscaler, Palo Alto Networks, Proofpoint, PagerDuty, Tanium, Google Workspace accounts, Tenable, Rubrik, CyberArk, BeyondTrust, Qualys, JFrog, Dynatrace, Cato Networks**. The most damaging haul was **credentials customers' own staff had pasted into support tickets** — AWS keys, Snowflake tokens, VPN and SSO credentials. Salesforce revoked all Drift tokens and removed Drift from AppExchange; Google revoked Drift Email tokens. No dollar figure or fine published.

**Maps to**: SG-03, SG-18 | T-05, T-07

**Tide changes**: Long-lived bearer grants are the artifact. Proof-of-possession binding means a stolen refresh token is not usable from the attacker's infrastructure.

**Tide does NOT change**: Your OAuth integration inventory, or what your staff paste into support tickets. **Two lessons to cite.** First: every third-party integration is a standing pre-authorized grant into your data — enumerate them, because the org that gets breached is not the org that loses the data. Second: **secrets in support tickets and CRM free-text fields** are a real, repeatedly-exploited channel (see also `BP-KEY-07`).

**Sources**: [Mandiant GTIG report on UNC6395](https://cloud.google.com/blog/topics/threat-intelligence/data-theft-salesforce-instances-via-salesloft-drift) · [Cloudflare disclosure](https://blog.cloudflare.com/response-to-salesloft-drift-incident/) · [Salesloft trust page](https://trust.salesloft.com/)

**Confidence**: HIGH on mechanism and victim list; no financial quantification exists

---

## BP-KEY-12 — Coinbase insider (2024–2025) — *the rogue-admin precedent*

**Single point of failure**: **One customer-support console with broad read access across accounts, operated by outsourced staff.** The control model assumed the operator was honest. There was no per-record authorization boundary, no cryptographic constraint on bulk read, and nothing that made the data useless to someone legitimately granted the console.

**What happened**: **Insider abuse of legitimate access** — criminals bribed overseas support contractors to copy customer data out of internal tooling they were authorized to use. **No technical exploit and no stolen credential**; the accounts were valid and the queries were within the tools' intended function. Detected by anomalous-access monitoring, but only after months.

**Damage**: **69,461 customers** notified (Maine AG). Coinbase's Form 8-K estimated **$180 million to $400 million** in remediation and voluntary customer reimbursement. Coinbase refused the $20M extortion demand and posted a $20M reward instead. The stolen data enabled downstream social-engineering theft of customer funds.

**Maps to**: SG-07, SG-09, SG-16 | T-03, T-07

**Tide changes**: This is the **T-03 archetype**. IGA quorum means no single admin or support operator holds unilateral power; privileged reads and changes enter a change-set requiring threshold approval. The insider's console access alone does not authorize the action.

**Tide does NOT change**: A support agent's need to see *some* customer data to do their job. The honest framing is that quorum raises the cost from "bribe one contractor" to "bribe a threshold of independent approvers" — a large but not infinite improvement. **Note that no technical control was bypassed here**, which is why detection-based and credential-based defences were structurally irrelevant.

**Sources**: [Coinbase Form 8-K](https://www.sec.gov/Archives/edgar/data/1679788/000167978825000091/coin-20250511.htm) · [Coinbase blog](https://www.coinbase.com/blog/protecting-our-customers-standing-up-to-extortionists) · [Maine AG breach notification](https://apps.web.maine.gov/online/aeviewer/ME/40/f7ed1e34-ae72-4dd5-8ee8-83e9a4d4be2e.shtml)

**Confidence**: HIGH

---

## BP-KEY-13 — Bybit / Safe{Wallet} (2025) — *the largest theft on record, and a warning about quorum*

**Single point of failure**: **One developer workstation at a third-party wallet vendor**, which controlled the **front-end rendering of the transaction the signers were asked to approve**. Multisig with multiple independent human signers provided **zero** protection, because all signers were shown the same lie by the same compromised interface. The property that failed was *what you see is what you sign*.

**What happened**: A compromised Safe{Wallet} developer machine was used to inject malicious JavaScript into the S3-hosted front end on 19 Feb 2025, conditionally targeted at Bybit's contract address. When Bybit's signers executed a routine multisig transfer on 21 Feb, the UI displayed a legitimate transaction while the payload they actually signed replaced the wallet's implementation contract with attacker-controlled logic. The code was removed from S3 about two minutes after execution. **TraderTraitor**, attributed by the FBI to the DPRK.

**Damage**: Approximately **$1.5 billion USD** (FBI figure) — **the largest cryptocurrency theft on record**. Bybit remained solvent and covered the loss. Safe{Wallet} took its front end offline and rebuilt its infrastructure. No regulatory penalty for either company.

**Maps to**: SG-04, SG-09, SG-16 | T-04, T-14

**Tide changes**: SRI enforcement is the direct control — a tampered bundle is refused by the browser. Forseti policy contracts evaluate the *actual* transaction semantics inside each ORK sandbox rather than trusting a rendered UI, so a majority must approve what the transaction really does.

**Tide does NOT change**: **This is the most important honesty note in the file.** Bybit is a warning aimed at Tide's own model as much as at anyone else's. A threshold or quorum scheme protects only what the approvers can actually *see and verify independently*. If every approver reviews the transaction through the same compromised surface, N-of-M collapses to 1. When reviewing a Tide app with a quorum-gated flow, ask: **what exactly is each approver verifying, and could one compromised component lie to all of them at once?** That is the T-14 residual, and it is real. Pair with the out-of-band Authenticator App path.

**Sources**: [FBI/IC3 PSA I-022625-PSA](https://www.ic3.gov/PSA/2025/PSA250226) · [Safe{Wallet}/Sygnia forensic statement](https://safe.mirror.xyz/VR6glBqJdIjWCz6xNAe5A0mzOZRc4dHVsMSrJLbXPUw) · [SlowMist technical analysis](https://slowmist.medium.com/bybits-1-5-billion-theft-unveiled-safe-wallet-front-end-code-tampered-84b78f0fa9c2)

**Confidence**: HIGH

---

## BP-KEY-14 — LastPass (2022)

**Single point of failure**: **One of four humans' home computers.** The engineer's personal machine held the path to the key that decrypted the cloud backups of every customer vault. A single unpatched media-server process on a personal device defeated the entire cryptographic architecture of a password manager.

**What happened**: Two chained incidents. **Incident 1** (Aug 2022): a developer's corporate laptop was compromised, yielding source code and technical documentation. **Incident 2** (Aug–Oct 2022): using that intelligence, the actor targeted **one of only four DevOps engineers holding decryption keys for cloud backup storage**, exploited an unpatched Plex vulnerability on that engineer's **home computer** to install a keylogger, captured the master password after MFA, and reached the corporate vault — and from there the DevOps secrets that decrypted the S3 backups. Unattributed.

**Damage**: Vault backups for an estimated **25–30M users** (widely reported; LastPass has not published a figure). Taken: all customer vault data (unencrypted URLs plus AES-256-encrypted usernames, passwords, notes), the customer database, **MFA seeds**, and MFA/Federation database backups including the K2 key split. Encrypted vaults remain **offline-crackable at whatever iteration count each account happened to have** — older accounts were still on 1 or 5,000 PBKDF2 iterations rather than 100,100. Researchers have linked stolen vaults to **$250M+** in cryptocurrency theft; 2025 DOJ forfeiture complaints explicitly cite LastPass-derived seed phrases. **No regulatory fine.**

**Maps to**: SG-01, SG-06, SG-17 | T-01, T-07

**Tide changes**: This is the reference case for SG-17 (user-held secrets stored server-readable) and for **why "encrypted at rest" is not a security property on its own**. If one party can assemble the decryption capability, the ciphertext is a time-delayed plaintext. Threshold key material has no such assembly point.

**Tide does NOT change**: Endpoint security on employees' personal devices. **Two lessons to cite.** First: the attacker did not break the crypto — they went around it to the four people who held the keys, so *count the humans who can assemble the key* and treat that number as your real threshold. Second: **exfiltrated ciphertext is permanent** — the 2022 backups are still being cracked years later as hardware improves, so a confidentiality breach has no expiry date and "we rotated credentials" does not undo it.

**Sources**: [LastPass incident update, 1 March 2023](https://blog.lastpass.com/posts/security-incident-update-recommended-actions) · [LastPass "what data was accessed"](https://support.lastpass.com/s/document-item?bundleId=lastpass&topicId=LastPass/incident-2-additional-details-of-the-attack.html) · [DOJ forfeiture complaint citing LastPass-derived seed phrases](https://www.justice.gov/usao-dc/pr/us-files-civil-forfeiture-complaint-against-over-24-million-cryptocurrency)

**Confidence**: HIGH on intrusion mechanics; MEDIUM on the 25–30M count and the crypto-loss attribution

---

# Category CHAIN — Supply chain (code, dependency, build pipeline, vendor)

## BP-CHAIN-01 — SolarWinds build system (2020)

**Single point of failure**: **The Orion build server.** SolarWinds' own 8-K states the backdoor "was introduced as a result of a compromise of the Orion software build system and was **not present in the source code repository**." Owning one build machine turned every downstream signature check into a rubber stamp — code signing validated provenance, not integrity of intent.

**Damage**: "Fewer than 18,000" customers may have installed a vulnerable build (8-K); ~33,000 active-maintenance customers notified. Per the White House (Feb 2021), **9 federal agencies and ~100 private companies** were actually compromised beyond the initial implant. **CISA Emergency Directive 21-01** ordered all federal civilian agencies to disconnect or power down Orion immediately.

**Maps to**: SG-11 | T-04 — see `BP-KEY-03` for the Golden SAML second stage, which is the same incident's identity-layer consequence.

**Tide changes**: Nothing about the build compromise. What it changes is the second stage: with no complete signing key, the AD FS token forgery that turned 18,000 installs into 100 real compromises has no artifact to steal.

**Tide does NOT change**: Your build pipeline. **Note the 18,000-vs-100 gap** — mass distribution was a funnel to reach a handful of targets. Do not conflate exposure count with compromise count in any report.

**Sources**: [SolarWinds Form 8-K](https://www.sec.gov/Archives/edgar/data/1739942/000162828020017451/swi-20201214.htm) · [CISA ED 21-01](https://www.cisa.gov/news-events/directives/ed-21-01-mitigate-solarwinds-orion-code-compromise-closed) · [White House briefing, 17 Feb 2021](https://bidenwhitehouse.archives.gov/briefing-room/press-briefings/2021/02/17/press-briefing-by-press-secretary-jen-psaki-and-deputy-national-security-advisor-for-cyber-and-emerging-technology-anne-neuberger-february-17-2021/)

**Confidence**: HIGH

---

## BP-CHAIN-02 — XZ Utils / liblzma backdoor (2024)

**Single point of failure**: **One upstream maintainer account, obtained through social pressure on a burned-out solo maintainer** over ~2 years. No downstream signature checking helped — the malicious release was signed by the legitimate release key of the legitimate maintainer. Secondary SPOF: the release tarball differed from the git tree, and nobody diffed them.

**Damage**: CVSS **10.0**. Ed448-keyed pre-auth RCE as root on affected sshd — effectively a private global SSH master key. **Caught before reaching any major stable distribution**; no reported exploitation. Discovered accidentally by a Microsoft engineer investigating ~500ms of unexplained sshd latency during a Postgres benchmark. **Do not cite a dollar figure — the damage is near-zero and the near-miss is the story.**

**Maps to**: SG-11 | T-04

**Tide changes**: Nothing. Include this record for one argument only: **trust in a dependency is trust in a person's life circumstances**, and no cryptographic control in your stack addresses maintainer burnout.

**Tide does NOT change**: Anything about this class. Cite it honestly as a limit of what architecture can fix.

**Sources**: [CISA alert](https://www.cisa.gov/news-events/alerts/2024/03/29/reported-supply-chain-compromise-affecting-xz-utils-data-compression-library-cve-2024-3094) · [Red Hat CVE-2024-3094](https://access.redhat.com/security/cve/CVE-2024-3094) · [Datadog technical analysis](https://securitylabs.datadoghq.com/articles/xz-backdoor-cve-2024-3094/)

**Confidence**: HIGH on technical facts; LOW on attribution — the persona is documented, the actor is not

---

## BP-CHAIN-03 — Kaseya VSA (2021)

**Single point of failure**: **The MSP's VSA server — one management console that legitimately holds SYSTEM-level push-execute rights on every client endpoint it manages.** Compromising ~60 consoles delivered ransomware to up to 1,500 downstream businesses. The tool built to administer everything is the tool that destroys everything.

**Damage**: Kaseya: **fewer than 60 direct customers**, **not more than 1,500 downstream businesses**. REvil demanded **$70M** for a universal decryptor; Kaseya obtained a decryption key on 21 July and states it did not pay. Coop Sweden closed ~800 stores for several days. No verified aggregate loss figure exists.

**Maps to**: SG-07, SG-18 | T-03, T-04

**Tide changes**: Quorum gating on high-impact administrative operations is the direct control — a single compromised console cannot push to every endpoint unilaterally.

**Tide does NOT change**: The RMM architecture itself. **Cite this whenever the target app has an admin action with fan-out** — anything one operator can trigger against all tenants at once. That fan-out is the finding, independent of how the operator authenticated.

**Sources**: [ODNI/NCSC case study (PDF)](https://www.dni.gov/files/NCSC/documents/SafeguardingOurFuture/Kaseya%20VSA%20Supply%20Chain%20Ransomware%20Attack.pdf) · [CISA-FBI guidance](https://www.cisa.gov/news-events/alerts/2021/07/04/cisa-fbi-guidance-msps-and-their-customers-affected-kaseya-vsa)

**Confidence**: HIGH on victim counts and ransom demand; MEDIUM on downstream operational losses

---

## BP-CHAIN-04 — 3CX (2023) — *the first documented cascading supply chain*

**Single point of failure**: **One employee's personal computer running a second vendor's already-backdoored installer**, which bridged into 3CX's build environments. Supply chain A (a deprecated X_TRADER build from Trading Technologies) was the delivery mechanism for supply chain B (3CX DesktopApp). Trust boundaries were transitive and nobody was modelling them that way.

**Damage**: 3CX claims ~600,000 customer orgs — that is an **exposure ceiling and a vendor marketing figure**, not an infection count. No authoritative count of successfully second-staged victims exists; Kaspersky reported GOPURAM delivery to a small number of cryptocurrency targets. UNC4736, assessed by Mandiant as North Korea-nexus.

**Maps to**: SG-11 | T-04

**Tide changes**: For browser-delivered code, SRI enforcement breaks the tampered-bundle path. Desktop installers are outside that control.

**Tide does NOT change**: Your vendors' vendors. **The transitive lesson is the whole value of this record**: when scoping a review, ask what software the *target's own developers* run, not just what the target ships.

**Sources**: [3CX security update — Mandiant findings](https://www.3cx.com/blog/news/mandiant-security-update2/) · [MITRE ATT&CK C0057](https://attack.mitre.org/campaigns/C0057/) · [ReversingLabs](https://www.reversinglabs.com/blog/the-3cx-supply-chain-hack-just-got-crazier-heres-what-you-need-to-know)

**Confidence**: HIGH on the attack chain; LOW on impact magnitude — no verified victim count exists

---

## BP-CHAIN-05 — MOVEit Transfer (2023)

**Single point of failure**: **One internet-facing file-transfer appliance sitting at an aggregation point.** The multiplier was not the CVE — it was that MOVEit is used by payroll processors and data-services vendors each holding records for hundreds of client organizations. Breaching one aggregator was hundreds of downstream employers, and the concentration of data at the transfer tier defeated every downstream org's own controls.

**Damage**: Emsisoft tracking (28 Jun 2024): **2,773 organizations and 95,788,491 individuals** — up from 2,095 orgs / 62.1M individuals in Sept 2023. **Always cite the dated figure.** Emsisoft's ~$15.8B cost estimate is a **derived extrapolation** (individuals × IBM's $165/record average), not an observed cost — flag it as such or omit it. Individual counts may double-count people breached via multiple affected orgs.

**Maps to**: SG-05, SG-06 | T-01, T-04

**Tide changes**: E2EE'd payloads under keys the transfer tier cannot assemble mean an appliance breach yields ciphertext, not records. This is the strongest available argument for encrypting data *before* it reaches a transfer or processing intermediary.

**Tide does NOT change**: The pre-auth SQLi, or your vendors' patch cadence. **Cite this for aggregation-point risk**: when reviewing an app, find every third party that holds a copy of the data and count them as breach surface.

**Sources**: [Progress advisory](https://community.progress.com/s/article/MOVEit-Transfer-Critical-Vulnerability-31May2023) · [CISA AA23-158A](https://www.cisa.gov/news-events/cybersecurity-advisories/aa23-158a) · [Emsisoft statistics](https://www.emsisoft.com/en/blog/44123/unpacking-the-moveit-breach-statistics-and-analysis/)

**Confidence**: HIGH on org/individual counts; LOW on the $15.8B figure

---

## BP-CHAIN-06 — British Airways / Magecart (2018) — *the best-documented client-side injection*

**Single point of failure**: **One third-party supplier's remote-access account, unprotected by MFA.** The ICO is explicit that MFA on remote access would have stopped this. The second, equally blunt SPOF: **a domain administrator password sitting in a plaintext file** — one file read converted a supplier login into full domain control.

**Damage**: **£20,000,000 ICO penalty** (reduced from a £183.39M notice of intent; the ICO stated £30M would have been appropriate before COVID-19 mitigation). **429,612 data subjects**: card number + CVV + name/address for 244,000; card number and CVV only for 77,000; card number only for 108,000. **77,000 customers had card number and CVV compromised with no tokenisation.** Undetected for **103 days**; BA was notified by a third party, not by its own monitoring.

**Maps to**: SG-08, SG-18 | T-04, T-14

**Tide changes**: Client-side script injection into a payment page is precisely the T-04 attack class SRI addresses — a browser refuses a bundle whose hash does not match.

**Tide does NOT change**: Supplier VPN MFA, or plaintext admin passwords on file shares. **This is the single best-sourced record in the library** — every figure comes from a regulator's published penalty notice, so it is the safest one to cite when a report needs an unimpeachable number.

**Sources**: [ICO Monetary Penalty Notice (PDF, full text)](https://ico.org.uk/media2/migrated/2618421/ba-penalty-20201016.pdf) · [ICO press release](https://ico.org.uk/about-the-ico/media-centre/news-and-blogs/2020/10/ico-fines-british-airways-20m-for-data-breach-affecting-more-than-400-000-customers/)

**Confidence**: HIGH — every figure is from the regulator's own notice

---

## BP-CHAIN-07 — Ticketmaster / Inbenta (2018)

**Single point of failure**: **One `<script src=>` tag pointing at a third party, placed on the payment page.** Inbenta stated it never intended the chatbot script for payment pages and "would have advised against it." The vendor's chatbot had no business reason to run in the card-capture origin — but a script tag confers full DOM access regardless of purpose. No SRI, no CSP, no isolation.

**Damage**: **£1,250,000 ICO penalty**. **9.4M customers** in Europe affected, ~1.5M in the UK. **60,000 Barclays cards** subjected to known fraud; **6,000 cards** replaced by Monzo. Detected only after banks correlated fraud with Ticketmaster purchases — ~4 months of undetected skimming, and Monzo reportedly warned Ticketmaster in April 2018 and was rebuffed.

**Maps to**: SG-04, SG-11 | T-04, T-14

**Tide changes**: SRI plus a CSP is the direct control. This record is the clearest illustration of why SRI is load-bearing rather than a nice-to-have.

**Tide does NOT change**: Your decision to embed third-party scripts. **When reviewing an app, enumerate every external script on any page that handles credentials or payment, and check for `integrity` + `crossorigin`.** A missing SRI attribute on a payment page is a finding with a £1.25M precedent attached.

**Sources**: [ICO Monetary Penalty Notice (PDF)](https://ico.org.uk/media/action-weve-taken/mpns/2618609/ticketmaster-uk-limited-mpn.pdf) · [ICO press release](https://ico.org.uk/about-the-ico/media-centre/news-and-blogs/2020/11/ticketmaster-uk-limited-fined-1-25m-for-failing-to-keep-customers-personal-data-secure/)

**Confidence**: HIGH

---

## BP-CHAIN-08 — Okta / Sitel (2022)

**Single point of failure**: **One outsourced help-desk contractor's workstation session into a support console that could reach customer tenants.** Okta's tenants were only as isolated as the least-secured contractor laptop with support access.

**Damage**: LAPSUS$ had interactive control of one support workstation for **25 consecutive minutes**. Initially disclosed maximum potential impact: **366 customers** (~2.5% of the base); final investigated impact: **2 active customer tenants**. Okta terminated its relationship with Sitel/Sykes. No fine. **The 366→2 gap is itself the instructive artifact** — an org that cannot scope a support-tool breach must assume the maximum, and Okta took two months to narrow it.

**Maps to**: SG-07, SG-18 | T-03, T-07

**Tide changes**: Quorum on tenant-affecting operations means a support session cannot unilaterally change customer state.

**Tide does NOT change**: Contractor endpoint security. Note the disclosure-timing lesson: Okta received the forensic alert in January and customers learned of it in March when LAPSUS$ published screenshots.

**Sources**: [Okta — investigation concluded](https://www.okta.com/blog/company-and-culture/okta-concludes-its-investigation-into-the-january-2022-compromise/) · [Okta — investigation of the January 2022 compromise](https://www.okta.com/blog/company-and-culture/oktas-investigation-of-the-january-2022-compromise/)

**Confidence**: HIGH on vendor-stated facts; MEDIUM on the "2 tenants" conclusion — a single-party self-investigation

---

## BP-CHAIN-09 — CCleaner (2017) and BP-CHAIN-10 — ASUS ShadowHammer (2019)

Two records with the same shape, cited together because the pairing is the argument.

**Single point of failure (both)**: **The vendor's build and code-signing pipeline.** In both cases the signature was genuine and the software was malicious. Every endpoint control — signature validation, vendor allow-listing, update-source pinning — validated *correctly* and let the malware through.

**Damage — CCleaner**: **2.27 million** users installed the backdoored 5.33.6162 build; second-stage payload confirmed delivered to only **~40** specifically targeted machines at technology and telecom companies. **Damage — ASUS**: **57,000+** confirmed installs among Kaspersky users (Kaspersky's "over 1 million worldwide" is an **extrapolation**); **~600 hardcoded MAC addresses** were the actual targets. ASUS reportedly continued serving the signed malicious binary from at least one server after notification.

**Maps to**: SG-11 | T-04

**Tide changes / does NOT change**: Neither is Tide-addressable — these are desktop software distribution. Their value is the **targeting-economics lesson**: 2.27M and 57,000 infections respectively, to reach ~40 and ~600 machines. When a report estimates blast radius, distinguish *reached* from *targeted*; mass compromise is often a funnel, and the org that matters may be a rounding error in the infection count.

**Sources**: [Cisco Talos on CCleaner](https://blog.talosintelligence.com/avast-distributes-malware/) · [Avast/Piriform statement](https://blog.avast.com/progress-on-ccleaner-investigation) · [Kaspersky Securelist — Operation ShadowHammer](https://securelist.com/operation-shadowhammer/89992/) · [CERT-EU 2019-007](https://cert.europa.eu/publications/security-advisories/2019-007/)

**Confidence**: HIGH on the 2.27M / ~40 / 57,000 / ~600 figures; LOW on the "1 million" extrapolation

---

## BP-CHAIN-11 — event-stream npm (2018)

**Single point of failure**: **A maintainer handover — one npm publish token given away in an email exchange**, with no identity verification and no second signer on releases. There was no attack on infrastructure at all. The attacker asked, and social convention granted the keys to a package with ~2 million weekly downloads.

**Damage**: Malicious code shipped in Copay wallet releases 5.0.2–5.1.0, targeting private keys of accounts holding **>100 BTC or 1,000 BCH** — a deliberately narrow filter designed to stay quiet. **No confirmed theft of funds was ever published; do not claim a loss figure.** Live for roughly two months; found by a developer investigating a deprecated crypto API, not by tooling.

**Maps to**: SG-11, SG-18 | T-04

**Tide changes**: Nothing about npm governance.

**Tide does NOT change**: Dependency provenance. Cite this for **the narrow-filter lesson**: payloads increasingly self-select high-value victims, so "we saw no malicious activity" often means "we were not the target," not "we were not compromised."

**Sources**: [npm incident write-up](https://blog.npmjs.org/post/180565383195/details-about-the-event-stream-incident) · [dominictarr/event-stream#116 — the maintainer's own account](https://github.com/dominictarr/event-stream/issues/116)

**Confidence**: HIGH on mechanism; HIGH confidence that **no** loss figure is established

---

## BP-CHAIN-12 — ua-parser-js (2021) and BP-CHAIN-14 — npm chalk/debug (2025)

Paired: the same failure — **one maintainer's npm account credential** — four years apart, with the second showing exactly which second factor fails.

**ua-parser-js**: maintainer publish credentials compromised; malicious versions dropped a cryptominer and credential stealer via `preinstall`. ~**8 million weekly downloads**; live ~**4 hours**. **CISA advised that any machine that installed an affected version be considered fully compromised** and all its secrets rotated. Infection count never published.

**chalk/debug (Sept 2025)**: the maintainer was phished by a 2FA-reset email from lookalike domain `npmjs.help`, which harvested username, password **and a live TOTP code**. **18 packages, ~2 billion combined weekly downloads** — the largest npm compromise by download volume. Live ~2.5 hours. **Actual theft: approximately $600 total** across all the attacker's wallets (Socket on-chain analysis). Maximum theoretical blast radius, negligible realised loss.

**Single point of failure**: One maintainer account — and specifically, **TOTP as the second factor**, which is phishable by real-time relay. A phishing-resistant, origin-bound factor (WebAuthn/passkey) would have made the harvested code useless. See `BP-SESS-01` for the same lesson proved by controlled comparison.

**Maps to**: SG-15, SG-18 | T-04, T-14

**Tide changes**: Nothing about npm. Cite for the **TOTP-is-not-phishing-resistant** argument, which bears directly on any Tide deployment choosing a second factor.

**Tide does NOT change**: Your dependency tree. **Never present a download figure as a loss figure** — the $600 realised loss against 2 billion weekly downloads is the point of this record.

**Sources**: [CISA on ua-parser-js](https://www.cisa.gov/news-events/alerts/2021/10/22/malware-discovered-popular-npm-package-ua-parser-js) · [GHSA-pjwm-rvh2-c87w](https://github.com/advisories/GHSA-pjwm-rvh2-c87w) · [Aikido — chalk/debug analysis](https://www.aikido.dev/blog/npm-debug-and-chalk-packages-compromised) · [Security Alliance — on-chain realised theft](https://www.securityalliance.org/news/2025-09-npm-supply-chain)

**Confidence**: HIGH on mechanism; LOW on ua-parser-js infection count; MEDIUM on the ~$600 figure

---

## BP-CHAIN-13 — polyfill.io (2024)

**Single point of failure**: **A domain name.** Every site that hardcoded `<script src="https://cdn.polyfill.io/...">` delegated arbitrary, permanent, unrevoked code-execution rights in its own origin to whoever controlled that domain in perpetuity. No hacking was required — the new owner (Funnull) simply served malicious JavaScript from the same URL. The original author publicly stated no site had ever needed it.

**Damage**: **100,000+ sites** embedding the script (Sansec), reportedly including JSTOR, Intuit and the World Economic Forum. Payloads were generated per HTTP header and suppressed when admin users or analysis tooling was detected. Google began blocking Google Ads for affected e-commerce sites; Cloudflare auto-rewrote references to its own mirror; Namecheap suspended the domain. **The 100,000+ figure is exposure, not confirmed harm** — victim-side loss was never quantified.

**Maps to**: SG-04, SG-11 | T-04, T-14

**Tide changes**: SRI. A hash-pinned script cannot be silently replaced by a new domain owner.

**Tide does NOT change**: Your decision to load code from a domain you do not control. **This is the cleanest argument for SRI in the library** because there was no compromise at all — the trust was attached to a DNS name, and the DNS name was for sale.

**Sources**: [Sansec original disclosure](https://sansec.io/research/polyfill-supply-chain-attack) · [Cloudflare automatic replacement](https://blog.cloudflare.com/automatically-replacing-polyfill-io-links-with-cloudflares-mirror-for-a-safer-internet)

**Confidence**: HIGH on mechanism and site count; LOW on harm magnitude

---

## BP-CHAIN-15 — Shai-Hulud npm worm (2025)

**Single point of failure**: **The npm publish token on a developer machine or in CI.** One long-lived, broadly scoped credential is simultaneously the loot and the propagation vector — the payload scanned for secrets, then used the stolen npm token to automatically publish infected versions of every other package that maintainer owned. Self-propagating supply-chain malware. It exfiltrated by **flipping private GitHub repositories to public**, so the exfiltration channel was the victim's own account.

**Damage**: First wave (Sept 2025): **500+ npm packages**; CISA issued a public alert. Second wave (Nov 2025): reporting cites **25,000+ malicious repositories across ~350 GitHub users**. **Counts varied between vendor trackers and shifted daily — cite a count with its source and date, never bare.** No published dollar cost.

**Maps to**: SG-08, SG-18 | T-04

**Tide changes**: Nothing about npm token custody.

**Tide does NOT change**: CI credential scope. Cite for **credential-as-propagation-vector**: when a review finds a broadly scoped long-lived token, the question is not only what it reads but what it can *publish*.

**Sources**: [CISA alert, 23 Sep 2025](https://www.cisa.gov/news-events/alerts/2025/09/23/widespread-supply-chain-compromise-impacting-npm-ecosystem) · [Unit 42 analysis](https://unit42.paloaltonetworks.com/npm-supply-chain-attack/) · [Datadog — Shai-Hulud 2.0](https://securitylabs.datadoghq.com/articles/shai-hulud-2.0-npm-worm/)

**Confidence**: HIGH on mechanism; MEDIUM on counts — vendor trackers disagree

---

## BP-CHAIN-16 — Log4Shell (2021)

**Single point of failure**: **One logging library buried in the transitive dependency tree of tens of thousands of packages — where most operators could not enumerate whether they used it.** Nothing was tampered with; organizations simply could not answer "do I ship Log4j, and where?" The CSRB found even sophisticated orgs spent weeks on that question alone.

**Damage**: CVSS **10.0**. Google's Open Source Insights found **over 17,000 Maven Central packages** affected (~4% of the ecosystem) at disclosure, versus the typical <2% for a CVE. The DHS **Cyber Safety Review Board** concluded Log4j is an **"endemic vulnerability"** expected to persist in unpatched systems **for a decade or longer**. Notably, the CSRB found **no confirmed significant Log4j-based attack on US critical infrastructure** at the time of writing — which contradicts widespread claims of catastrophe. **No defensible dollar figure exists; several circulating estimates trace to vendor marketing.**

**Maps to**: SG-11 | T-04

**Tide changes**: Nothing.

**Tide does NOT change**: Anything here. **Include this record specifically to keep reports honest.** It is the standard example of a catastrophe whose measured impact was far smaller than its narrative, and the CSRB's "no confirmed significant attack" finding is the sentence to quote when pushing back on inflated risk claims — including inflated claims made in Tide's favour.

**Sources**: [CSRB Log4j report (PDF)](https://www.cisa.gov/sites/default/files/publications/CSRB-Report-on-Log4-July-11-2022_508.pdf) · [Google Security Blog — affected Maven packages](https://security.googleblog.com/2021/12/understanding-impact-of-apache-log4j.html) · [NVD CVE-2021-44228](https://nvd.nist.gov/vuln/detail/CVE-2021-44228)

**Confidence**: HIGH on technical facts and CSRB findings; no defensible cost figure

---

# Category ADMIN — Privileged admin abuse, insider threat, help-desk compromise

## BP-ADMIN-01 — Twitter internal admin tool (2020) — *the T-03 archetype*

**Single point of failure**: **One internal support tool that could take over any account, reachable by a broad population of employees and contractors with only phishable credentials.** No approval workflow, no second-person authorization, no per-action escalation. Owning any one of hundreds of ordinary employees was equivalent to owning the President's account.

**Damage**: Control of **130 accounts**; tweeted from **45**; accessed DMs of **36**; downloaded the full data archive for **7**. Victims included Obama, Biden, Musk, Gates, Bezos, Apple, Uber. Direct fraud: **~$118,000** in Bitcoin from 400+ transfers; NYDFS coordination blocked **over $1 million** more. **NYDFS found Twitter, with ~330 million monthly users, had no Chief Information Security Officer at the time.** Graham Ivan Clark (17) pleaded guilty to a three-year juvenile sentence.

**Maps to**: SG-07, SG-09, SG-16 | T-03

**Tide changes**: IGA quorum is the direct answer — account-affecting administrative operations enter a change-set requiring threshold approval, so no single support console session can seize an account.

**Tide does NOT change**: Employee phishing. **The $118,000 is the least important number in this record.** NYDFS says so explicitly: the same tool could have moved markets or triggered a geopolitical incident. When rating a unilateral-admin-power finding, rate the *capability*, not the observed exploitation.

**Sources**: [NYDFS Report on the Twitter Hack](https://www.dfs.ny.gov/Twitter_Report) · [NYDFS press release](https://www.dfs.ny.gov/reports_and_publications/press_releases/pr202010141) · [DOJ N.D. Cal. charges](https://www.justice.gov/usao-ndca/pr/three-individuals-charged-alleged-roles-twitter-hack)

**Confidence**: HIGH

---

## BP-ADMIN-02 — Uber MFA fatigue → PAM (2022)

**Single point of failure**: **A plaintext admin credential for the PAM system, sitting in a PowerShell script on an internal file share.** The vault that exists to eliminate standing credentials was itself protected by a standing credential in a text file — one `grep` converted a contractor foothold into administrator over every secret the organization held. Secondary SPOF: **push-approval MFA, defeated by human fatigue** plus a WhatsApp message impersonating Uber IT.

**Damage**: Admin access to G-Suite, Slack, AWS, OneLogin, VMware vSphere, SentinelOne, and **Uber's HackerOne bug-bounty dashboard — meaning the attacker could read Uber's unfixed vulnerabilities.** Uber states the attacker did **not** access production systems, user accounts, or sensitive user data, and made no codebase changes. **No published dollar cost and no fine for this incident** — do not conflate with the separate 2016 breach (`BP-KEY-02`) and its $148M settlement.

**Maps to**: SG-08, SG-07 | T-03, T-05

**Tide changes**: Quorum on privileged operations means possession of a PAM admin credential is not sufficient to act.

**Tide does NOT change**: Secrets on file shares. **Two things to carry into a review**: push-approval MFA without number matching is a weak factor, and *the secrets store's own admin credential* is the highest-value target in most environments — always ask how it is protected.

**Sources**: [Uber Newsroom security update](https://www.uber.com/newsroom/security-update/) · [KPMG analysis (PDF)](https://assets.kpmg.com/content/dam/kpmgsites/in/pdf/2022/09/27-september-2022-lessons-to-learn-from-the-uber-security-breach.pdf.coredownload.inline.pdf)

**Confidence**: HIGH on Uber's stated facts; MEDIUM on the Thycotic/PowerShell detail — extensively reported and matching attacker screenshots, but not named in Uber's statement

---

## BP-ADMIN-03 — MGM Resorts (2023) and BP-ADMIN-04 — Caesars (2023)

Same attacker, same week, same sector, two different doors — cited as a pair because the contrast is the argument.

**Single point of failure — MGM**: **One help-desk agent's authority to reset a password and re-enrol MFA on the basis of a phone call and publicly available identity details.** Every technical control MGM bought — Okta, MFA, EDR — sat behind a human whose job was to bypass them on request. Identity proofing was name + DOB + employee ID, all obtainable from LinkedIn. **Single point of failure — Caesars**: **an outsourced IT support vendor with standing access**; Caesars' security posture at that boundary was contractually, not technically, enforced.

**Damage — MGM** (all from its 8-K): **~$100 million** negative impact to Adjusted Property EBITDAR for September 2023; **under $10 million** in one-time Q3 expenses; Las Vegas Strip occupancy fell to **88%** from 93% year-on-year. Customer data pre-March-2019 exposed including driver's licence numbers, and SSN/passport numbers for a limited number. ~10 days of disruption to room keys, slot machines and reservations. A **$45M** class-action settlement followed in 2025. **Damage — Caesars**: loyalty database with driver's licence and/or SSN for "a significant number of members"; **customer-facing operations were not disrupted at all**. Caesars stated it "has taken steps to ensure that the stolen data is deleted... although we cannot guarantee this result" — the standard phrasing for having paid. Widely reported as ~**$15 million**, **never confirmed by Caesars — treat as unconfirmed.**

**Maps to**: SG-07, SG-16 | T-03, T-11

**Tide changes**: This pair is the strongest commercial argument for quorum-gated recovery. Tide's account-recovery model requires threshold authorization rather than a single operator's judgment, which is exactly the control both companies lacked. It bears directly on **T-11**.

**Tide does NOT change**: Ransomware encryption or the operational outage. **The pay-and-stay-up versus refuse-and-lose-$100M contrast is the most quoted fact in this record — resist using it.** It is an argument about ransom economics, not about architecture, and citing it approvingly edges toward advising payment.

**Sources**: [MGM Form 8-K, 5 Oct 2023](https://www.sec.gov/Archives/edgar/data/789570/000119312523251667/d461062d8k.htm) · [Caesars Form 8-K, 14 Sep 2023](https://www.sec.gov/Archives/edgar/data/1590895/000119312523235015/d537840d8k.htm) · [CISA/FBI AA23-320A](https://www.cisa.gov/news-events/cybersecurity-advisories/aa23-320a)

**Confidence**: HIGH on the 8-K figures; MEDIUM on the ten-minute help-desk call detail; LOW on the $15M Caesars ransom

---

## BP-ADMIN-05 — Retool (2023) — *when a security upgrade created the vulnerability*

**Single point of failure**: **Google Authenticator cloud sync.** It silently converted a per-device, non-exportable second factor into **a single credential — the Google account password — that unlocked every TOTP seed the employee held.** Retool called it a "dark pattern." Downstream, the second SPOF was Retool's internal admin console, which could act on customer accounts.

**Damage**: SMS phishing plus a **deepfaked colleague's voice by phone** to obtain an additional MFA code. **27 Retool cloud customers** compromised, all crypto firms; no on-premise or self-hosted customers affected. **Fortress Trust**, one affected customer, reported approximately **$15 million** in cryptocurrency stolen downstream.

**Maps to**: SG-07, SG-15 | T-03, T-14

**Tide changes**: Quorum on customer-affecting admin operations. Also relevant to Tide's own second-factor guidance — the out-of-band Authenticator App path with key material in a secure element is specifically designed not to be cloud-syncable.

**Tide does NOT change**: Vendor product decisions you did not consent to. **This is the most important record for reviewing an app's MFA posture**, for one reason: any org that told employees "use an authenticator app instead of SMS" inherited this failure mode the moment Google shipped cloud sync in April 2023, **without being consulted**. A control's security properties can change under you. Also the first well-documented deepfake-voice step in a corporate intrusion chain.

**Sources**: [Retool post-mortem — "MFA isn't MFA"](https://retool.com/blog/mfa-isnt-mfa) · [BleepingComputer](https://www.bleepingcomputer.com/news/security/retool-blames-breach-on-google-authenticator-mfa-cloud-sync-feature/)

**Confidence**: HIGH on mechanism and the 27-customer figure; MEDIUM on the $15M Fortress Trust figure

---

## BP-ADMIN-06 — Microsoft Midnight Blizzard (2024)

**Single point of failure**: **One forgotten legacy test OAuth application holding production-grade privilege, reachable via one non-MFA legacy account.** Nobody's threat model included the test tenant, precisely because it was "non-production." Privilege had been granted years earlier and never reviewed; the account predated the MFA policy and was therefore outside it. The canonical **orphaned high-privilege service principal** — an identity with no owner, no lifecycle, and no expiry.

**Damage**: Password spray → legacy non-production test tenant → legacy OAuth app with corporate access → mailboxes of **senior leadership and staff in cybersecurity and legal functions**. Then, using **secrets found inside that exfiltrated email**, access to some Microsoft **source code repositories**. Secrets customers had shared with Microsoft over email were exposed. Microsoft observed the actor **increasing password-spray volume tenfold** in February 2024. **CISA issued Emergency Directive 24-02** requiring federal agencies to analyse exfiltrated Microsoft correspondence and treat any credentials in it as compromised — a federal emergency directive because a *vendor's* mailbox was read.

**Maps to**: SG-08, SG-18 | T-02, T-07

**Tide changes**: Standing high-privilege grants are the artifact. Quorum gating means an orphaned service principal cannot act unilaterally regardless of what it was granted years ago.

**Tide does NOT change**: Your identity inventory. **Two review actions come straight out of this**: enumerate non-production tenants and test applications with production privilege, and enumerate identities that predate your current MFA policy. Also — secrets in email are a real, repeatedly-exploited channel (see `BP-KEY-11`).

**Sources**: [MSRC — Microsoft actions following Midnight Blizzard](https://www.microsoft.com/en-us/msrc/blog/2024/01/microsoft-actions-following-attack-by-nation-state-actor-midnight-blizzard) · [Microsoft 8-K Ex-99.1](https://www.sec.gov/Archives/edgar/data/789019/000119312524062997/d808756dex991.htm) · [CISA ED 24-02](https://www.cisa.gov/news-events/directives/ed-24-02-mitigating-significant-risk-nation-state-compromise-microsoft-corporate-email-system-closed)

**Confidence**: HIGH

---

## BP-ADMIN-07 — Ubiquiti insider (2020–2021) — *the audit-log integrity precedent*

**Single point of failure**: **One engineer holding both the highest-privilege cloud administrator credentials AND the ability to modify the audit logs that would record his use of them.** Logging integrity was under the control of the person being logged. Then the same person was **assigned to the incident response team investigating his own attack**, so the investigation's scope, evidence handling and public messaging were all controlled by the attacker.

**Damage**: Nickolas Sharp, a senior Ubiquiti engineer, cloned gigabytes from AWS and hundreds of GitHub repositories, altered CloudTrail retention to destroy evidence, then sent an anonymous ransom note posing as an external attacker demanding **50 bitcoin (~$1.9M)**. Ubiquiti refused. Sharp then leaked to journalists posing as a whistleblower, falsely claiming a cover-up — **Ubiquiti's share price fell ~20% over two days, erasing more than $4 billion in market capitalisation** (per prosecutors). Sharp was sentenced to **six years** and ~**$1.59M** restitution.

**Maps to**: SG-07, SG-14 | T-03, T-07

**Tide changes**: This is the direct argument for **SG-14 (tamperable audit trail)**. Threshold-signed, quorum-sealed change records cannot be retroactively edited by the administrator whose actions they record.

**Tide does NOT change**: Personnel decisions, including who staffs an incident response team. **The reputational damage from the insider's narrative control exceeded the data-theft damage by three orders of magnitude** — $4bn versus a refused $1.9M demand. When rating an insider finding, the ability to control the *story* is part of the blast radius.

**Sources**: [DOJ SDNY sentencing](https://www.justice.gov/usao-sdny/pr/former-employee-technology-company-sentenced-six-years-prison-stealing-confidential) · [DOJ SDNY charges](https://www.justice.gov/usao-sdny/pr/network-engineer-arrested-and-charged-data-theft-and-extortion)

**Confidence**: HIGH — DOJ prosecution with guilty plea; the $4bn figure is from prosecutors' sentencing submission

---

## BP-ADMIN-08 — Tesla insider (2023) and BP-ADMIN-09 — Cash App / Block (2021)

Two low-sophistication insider records included because they are the *common* case, not the exotic one.

**Tesla**: two **former** employees exfiltrated over 100GB and gave it to *Handelsblatt*. **75,735 individuals** affected — current and former Tesla employees, including SSNs (Maine AG notification). **Tesla only learned of it when the newspaper informed them** — the detection control was a journalist's courtesy call. No fine has been levied; **do not cite a GDPR figure for this incident.**

**Cash App / Block**: a **departed** employee downloaded internal reports **after employment ended**. Block's 8-K: "this employee had regular access to these reports as part of their past job responsibilities... accessed without permission after their employment ended." **~8.2 million** customers notified. Incident 10 Dec 2021, 8-K filed 4 Apr 2022 — **nearly four months**.

**Single point of failure**: **Standing bulk-read access, and offboarding latency.** No exotic technique in either case. Cash App is the purer lesson: the control that failed was deprovisioning, and the exposure window is however long revocation takes multiplied by the bulk-export rights the role carried.

**Maps to**: SG-07, SG-14 | T-03, T-07

**Tide changes**: Quorum on bulk-export operations; cryptographic constraint rather than policy constraint on what a departing role can read.

**Tide does NOT change**: Your HR offboarding process. **Cite Cash App whenever a review finds a role with bulk-export rights** — ask specifically how quickly access is revoked and whether anything would detect a bulk read on the last day. Note both datasets are individually low-sensitivity but are high-quality **targeting lists**.

**Sources**: [Maine AG — Tesla notification](https://www.maine.gov/agviewer/content/ag/985235c7-cb95-4be2-8792-a1252b4f8318/1beb4c69-24ea-4b31-a3c2-eb9d1d3d0d92.html) · [Block Form 8-K](https://www.sec.gov/Archives/edgar/data/1512673/000119312522095215/d343042d8k.htm)

**Confidence**: HIGH on both counts (state AG filing / SEC 8-K); MEDIUM on Tesla's 100GB / 23,000-document figures — those are the newspaper's description

---

# Category AUTHZ — Application-layer authorization bypass

> **This is the category that lands against the application, not against Tide.** See `T-09`/`T-10`. Route every fix here to `tide-route-and-api-protection`. `BP-CRED-09` (Optus) is the flagship record and lives in the CRED category.

## BP-AUTHZ-01 — First American Financial (2019)

**Single point of failure**: **A sequential integer in the URL.** Incrementing it returned other customers' documents; there was no session, entitlement, or per-document ownership check behind the link.

**Damage**: SEC states **over 800 million document images dating back to 2003** were exposed (the widely-cited 885M is journalist-sourced — **use the SEC's "over 800 million"**). Title and escrow documents including SSNs, bank account numbers, mortgage and tax records. **SEC penalty: $487,616** — notably **for disclosure-controls failures, not for the vulnerability itself**. Separately, **$1,000,000** NY DFS settlement. Aggravating fact per the SEC: the company's own security team identified the flaw in a January 2019 report, but it **never reached senior management**.

**Maps to**: SG-04, SG-05 | T-09

**Tide changes**: Nothing, unless the app checks authorization server-side. Tide supplies threshold-signed JWTs an API can verify with no remote key fetch; it cannot supply the check itself.

**Tide does NOT change**: A missing ownership check. **This is the canonical IDOR precedent** — cite it whenever a review finds a resource addressed by a guessable identifier without a per-record entitlement check. The internal-report-never-escalated detail is also worth citing: a finding that stays in the security team is functionally an unfixed finding.

**Sources**: [SEC press release 2021-102](https://www.sec.gov/newsroom/press-releases/2021-102) · [NY DFS settlement](https://www.dfs.ny.gov/reports_and_publications/press_releases/pr202311281) · [Krebs on Security](https://krebsonsecurity.com/2021/06/first-american-financial-pays-farcical-500k-fine/)

**Confidence**: HIGH

---

## BP-AUTHZ-02 — USPS Informed Visibility (2018)

**Single point of failure**: **Authentication was mistaken for authorization.** Holding *any* valid usps.com account was the entire access-control model; the API never asked whether this account owned the record being requested. It also accepted unrestricted wildcard search parameters.

**Damage**: ~**60 million** usps.com users exposed, with the ability in some cases to **modify other users' account details** (email/phone). No confirmed malicious exploitation, no fine. The instructive damage is process: the researcher notified USPS **over a year before the fix** and received no response until a journalist intervened.

**Maps to**: SG-04, SG-05 | T-09

**Tide changes**: Nothing.

**Tide does NOT change**: This exact bug. **The one-sentence version — "authentication is not authorization" — is the most reusable finding statement in this whole category.** When reviewing an API, check that each endpoint verifies *whose* record is being requested, not merely that a valid token was presented. Write-access exposure (modifying others' contact details) is an account-takeover primitive, so rate it above read-only IDOR.

**Sources**: [Krebs on Security — original disclosure](https://krebsonsecurity.com/2018/11/usps-site-exposed-data-on-60-million-users/) · [TechCrunch](https://techcrunch.com/2018/11/26/the-us-postal-service-exposed-data-of-60-million-users/)

**Confidence**: MEDIUM-HIGH — rests on one researcher's disclosure; USPS confirmed remediation but published no post-mortem

---

## BP-AUTHZ-03 — Facebook "View As" access tokens (2018)

**Single point of failure**: **A bearer access token that, once minted, was accepted everywhere with no binding to the user who actually authenticated.** An interaction between the "View As" preview feature and the video uploader caused Facebook to issue a valid token *for the account being viewed as*. Possession was sufficient, and each stolen token could be pivoted to the victim's friends' tokens.

**Damage**: Facebook's initial estimate was **50 million** accounts; the Irish DPC's final decision puts it at approximately **29 million** globally, ~**3 million** in the EU/EEA. **The 50M-vs-29M discrepancy is load-bearing — cite both figures with their sources.** Irish DPC fine: **€251 million** across two inquiries for four GDPR infringements including Article 25 data-protection-by-design.

**Maps to**: SG-03, SG-04 | T-05, T-09

**Tide changes**: DPoP proof-of-possession binds a token to a per-client key, so a token minted for the wrong subject — or stolen — cannot be replayed by another party.

**Tide does NOT change**: A token-issuance logic bug in your own application. **Two lessons**: initial breach estimates are usually wrong in the *downward* direction after investigation, so never anchor a report on a first-week number; and the DPC fined under **data-protection-by-design**, meaning architecture itself was the violation — which is the most directly Tide-relevant regulatory finding in this library.

**Sources**: [Irish DPC — €251M fine](https://www.dataprotection.ie/en/news-media/press-releases/irish-data-protection-commission-fines-meta-eu251-million) · [Auth0 technical analysis](https://auth0.com/blog/facebook-access-token-data-breach-early-look/)

**Confidence**: HIGH

---

## BP-AUTHZ-04 — Peloton GraphQL (2021) and BP-AUTHZ-08 — Twitter API (2022)

Paired: in both, **a privacy setting was enforced only in the presentation layer.**

**Peloton**: marking a profile "private" changed what the client rendered; the GraphQL resolver behind it returned user ID, location, workout stats, gender, age, weight and birthday to **anyone who asked, unauthenticated**. **No exploited-record count was ever published** — Peloton's ~3 million subscribers is *not* an exposure figure, do not present it as one. Peloton was unresponsive for the full 90-day disclosure window and engaged only after press contact.

**Twitter**: an account-duplication-check endpoint accepted an email or phone number **without authentication** and returned the associated account ID, **ignoring the user's setting prohibiting discoverability by phone/email** — de-anonymising pseudonymous accounts. The compiled dataset offered for sale contained ~**5.4 million** records; **that figure originates from the threat actor's sale listing**, corroborated by journalist sampling, and was never certified by Twitter. Twitter paid the reporting researcher **$5,040**. Ireland's DPC opened an inquiry.

**Single point of failure**: **A privacy toggle honoured by the product surface and ignored by the endpoint that answered the same question.**

**Maps to**: SG-04, SG-05 | T-09

**Tide changes**: Nothing directly — but the failure class is exactly what `T-09` warns about, and the fix is server-side verification on every endpoint.

**Tide does NOT change**: Resolver-level authorization. **When reviewing an app, take every user-facing privacy or visibility control and test the API directly.** For pseudonymous or safety-critical users, de-anonymisation is a physical-safety finding, not a privacy nicety — rate accordingly.

**Sources**: [Pen Test Partners — Peloton](https://www.pentestpartners.com/security-blog/tour-de-peloton-exposed-user-data/) · [TechCrunch — Twitter 5.4M](https://techcrunch.com/2022/08/05/twitter-zero-day-vulnerability-millions/)

**Confidence**: HIGH on the Peloton vulnerability, LOW on its impact (unpublished); MEDIUM on Twitter — the count is actor-sourced

---

## BP-AUTHZ-05 — Parler (2021)

**Single point of failure**: **A monotonically increasing post ID on an unauthenticated, unthrottled endpoint.** Knowing the last ID was equivalent to holding the whole database. Uploaded media additionally retained unstripped EXIF geolocation.

**Damage**: Approximately **70 TB** archived — **the figure originates with the archivist and is reported as "70 to 80 TB"; treat as an approximation.** Included deleted posts that remained retrievable, and GPS coordinates on uploaded media. The archive was used in law-enforcement and journalistic investigation of the 6 January 2021 Capitol attack; Parler was deplatformed by AWS within days.

**Maps to**: SG-04, SG-05, SG-15 | T-09

**Tide changes**: Nothing.

**Tide does NOT change**: Rate limiting or identifier design. **Three reusable review checks come from this record**: sequential identifiers make bulk enumeration trivial, absent rate limiting turns a slow leak into a full-corpus dump, and **"deleted" content that is still retrievable by ID is a distinct finding** — check what deletion actually does. EXIF stripping on user uploads is a fourth.

**Sources**: [Vice — interview with the archivist](https://www.vice.com/en/article/the-hacker-who-archived-parler-explains-how-she-did-it-and-what-comes-next/) · [Academic analysis (PDF)](https://sbhunia.me/publications/manuscripts/split22parler.pdf)

**Confidence**: MEDIUM-HIGH on mechanism; the volume figure is self-reported and varies

---

## BP-AUTHZ-06 — Experian partner API (2021)

**Single point of failure**: **An API that trusted its intended caller instead of authenticating any caller.** The only "credential" was knowing the endpoint URL, and the one input that looked like a secret — date of birth — **was accepted as all zeros**.

**Damage**: FICO scores and risk-factor codes retrievable from name and address alone. **No verified count of affected consumers exists**, no fine, no enforcement action. **Correcting a common mischaracterisation: this was not a credit-freeze bypass — a security freeze blocked the API from returning data.** The freeze was the one control that held.

**Maps to**: SG-05, SG-18 | T-09

**Tide changes**: Nothing.

**Tide does NOT change**: Partner API authentication. **Cite this for the partner/B2B API blind spot** — endpoints built for a named integrator are routinely deployed with the integrator's identity assumed rather than verified. When reviewing, enumerate partner-facing endpoints separately from user-facing ones. Note the honest correction about the freeze; repeating the "freeze bypass" claim would be citing a myth.

**Sources**: [Krebs on Security — original disclosure](https://krebsonsecurity.com/2021/04/experian-api-exposed-credit-scores-of-most-americans/)

**Confidence**: MEDIUM — single-researcher disclosure, disputed by Experian, never adjudicated. Impact: LOW (unknown)

---

## BP-AUTHZ-07 — T-Mobile API (2022–2023)

**Single point of failure**: **One API that would answer for any account, for over 40 days, without anyone noticing the query volume.** Absent per-caller authorization scoping compounded by absent rate/anomaly detection on that endpoint.

**Damage**: ~**37 million** current postpaid and prepaid accounts. Retrieval began ~25 Nov 2022 and was not detected until 5 Jan 2023 — **roughly six weeks**. Exposed: name, billing address, email, phone, DOB, account number, plan features. T-Mobile states no payment card, SSN, government ID or password/PIN data was in the set. This is a repeat offender — see `BP-CRED-08` and the earlier **$350M** class-action settlement, which is context, not this incident's cost.

**Maps to**: SG-05 | T-09

**Tide changes**: Nothing about the missing scope check.

**Tide does NOT change**: API authorization. **Cite this specifically for detection, not prevention**: the exploitation lasted six weeks at scale on a single endpoint. When reviewing, ask what would alert if one endpoint suddenly served 37 million distinct account lookups — usually the answer is nothing.

**Sources**: [T-Mobile Form 8-K, Jan 2023](https://www.sec.gov/Archives/edgar/data/1283699/000119312523010949/d641142d8k.htm) · [Sophos](https://www.sophos.com/en-us/blog/t-mobile-admits-to-37000000-customer-records-stolen-by-bad-actor)

**Confidence**: HIGH (company SEC filing). The exact nature of the authorization flaw was never disclosed — **do not assert specifics beyond "a single API."**

---

## BP-AUTHZ-09 — Sign in with Apple (2020) — *when the IdP itself signs a lie*

**Single point of failure**: **The identity provider would sign a false claim.** Apple's token endpoint minted a validly-signed JWT asserting *any* requested email address without verifying the requester controlled it. **Every relying party's verification logic was correct** — because the assertion was genuinely signed by Apple, no downstream check could have caught it. The token *was* the account.

**Damage**: Trivially automatable full account takeover on any third-party service using Sign in with Apple — including Dropbox, Spotify, Airbnb, Giphy — **regardless of whether the victim had an Apple ID**. Apple's log review found no exploitation, so no records lost and no fine. **The only quantified figure is the $100,000 bug bounty — that is a bounty, not a loss.**

**Maps to**: SG-02, SG-10, SG-13 | T-02, T-09

**Tide changes**: The whole point of per-ORK independent claim verification is that no single component can decide to sign an arbitrary claim. Under threshold VVK signing, minting a token asserting an identity requires a threshold of independent verifiers to each accept the claim.

**Tide does NOT change**: Your dependence on whichever IdP you choose. **This is the sharpest available argument against "we federate to a big provider, so identity is handled."** Correct verification of a correctly-signed lie is still a takeover, and Tide's answer to it — distributing the *decision to sign*, not just the key — is a genuinely different property from key protection. Worth stating explicitly, since it is often collapsed into the key-theft argument.

**Sources**: [Bhavuk Jain — original disclosure](https://bhavukjain.com/blog/2020/05/30/zeroday-signin-with-apple/) · [Infosecurity Magazine](https://www.infosecurity-magazine.com/news/researcher-sign-apple/)

**Confidence**: HIGH

---

## BP-AUTHZ-10 — JWT algorithm confusion: `jsonwebtoken` CVE-2015-9235 and the `alg:none` class

**Single point of failure**: **A field inside the attacker's own token decided how that token would be checked.** `jwt.verify()` selected the verification algorithm from the attacker-supplied `alg` header rather than from the configured key type. A token claiming `HS256` would be verified with HMAC **using the application's RSA public key as the shared secret** — a value the attacker already has. The `alg:none` variant is the same failure with the signature omitted entirely.

**Damage**: Complete authentication and authorization bypass — forge any user ID, any role, any claim. **Not quantifiable as a single incident**; this is a class defect (CWE-347) affecting very high-download libraries across Node, Python and PHP, recurring for a decade. **No aggregate breach total exists — do not invent one.** It remains a standard finding in penetration tests today.

**Maps to**: SG-13, SG-02 | T-02, T-09

**Tide changes**: Tide's model fixes the *signing* side by distributing it. It does not automatically fix a broken verifier.

**Tide does NOT change**: **Read this field carefully, because it is the one most likely to be overclaimed.** Threshold-signed tokens are worthless if the relying party can be told to skip verification. The general principle — **never let the artifact being verified declare its own verification policy** — applies to Tide too: the algorithm, the signer set, and the threshold must come from the verifier's configuration, never from the token. When reviewing a Tide integration, check that JWT verification pins the expected algorithm explicitly. See `SG-13` for the detection commands.

**Sources**: [NVD CVE-2015-9235](https://nvd.nist.gov/vuln/detail/CVE-2015-9235) · [Snyk advisory](https://security.snyk.io/vuln/npm:jsonwebtoken:20150331) · [Auth0 — the original 2015 disclosure](https://auth0.com/blog/critical-vulnerabilities-in-json-web-token-libraries/)

**Confidence**: HIGH on mechanism; impact inherently unquantified

---

## BP-AUTHZ-11 — Keycloak JWT algorithm confusion, CVE-2026-11800

**Single point of failure**: **One set of legitimate, low-privilege client credentials.** In the JWT Authorization Grant flow, signature verification could be induced into algorithm confusion, so holding valid low-privilege client credentials was enough to forge assertions and **mint access tokens impersonating any federated user** — the trust boundary between "a client" and "any user" collapsed at a single signature check.

**Damage**: CVSS v3.1 **8.1 (HIGH)**, CWE-347. Affects Red Hat Build of Keycloak 26.6 up to but excluding **26.6.4**. **No breach count, no fine, no confirmed exploitation — this is a pre-exploitation advisory. Do not attach incident figures to it.**

**Maps to**: SG-13 | T-02, T-09

**Tide changes**: Nothing automatically — and this record is here precisely because **TideCloak is built on Keycloak**. A Tide deployment on an unpatched Keycloak inherits this CVE.

**Tide does NOT change**: Your patch level. **This is a mandatory check in any Tide app review**: confirm the Keycloak/TideCloak version against `canon/version-policy.md`, and treat a version below 26.6.4 as a live finding. The general lesson — the same algorithm-confusion class as `BP-AUTHZ-10`, twelve years later, in the IdP the pack itself depends on — is worth stating plainly rather than omitting for comfort.

**Sources**: [NVD CVE-2026-11800](https://nvd.nist.gov/vuln/detail/CVE-2026-11800) · [keycloak/keycloak#50357](https://github.com/keycloak/keycloak/issues/50357)

**Confidence**: HIGH for the advisory content. **Make no exploitation claims.**

---

## BP-AUTHZ-12 — Microsoft Power Apps portals (2021) — *the insecure-default precedent*

**Single point of failure**: **A platform default that made "not configured" mean "public."** Table Permissions — the control restricting which records a portal visitor may read — were **off by default**. Developers who configured the visible portal correctly still shipped an OData API that answered anonymously, and nothing in the build process surfaced the discrepancy.

**Damage**: **38 million records** across **47 organizations**, including US government public-health agencies, American Airlines, Ford, J.B. Hunt and New York City agencies. Exposed: names, emails, **SSNs**, employee IDs, COVID-19 contact-tracing records and vaccination appointment data. UpGuard found **over a thousand** anonymously accessible lists across several hundred portals. **Microsoft initially classified the behaviour as "by design" and closed the report**, then changed the product so permissions default on. No fine.

**Maps to**: SG-04, SG-05 | T-09

**Tide changes**: Nothing about platform defaults.

**Tide does NOT change**: Low-code/no-code platform configuration. **This is the best record for the insecure-default argument**, which generalises directly to Tide: any control that must be *switched on* to be effective will be off somewhere. When reviewing, list every security-relevant setting whose safe value is not the default — those are your likely findings. See also `BP-CRED-13`, where the same dynamic played out at Snowflake.

**Sources**: [UpGuard — original research](https://www.upguard.com/breaches/power-apps) · [The Register](https://www.theregister.com/2021/08/23/power_shell_records/)

**Confidence**: HIGH

---

# Category SESS — Session replay, MFA bypass, phishing, account recovery

## BP-SESS-01 — 0ktapus: Twilio vs Cloudflare (2022) — *the controlled experiment*

**This is the most valuable record in the library.** Two companies, the same phishing kit, the same week, the same human error — opposite outcomes.

**Single point of failure**: **A one-time code the human could be tricked into typing into the wrong origin.** The kit was an adversary-in-the-middle relay: it captured username and password, prompted for the TOTP code, and relayed it to the real Okta inside the validity window.

- **Twilio**: employees phished, credentials + OTP relayed, attacker authenticated. **Compromised.**
- **Cloudflare**: **three** employees entered credentials into the same class of page — and the attack **still failed**, because every employee holds a **FIDO2 hardware security key**, and the key's **origin binding** means it will not produce an assertion for the attacker's domain. The human error was identical; the outcome differed entirely because the second factor was cryptographically bound to the origin rather than readable by the user.

**Damage**: **136 organizations** targeted (Group-IB), 114 in the USA. Recovered from the kit's Telegram channel: **9,931 credentials, 5,441 records containing MFA codes**, across **169 phishing domains**. Twilio's investigation concluded **209 customers** and **93 Authy end users** were impacted; downstream, Signal stated ~**1,900** users' phone numbers were exposed. **Cloudflare: zero systems compromised.** No fine.

**Maps to**: SG-15, SG-03 | T-05, T-14

**Tide changes**: Directly relevant to **T-14**, and honestly so. Tide's own documentation is explicit that **password BYOiD does not match FIDO2's domain-origin phishing resistance**, and that the out-of-band Authenticator App (key material in a secure element) is the phishing-resistant path. This record is the evidence for why that caveat matters.

**Tide does NOT change**: User susceptibility to phishing. **Use this record in two directions.** For an app review: if the target uses SMS or TOTP as its second factor, this is the precedent, and the remediation is origin-bound credentials. For a Tide review: this is the strongest external evidence for the T-14 residual, and citing it *against* Tide's password path is what makes the rest of the report credible.

**Sources**: [Cloudflare post-mortem — how it was stopped](https://blog.cloudflare.com/2022-07-sms-phishing-attacks/) · [Group-IB — Roasting 0ktapus](https://www.group-ib.com/blog/0ktapus/)

**Confidence**: HIGH — both companies published first-party accounts; Group-IB's figures come from recovered attacker infrastructure

---

## BP-SESS-02 — Scattered Spider help-desk campaign (CISA AA23-320A)

**Single point of failure**: **A help-desk operator with authority to re-enrol MFA on the basis of knowledge-based verification.** Every cryptographic control in the stack is downstream of one person who can hand out a new factor to a convincing caller. CISA documents four variants: impersonating IT to harvest credentials, asking the user for their OTP, MFA-fatigue push bombing, and convincing the *carrier* to SIM-swap the target.

**Damage**: The advisory is TTP guidance and does not aggregate victim losses. **Do not attach a dollar figure to this record** — cite `BP-ADMIN-03` (MGM, ~$100M) when a figure is needed.

**Maps to**: SG-07, SG-16 | T-03, T-11

**Tide changes**: **This is the strongest general argument for T-11's threshold recovery model.** Tide requires threshold authorization for recovery rather than one operator's judgment, which removes the single-operator override this entire campaign depends on.

**Tide does NOT change**: Your help desk's existence. **And note the honest limit**: `T-11`'s residual is that the recovery threshold is only real if the factors are genuinely distinct. Check whether a user supplied fewer than the required number of distinct addresses — overlap collapses the threshold exactly as a bribable help desk does.

**Sources**: [CISA/FBI AA23-320A](https://www.cisa.gov/news-events/cybersecurity-advisories/aa23-320a) · [AA23-320A PDF, July 2025 revision](https://www.cisa.gov/sites/default/files/2025-08/aa23-320a-scattered-spider-508c.pdf)

**Confidence**: HIGH for TTPs (government primary). No damage figures available.

---

## BP-SESS-03/04 — Reddit 2018 and Reddit 2023 — *the same company, two second factors, both defeated*

The most instructive pairing available on MFA strength.

**2018**: attacker compromised employee accounts by **intercepting the SMS second factor** (mechanism never specified — SS7, SIM swap or carrier insider). Reddit's own conclusion: "SMS-based authentication is not nearly as secure as we would hope." Exposed a 2007 database backup (usernames, salted+hashed passwords, email, all pre-May-2007 content) plus June 2018 email digest logs. **Reddit never published a total affected-user count.** Reddit then migrated to token-based 2FA.

**2023**: a targeted phishing site cloned Reddit's intranet gateway and captured credentials **and the TOTP second factor**, relaying both in real time. Internal documents, code repositories, dashboards, and contact information for hundreds of employees. **No user passwords or accounts accessed.**

**Single point of failure**: **A shared secret the user can be induced to hand over.** SMS in 2018, TOTP in 2023. Reddit fixed the first correctly and was defeated by the same class of attack five years later — because only **origin-bound credentials (FIDO2)** break this chain. See `BP-SESS-01`.

**Maps to**: SG-15 | T-05, T-14

**Tide changes**: See `BP-SESS-01`. Same analysis, same honest caveat.

**Tide does NOT change**: Phishing susceptibility. **One control genuinely worked in 2023 and it is worth reporting: the phished employee self-reported to the security team**, which is how the breach was caught. A blame-free reporting culture is a real detection control — say so when a review finds one, and flag its absence.

**Sources**: [Krebs — Reddit 2018 and SMS limits](https://krebsonsecurity.com/2018/08/reddit-breach-highlights-limits-of-sms-based-authentication/) · [TechCrunch — Reddit 2023](https://techcrunch.com/2023/02/10/reddit-says-hackers-accessed-internal-data-following-employee-phishing-attack/)

**Confidence**: HIGH that Reddit attributed 2018 to SMS intercept; MEDIUM on the exact 2018 mechanism — say "SMS intercept, mechanism unspecified"

---

## BP-SESS-05 — EA via stolen Slack cookie (2021)

**Single point of failure**: **The help desk's willingness to issue a new MFA factor to someone whose only proof of identity was already-stolen session access.** The attackers bought an authenticated Slack session cookie for approximately **$10**, used it to log in as an employee, then told IT they had lost their phone at a party — and IT issued a new MFA token. One support interaction converted a $10 cookie into full corporate authentication.

**Damage**: Approximately **780 GB** exfiltrated — FIFA 21 source and matchmaking server code, the **Frostbite engine source**, proprietary frameworks and SDKs. Attackers attempted to sell for a reported **$28 million**, found no buyer, and leaked it. EA stated **no player data was accessed**.

**Maps to**: SG-03, SG-07, SG-15 | T-05

**Tide changes**: DPoP binding makes a stolen cookie unusable from the attacker's machine, which removes the credibility the pretext depended on.

**Tide does NOT change**: Help-desk identity proofing. **The reusable insight is the chain**: a stolen artifact that is not itself sufficient becomes sufficient when it lends credibility to a social-engineering step. When rating a session-theft finding, ask what the stolen artifact lets the attacker *claim*, not only what it lets them *do*. Note also the market price — session cookies are a commodity, so "an attacker would need to compromise an employee device" is not the barrier it sounds like.

**Sources**: [Vice/Motherboard — attacker interviews](https://www.vice.com/en/article/how-ea-games-was-hacked-slack/) · [CyberScoop](https://cyberscoop.com/ea-games-fifa-hack-hackers-slack/)

**Confidence**: MEDIUM — the chain is attacker-narrated to journalists; EA confirmed the breach and source-code theft but published no post-mortem

---

## BP-SESS-06 — Mailchimp (2022, 2023, ×3 in twelve months)

**Single point of failure**: **One internal admin tool that could act on any customer account.** Employee credentials were not scoped to a customer, so compromising a support employee was equivalent to compromising the tenancy boundary for every account that tool could reach.

**Damage**: **133 Mailchimp accounts** accessed in the January 2023 incident. Audience/mailing-list data was then used to launch targeted phishing against those lists — crypto customers such as Trezor were hit in the related 2022 incident. Mailchimp suspended affected accounts and notified within 24 hours. No fine. **The compounding damage is that this was Mailchimp's third breach in about twelve months, all via social engineering against staff.**

**Maps to**: SG-07, SG-18 | T-03, T-07

**Tide changes**: Quorum on tenant-affecting operations; a support session cannot unilaterally reach across the tenancy boundary.

**Tide does NOT change**: Staff social engineering. **Cite this for two things**: repeat incidents at the same org via the same vector indicate the remediation addressed the instance and not the class — a pattern worth naming explicitly in any review; and **the stolen data was itself an attack tool**, since mailing lists became phishing target lists. When assessing data exposure, ask what the data lets an attacker *do next*, not just what it reveals.

**Sources**: [Mailchimp — January 2023 incident](https://mailchimp.com/newsroom/january-2023-security-incident/) · [Cybersecurity Dive](https://www.cybersecuritydive.com/news/mailchimp-cyberattack-breach-social-engineering/640743/)

**Confidence**: HIGH

---

## BP-SESS-07 — SEC @SECGov X account SIM swap (2024)

**Single point of failure**: **A mobile phone number acting as the account's recovery channel — controlled not by the SEC but by a carrier's ability to reassign it.** Compounded by a second: **MFA had been disabled at the SEC's request in an earlier support interaction and never re-enabled.** X explicitly stated the compromise was **not** due to any breach of X's systems.

**Damage**: No data loss. A false announcement that spot bitcoin ETFs had been approved. Market impact: bitcoin spiked to nearly **$48,000** then fell roughly **6% to ~$45,100**; over **$50 million** of leveraged derivatives positions were liquidated within an hour. **These are reported market-data estimates, not audited losses.** House Financial Services Committee Republicans formally demanded a briefing.

**Maps to**: SG-15, SG-16 | T-05, T-11

**Tide changes**: Threshold recovery removes the single-channel recovery dependency that made a carrier the effective owner of the account.

**Tide does NOT change**: Third-party platform account security. **Three lessons worth carrying**: the damage was entirely *reputational and market-moving* with zero data loss, so a blast-radius analysis that only counts records will underrate this class; **a temporarily disabled control that is never restored is a permanent finding** — check for these explicitly; and it is a useful piece of rhetorical honesty that the organisation which mandates cybersecurity disclosure controls was compromised through a missing MFA toggle.

**Sources**: [CoinDesk — reproduces the SEC statement](https://www.coindesk.com/business/2024/01/13/sec-statement-on-the-hack-of-its-x-account-and-the-resulting-fake-bitcoin-etf-approval-announcement) · [CNBC — X Safety statement on missing MFA](https://www.cnbc.com/2024/01/10/secs-compromised-account-was-not-due-to-breach-of-xs-systems-company-says.html) · [House Financial Services Committee letter (PDF)](https://financialservices.house.gov/uploadedfiles/2024-01-10_letter_to_sec_re_x_hack_final.pdf)

**Confidence**: HIGH for the mechanism; MEDIUM for the market-impact figures

---

## BP-SESS-08 — Terpin v. AT&T and BP-SESS-09 — "The Community" SIM-swap indictment

Paired: the civil and criminal records for the same failure.

**Single point of failure**: **One mobile carrier employee who could reassign a phone number.** In *Terpin*, a retail employee ported the number despite an account protection PIN. In *The Community*, **three former carrier employees were criminally charged** with taking bribes to execute swaps. **No technical control at any exchange or wallet provider was defeated** — the authentication system worked exactly as designed and delivered the codes to whoever held the number.

**Damage**: **Terpin** alleges approximately **$24 million** in cryptocurrency — **there is no final judgment; do not report $24M as an award.** Procedural posture: district court granted AT&T summary judgment (Mar 2023); the **Ninth Circuit reversed in part (30 Sep 2024)**; in July 2025 the district court partly denied summary judgment on the Federal Communications Act claim, sending it toward trial. Terpin's separate **$75.8 million** default judgment was against **Nicholas Truglia — a different defendant in a different case; do not merge these.** **The Community**: DOJ states seven attacks stealing approximately **$2,416,352** (cite the DOJ figure, not the rounded "$2.5 million"), across a fifteen-count indictment; multiple prison sentences with restitution.

**Maps to**: SG-15, SG-16 | T-11

**Tide changes**: **This is the core T-11 argument, evidenced.** Phone-number-based recovery outranks the password in the trust hierarchy, and it depends on a third party the relying service has no relationship with and cannot audit. Threshold recovery removes the single-channel dependency entirely.

**Tide does NOT change**: Carrier employee integrity. **The Community is the more useful citation of the two** because it is an adjudicated criminal record proving the **insider-threat surface at a fourth party** — SMS 2FA's security is bounded by the least-bribable employee at a company you do not contract with. When reviewing, treat any SMS-based recovery or 2FA path as having that dependency.

**Sources**: [Terpin v. AT&T Mobility, 9th Cir. No. 23-55375](https://law.justia.com/cases/federal/appellate-courts/ca9/23-55375/23-55375-2024-09-30.html) · [DOJ — The Community indictment](https://www.justice.gov/usao-edmi/pr/nine-individuals-connected-hacking-group-charged-online-identity-theft-and-other) · [DOJ — sentencing](https://www.justice.gov/usao-edmi/pr/international-hacking-group-members-sentenced-sim-hijacking-conspiracy-resulted-theft)

**Confidence**: HIGH for mechanism and posture. **Terpin's $24M is a plaintiff allegation, not an adjudicated finding — always state this.**

---

## BP-SESS-10 — Robinhood vishing (2021)

**Single point of failure**: **One support employee's session, backed by internal tooling that could query the entire customer base.** No credential stuffing, no malware, no vulnerability — a phone call. The support console's blast radius was the whole book of customers.

**Damage**: Approximately **7 million** individuals: email addresses for ~**5 million**, full names for a different ~**2 million**, name + DOB + ZIP for ~**310**, and more extensive account details for ~**10**. No SSNs, bank account or debit card numbers; no customer suffered financial loss. Robinhood later agreed to a **$45 million SEC settlement** (Jan 2025) covering multiple violations including this incident — **verify the allocation before attributing the full $45M to this breach alone.**

**Maps to**: SG-07, SG-16 | T-03, T-07

**Tide changes**: Quorum on bulk-read and customer-affecting support operations.

**Tide does NOT change**: Vishing. **The tiered damage figures are the useful part of this record** — 7 million, 310 and 10 are three very different findings inside one incident. When reporting blast radius, break it down by sensitivity tier rather than quoting the headline count; a report that says only "7 million affected" is less accurate than one that separates them.

**Sources**: [Robinhood Form 8-K exhibit](https://www.sec.gov/Archives/edgar/data/1783879/000178387921000073/exhibit991november82021blo.htm) · [Robinhood newsroom update](https://robinhood.com/us/en/newsroom/robinhood-announces-data-security-incident-update)

**Confidence**: HIGH for the incident and counts; MEDIUM for the fine attribution

---

## BP-SESS-11 — Coinbase SMS account-recovery flaw (2021)

**Single point of failure**: **The account-recovery flow, which was weaker than the login flow it could substitute for.** 2FA was implemented; the "what if the user is locked out" branch around it was not held to the same standard. Note the required precondition: the attacker also needed the victim's **personal email inbox — one mailbox again sitting upstream of every other control.**

**Damage**: **At least 6,000** Coinbase customers had funds stolen. Coinbase patched the flaw and reimbursed affected customers. **No aggregate dollar figure was published — do not estimate one.**

**Maps to**: SG-15, SG-16 | T-11

**Tide changes**: **This is the cleanest small-scale illustration of T-11.** Recovery is the weakest link because it must work when the primary factor does not. Tide's answer — requiring threshold authorization across distinct channels rather than a single fallback — targets exactly this asymmetry.

**Tide does NOT change**: Your recovery flow's design if you build one outside Tide. **The reusable review action is blunt**: audit the recovery path with the same rigour as the login path, and specifically ask what single channel (a mailbox, a phone number) sits upstream of it. Most apps have one, and most threat models ignore it.

**Sources**: [CoinDesk — cites the California AG notification letter](https://www.coindesk.com/business/2021/10/01/coinbase-multi-factor-authentication-hack-affects-at-least-6000-customers) · [The Record](https://therecord.media/hackers-bypass-coinbase-2fa-to-steal-customer-funds)

**Confidence**: MEDIUM-HIGH — the underlying document is Coinbase's own regulatory notification, but accessible reporting is secondary. **Retrieve the CA AG filing directly before citing in a formal report.**

---

## BP-SESS-12 — Twilio Authy (2024) and BP-SESS-13 — Cisco Duo telephony supplier (2024)

Paired: **the vendors supplying your second factor are themselves a concentration of risk.**

**Authy**: an **unauthenticated public API endpoint** accepted a list of phone numbers and confirmed which were registered Authy accounts, allowing wholesale enumeration. **33 million phone numbers** with account IDs leaked. Twilio states no Twilio systems were accessed and no passwords, 2FA seeds or auth tokens were compromised. The output is a precisely targeted list of people who use app-based MFA — the exact population worth SIM-swapping and smishing.

**Cisco Duo**: a threat actor phished an employee of **the provider that delivers Duo's SMS and VoIP MFA messages** and downloaded MFA message logs — phone number, carrier, country, date/time, message type. **No message content and no OTP values.** Cisco reported roughly **1% of Duo customers** affected (~1,000 organizations/people) — **inconsistently reported and never officially published; flag as approximate.**

**Single point of failure**: For Authy, an unauthenticated enumeration endpoint (a Category-AUTHZ failure producing a Category-SESS consequence). For Duo, **one employee credential at a subcontractor the customers had never heard of** — the MFA vendor's own security was not defeated; the *fourth party* carrying the message was.

**Maps to**: SG-05, SG-15, SG-18 | T-05, T-07

**Tide changes**: Reduces dependence on a delivery-channel vendor for the authentication path.

**Tide does NOT change**: Your MFA vendor's supply chain. **The Duo record is the more important of the two**: every SMS-based MFA deployment inherits the security posture of an SMS delivery chain it does not control and often cannot name. When reviewing, ask who actually delivers the second factor — the answer is usually two companies deeper than the one on the invoice. Note also that **Twilio appears twice in this library** (see `BP-SESS-01`), which is itself the finding.

**Sources**: [SecurityWeek — Authy 33M](https://www.securityweek.com/twilio-confirms-data-breach-after-hackers-leak-33m-authy-user-phone-numbers/) · [BleepingComputer — Duo supplier breach](https://www.bleepingcomputer.com/news/security/cisco-duo-warns-third-party-data-breach-exposed-sms-mfa-logs/) · [The Record](https://therecord.media/cisco-duo-data-breach-mfa-telephony-provider)

**Confidence**: HIGH for Authy's mechanism; MEDIUM-HIGH for Duo — the notification letter went to customers rather than being published, and the scale figure is the weakest element

---

# Category KEYLOSS — Catastrophic key loss, no break-glass, irreversible custody failure

> These records use **Bearing on Tide** instead of `Tide changes` / `Tide does NOT change`. Several are warnings aimed at Tide's own model. They map onto `T-12` (Ragnarök/quorum capture) and `T-19` (no break-glass / lost quorum).

## BP-KEYLOSS-01 — QuadrigaCX (2018–2019)

**Single point of failure**: **One person who was simultaneously the only key custodian, the only administrator, and the only auditor.** When founder Gerald Cotten died there was no second custodian — and while he lived, nobody could see what he was doing.

**What happened**: The public narrative was "the keys died with him." The court-appointed monitor Ernst & Young found the cold wallets were **largely empty and dormant since April 2018 — eight months before Cotten's death** — with user crypto moved to personal accounts on competitor exchanges. The OSC concluded the shortfall was principally caused by **fraudulent trading against clients**, not lost keys.

**Damage**: OSC: approximately **76,000 clients** lost at least **CAD $169 million**. Company liquidated; no meaningful recovery for most clients.

**Bearing on Tide**: Distributing custody helps enormously — but **only if the shares are held by parties with divergent interests.** An n-of-n scheme where one person controls all n shares is not a threshold system. This is the record to cite when auditing whether Tide's ORK operator independence is real rather than nominal (`T-08`, irreducible assumption 4). **Also note the correction**: the famous "lost keys" story was false, so cite the fraud finding, not the folklore.

**Sources**: [OSC — *QuadrigaCX: A Review by Staff* (PDF)](https://www.osc.gov.on.ca/quadrigacxreport/web/files/QuadrigaCX-A-Review-by-Staff-of-the-Ontario-Securities-Commission.pdf) · [OSC report landing page](https://www.osc.gov.on.ca/quadrigacxreport/) · [CBC — E&Y findings](https://amp.cbc.ca/lite/story/1.5040099)

**Confidence**: HIGH

---

## BP-KEYLOSS-02 — Parity multisig library self-destruct (2017)

**Single point of failure**: **One shared library contract that every "multi-signature" wallet delegated its logic to.** The wallets were multi-sig at the signature layer and **1-of-anyone at the code layer**. Multi-party key control bought nothing, because the code the keys called was singly owned.

**What happened**: The shared `WalletLibrary` was deployed uninitialized and retained both `initWallet` and `kill`. A user claimed ownership and invoked self-destruct, removing the library. Every dependent wallet's `delegatecall` pointed at nothing. **Funds were not stolen — they became permanently immovable.** Parity's post-mortem confirms a fix had been proposed in August 2017 and not shipped.

**Damage**: **513,774.16 ETH plus ERC-20 tokens frozen permanently across 587 wallets.** ~$150M at the time; later valuations exceed $1.7B — **cite the ETH figure, the dollar figure is a moving target.** No recovery: multiple EIPs to unfreeze were never adopted. Irreversible.

**Bearing on Tide**: **Thresholds do not help if all shares are enforced by one shared piece of code.** You must threshold the *enforcement mechanism*, not just the signing material, or you have replaced a key SPOF with a code SPOF. Directly applicable to Tide's Forseti contracts (`T-16`) and to any shared component every ORK depends on — ask what single code artifact all participants execute.

**Sources**: [Parity — post-mortem](https://medium.com/paritytech/a-postmortem-on-the-parity-multi-sig-library-self-destruct-63daca3a4cf7) · [Vice — Parity knew since August](https://www.vice.com/en/article/ethereum-wallet-parity-knew-about-critical-flaw-that-let-user-devops199-lock-up-millions/)

**Confidence**: HIGH

---

## BP-KEYLOSS-03 — Mt. Gox (2011–2014)

**Single point of failure**: **One unencrypted `wallet.dat` file containing the operational private keys**, plus one operator with no independent reserve reconciliation. Once that file left the building, every balance the exchange displayed was fiction — for roughly 30 months.

**Damage**: **850,000 BTC initially declared missing** (~$450–500M at Feb 2014 prices), of which **200,000 BTC were later located in an old wallet**, leaving ~650,000 unrecovered. Creditor distributions ran for more than a decade. WizSec established the drain was gradual from 2011, not a single 2014 event.

**Bearing on Tide**: Thresholds help — a single stolen file should not suffice to sign. But they do **nothing** about the second failure, which is that **nobody could independently verify reserves**. Splitting keys without independent attestation of state still lets you be robbed for three years without noticing. When reviewing a Tide deployment, ask what independently attests that the system's state is what it claims.

**Sources**: [Bitcoin Wiki — Collapse of Mt. Gox (aggregates primary statements + WizSec)](https://en.bitcoin.it/wiki/Collapse_of_Mt._Gox) · [NPR — bankruptcy filing](https://www.npr.org/sections/thetwo-way/2014/02/28/283863219/mtgox-files-for-bankruptcy-nearly-500m-of-bitcoins-lost) · [CBC — 200,000 BTC recovered](https://www.cbc.ca/news/science/bitcoin-exchange-mt-gox-finds-200k-of-its-missing-bitcoins-1.2581232)

**Confidence**: MEDIUM-HIGH (the 850k/200k figures are HIGH; per-year drain figures MEDIUM)

---

## BP-KEYLOSS-04 — Multichain (2023) — *jurisdictional concentration as a threshold break*

**Single point of failure**: **One executive's personal device set holding the operational keys to a nominally multi-party MPC system.** The protocol marketed distributed key generation; the *operational control plane above it* was one man. When Chinese police detained CEO Zhaojun and confiscated his computers, phones, hardware wallets and mnemonic phrases, the rest of the team had no path to operate or secure the protocol.

**Damage**: **~$126 million** in user assets drained in circumstances the team could not explain or halt; **>$65M frozen** by Circle and Tether afterwards. Protocol permanently shut down 14 July 2023. Whether this was an exploit, a state seizure, or a rug pull **remains contested.**

**Bearing on Tide**: **The single most important record in this file for auditing Tide's ORK independence assumption.** A threshold scheme is only as distributed as its weakest layer — MPC shards are worthless if one person holds the admin credentials to all the nodes, and **legal-jurisdictional concentration (all shares reachable by one police force, or one court order) is a real threshold break.** Irreducible assumption 4 says node independence; this record says independence must include *jurisdictional* and *operational-control* independence, not just distinct processes. Ask: how many ORKs could one legal authority compel at once?

**Sources**: [Chainalysis — Multichain exploit analysis](https://www.chainalysis.com/blog/multichain-exploit-july-2023/) · [CoinDesk — operations cease, CEO detained](https://www.coindesk.com/business/2023/07/14/crypto-bridging-protocol-multichain-ceases-operations) · [Blockworks](https://blockworks.com/news/multichain-founder-family-arrested)

**Confidence**: MEDIUM — the shutdown and key-custody facts come from the project's own statements; **the cause of the $126M drain is contested**

---

## BP-KEYLOSS-05 — Ronin Bridge (2022) — *the effective threshold vs the configured threshold*

**Single point of failure**: **One organization that effectively controlled 5 of the 9 "independent" validator keys.** The bridge required 5-of-9. Four validator keys were held by Sky Mavis itself, and a **temporary allowlist granted in November 2021 during a load spike — and never revoked** — let Sky Mavis's RPC node elicit a signature from the fifth (Axie DAO) validator. **The threshold was 5-of-9 on paper and 1-of-1 in practice.**

**Damage**: **173,600 ETH + 25.5M USDC**, roughly **$540M at the time** (~$620–625M in later reporting — **cite the token quantities, the dollar figure varies by valuation date**). **Undetected for six days.** Sky Mavis raised $150M to reimburse users; the FBI attributed the theft to DPRK-linked Lazarus Group.

**Bearing on Tide**: **This is the canonical warning and it applies to Tide directly.** A threshold is a lie if the shares are not held by genuinely independent parties, and **every temporary "just for now" delegation permanently lowers the real threshold.** Two mandatory review actions for any Tide deployment: audit the *effective* threshold rather than the configured one, and enumerate every delegation, allowlist entry or convenience exception — with an expiry. `T-08` claims "≥14 of the specific 20 ORKs"; Ronin is the proof that such a claim must be verified operationally, not read off a config.

**Sources**: [Ronin/Sky Mavis post-mortem](https://roninchain.com/blog/posts/back-to-building-ronin-security-breach-6513cc78a5edc1001b03c364) · [Halborn technical breakdown](https://www.halborn.com/blog/post/explained-the-ronin-hack-march-2022)

**Confidence**: HIGH

---

## BP-KEYLOSS-06 — DigiNotar (2011)

**Single point of failure**: **One commercial CA's signing authority, trusted equally with every other CA by every browser on earth.** The global PKI trust model gives every CA full authority over every domain — so the weakest CA sets the security of all of them.

**Damage**: **531 rogue SSL certificates** issued over ten days, including for Google, Skype, Mozilla add-ons and Microsoft Update. A rogue `*.google.com` certificate was used in MiTM interception against approximately **300,000 users, almost exclusively in Iran** (Fox-IT, *Operation Black Tulip*). Microsoft, Google and Mozilla revoked trust in **all** DigiNotar certificates including the Dutch government's PKIoverheid hierarchy; the Dutch government took operational control and **DigiNotar was declared bankrupt in September 2011**. No mechanism existed to selectively repudiate the bad certificates without destroying the good ones.

**Bearing on Tide**: Thresholds help against the *issuance* failure — requiring k independent parties to authorize. They do **not** help against the *trust-model* failure: **if a relying party accepts any one authority unconditionally, distributing that authority internally does not change the blast radius.** Fix the verifier, not only the signer. Relevant to any Tide claim about JWKS trust and to the `cmk-ceremony` protocol's "trust any gVVK without PKI" property — ask what the relying party would accept if a single authority were subverted.

**Sources**: [Fox-IT — *Operation Black Tulip* (PDF, via ENISA)](https://www.enisa.europa.eu/sites/default/files/all_files/Operation_Black_Tulip_v2.pdf) · [CCDCOE Cyber Law Toolkit](https://cyberlaw.ccdcoe.org/wiki/DigiNotar_(2011))

**Confidence**: HIGH

---

## BP-KEYLOSS-07 — Code Spaces (2014) — *when the backup shares the credential*

**Single point of failure**: **One AWS control-panel identity that could delete the backups as well as the primary data.** "Off-site backup" that is reachable from the same credential is not a backup.

**Damage**: An extortionist with the credentials deleted "all EBS snapshots, S3 buckets, all AMIs, some EBS instances and several machine instances," and created backdoor logins so a password reset did not evict him. Customer repositories, backups and machine images irrecoverably destroyed **within hours**. The company stated the cost put it "in an irreversible position" and **ceased trading the same day.** No dollar figure published.

**Bearing on Tide**: Directly applicable to `T-19`. **Destructive operations need a higher threshold than routine ones, and recovery material must be outside the authority of the credential being protected.** A threshold scheme that lets k signers also destroy the recovery path has no break-glass at all. When reviewing Tide's Ragnarök and key-healing flows, ask specifically whether the quorum that can *use* the key can also *destroy the ability to recover* it.

**Sources**: [Help Net Security — contemporaneous, quotes the company statement](https://www.helpnetsecurity.com/2014/06/19/code-hosting-code-spaces-destroyed-by-extortion-hack-attack/) · [breaches.cloud case file with archived statement](https://www.breaches.cloud/incidents/codespaces/)

**Confidence**: MEDIUM — well corroborated contemporaneously, but the primary source is the company's now-defunct statement; no independent forensic report exists

---

## BP-KEYLOSS-08 — Colonial Pipeline decryptor (2021) — *an untested recovery path is not a recovery path*

**Single point of failure**: **One legacy VPN credential without MFA** for the intrusion; and for the recovery, **one recovery mechanism that had never been performance-tested.** Colonial paid the ransom, received a **working** decryption tool, and it was **too slow to be operationally useful** — they restored from their own backups in parallel anyway. Possession of the correct key was necessary but not sufficient for recovery inside the required window.

**Damage**: **$4.4 million ransom** (75 BTC) paid within a day; DOJ later recovered 63.7 BTC. **~5,500 miles of pipeline shut down for ~6 days**, triggering fuel shortages and emergency declarations in 17 states and DC. CEO Joseph Blount testified the tool was "advantageous" but "not perfect."

**Bearing on Tide**: **The sharpest operational lesson in the file for `T-19`.** If your break-glass requires assembling k custodians, you must have **measured the wall-clock time to do it under adversarial conditions**. A correct-but-slow recovery is an outage. Tide's model deliberately fails closed and has no god-mode; that is defensible only if the *legitimate* recovery path has a measured, rehearsed duration. Ask any Tide operator: how long does your quorum actually take to assemble, and when did you last test it?

**Sources**: [CNBC — Blount Senate testimony](https://www.cnbc.com/2021/06/08/colonial-pipeline-ceo-testifies-on-first-hours-of-ransomware-attack.html) · [Nextgov/FCW — decryptor efficacy](https://www.nextgov.com/cybersecurity/2021/06/colonial-pipeline-ceo-talks-ransom-with-lawmakers/258407/)

**Confidence**: MEDIUM-HIGH (ransom, shutdown duration and testimony HIGH; the degree of decryptor slowness rests on testimony and reporting, not a published RCA)

---

## BP-KEYLOSS-09 — Stefan Thomas IronKey (illustrative, individual)

**Single point of failure**: **One password on one device, with a hard-coded self-destruct and no escrow, no shares, no recovery contact.** The anti-brute-force control and the availability control are the same control.

**Damage**: **7,002 BTC inaccessible.** 8 of 10 password attempts consumed; **2 remain.** Dollar valuations in reporting range from ~$220M (Jan 2021) to ~$840M in later coverage — **cite the BTC quantity, never a dollar figure.** This is one individual's loss, included only as a clean illustration.

**Bearing on Tide**: Thresholds directly solve this — k-of-n recovery converts a forgotten secret from fatal to survivable. But state the cost honestly: **every recovery share you add is an additional attack surface, and the IronKey's lockout is exactly the control a threshold scheme trades away.** This is the tradeoff behind `T-11`: threshold recovery is strictly better than one mailbox and strictly worse than "no recovery path exists at all," and a report should say so rather than presenting recovery as free.

**Sources**: [CBC *As It Happens* — interview with Thomas](https://www.cbc.ca/radio/asithappens/as-it-happens-friday-edition-1.5875363/this-man-owns-321m-in-bitcoin-but-he-can-t-access-it-because-he-lost-his-password-1.5875366)

**Confidence**: MEDIUM — the 7,002 BTC and 10-attempt facts come from Thomas himself and are consistently reported; all valuations are date-dependent

---

# Category AVAIL — Availability and centralization

> **Framing note for this whole category: none of these are solved by threshold cryptography, and several are made *worse* by it.** These records exist so a red-team report cannot quietly imply that distributing keys improves availability. Tide explicitly trades availability for confidentiality (`T-19`); these are the precedents for what that costs.

## BP-AVAIL-01 — CrowdStrike Falcon Channel File 291 (2024)

**Single point of failure**: **One content file, pushed simultaneously to every Windows host on the planet running Falcon, parsed by a kernel-mode driver with no staged rollout and no fail-open.** There was no ring deployment for Rapid Response Content — "rapid" was the point, and it was also the flaw.

**What happened**: The update supplied 20 input values to an interpreter whose template defined **21** parameters; the 21st had only ever been exercised with wildcards in testing. First non-wildcard use → out-of-bounds read in kernel mode → boot loop. Because the crash occurred before networking came up, **the fix could not be pushed** — every machine needed physical or out-of-band access. BitLocker-encrypted machines needed recovery keys retrieved from systems that were themselves down.

**Damage**: **8.5 million Windows devices** (Microsoft's estimate, "less than one percent of all Windows machines"). CrowdStrike shipped a fix in ~90 minutes but recovery was manual; ~99% of sensors were back by **10 days** later. **Delta Air Lines: over 7,000 flights cancelled, 1.3 million passengers, ~$500 million claimed** — **this is Delta's litigated claim, disputed by CrowdStrike, not an established figure.**

**Bearing on Tide**: **Thresholds do not help and can hurt.** This was a correctness-and-blast-radius failure, not a key failure — a k-of-n signing quorum on the update would not have caught a parameter-count bug that passed every automated validator. What helps is staged rollout, canarying, and a rollback path that does not require the machine to boot. **The hard part: if your threshold system requires k parties to be reachable to recover, a global availability event of this class means you cannot recover at all.** Cite this against any claim that distribution improves resilience generally.

**Sources**: [CrowdStrike — External Technical Root Cause Analysis (PDF)](https://www.crowdstrike.com/wp-content/uploads/2024/08/Channel-File-291-Incident-Root-Cause-Analysis-08.06.2024.pdf) · [Microsoft — 8.5M devices](https://blogs.microsoft.com/blog/2024/07/20/helping-our-customers-through-the-crowdstrike-outage/) · [CNBC — Delta/CrowdStrike countersuits](https://www.cnbc.com/2024/10/25/delta-suit-against-crowdstrike-after-it-outage-caused-cancellations.html)

**Confidence**: HIGH on device count and RCA; **Delta's $500M is a litigated claim**

---

## BP-AVAIL-02 — Meta BGP withdrawal (2021) — *the dependency-loop precedent*

**Single point of failure**: **One command, validated by one buggy audit tool, against one backbone — plus a DNS health-check design that converted a partial failure into total internet-level disappearance.** And then: **the out-of-band access path depended on the same network.**

**What happened**: A routine capacity-assessment command took down all backbone connections between data centres; the audit tool designed to reject such a command **contained a bug**. Meta's authoritative DNS servers withdraw their BGP advertisements when they cannot reach a data centre — so they correctly withdrew, removing Meta from the global routing table. Recovery was dominated by **physical access**: Meta's own post-mortem notes "primary and out-of-band network access was down," data centres are "hard to get into," and hardware is "designed to be difficult to modify even when you have physical access." Internal tools, badge systems and communications were all affected because they shared the infrastructure.

**Damage**: **More than six hours of total global unavailability** across Facebook, Instagram, WhatsApp, Messenger and Workplace — ~3.5 billion users. WhatsApp is primary communications infrastructure across much of Latin America, South Asia and Africa. **No official Meta dollar figure; press revenue estimates vary widely and should not be cited as authoritative.**

**Bearing on Tide**: **Thresholds actively hurt here unless you plan for it.** Meta's recovery tooling depended on the thing it was recovering. **A k-of-n scheme whose custodians authenticate through the system they are recovering is unrecoverable.** Your break-glass quorum must be reachable over infrastructure that shares no dependency with the system it rescues. Mandatory question for any Tide deployment with quorum-gated recovery: *if TideCloak is down, how do the approvers authenticate?*

**Sources**: [Meta Engineering — more details about the October 4 outage](https://engineering.fb.com/2021/10/05/networking-traffic/outage-details/) · [Meta Engineering — update](https://engineering.fb.com/2021/10/04/networking-traffic/outage/)

**Confidence**: HIGH

---

## BP-AVAIL-03 — AWS DynamoDB / us-east-1 (2025) — *correlated failure domains*

**Single point of failure**: **One regional DNS record for DynamoDB in us-east-1** — a region on which a very large fraction of the internet, and a large fraction of AWS's *own* internal control planes (EC2, IAM, STS, Lambda), depend.

**What happened**: A latent **race condition** in DynamoDB's automated DNS management — two "DNS Enactor" processes updating concurrently, a delayed one overwriting a newer plan, whose cleanup automation then deleted it — **removed all IP addresses for the regional endpoint**, leaving an inconsistent state that **blocked automated repair**. The failure cascaded into EC2 launches, NLB health checks, Lambda, ECS/EKS/Fargate, Redshift, STS and IAM. AWS's own Support Console was affected, slowing response. AWS states it "did not have adequate test coverage for the DWFM recovery workflow."

**Damage**: **~14.5 hours** end to end. AWS names at least **13 major services**; third-party analyses cite **over 140** — **that higher number is secondary reporting, not AWS's count.** CyberCube estimated **insured losses up to $581 million** — **a modelled insurance estimate from a risk vendor, not a measured figure.**

**Bearing on Tide**: **Not solved by thresholds — and a direct warning.** Distributing shares across nodes that all resolve through, authenticate against, or run inside one region gives you **the illusion of independence**. Correlated infrastructure dependency is the real threshold-breaker: **count your shares by failure domain, not by process.** When auditing ORK distribution, map the nodes to cloud regions, DNS providers and transit paths — if 14 of 20 share a failure domain, the honest availability threshold is not 14. Note also that automated recovery could not fix an inconsistent state; **automated recovery needs a manual override that does not depend on the automation.**

**Sources**: [AWS — post-event summary](https://aws.amazon.com/message/101925/) · [ThousandEyes — independent measurement](https://www.thousandeyes.com/blog/aws-outage-analysis-october-20-2025) · [Forbes — CyberCube modelling](https://www.forbes.com/sites/kateoflahertyuk/2025/10/23/aws-outage-new-analysis-explains-what-went-wrong-and-why/)

**Confidence**: HIGH for root cause and timeline; MEDIUM for the "140 services" and "$581M" figures

---

## BP-AVAIL-04 — Cloudflare (2025) and BP-AVAIL-05 — Cloudflare (2019)

Paired: **config artifacts are code**, proved twice at the same company six years apart.

**2025**: a ClickHouse **permissions change** caused a query building the Bot Management feature file to also return metadata from an underlying database. The query did not filter on database name, so duplicate rows roughly **doubled the file's size past a 200-feature memory preallocation limit**, where the Rust core proxy called `Result::unwrap()` on an `Err` and panicked into 5xx. As the oversized file propagated on its **5-minute cycle**, parts of the fleet alternated between good and bad states — which initially made it look like an external attack and delayed diagnosis. **~5.5 hours of impact.** Cloudflare: **"Today was Cloudflare's worst outage since 2019,"** described as "unacceptable."

**2019**: one new WAF rule containing a regex with **catastrophic backtracking**, deployed globally in a single step. CPU went to 100% network-wide. **A protection mechanism that capped regex CPU usage had been removed during a prior refactoring and its absence was not noticed.** **27 minutes** of global 502s.

**Single point of failure**: A single data/config artifact distributed to every node, parsed by a component with a hard limit and no graceful degradation — and, in 2019, **a safety guardrail that had been silently removed.**

**Bearing on Tide**: Two lessons. **(1) If a threshold system distributes a policy, feature or parameter file to all participants, a malformed file is a simultaneous global fault regardless of how many keys guard it** — prefer fail-safe degradation over `unwrap()`. Directly relevant to Forseti contract distribution (`T-16`). **(2) Guardrail decay**: the 2019 controlling failure was that a safety mechanism was removed and nobody detected the removal. **Test continuously that the threshold is actually enforced** — a quorum requirement that has been silently relaxed looks identical to one that works, right up until it doesn't. Pair this with `BP-KEYLOSS-05` (Ronin).

**Sources**: [Cloudflare — 18 November 2025 outage](https://blog.cloudflare.com/18-november-2025-outage/) · [Cloudflare — 2 July 2019 outage](https://blog.cloudflare.com/cloudflare-outage/)

**Confidence**: HIGH (both are detailed first-party RCAs)

---

## BP-AVAIL-06 — Fastly (2021)

**Single point of failure**: **One customer's legitimate configuration change, hitting one dormant bug, in one shared software version running on every POP.** No malice, no invalid input — **a valid action by one tenant took down all tenants.** The bug had been live and undetected for ~27 days.

**Damage**: **85% of Fastly's network returned errors**, taking down Amazon, Reddit, The New York Times, Spotify, Twitch, GitHub, PayPal and gov.uk. Fastly detected within **one minute** and had **95% of the network operating normally within 49 minutes** — a genuinely good response. No published dollar figure.

**Bearing on Tide**: **Multi-tenancy is a single point of failure that thresholds do not address.** One participant's *valid* input crashing the shared component is exactly the failure mode a threshold scheme is blind to — **every honest signer would have signed.** Design for input-triggered global faults from legitimate parties, not just for malicious minorities. Applies to any Tide surface where one tenant's configuration is processed by shared ORK code.

**Sources**: [Fastly — summary of June 8 outage](https://www.fastly.com/blog/summary-of-june-8-outage) · [ThousandEyes analysis](https://www.thousandeyes.com/blog/inside-the-fastly-outage-analysis-and-lessons-learned)

**Confidence**: HIGH

---

## BP-AVAIL-07 — Azure AD key-rotation outage (2021) — *the most directly transferable record here*

**Single point of failure**: **One signing key, and one piece of automation with unilateral authority to remove it.** A key had been explicitly marked "do not rotate" because an in-flight migration still required it; **a bug in the rotation automation failed to honour the flag** and removed it. **The failure was not a compromise — it was correct-looking key hygiene applied to the wrong key.**

**Damage**: **Approximately 14 hours** of authentication failures worldwide across Microsoft 365, Azure, Xbox Live, Teams, Dynamics and every third-party application federating to Azure AD. Recovery was slow even after the fix because dependent services had to expire cached key metadata. Microsoft's own review stated "the maturity of the key removal process is currently insufficient." **Because it was an *authentication* outage, affected users could not log in to anything — including, in many organisations, the tooling they would have used to respond.** No user count or dollar figure published.

**Bearing on Tide**: **Two painful and directly applicable lessons.** (1) **Key rotation is an availability operation, not just a security operation.** A threshold system that rotates shares must treat rotation as a change with staged rollout and rollback — a botched rotation locks everyone out just as effectively as a stolen key lets everyone in. This bears on Tide's proactive resharing and key-healing (`T-19`). (2) **If your quorum members authenticate through the IdP, an IdP outage means you cannot assemble the quorum.** Break-glass custodians need an authentication path independent of the identity system — the same conclusion as `BP-AVAIL-02`, reached from the identity side.

**Sources**: [Microsoft Q&A / Service Health record](https://learn.microsoft.com/en-us/answers/questions/315440/notification-authentication-errors-across-multiple) · [BleepingComputer — the key-rotation bug and the "don't rotate" flag](https://www.bleepingcomputer.com/news/microsoft/microsoft-explains-the-cause-of-yesterdays-massive-service-outage/) · [Computer Weekly](https://www.computerweekly.com/news/252497921/Microsoft-cloud-users-hit-by-global-outage-linked-to-Azure-Active-Directory-issue)

**Confidence**: MEDIUM-HIGH — root cause is Microsoft's own stated review content, reported here via secondary sources quoting it; duration and scope HIGH

---

## BP-AVAIL-08 — Rogers Canada (2022) and BP-AVAIL-09 — Optus Australia (2023)

Paired national-scale telecom failures. Both are **control-plane and homogeneity** lessons.

**Rogers**: a configuration change **deleted a routing filter**, allowing all possible internet routes to be distributed; routers exhausted resources and the IP core collapsed. **One converged IP core carried wireless, wireline, internet and 911 for the whole country with no separated management plane** — so when the core failed, the tools to fix it failed too. The CRTC-commissioned review found staff **could not access critical error logs until 14 hours in**, and had to be **physically dispatched** to remote sites. **More than 12 million customers** lost service for **more than 24 hours**, including **911 access** and nationwide Interac debit payments.

**Optus**: a large increase in BGP routes from an upstream peer exceeded a preset route limit on core routers, which **triggered a designed failsafe that disconnected them.** **The safety mechanism was the outage mechanism.** ~**10 million retail and 400,000 business customers**, ~**12–14 hours**, **000 emergency calls failed**. **Root cause is genuinely disputed** — Optus attributed the trigger to a software upgrade; parent Singtel stated the upgrade "was not the root cause." **Report the dispute; do not pick a side.** The CEO subsequently resigned.

**Bearing on Tide**: **(1) Control-plane separation** — the channel over which custodians coordinate must not traverse the system being protected, or your k-of-n becomes 0-of-n exactly when you need it. **(2) Homogeneous failsafes are a correlated failure**: if every node in your quorum runs the same protective policy with the same threshold, a single external stimulus takes them all offline simultaneously — a liveness break with no key compromised. **Diversity of implementation and of trigger thresholds is a real availability property, and a threshold system built from n identical nodes has n=1 for this class of fault.** This is a genuine open question for a 20-ORK swarm running identical software.

**Sources**: [CRTC — Xona assessment of Rogers](https://crtc.gc.ca/eng/publications/reports/xonarp2023.htm) · [CRTC executive summary](https://crtc.gc.ca/eng/publications/reports/xona2024.htm) · [*Journal of Telecommunications and the Digital Economy* — Optus outage analysis (peer-reviewed)](https://jtde.telsoc.org/index.php/jtde/article/view/898) · [Internet Society Pulse — BGP measurement](https://pulse.internetsociety.org/blog/optus-outage-exposes-australias-internet-resilience)

**Confidence**: HIGH for Rogers; MEDIUM for Optus — scale and duration HIGH, **root cause contested between Optus and Singtel**

---

# Category CRYPTO — Primitive and implementation failure

> **Framing note: distributing a key across n parties does not help when the primitive or implementation used by all n parties is broken.** In several of these, n parties running the same broken library is **n independent compromises, not one**. This category is where threshold systems are most likely to be oversold, and it maps onto `T-15` (unaudited primitives), `T-16` (determinism) and `T-20` (long-horizon).

## BP-CRYPTO-01 — Heartbleed (2014)

**Single point of failure**: **One function in one library that essentially the entire internet's TLS depended on** — and the leaked region routinely contained **the server's own long-term private key**.

**Damage**: Up to 64KB of process memory per request, repeatable indefinitely, **leaving no log entries**. Leaked in practice: TLS private keys, session cookies, credentials, and other users' plaintext. Netcraft: **~17% of SSL web servers with trusted-CA certificates were vulnerable — over half a million widely trusted websites.** Remediation was catastrophically slow: **three weeks after disclosure, over 73% of affected certificates had not been reissued and over 87% had not been revoked.** Directly caused the founding of the Core Infrastructure Initiative.

**Bearing on Tide**: **Thresholds help only if the shares never enter the vulnerable process's memory.** If all n parties run the same OpenSSL, an over-read on each leaks each share — **n independent leaks, not 1/n of a leak.** The genuine mitigations are *implementation diversity across the quorum* and never materialising reconstructed key material in a general-purpose process. Second-order lesson for `T-19`: **the hard part was not patching, it was rotating 500,000 keys** — plan rotation capacity before you need it.

**Sources**: [NVD CVE-2014-0160](https://nvd.nist.gov/vuln/detail/CVE-2014-0160) · [Netcraft — the 17% measurement](https://www.netcraft.com/blog/half-a-million-widely-trusted-websites-vulnerable-to-heartbleed-bug) · [Netcraft — revocation rates](https://www.netcraft.com/blog/heartbleed-certificate-revocation-tsunami-yet-to-arrive) · [ACM IMC 2014 study](https://dl.acm.org/doi/10.1145/2663716.2663758)

**Confidence**: HIGH

---

## BP-CRYPTO-02 — Debian OpenSSL PRNG (2006–2008) — *the cleanest refutation of naive threshold optimism*

**Single point of failure**: **One two-line downstream patch**, applied to the one library that generated the keys, which removed all entropy contribution except the process ID — reducing the effective keyspace to the number of possible PIDs (**32,768**).

**Damage**: **The entire set of possible keys could be pre-generated and published.** Anyone could look up a Debian-generated key in a table and read off the private key. Affected: SSH host and user keys, OpenVPN keys, DNSSEC keys, X.509 keys, TLS session keys — **all keys generated on Debian-based systems across ~20 months.** Debian's advisory further states that **all DSA keys ever used on an affected system must be considered compromised even if generated elsewhere**, because DSA leaks the private key when the per-signature nonce is predictable. Weak-key blacklists are still enforced in OpenSSH today.

**Bearing on Tide**: **The single most important record in this category.** If all n parties generate their shares with the same broken RNG, **an attacker enumerates all n shares independently — the threshold provides zero additional work.** Worse, the DSA note applies directly to threshold signing: **a biased or predictable nonce leaks share material through the signatures themselves.** Two requirements follow for any Tide review: entropy sources must be independent across the quorum, and share generation must be **verifiable, not merely distributed**. This is the concrete technical content behind irreducible assumption 4.

**Sources**: [Debian DSA-1571-1](https://www.debian.org/security/2008/dsa-1571) · [debian-security-announce — original posting with the DSA-key guidance](https://lists.debian.org/debian-security-announce/2008/msg00152.html) · [Ubuntu Launchpad Bug #229964](https://bugs.launchpad.net/bugs/229964)

**Confidence**: HIGH

---

## BP-CRYPTO-03 — ROCA / Infineon RSA keygen (2017) — *national-scale, and the closest analogue to T-15*

**Single point of failure**: **One vendor's RSA key-generation library, burned into the firmware of millions of smartcards and TPMs.** No key ever generated by that library was ever safe, no matter how well protected afterwards — **the attack needs only the public key.** Hardware tamper-resistance was irrelevant.

**What happened**: Infineon's RSALib constructed primes in a structured form to speed up on-card generation, drastically reducing the search space and making **factorisation of 512-, 1024- and 2048-bit keys practical from the public key alone.** Vulnerable keys are also trivially **fingerprintable** from the public modulus.

**Damage**: **Estonia: more than 750,000 ID cards affected; ~760,000 certificates suspended.** A **national-scale identity compromise** — Estonia's eID underpins voting, banking, prescriptions and legal signature. For a national eID this means forging legally-effective digital signatures **without physical access and without the PIN**. Slovakia suspended affected eIDs; Microsoft, Google, HP, Lenovo and Fujitsu issued advisories. Follow-up research (Bernstein & Lange, 2018) produced a materially **faster** factorisation than the original paper.

**Bearing on Tide**: **A threshold does not help if all n shares are generated by the same keygen implementation** — n Infineon cards holding n shares is n breakable keys. The mitigations that work are **heterogeneous key generation across the quorum** (different vendors, different libraries) and **public verifiability of key generation**, so structured or weak keys are detectable before use. This is also the strongest argument for **crypto-agility** and the closest historical analogue to `T-15`: a primitive everyone trusted, in production at national scale, broken by analysis nobody had done. Estonia recovered only because it had **already built a remote renewal channel** — ask whether a Tide deployment has one.

**Sources**: [CRoCS Masaryk — ROCA disclosure and ACM CCS 2017 paper](https://crocs.fi.muni.cz/public/papers/rsa_ccs17) · [NVD CVE-2017-15361](https://nvd.nist.gov/vuln/detail/CVE-2017-15361) · [SC Media — Estonia suspends 760,000 cards](https://scmagazine.com/news/data-security/estonia-suspends-national-760000-id-cards-found-prone-to-encryption-vulnerability)

**Confidence**: HIGH

---

## BP-CRYPTO-04 — Juniper ScreenOS / Dual_EC_DRBG (2012–2015)

**Single point of failure**: **One constant — the elliptic curve point Q — in one RNG, in one product line.** Nothing else had to be compromised. Whoever controlled Q could **passively decrypt every VPN session the device negotiated**, with no active interference and no detectable trace.

**What happened**: ScreenOS used Dual_EC_DRBG, which has a known **kleptographic** structure. Juniper layered an ANSI X9.31 PRNG on top that should have masked the output, but **a separate bug meant the X9.31 layer was never actually applied**. An unauthorized party then **changed the Q point** in the ScreenOS source.

**Damage**: **Not publicly quantified** — Juniper never disclosed how many devices or which customers, nor how long the substituted Q was in production (**at minimum 2012 to December 2015, roughly three years**). Significant as **the only publicly confirmed instance of a deployed cryptographic backdoor being repurposed by a second unknown party**: Juniper had adopted Dual_EC with a self-chosen Q, and someone else replaced it. A congressional inquiry followed; Juniper declined to identify who inserted the code.

**Bearing on Tide**: **A backdoor in a primitive is not solved by distributing keys — because the backdoor operates on the randomness, not the key.** Two consequences: if all quorum members share an RNG design with a trapdoored constant, the adversary reads every share; and **nothing-up-my-sleeve constants matter** — any parameter your scheme accepts without an auditable derivation is a place someone can hide a master key. **This is the record to cite against Tide's own `T-15`**: the custom curve BEd255475 is not yet independently audited, and Juniper is the precedent for why an unaudited curve parameter is a category of risk rather than a paperwork gap. **Verify every constant, or your threshold has an implicit n+1th party.**

**Sources**: [Checkoway et al., *A Systematic Analysis of the Juniper Dual EC Incident*, ACM CCS 2016 (PDF)](https://eprint.iacr.org/2016/376.pdf) · [HD Moore — binary analysis and the substituted Q](https://github.com/hdm/juniper-cve-2015-7755) · [Matthew Green — On the Juniper backdoor](https://blog.cryptographyengineering.com/2015/12/22/on-juniper-backdoor/)

**Confidence**: HIGH for the technical facts; **LOW for attribution** — nobody has publicly established who substituted Q

---

## BP-CRYPTO-05 — SHA-1 collisions: SHAttered (2017) and Shambles (2020)

**Single point of failure**: **One hash function that a very large amount of the world's integrity and signature infrastructure had baked in as an unparameterised assumption** — in many protocols and formats, SHA-1 was not negotiable and not swappable.

**Damage**: 2017 (Google + CWI): two distinct PDFs with the same SHA-1 digest, at a cost of **~9.2 quintillion SHA-1 computations (~6,500 CPU-years plus 110 GPU-years)** — but **more than 100,000× faster than brute force.** 2020 (Leurent & Peyrin): a **chosen-prefix** collision, the dangerous variant, demonstrated against the **PGP/GnuPG web of trust** to forge a certification, at roughly **$45,000 of rented cloud GPU** at the time — a figure that has only fallen. Consequences: browsers distrusted SHA-1 TLS, Git added collision detection, GnuPG and DNSSEC deprecated it, NIST formally retired SHA-1 in 2022. **The damage is the global migration cost and the retroactive invalidation of every SHA-1 signature — there is no single victim figure.**

**Bearing on Tide**: **Thresholds provide no protection whatsoever against a broken hash.** k-of-n signatures over a colliding digest are k-of-n signatures over the attacker's document. The defence is **crypto-agility**: the ability to change the primitive without changing the protocol, and to re-attest historical signatures under a stronger one. **If your threshold scheme hard-codes a hash or a curve, you have inherited that primitive's entire remaining lifetime as a system-level risk** — which is the honest framing for `T-20`'s post-quantum question, and a fair challenge to put to any Tide deployment: what is the migration path, and has it been exercised?

**Sources**: [Stevens et al., *The first collision for full SHA-1* (PDF)](https://eprint.iacr.org/2017/190.pdf) · [shattered.io](https://shattered.io/) · [Leurent & Peyrin, *SHA-1 is a Shambles*, USENIX Security 2020 (PDF)](https://www.usenix.org/system/files/sec20-leurent.pdf)

**Confidence**: HIGH

---

## BP-CRYPTO-06 — PS3 ECDSA nonce reuse (2010) and BP-CRYPTO-07 — PuTTY CVE-2024-31497 (2024)

Paired: **the nonce is the most fragile part of (EC)DSA, and threshold signing makes it harder, not easier.**

**PS3**: Sony used a **constant** value for the per-signature nonce `k`. Two signatures under the same `k` allow trivial algebraic recovery of the long-term private key. The attacker obtained the **PS3 root code-signing private key** from publicly available signatures — total, unrevocable compromise of a shipped console generation's chain of trust. **No credible dollar figure exists; do not invent one.** (Do not merge with the separate 2011 PlayStation Network breach.)

**PuTTY**: nonces for NIST P-521 were derived such that **the first 9 bits are always zero**. **Full private-key recovery from roughly 60 signatures** via lattice methods. Affects PuTTY 0.68–0.80, FileZilla, WinSCP, TortoiseGit, TortoiseSVN — **~7 years of exposure**. Critically, **the signatures need not be stolen**: any SSH server the user connected to has them, and **so does any public Git host storing SSH-signed commits.** Remediation required not just upgrading but **revoking and replacing every affected P-521 key** — historic signatures cannot be un-published. Fixed by adopting RFC 6979 deterministic nonces.

**Bearing on Tide**: **The single most directly applicable pair for anyone building threshold signatures.** Nonce generation is the primary attack surface, and **distributed nonce generation is where most threshold-ECDSA vulnerabilities have been found — thresholds do not fix nonce failures, they multiply the opportunities for them.** The PuTTY case is sharper still: **the signatures are the leak.** A partial bias in each participant's nonce contribution is not detectable by any participant, is not detectable by verifying the signature, and **accumulates publicly**. "We split the key so no one party has it" is worthless when the key is being reassembled bit-by-bit out of the signature stream. **You must be able to prove nonce quality, not assume it.** Use deterministic nonces where the scheme allows, and treat the nonce protocol as the primary attack surface of the whole design — this is a live review question for Tide's threshold signing and for `T-16`'s determinism requirement.

**Sources**: [fail0verflow — *Console Hacking 2010: PS3 Epic Fail*, 27C3](https://www.youtube.com/watch?v=LP1t_pzxKyE) · [oss-security — PuTTY disclosure](https://www.openwall.com/lists/oss-security/2024/04/15/6) · [PuTTY vendor advisory `vuln-p521-bias`](https://www.chiark.greenend.org.uk/~sgtatham/putty/wishlist/vuln-p521-bias.html) · [CERT-EU 2024-039](https://cert.europa.eu/publications/security-advisories/2024-039/)

**Confidence**: HIGH for both mechanisms; **LOW for any PS3 damage figure** — none was ever published

---

## BP-CRYPTO-08 — Milk Sad / Libbitcoin (2016–2023)

**Single point of failure**: **One 32-bit seed value derived from the clock.** `bx seed` generated wallet entropy using **Mersenne Twister seeded with 32 bits of system time** — so regardless of the requested seed length, real entropy was ~2^32, not 2^128. Every wallet ever generated by it lives in a keyspace of ~4.3 billion, enumerable on consumer hardware in days.

**Damage**: The **complete private key set** for any affected wallet is derivable offline with no interaction with the victim. Researchers documented a **coordinated theft on 12 July 2023** amounting to **millions of dollars across hundreds of victims and multiple blockchains** — though losses attributable specifically to `bx` versus other weak-entropy classes are **not cleanly separable, and the researchers say so.** Losses are unrecoverable.

**Bearing on Tide**: **Splitting a weak secret does not make it strong.** If the master seed had only 32 bits of entropy, sharding it k-of-n across n custodians protects nothing — **the adversary never needs a share, only the search space.** Entropy must be established and verified **at generation time, before any sharing scheme is applied**, and every participant in a distributed key generation must be able to **prove** their contribution was well-sampled rather than merely assert it. Together with `BP-CRYPTO-02`, this is the technical case for verifiable DKG over trusted DKG.

**Sources**: [milksad.info — full disclosure](https://milksad.info/disclosure.html) · [invd blog — researcher write-up](https://blog.inhq.net/posts/milk-sad-vuln1/)

**Confidence**: HIGH for the vulnerability; **MEDIUM for the damage figure** — the researchers' own estimate, explicitly not a precise accounting

---

## BP-CRYPTO-09 — JWT `alg:none` / algorithm confusion as a class

Cross-referenced with `BP-AUTHZ-10` and `BP-AUTHZ-11`; repeated here because the *design* lesson belongs in this category.

**Single point of failure**: **One attacker-controlled header field that selects the verification algorithm.** The protocol handed the choice of "how should you check me" to the thing being checked. No key was ever weak, stolen, or lost — **the verifier simply asked the attacker what to do.**

**Damage**: Authentication bypass as any user including administrators, with no brute force and no key knowledge. **A vulnerability class, not an incident — no aggregate figure exists and none should be cited.** Still a standard penetration-test finding a decade later, and recurring in new implementations (see `BP-AUTHZ-11`, Keycloak 2026).

**Bearing on Tide**: **The most important protocol-design lesson in this category.** Cryptographic strength is irrelevant if the verifier accepts attacker-supplied metadata about which cryptography to apply. Generalised for a threshold system: **never let the request declare its own required threshold, its own signer set, or its own algorithm.** The policy — k, which n, which curve — must be fixed by the **verifier's configuration** and never read from the artifact being verified. And distributing signing authority does nothing at all if the verification path can be told to skip verification. This is a concrete review check for every Tide integration.

**Sources**: [Auth0 — the original 2015 disclosure](https://auth0.com/blog/critical-vulnerabilities-in-json-web-token-libraries/) · [NVD CVE-2015-9235](https://nvd.nist.gov/vuln/detail/CVE-2015-9235)

**Confidence**: HIGH for mechanism; **LOW for any damage quantification**

---

## BP-CRYPTO-10 — ROBOT / Bleichenbacher revival (1998–2017)

**Single point of failure**: **One padding scheme (RSA PKCS#1 v1.5) whose safe use requires the implementation to be perfectly indistinguishable across error paths** — a requirement essentially nobody met for two decades. Any observable difference (error message, timing, connection behaviour) is an adaptive chosen-ciphertext **oracle**.

**Damage**: The researchers demonstrated the attack concretely by **signing a message with the private key of facebook.com's HTTPS certificate** — without extracting the key. Affected at least eight vendors (F5, Citrix, Cisco, Radware, Cavium, Erlang) and **almost a third of the top 100 domains in the Alexa Top 1 Million**, including Facebook and PayPal. **No dollar figure and no confirmed real-world exploitation were published.** TLS 1.3 subsequently **removed RSA key exchange entirely**. Nineteen years of workarounds preceded the fix.

**Bearing on Tide**: **Two hard lessons.** (1) A known-broken construction survives for 19 years because "we patched around it" is cheaper than "we replaced it" — do not let a threshold scheme accumulate patched-around primitives. (2) Sharper: **an oracle attack does not require the key, so splitting the key does not prevent it.** If your k-of-n signers will perform a decryption or signing operation on request and their behaviour differs observably on malformed input, **the adversary uses the quorum itself as the oracle — and having n of them gives n oracles to query in parallel.** Threshold systems must be constant-time and error-uniform **as a group**, which is materially harder than doing it once. Directly relevant to Tide's per-ORK verification gates and to `T-16`.

**Sources**: [Böck, Somorovsky, Young — *ROBOT*, USENIX Security 2018 (PDF)](https://eprint.iacr.org/2017/1189.pdf) · [robotattack.org — vendor and CVE list](https://robotattack.org/) · [F5 advisory CVE-2017-6168](https://community.f5.com/kb/technicalarticles/return-of-bleichenbacher---the-robot-attack-cve-2017-6168/274457)

**Confidence**: HIGH

---

## Excluded records

Deliberately not included, with reason — do not add these back without a primary source:

- **RockYou2021** — a compilation of passwords from prior breaches posted to a forum, not an incident. No victim org, no root cause, and the "8.4 billion passwords" figure traces only to the forum post itself. Not citable.
- **Danish / Swedish public-sector key-escrow failures** — no primary regulator, court or agency document located.
- **Enterprise HSM/KMS key loss causing permanent data loss** — no named organization with a citable post-mortem or filing. `BP-KEYLOSS-07` (Code Spaces) is the closest sourceable analogue, included under its actual facts.
- **Okta availability outages** — Okta's well-documented incidents are *breaches*, not availability events. `BP-AVAIL-07` (Azure AD) makes the IdP-lockout point with a sourced root cause.
- **Android / Bitcoin ECDSA nonce-reuse cases (2013)** — real, but sourced only to mailing-list posts. The point is made at higher confidence by `BP-CRYPTO-06` and `BP-CRYPTO-07`.
- **A named-victim "client-side-only role check bypassed by direct API call"** — the pattern is well attested (`BP-AUTHZ-04`, `BP-AUTHZ-08`, `BP-AUTHZ-12`) but no single named-victim case survived primary-source verification.

## Figures that must never be rounded or restated

These discrepancies are load-bearing. Presenting the wrong side of one is a sourcing error.

| Record | The rule |
|---|---|
| `BP-AUTHZ-01` First American | SEC says **"over 800 million"**. The 885M figure is journalist-sourced. |
| `BP-AUTHZ-03` Facebook | **50M initial / 29M per the DPC.** Cite both with attribution. |
| `BP-CRED-13` Ticketmaster | **560M is an attacker's sale claim**, never confirmed by Live Nation. |
| `BP-CRED-14` National Public Data | **2.9B is rows, not people**, and is a seller's claim; NPD's own filing said 1.3M. |
| `BP-SESS-08` Terpin | **$24M is a plaintiff allegation, not an award.** The $75.8M judgment was a different defendant in a different case. |
| `BP-ADMIN-04` Caesars | **The ~$15M ransom was never confirmed by Caesars.** |
| `BP-CHAIN-05` MOVEit | **$15.8B is an extrapolation** (records × industry average), not a measured cost. |
| `BP-AVAIL-01` CrowdStrike | **Delta's $500M is a litigated claim**, disputed by CrowdStrike. |
| `BP-AVAIL-03` AWS | **$581M is insurance modelling**; "140 services" is secondary, not AWS's count. |
| `BP-CHAIN-10` ASUS | **57,000 is measured; "1 million+" is Kaspersky's extrapolation.** |
| `BP-CHAIN-14` npm chalk/debug | **2 billion weekly downloads is exposure; realised theft was ~$600.** |
| `BP-KEYLOSS-02` Parity, `BP-KEYLOSS-05` Ronin, `BP-KEYLOSS-09` IronKey | **Cite token quantities, not dollar values** — valuations move. |
| `BP-CRED-09` Optus, `BP-CRED-10` Medibank | **Penalties are unresolved. Do not cite a fine figure.** |
| `BP-ADMIN-08` Tesla | **No GDPR fine exists.** Do not cite a theoretical maximum as a consequence. |

---

## Status legend

`VERIFIED` — directly sourced from a primary document listed in the record.
`INFERRED` — the mapping to `SG-xx`/`T-xx` and the `Tide changes` / `Tide does NOT change` fields are pack analysis, not statements by the victim organization. Treat all such fields as INFERRED unless they restate a source.
