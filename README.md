# SportBoss

SportBoss is a single-user, mobile-first fitness app. It runs with Node.js 24, SQLite and a static frontend. The included catalog contains 112 exercises and their embedded images from home_exercise_catalog.xlsx. The workbook itself is only needed to regenerate the catalog.

## Open with Docker Desktop

Start Docker Desktop and wait for the engine to be ready. In the project folder, create a local configuration if you don't already have one.

~~~powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
~~~

Start the containers.

~~~powershell
docker compose up -d --build --remove-orphans --wait
~~~

Open http://localhost:8787. Sign-in is disabled by default. Docker includes the Node.js runtime and stores your workout history in the `fitness-data` volume.

To enable sign-in later, set APP_PASSWORD in `.env` and apply the change with `docker compose up -d`. The username defaults to `form` and can be changed with APP_USER.

~~~powershell
docker compose stop
~~~

Run `docker compose start` to resume using the same containers and data.

## Deploy to a Raspberry Pi 5

Use a 64-bit Raspberry Pi OS installation with Docker Engine and the Docker Compose plugin. Copy this project directory to the Pi and run these commands there.

~~~sh
uname -m
umask 077
cp .env.example .env
~~~

The Pi should report aarch64. The official Node image resolves to the Pi's native ARM64 build. [Docker Node image](https://hub.docker.com/_/node)

~~~sh
docker compose up -d --build --remove-orphans --wait
docker compose ps
curl --fail http://127.0.0.1:8787/healthz
~~~

SportBoss runs the web app and optional Telegram reminders in one container on port 8787. The container runs as a non-root user with a read-only filesystem, a health check, and automatic restarts after process exits. When upgrading from the two-container setup, `--remove-orphans` removes the old reminders container. Keep the Compose project name stable so the app continues using the same `fitness-data` volume.

### Secure access from your phone

Compose publishes the port on the Pi's loopback interface. Keep it there and use a private HTTPS reverse proxy. One option is Tailscale Serve with the Pi and phone joined to the same tailnet.

~~~sh
sudo tailscale serve --bg 8787
tailscale serve status
~~~

