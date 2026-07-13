# AWS RDS PostgreSQL — complete guide

**Project:** Production Monitoring & Inventory Management (multi-tenant SaaS)
**Database:** PostgreSQL 18 on AWS RDS (external managed — _not_ a Catalyst service)
**Companion docs:** `DEPLOYMENT_ZOHO_CATALYST.md`, `ARCHITECTURE_AND_TECH_STACK.md`, `PRISMA.md`
**Last updated:** 2026-07-13

> **Purpose.** How to create an AWS RDS PostgreSQL database from nothing, keep it inside the free
> tier, and connect to it from all three places this project needs: a **developer laptop**, an
> **external server outside AWS**, and **Zoho Catalyst** (AppSail + Functions).
>
> Written for someone who has never opened the AWS console. Start at §1 and read straight through.
> Every setting that can silently cost money is called out with a 💸, and every setting that affects
> whether you can connect at all is called out with a 🔌.

---

## 1. The mental model (read this first)

Four separate things get confused constantly. They are not the same, and mixing them up is the cause
of almost every "I can't connect" problem.

```
   ┌──────────────────────────────────────────────────────────────┐
   │  VPC  (vpc-0386ce…)          ← the private network            │
   │                                                                │
   │   ┌────────────────────────────────────────────────────┐      │
   │   │  Security group (jobwork-db-sg)  ← the firewall     │      │
   │   │                                                      │      │
   │   │   ┌──────────────────────────────────────────┐      │      │
   │   │   │  DB instance (jobwork-db-dev)             │      │      │
   │   │   │  ← the running PostgreSQL SERVER          │      │      │
   │   │   │                                            │      │      │
   │   │   │    ┌───────────┐  ┌───────────┐           │      │      │
   │   │   │    │ jobwork   │  │ postgres  │  ← DATABASES     │      │
   │   │   │    └───────────┘  └───────────┘           │      │      │
   │   │   └──────────────────────────────────────────┘      │      │
   │   └────────────────────────────────────────────────────┘      │
   └──────────────────────────────────────────────────────────────┘
```

| Thing               | What it actually is                                                            | Example                                              |
| ------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------- |
| **VPC**             | A private network inside AWS. Your DB lives in it. You don't configure it.     | `vpc-0386ce6ceaf8888cf`                              |
| **Security group**  | A firewall. Decides **who is allowed to open a connection**. You configure it. | `jobwork-db-sg`                                      |
| **DB instance**     | The running PostgreSQL **server**. Billed per hour. Has one endpoint.          | `jobwork-db-dev`                                     |
| **Database**        | A logical database **inside** the server. Free. You can have many.             | `jobwork`, `postgres`                                |
| **Endpoint**        | The **hostname** of the server. Public info, not a secret.                     | `jobwork-db-dev.abc123.ap-south-1.rds.amazonaws.com` |
| **Master password** | The **credential**. Secret. Shown once, never again.                           | _(in your password manager)_                         |

> **The single most common confusion:** "Database created successfully" means the **instance** (the
> server) was created. It does **not** mean a database named `jobwork` exists inside it. Those are
> two different things — see §4.6.

> **The second most common confusion:** the **endpoint is not the password**. The endpoint tells you
> _where_ the server is; the password proves you're _allowed in_. You need both, and AWS shows them
> on different screens (the endpoint forever, the password exactly once).

---

## 2. Free tier — the honest situation

⚠️ **Read this before you assume anything is free.**

As of 2026, AWS runs **two different free-tier models**, and which one you're on depends on when your
account was created:

| Model                      | What you get                                                         |
| -------------------------- | -------------------------------------------------------------------- |
| **Old (legacy accounts)**  | 12 months of always-free monthly allowances (750 instance-hours/mo…) |
| **New "Free Plan" (2026)** | A 6-month window and a credit balance (~$200) that gets consumed     |

