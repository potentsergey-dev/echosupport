# Google Cloud VM Demo Deployment

This runbook deploys EchoSupport to one Google Cloud Compute Engine VM with Docker
Compose. It is intended for a temporary public demo on a new Google Cloud trial account:
backend, PostgreSQL, Qdrant, and nginx run on the VM. Start with an external IP, then move
to a domain and HTTPS when the demo is stable.

Official references used for this runbook:

- [Google Cloud: create and start a Compute Engine instance](https://cloud.google.com/compute/docs/instances/create-start-instance).
- [Google Cloud: VPC firewall rules](https://cloud.google.com/firewall/docs/using-firewalls).
- [Google Cloud: reserve or promote a static external IP address](https://cloud.google.com/compute/docs/ip-addresses/reserve-static-external-ip-address).
- [Docker: install Docker Engine on Ubuntu](https://docs.docker.com/engine/install/ubuntu/).

## 1. Create the Google Cloud project

In Google Cloud Console:

1. Create a new project, for example `echosupport-demo`.
2. Link the trial billing account.
3. Enable the Compute Engine API.
4. Pick a region close to your audience. For a small demo, start with one zone in that
   region and avoid premium machine families.

## 2. Create the VM

Recommended starter shape:

- OS: Ubuntu LTS.
- Machine type: 2 vCPU and 4 GB RAM minimum. Use 4 vCPU and 8 GB RAM if indexing or demo
  traffic feels slow.
- Boot disk: 30-50 GB balanced persistent disk.
- Network: default VPC is acceptable for the first demo.
- Firewall: allow HTTP traffic for the VM. This matches `HTTP_PORT=80` below. Keep SSH restricted to your account or trusted
  source IPs where possible.

After creation, note:

- External IP.
- Zone.
- VM name.

For a demo that will live longer than one session, reserve or promote the external IP to a
static address before pointing a domain at it.

## 3. Install Docker on the VM

SSH into the VM from Google Cloud Console and install Docker Engine using Docker's Ubuntu
instructions. A compact command sequence is:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
```

Log out and back in, then verify:

```bash
docker --version
docker compose version
```

## 4. Clone EchoSupport

```bash
git clone https://github.com/potentsergey-dev/echosupport.git
cd echosupport
cp .env.example .env
```

## 5. Configure `.env`

Use `docs/deployment/google-cloud-vm.env.example` as the cloud demo guide. Replace every
placeholder. Generate secrets on the VM:

```bash
openssl rand -base64 48
openssl rand -hex 32
openssl rand -base64 48
```

For the first external-IP launch:

```env
PUBLIC_BASE_URL=http://EXTERNAL_IP
ADMIN_CORS_ORIGINS=http://EXTERNAL_IP
HTTP_PORT=80
ECHOSUPPORT_DEMO_MARKETING_SEED=true
```

If you prefer to keep `HTTP_PORT=8080`, create an explicit ingress firewall rule for TCP 8080 and include `:8080` in `PUBLIC_BASE_URL` and `ADMIN_CORS_ORIGINS`.`r`n`r`nUse a separate OpenRouter API key for the demo and set a low budget limit in OpenRouter.
Leave provider keys empty until you are ready to test real AI answers. Do not paste real
keys into screenshots, issues, pull requests, or chat logs.

## 6. Start the stack

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f backend
```

The backend runs migrations and the idempotent seed before starting. With
`ECHOSUPPORT_DEMO_MARKETING_SEED=true`, the seeded demo agent gets EchoSupport-specific
marketing copy and the allowed origin from `PUBLIC_BASE_URL`. With the flag absent or
`false`, the normal neutral seed is preserved.

## 7. Verify

From the VM:

```bash
curl http://localhost/api/v1/health
curl http://localhost/api/v1/ready
```

From your browser:

```text
http://EXTERNAL_IP/admin
```

Sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`. Open the seeded agent, confirm the
allowed origin matches `PUBLIC_BASE_URL`, and copy the public agent key only in private.

When `INITIAL_OPERATOR_EMAIL` and `INITIAL_OPERATOR_PASSWORD` are set, the seed also creates
or rotates a restricted `OPERATOR` account. Rotation is allowed only when the existing user
already belongs to the demo tenant and has the `OPERATOR` role; conflicting emails stop the
seed. The account can work with Inbox, appointments, and CSAT, but admin API authorization
prevents it from changing agents, provider keys, knowledge sources, specialists, services,
or working hours. Prefer this account for temporary demo access and never share the owner
credentials.

## 8. Test the public demo page

The Docker image includes a customer-facing demo page at the site root:

```text
http://EXTERNAL_IP/
```

The page loads `/embed.js` from the same origin and mounts the live EchoSupport widget.
The committed demo page uses the public demo agent key, and you can temporarily override it
for another agent with:

```text
http://EXTERNAL_IP/?agentKey=pk_your_agent_key
```

Before testing, make sure the agent profile includes this allowed origin:

```text
http://EXTERNAL_IP
```

Ask the widget one of the suggested questions, then open `/admin` and check Inbox for the
conversation. Provider keys stay server-side; the page contains only the public widget key.

Optional local smoke from the VM:

```bash
pnpm install --frozen-lockfile
SMOKE_BASE_URL=http://localhost pnpm smoke:install
```

If you include `SMOKE_AGENT_KEY`, treat terminal output as private because public agent
keys are reusable.

## 9. Domain and HTTPS follow-up

After the external IP demo works:

1. Reserve or promote the VM external IP to static.
2. Point your domain's `A` record to the static IP.
3. Put HTTPS in front of the stack. A simple VM path is Caddy or an outer nginx with
   Let's Encrypt on ports 80 and 443, proxying to the Compose nginx.
4. Update `.env`:

```env
PUBLIC_BASE_URL=https://support.example.com
ADMIN_CORS_ORIGINS=https://support.example.com
HTTP_PORT=80
```

5. Restart backend/nginx:

```bash
docker compose up -d
```

6. Recheck `/api/v1/health`, `/api/v1/ready`, admin login, and widget origin behavior.

## 10. Operations notes

- Back up PostgreSQL before upgrades; see `docs/upgrade.md`.
- Keep the VM stopped when the demo is not needed if you want to conserve trial credits.
- Watch disk usage after uploads and indexing:

```bash
df -h
docker system df
```

- Stop the stack without deleting data:

```bash
docker compose down
```

- Delete volumes only after backup or when intentionally destroying the demo:

```bash
docker compose down --volumes
```

## Troubleshooting

- `docker compose config` fails: replace every required placeholder in `.env`.
- Admin login fails after changing credentials: restart backend; the seed rotates the
  initial owner password from `ADMIN_PASSWORD`.
- Browser cannot reach the app: check the VM firewall allows the selected `HTTP_PORT`.
- Admin requests fail with CORS: `ADMIN_CORS_ORIGINS` must be the exact browser origin,
  with scheme and port, and no path.
- Widget says origin is not allowed: add the widget page origin to the agent profile or
  restart once with `ECHOSUPPORT_DEMO_MARKETING_SEED=true` and correct `PUBLIC_BASE_URL`.
- AI answers fail: add `OPENROUTER_API_KEY` or an agent-specific OpenRouter key and confirm
  the OpenRouter account has credit. If the widget says the configured LLM model is unavailable,
  open the agent Profile and use a current OpenRouter model such as `openai/gpt-4o-mini`, then
  inspect the exact provider error:

  ```bash
  docker compose logs --tail=160 backend
  ```