Use the displayed HTTPS URL from your phone. Set APP_URL in .env to that same URL for Telegram. Restrict tailnet access to your own devices, keep the Pi and Docker patched, and avoid forwarding the app port from your router. With another HTTPS reverse proxy, preserve the original Host header so the API can verify same-origin writes. [Tailscale Serve documentation](https://tailscale.com/docs/reference/tailscale-cli/serve)

### Automatic deployment from GitHub Actions

The **Test and deploy SportBoss** workflow runs tests on pull requests to `main`. After setup, successful pushes to `main` deploy over your tailnet. The Pi builds the tested commit with Docker Compose and checks the app before marking the release current. You can also run the workflow from the Actions tab with `main` selected.

**On the Raspberry Pi**

1. Use a non-root account that can run `docker compose` on the same Docker daemon as your current SportBoss deployment. Enable OpenSSH if it is not already running. Use its port, usually 22. If Tailscale SSH already handles port 22, use a separate OpenSSH port and match it in the tailnet grant and GitHub variable. The workflow uses standard SSH keys over Tailscale. [Connect over SSH with Tailscale](https://tailscale.com/docs/how-to/connect-ssh-linux-vm)
2. Run `tailscale ip -4` for the Pi's private address and `docker compose ls --all` for the existing project name. If the project has been removed, check `docker volume ls` for the prefix of its `_fitness-data` volume. Use that exact project name to keep access to your workout database. A fresh deployment can use the default project name `sportboss`.
3. Create `~/sportboss-deploy` and install your current app configuration there. For a fresh Pi, start with `.env.example` and configure the options you use.

   ~~~sh
   install -d -m 700 "$HOME/sportboss-deploy"
   install -m 600 /path/to/current/sportboss/.env "$HOME/sportboss-deploy/.env"
   ~~~

4. Generate a dedicated SSH key outside the repository, for example with `ssh-keygen -t ed25519 -f ~/.ssh/sportboss-actions`. Leave its passphrase empty for unattended deployment. Add the **public** key to the Pi account's `~/.ssh/authorized_keys` with the prefix `restrict `. Add the **private** key to GitHub as the secret listed below.
5. From a trusted Pi terminal, get its OpenSSH host public key with `sudo cat /etc/ssh/ssh_host_ed25519_key.pub`. In the GitHub known-hosts secret, put the Pi's Tailscale IP followed by the public key type and key, for example `100.101.102.103 ssh-ed25519 AAAA…`. For a custom port, use the form `[100.101.102.103]:2222 ssh-ed25519 AAAA…`.

**In Tailscale**

Create the runner tag and add a grant for only the Pi's OpenSSH port. Merge the entries below into your existing policy. Replace the example IP and port. Review any existing wildcard rules that would also grant access to this new tag. The Pi can keep its existing Tailscale identity and Serve configuration. [Tailscale grants syntax](https://tailscale.com/docs/reference/syntax/grants)

~~~json
{
  "tagOwners": { "tag:sportboss-ci": ["autogroup:admin"] },
  "grants": [
    { "src": ["tag:sportboss-ci"], "dst": ["100.101.102.103"], "ip": ["tcp:22"] }
  ]
}
~~~

Create a federated **OpenID Connect** credential in Tailscale under **Trust credentials**. Select GitHub Actions as the issuer and grant **Auth Keys → Write** for `tag:sportboss-ci`. Enter your repository's exact `main` subject. For repositories using immutable subject claims, use `repo:OWNER@OWNER-ID/REPO@REPO-ID:ref:refs/heads/main`. For older repositories using the previous format, use `repo:OWNER/REPO:ref:refs/heads/main`. Repositories created, renamed or transferred after July 15, 2026 use the immutable format by default. Copy the generated Client ID and Audience. [Tailscale workload identity setup](https://tailscale.com/docs/features/workload-identity-federation) [GitHub OIDC subject format](https://docs.github.com/en/actions/reference/security/oidc#immutable-subject-claims)

**In your existing GitHub repository**

Under **Settings → Secrets and variables → Actions**, add these repository settings.

| Name | Type | Value |
| --- | --- | --- |
| `SPORTBOSS_PI_HOST` | Variable | Pi's Tailscale IPv4 address |
| `SPORTBOSS_PI_USER` | Variable | Non-root SSH account on the Pi |
| `SPORTBOSS_PI_SSH_PORT` | Variable | Optional OpenSSH port, default `22` |
| `SPORTBOSS_COMPOSE_PROJECT` | Variable | Existing Pi Compose project, default `sportboss` |
| `SPORTBOSS_TS_CLIENT_ID` | Variable | Tailscale federated identity Client ID |
| `SPORTBOSS_TS_AUDIENCE` | Variable | Tailscale federated identity Audience |
| `SPORTBOSS_PI_SSH_KEY` | Secret | Dedicated deployment private key |
| `SPORTBOSS_PI_KNOWN_HOSTS` | Secret | Verified Pi OpenSSH known-hosts line |
| `SPORTBOSS_DEPLOY_ENABLED` | Variable | Set to `true` to enable deployment after setup |

Push the workflow to `main`, then check **Actions → Test and deploy SportBoss**. The deploy job ships tracked application files. Your Pi keeps its `.env`, TypeSafe and Telegram credentials, and SQLite volume. If health checks fail after a successful automated deployment, the script attempts to restore the previous source release using the same data volume. Keep database backups for data recovery.

### TypeSafe AI

Set TYPESAFE_API_KEY in .env and apply changes with docker compose up -d. Reviews apply to newly generated plans. The server sends candidate exercise names, classifications, set targets and available equipment to TypeSafe's Jev API. Workout logs, weights and images are stored locally. The preview's **How this workout was selected** section shows the current exercise patterns, any fallback reason, and the balance and equipment scores returned for each candidate. Of the candidates that meet both thresholds, the app selects the one with the highest balance score. If the request fails, the scores miss the thresholds, or the key is absent, the app keeps the highest-ranked rule-based plan. [TypeSafe API](https://docs.typesafe.ai/introduction/quickstart)

### Telegram reminders

1. Create a bot with @BotFather. Open the bot in Telegram and send it a message so that it can reach your chat.
2. Use the Bot API's getUpdates method to find the message's chat.id. Keep the token private.
3. Set TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID and APP_URL in .env. Set REMINDER_DAYS to comma-separated weekdays such as Mon,Wed,Fri and REMINDER_TIME to a 24-hour value such as 18:00.
4. Run `docker compose up -d` and check `docker compose logs app`.

The app checks every 20 seconds using Asia/Jerusalem, including daylight saving time. It sends at most one reminder per scheduled local day after the configured time, including a same-day catch-up after a reboot. It skips the reminder if the SQLite log already contains a completed workout today. A definite transient Telegram rejection can be retried. Ambiguous delivery results are recorded without resending, so one message is not delivered twice. Leave both Telegram variables blank to keep reminders idle. [Telegram Bot API](https://core.telegram.org/bots/api)

## Workouts and rotation

- Settings starts with dumbbells, a bench and bodyweight enabled. Enable cable or machine equipment if you have it. Workouts require enough equipment and distinct exercises to cover each template.
- Choose an upper/lower alternating split or full body in Settings. The alternating split recommends the opposite of your latest completed upper or lower session. You can select a different workout on Today.
- Each session has three sets per exercise by default. Exercises such as planks and carries use seconds. Weight is whatever measurement you consistently log for the exercise, such as per dumbbell. The progress chart uses estimated one-rep max for loaded movements and tracks reps or seconds for unloaded ones.
- Set **Target workout length** in Settings to 30, 40, 50, 60 or 75 minutes. New plans adjust the number of sets and exercises while keeping the core movement patterns. The preview estimate includes time for warm-up, setup and your configured rest between sets. Choose **Auto** for standard workout volume.
- The planner prioritizes coverage within balanced movement slots. Only completed workouts count toward rotation. Full-body sessions credit both upper and lower cycles, and core exercises can count in either. Each scope resets when all currently eligible exercises have been covered. Changing available equipment recalculates rotation from completed history against the new eligible catalog. Manual swaps can delay coverage.
- Use **Exclude** on a card in the Exercise Library to remove it from generated workouts, swap options and rotation targets. Filter to **Excluded** to find and restore exercises. Swap or restore excluded exercises before starting a saved preview.

## Back up and restore

Run these commands on the Pi in a Linux shell. The backup uses SQLite's online backup API and includes unfinished workouts, preferences, completed sets and reminder history.

~~~sh
umask 077
mkdir -p backups
backup_file="backups/sportboss-$(date +%F-%H%M%S).sqlite"
docker compose exec -T app node tools/backup.mjs > "$backup_file"
test -s "$backup_file"
~~~

Keep a copy off the Pi. Back up .env separately in an encrypted location, along with the project containing catalog.json and public/exercises. Test restores on a disposable deployment first. Restoring replaces the live database, so create a fresh backup before proceeding. Stop the app while restoring.

~~~sh
docker compose stop app
docker compose run --rm -T --no-deps app node tools/backup.mjs restore < backups/sportboss-REPLACE.sqlite
docker compose up -d
~~~

## Refresh the workbook import

From Windows PowerShell, use the same workbook layout with exercise names in column A and Excel **Place in Cell** images in column B on the first sheet.

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/import-catalog.ps1 -Workbook 'C:\path\home_exercise_catalog.xlsx'
~~~

The importer resolves the image associated with each Excel cell and writes resized JPEGs and catalog.json. Existing exercise IDs derive from names. Preserve names or migrate IDs if you need to keep historical exercise lookups. Review lib/catalog.mjs for any new movements or equipment requirements, then run npm test and rebuild the containers.

Dashboard photograph by Jason Grant. [Unsplash](https://unsplash.com/photos/a-row-of-dumbs-in-a-gym-m4Jqyv5VwqY)