**These behave completely differently.** On the old model, staying under the monthly limits costs
nothing indefinitely. On the new model you are **spending credits**, and when they run out (or the
window closes), charges begin.

### 👉 Do this before anything else

1. AWS Console → **Billing and Cost Management** → **Free tier**.
2. Look at what it shows you:
   - **Usage percentages against monthly limits** → you're on the **old** model.
   - **A remaining credit balance** → you're on the **new Free Plan**.

Knowing which one you're on is the difference between "this is free" and "this is free for now."

> **This guide cannot tell you which model your account is on.** Nobody can except the console. If
> your requirement is genuinely _zero rupees_, check it — it takes thirty seconds, and every other
> precaution in this document is built on that answer.

### The free-tier allowances (old model)

| Resource       | Free allowance                     | What breaks it                                         |
| -------------- | ---------------------------------- | ------------------------------------------------------ |
| Instance hours | 750 hrs/month of `db.t3/t4g.micro` | A **second** instance, or Multi-AZ (doubles the hours) |
| Storage        | 20 GB                              | **Storage autoscaling** growing past 20 GB             |
| Backups        | Up to your DB size                 | Retaining snapshots after deleting the instance        |

750 hours ≈ one instance running 24×7 for a month. So **one** instance left running is fine. **Two**
is not — and that is exactly what happens when you switch regions and forget the old one (§3.3).

---

## 3. Choosing a region (do this before you create anything)

### 3.1 Region matters for speed

The region is a **physical location**. Queries travel there and back on every request.

| Your region              | Round-trip from India | Verdict                          |
| ------------------------ | --------------------- | -------------------------------- |
| `ap-south-1` (Mumbai)    | ~10–30 ms             | ✅ **Use this**                  |
| `eu-north-1` (Stockholm) | ~150 ms               | ❌ Every query pays a 150 ms tax |

Free tier applies in **any** region, so there is no cost reason to pick a far one. Pick Mumbai.

> Ideally the database sits in the same region as the compute that talks to it. Our compute is on
> **Zoho Catalyst**, not AWS, so we can't co-locate perfectly — but Catalyst's Indian data centre and
> `ap-south-1` are both in India, which is as close as this architecture gets.

### 3.2 🔌 You cannot change the region later

The region is baked into the instance at creation. It is **not** editable, and you **cannot** fix it
by editing the endpoint hostname. If you created it in the wrong region, you delete it and recreate.

### 3.3 💸 The region-switch trap

The **region selector in the top-right of the console only changes what you are looking at.** It does
not move anything.

If you switch from Stockholm to Mumbai, your Stockholm instance **disappears from the list** — but it
is still running, and still burning instance-hours. People then create a fresh instance in Mumbai and
end up paying for **two**.

**Correct order:**

1. **Delete** the instance in the old region (while still viewing that region).
2. **Then** switch the region selector.
3. **Then** create the new one.

**To delete:** RDS → Databases → select it → **Actions → Delete**.

- If it refuses: Modify → uncheck **Enable deletion protection** → Apply immediately → retry.
- In the dialog: 💸 **uncheck "Create final snapshot"** and 💸 **uncheck "Retain automated backups."**
  Both leave storage behind that **outlives the instance and is not covered by its free tier.**
- Type `delete me` to confirm.
- **Wait until it is gone from the list.** Status passes through `deleting`.

---

## 4. Creating the instance, field by field

### 4.1 Finding RDS — "Aurora and RDS" is the right link

Search `RDS` in the console and you'll see **"Aurora and RDS"**. That looks like two services. It is
**one** — AWS renamed the console entry. Click it.

**Aurora vs RDS is a choice you make later**, at the engine step, not here.

### 4.2 Create database → **Standard create**

Do **not** pick "Easy create" — it hides the free-tier template and picks its own settings.

### 4.3 Engine options → **PostgreSQL**

You'll see a grid of tiles:

```
  ┌─────────────────────────┐  ┌─────────────────────────┐
  │ Aurora (MySQL)          │  │ Aurora (PostgreSQL)     │   ❌ NOT these
  └─────────────────────────┘  └─────────────────────────┘
  ┌─────────────────────────┐  ┌─────────────────────────┐
  │ MySQL                   │  │ PostgreSQL         ✅    │   ← this one
  └─────────────────────────┘  └─────────────────────────┘
```

Pick the tile that says **just "PostgreSQL"**. The Aurora tiles say "Aurora" explicitly.

> 💸 **Aurora has no free tier.** Its smallest instance is `db.t3.medium`, not `db.t3.micro`. If the
> **Free tier** template in the next step is greyed out or missing, you have an Aurora engine
> selected. Go back.

**Engine version:** the default is fine. We use **18.3**.

> 💸 **RDS Extended Support** — this is a real charge that surprises people. If you pick a PostgreSQL
> major version that is past its community end-of-life, AWS auto-enrols you in Extended Support,
> which bills **per vCPU-hour** and is **not** free tier. PostgreSQL 18 is current and years from
> EOL, so we're clear. **Do not pick an old major version to "be safe" — that is what triggers it.**

### 4.4 Templates → **Free tier**

This auto-restricts the rest of the form to free-eligible options. If it's not selectable, see the
Aurora warning above.

Selecting Free tier also forces **Availability and durability** to _Single DB instance_ — which is
what you want. 💸 Multi-AZ creates a standby and **doubles your instance-hours**.

### 4.5 Settings

| Field                      | Value            | Why                                                                                                                                                                                                                 |
| -------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DB instance identifier** | `jobwork-db-dev` | The AWS-level name of the **server**, not a database. Lowercase/digits/hyphens. Appears in the endpoint. Include the environment now — you'll want `jobwork-db-prod` beside it later, and you can't rename cleanly. |
| **Master username**        | `postgres`       | The PostgreSQL convention. Avoid `admin` (that's the MySQL habit). `rdsadmin` is **reserved** by AWS and will be rejected.                                                                                          |

**Credential management** — three options:

| Option                             | Verdict                                                                                                                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Self managed**                   | ✅ **Pick this.** You type a password and store it. Free.                                                                                                               |
| Managed in **AWS Secrets Manager** | 💸 **Not free tier.** Roughly $0.40/month per secret + API calls. Great for production, but it will quietly put you on a bill. _(Verify current pricing — it changes.)_ |
| **IAM database authentication**    | No password; short-lived IAM tokens. Excellent for AWS-hosted compute, but our compute is on **Catalyst, outside AWS**, which makes this awkward. Skip.                 |

> **"Auto generate a master password"** is fine — but it is shown **exactly once**, on a
> **View credential details** banner right after creation. Miss it and it's unrecoverable. Simpler
> for a first run: type your own, and paste it straight into your password manager.
>
> **Lost the password?** It is genuinely unrecoverable — don't go hunting. Instance → **Modify** →
> Master password → new one → **Apply immediately**. A password change does **not** restart the
> instance.

### 4.6 🔌 Additional configuration → **Initial database name** ← easy to miss

Scroll down to **Additional configuration** (it's collapsed, near the bottom) and set:

**Initial database name:** `jobwork`

**This is creation-only.** It does not appear under Modify, and you cannot add it retroactively
through the console.

**If you left it blank** (which is easy to do), the instance still works — PostgreSQL always has its
built-in `postgres` database. You just have to create yours with SQL:

```bash
psql "postgresql://postgres:YOUR_PASSWORD@YOUR_ENDPOINT:5432/postgres?sslmode=require"
```

```sql
CREATE DATABASE jobwork;
```

Then `\q` and reconnect with `/jobwork` on the end instead of `/postgres`.

> **Why this matters later:** in PostgreSQL, a connection is bound to **exactly one** database. You
> cannot query across databases in one connection (unlike MySQL's `other_db.some_table`). So
> `jobwork` and `postgres` are fully isolated. When you later want a test database, the right move is
> a **second database on the same server** (`jobwork_test`) — 💸 **not** a second RDS instance, which
> would blow the free tier.

---

## 5. 💸 The settings that cost money — checklist

Set these **at creation**. Fixing them afterwards in Modify works, but it's easy to forget one.

| Setting                       | Set to                       | What happens if you don't                                                                                                                                                                                         |
| ----------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Storage autoscaling**       | ❌ **OFF**                   | ⚠️ **The dangerous one.** Silently grows past the 20 GB free limit, and you find out on the bill.                                                                                                                 |
| **Allocated storage**         | 20 GB                        | Above 20 GB is billed.                                                                                                                                                                                            |
| **Instance class**            | `db.t3.micro`/`db.t4g.micro` | Anything larger is billed. (Aurora starts at `db.t3.medium` — a tell you picked Aurora.)                                                                                                                          |
| **Multi-AZ**                  | Single DB instance           | A standby **doubles** instance-hours.                                                                                                                                                                             |
| **Performance Insights**      | ❌ OFF                       | Free at the **default 7-day** retention, but **billed if you raise it.** Just turn it off — it's a monitoring dashboard, has **zero effect on how the DB runs**, and can be re-enabled anytime without a restart. |
| **Enhanced monitoring**       | ❌ OFF                       | Ships OS metrics to CloudWatch Logs at up to 1-second granularity; can chew through the CloudWatch free allowance.                                                                                                |
| **Log exports to CloudWatch** | ❌ all unchecked             | Same reason.                                                                                                                                                                                                      |
| **Backup retention**          | Leave default (7 days)       | Backup storage **up to your DB size is free** — don't set it to 0.                                                                                                                                                |
| **Deletion protection**       | ❌ OFF (while learning)      | If ON, deleting requires a separate Modify step first — and you **do** want deleting to be easy.                                                                                                                  |
| **Extended Support**          | Avoid via current version    | See §4.3. Billed per vCPU-hour.                                                                                                                                                                                   |

### 💸 The two things that actually protect you

Checkboxes tell you what you _intended_. These tell you what's _happening_:

1. **Set a zero-spend budget alert.** Billing → **Budgets** → **Create budget** → **Zero spend
   budget** template → your email. AWS will **not stop** the charge, but you'll know within a day
   instead of at month-end. **This is the only mechanism that will actually warn you.**
2. **Delete the instance when you're done experimenting.** 💸 **RDS bills per instance-hour whether
   or not you ever connect to it.** An idle database costs exactly as much as a busy one.

---

## 6. Networking — why you still can't connect

You have a running database with a valid endpoint and the correct password, and your connection
**hangs and then times out**. This is the single most common place people get stuck.

**The endpoint resolving does not mean you can reach it.** Two things gate that:

### 6.1 🔌 Public accessibility

| Setting | Meaning                                                                                           |
| ------- | ------------------------------------------------------------------------------------------------- |
| **Yes** | The DB gets a **public IP** and is reachable from the internet — _subject to the security group_. |
| **No**  | Only reachable from **inside the VPC**. Your laptop and Catalyst cannot reach it, ever.           |

Because our clients are a **laptop**, an **external server**, and **Zoho Catalyst** — none of which
are inside the AWS VPC — this **must be Yes**. See §7 for what that costs you in security.

This is under Modify → Connectivity. It is **not** a billing setting.

### 6.2 🔌 The security group — the firewall

A **security group** is a stateful virtual firewall attached to your database's network interface. It
contains **only allow rules** — there is no "deny." Anything not explicitly allowed is **silently
dropped**.

> **That silence is why a bad security group produces a _hang and timeout_ rather than a clear
> "permission denied."** Your packets are discarded, so your client waits for a reply that never
> comes. **If a connection hangs, suspect the security group first — not your password.**

**Where it lives:** the security group is _selected_ in **RDS → Modify → Connectivity**. But its
**rules** are edited in the **EC2 console** → **Security Groups** (left sidebar).

> **"Why EC2? I never purchased EC2 — will I be charged?"**
>
> **No.** Security groups are **VPC networking objects** that RDS, EC2, and Lambda all share. AWS
> just happens to put the UI inside the EC2 console for historical reasons. **Creating, editing, and
> attaching security groups is free, always.** Nothing on that screen provisions a server.
>
> 💸 What _does_ cost money in the EC2 console: the orange **Launch instance** button, an **Elastic
> IP** left unattached, and above all a **NAT Gateway** (~$32/month — the classic surprise). Don't
> click those. Go to Security Groups, do your thing, leave.

### 6.3 🔌 Don't use the `default` security group

Every VPC is created with a `default` security group. You didn't make it; it isn't there for your
database. **Leave its rules alone.**

Two reasons to create your own:

1. **`default`'s stock rule allows traffic only from resources already in the `default` group** — a
   self-reference. **It does not allow your laptop.** So out of the box, you cannot connect.
2. **`default` is inherited automatically** by every future resource in the VPC that doesn't name its
   own group. Punching a world-open hole in it means the next EC2 box or Lambda someone spins up
   **silently inherits it**. That's how these things go wrong quietly.

You also **cannot delete** the `default` group — AWS won't let you. It will always sit there as a
trap for anything that forgets to choose.

**Create a dedicated one:**

1. EC2 → **Security Groups** → **Create security group**
2. Name: `jobwork-db-sg`
3. 🔌 **VPC: `vpc-0386ce6ceaf8888cf`** ← the VPC your DB is in. If you have several VPCs the dropdown
   preselects the account default, which may be the wrong one. If you have only one VPC it's already
   correct — just confirm the ID matches.
4. **Inbound rule:** Type **PostgreSQL** (port auto-fills to **5432**) → Source → see §7
5. Leave outbound alone → **Create**

**Attach it:** RDS → Databases → your instance → **Modify** → Connectivity → **Security group** →
select `jobwork-db-sg`, **deselect `default`** → Continue → **Apply immediately**.

Security group changes take effect **immediately** and do **not** restart the instance.

> ✅ **Verify:** instance → **Connectivity & security** tab → it should list **`jobwork-db-sg` only**.
> If both are attached, **rules are additive** — the DB is reachable if _either_ group allows it,
> which defeats the whole point.

---

## 7. The three clients — and the hard decision

This project needs the database reachable from three places with very different network shapes:

| Client                        | Where it connects from | Egress IP            |
| ----------------------------- | ---------------------- | -------------------- |
| **Developer laptops**         | Home / office ISP      | Dynamic, changes     |
| **External server (non-AWS)** | Wherever it's hosted   | Usually static ✅    |
| **Zoho Catalyst** (AppSail)   | Zoho's infrastructure  | ❓ **Unknown to us** |

### 7.1 The tight option — allowlist specific IPs

Add one inbound rule per known source: Type **PostgreSQL**, Source **My IP** (`/32`) for each
developer, plus the server's static IP.

- ✅ Genuinely secure.
- ❌ Home ISPs hand out **dynamic** addresses, so developer rules go stale and connections start
  timing out mysteriously. Someone has to re-edit the rule. If your team has an office with a static
  IP, use that and it stops being a chore.
- ❌ **The blocker: we do not know whether Zoho Catalyst publishes a stable, documented set of
  outbound egress IP ranges.** This has not been verified. If it does, allowlist them and you're in
  good shape. **This is worth researching before production** — it's the one fact that would let us
  close the database back down.

### 7.2 The open option — what this project currently does

Source **Anywhere-IPv4** (`0.0.0.0/0`) on port 5432.

**This is a deliberate, informed tradeoff for a _development_ database**, chosen because Catalyst's
egress ranges are unknown. Be clear-eyed about what it means:

> ⚠️ **An internet-exposed PostgreSQL on 5432 gets found by automated scanners within hours and
> brute-forced against the `postgres` username.** You _will_ see failed login attempts in the logs.
> That is expected and is not, by itself, a breach.

**Because the port is open, the mitigations in §8 are not optional garnish — they _are_ the security
model.** Do all four.

> 🔒 **Before real production data lands in this database, revisit §7.1.** An open 5432 is acceptable
> for dev. It is not a good permanent answer.

---

## 8. Hardening an internet-exposed database (mandatory)

### 8.1 Force TLS with a custom parameter group

The **default** parameter group is read-only, so you need your own. **Parameter groups are free.**

1. RDS → **Parameter groups** → **Create parameter group**
   - Engine type **PostgreSQL**, family **postgres18**, name `jobwork-pg18`
2. Select it → **Edit** → search `rds.force_ssl` → set to **1** → **Save**
3. RDS → Databases → instance → **Modify** → Additional configuration → **DB parameter group** →
   `jobwork-pg18` → Continue → **Apply immediately**
4. 🔌 **Actions → Reboot.** **A parameter group does not take effect until you reboot.** ~1 minute.
5. ✅ Verify: Configuration tab shows the parameter group as **`in-sync`**, not `pending-reboot`.
   **Until it says `in-sync`, TLS is not being enforced.**

**Prove it worked** — this must be **rejected**:

```bash
psql "postgresql://postgres:PW@YOUR_ENDPOINT:5432/jobwork?sslmode=disable"
```

If it connects, the reboot didn't apply.

### 8.2 A long random password

With 5432 open, this password is the **only** thing between the internet and your data. Generate a
real one (alphanumeric, so it won't break when embedded in a URL):

```powershell
# PowerShell
-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 32 | ForEach-Object {[char]$_})
```

RDS → Modify → Master password → paste → **Apply immediately**. No restart. **Never relax this.**

### 8.3 Don't let the app use the master user

`postgres` is a **superuser**, and it's the first username every scanner tries. Give the application
its own least-privilege role. Connect as master **once**:

```bash
psql "postgresql://postgres:MASTER_PW@YOUR_ENDPOINT:5432/jobwork?sslmode=require"
```

```sql
CREATE ROLE jobwork_app LOGIN PASSWORD 'ANOTHER_RANDOM_32_CHARS';
GRANT CONNECT ON DATABASE jobwork TO jobwork_app;
GRANT USAGE, CREATE ON SCHEMA public TO jobwork_app;
```

> 🔌 **That last `GRANT ... ON SCHEMA public` is required on PostgreSQL 15+.** The `public` schema no
> longer grants `CREATE` to everyone by default, and without it **your Prisma migrations will fail**
> with a confusing permission error.

The app (Catalyst + developers) uses **`jobwork_app`**. The **master password goes in a password
manager** and is used for admin tasks only.

### 8.4 Never `rejectUnauthorized: false`

See §9.3. If certificate verification fails, **fix the CA path** — do not turn verification off. That
leaves the connection encrypted but **unauthenticated**, so anything able to intercept the route can
impersonate your database.

---

## 9. TLS and the CA bundle — the part that wastes a day

This section documents a **hard-won, verified finding** in this repo. Read it before you touch
`backend/src/db/prisma.ts`.

### 9.1 `sslmode` means different things in different clients

| `sslmode`     | psql                                   | node-postgres (`pg`)               |
| ------------- | -------------------------------------- | ---------------------------------- |
| `disable`     | No TLS                                 | No TLS                             |
| `require`     | **Encrypts, does NOT verify the cert** | **Encrypts AND verifies the cert** |
| `verify-full` | Encrypts + verifies cert + hostname    | —                                  |

**This asymmetry is the trap.** `sslmode=require` works fine in `psql` and then fails in Node with:

```
self-signed certificate in certificate chain
```

Nothing is wrong. `pg` is verifying the certificate — correctly — and **Node's trust store has no
Amazon root CA**.

### 9.2 The fix: supply Amazon's CA bundle

The bundle is **public**, holds no secrets, and **is committed to this repo**:

```
backend/certs/rds-ap-south-1-bundle.pem
```

Refresh it (or get a different region's) from **<https://truststore.pki.rds.amazonaws.com/>**.

For `psql`, real verification looks like this — note `verify-full`, which checks the chain **and**
that the hostname matches:

```bash
psql "postgresql://jobwork_app:PW@YOUR_ENDPOINT:5432/jobwork?sslmode=verify-full&sslrootcert=backend/certs/rds-ap-south-1-bundle.pem"
```

> If `verify-full` fails but `require` works, **your certificate path is wrong.** Do not "fix" it by
> downgrading to `require`.

### 9.3 🔌 The `sslmode` / `pg` conflict — the non-obvious one

**`pg` parses `sslmode` out of the connection string into its own SSL config, which then REPLACES the
`ssl` object you passed in** — silently dropping your CA. Verification then fails against Node's
empty trust store.

So `backend/src/db/prisma.ts` **strips `sslmode` from the URL** before handing it to the pool, and
passes the CA explicitly:

```ts
// Verified: WITH sslmode the connection is refused; WITHOUT it (and with the
// CA passed explicitly) it succeeds.
function toPoolConnectionString(databaseUrl: string): string {
  if (!env.databaseSslCaPath) return databaseUrl;
  const url = new URL(databaseUrl);
  url.searchParams.delete('sslmode'); // ← or pg discards our CA
  return url.toString();
}

const adapter = new PrismaPg({
  connectionString: toPoolConnectionString(env.databaseUrl),
  ssl: { ca: readFileSync(...), rejectUnauthorized: true },
  max: 5,
});
```

**`DATABASE_URL` still keeps `sslmode=require`** — because that's the form RDS hands you, the form
`psql` expects, and the form the **Prisma CLI** (`migrate`, `db pull`) needs. The CLI uses its own
engine, **not** this adapter. Only the runtime pool strips it.

---

## 10. Wiring it into this project

### 10.1 `backend/.env`

```bash
# Runtime uses jobwork_app (least privilege) — NOT the postgres master user.
DATABASE_URL="postgresql://jobwork_app:PASSWORD@jobwork-db-dev.xxxx.ap-south-1.rds.amazonaws.com:5432/jobwork?sslmode=require"

# Amazon's public CA bundle. Committed; holds no secrets.
DATABASE_SSL_CA_PATH="./certs/rds-ap-south-1-bundle.pem"
```

`backend/.env` is **gitignored**. `backend/.env.example` is committed and holds **placeholders only**
— never a real password, secret, or hostname.

`backend/src/config/env.ts` validates both at boot with Zod and **crashes on startup** if
`DATABASE_URL` is missing, rather than failing later at the first query.

### 10.2 Connection pooling — 🔌 don't skip this

```ts
max: 5;
```

**AppSail runs many short-lived instances of the backend.** A `db.t3.micro` has a **low
`max_connections` limit** (roughly 80–110 depending on memory — check `SHOW max_connections;`). If
every instance opens a large pool, **the database runs out of connections** and everything starts
failing. Keep the per-instance cap small. See `ARCHITECTURE_AND_TECH_STACK.md` §6.

### 10.3 Zoho Catalyst

- **AppSail** reads the same `DATABASE_URL` / `DATABASE_SSL_CA_PATH` from its **environment
  variables** — set them in the Catalyst console, not in a committed file.
- The **CA bundle must ship with the deployment** — it's inside `backend/`, so it deploys with the
  AppSail component. `DATABASE_SSL_CA_PATH` is resolved relative to `process.cwd()`.
- ❓ **Catalyst's outbound egress IPs are unknown to us** (§7). This is why 5432 is currently open to
  `0.0.0.0/0`. **Verify this before production.**

---

## 11. Verification checklist

Run these **in order**. Each one isolates a different failure.

```bash
# 1. Is the port reachable at all?  (PowerShell — tests network, not credentials)
Test-NetConnection jobwork-db-dev.xxxx.ap-south-1.rds.amazonaws.com -Port 5432
#    ❌ fails → security group / public accessibility (§6)

# 2. Do the credentials work?
psql "postgresql://jobwork_app:PW@YOUR_ENDPOINT:5432/jobwork?sslmode=require"
#    ❌ "password authentication failed" → network is FINE, password is wrong.
#       This is PROGRESS: the security group is doing its job.

# 3. Is TLS actually enforced?  (this must be REJECTED)
psql "postgresql://jobwork_app:PW@YOUR_ENDPOINT:5432/jobwork?sslmode=disable"
#    ❌ connects → the parameter-group reboot didn't apply (§8.1)

# 4. Does the certificate chain verify?
psql "postgresql://jobwork_app:PW@YOUR_ENDPOINT:5432/jobwork?sslmode=verify-full&sslrootcert=backend/certs/rds-ap-south-1-bundle.pem"

# 5. Does the app connect?
cd backend && npx prisma migrate dev
```

---

## 12. Troubleshooting

| Symptom                                                | Cause                                                                                       | Fix                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------- | --------------------------------------------- |
| **Connection hangs, then times out**                   | Security group (packets silently dropped). **Most common.**                                 | §6.2 — inbound rule, PostgreSQL/5432          |
| Hangs, and the SG looks right                          | **Public accessibility = No**                                                               | Modify → Connectivity → Yes                   |
| Hangs, SG right, public = Yes                          | Rule is **outbound** instead of inbound; or the SG is attached to the wrong VPC             | §6.3                                          |
| `password authentication failed`                       | **Network is fine.** Wrong password.                                                        | Modify → Master password → Apply immediately  |
| `self-signed certificate in certificate chain` (Node)  | `pg` verifies certs; Node has no Amazon CA                                                  | §9.2 — set `DATABASE_SSL_CA_PATH`             |
| Cert error persists **even with** the CA set           | **`pg` parsed `sslmode` and discarded your CA**                                             | §9.3 — strip `sslmode` for the pool           |
| `database "jobwork" does not exist`                    | Left **Initial database name** blank                                                        | §4.6 — `CREATE DATABASE jobwork;`             |
| `permission denied for schema public` during migration | PG 15+ removed the default `CREATE` grant                                                   | §8.3 — `GRANT USAGE, CREATE ON SCHEMA public` |
| `sorry, too many clients already`                      | Too many pool connections × too many AppSail instances                                      | §10.2 — lower `max`                           |
| **Free tier** template greyed out                      | You selected an **Aurora** engine                                                           | §4.3 — pick plain **PostgreSQL**              |
| Instance vanished after switching region               | It didn't. You're **looking** at a different region — 💸 **it's still running and billing** | §3.3                                          |
| TLS not enforced despite `rds.force_ssl = 1`           | Parameter group needs a **reboot**                                                          | §8.1 — check status is `in-sync`              |

---

## 13. Known unknowns

Stated plainly, so nobody mistakes a guess for a fact:

1. ❓ **Does Zoho Catalyst publish stable outbound egress IP ranges?** **Unverified.** This is the
   single fact that determines whether §7.1 (tight allowlist) is possible, or whether we're stuck
   with §7.2 (open 5432 + hardening). **Worth researching before production.**
2. ❓ **Which free-tier model is this AWS account on?** Old always-free, or the 2026 credit-based Free
   Plan? Only **Billing → Free tier** in the console can tell you (§2). Everything in §5 assumes you
   have checked.
3. ❓ **AWS Secrets Manager pricing** (~$0.40/secret/month) is from memory and **changes**. Verify on
   the pricing page before enabling it.
4. ⚠️ **The open 5432 in §7.2 is a development-grade decision.** It is documented as a deliberate
   tradeoff, **not** endorsed as a production posture.
