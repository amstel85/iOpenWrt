# iOpenWRT Controller

A web-based controller and monitor for OpenWrt routers. Manage and monitor your network devices via SSH.

> [!IMPORTANT]
> **Known limitation:** the active network sweep is currently hardcoded to the `10.0.0.0/24` subnet
> ([`src/services/deviceManager.js`](src/services/deviceManager.js)). On any other subnet the app
> still works — routers are polled directly over SSH — but the extra discovery sweep finds nothing,
> so some clients may show as `Unknown Device` instead of by name.

## Features

- Monitor multiple OpenWrt routers over SSH from one dashboard: load, memory, uptime, live traffic
  rate, and per-radio wireless clients.
- Client discovery across the whole network, merging DHCP leases, ARP tables, static host entries
  and reverse DNS, with per-client custom names.
- Remote reboot, and optional Telegram alerts when a new client joins.
- **Firmware & package management** — see below.

### Firmware &amp; package management

Each device page shows its firmware version, kernel, model and free flash space, and can check
`opkg` (or `apk` on OpenWrt 24.10+) for upgradable packages.

There is deliberately **no "upgrade everything" button.**

On OpenWrt, mass-upgrading packages is not the equivalent of `apt upgrade` — it is a well-known way
to brick a router. Flash space is tiny, and kernel modules are pinned to the exact kernel build the
firmware shipped with. The supported way to update an OpenWrt system is to flash a full firmware
image (**sysupgrade**), not to upgrade packages one by one.

So this tool:

- **refuses to touch protected packages** — kernel modules, `libc`, `base-files`, `busybox`, the SSH
  server, `opkg` itself. These are shown in the list, marked, and greyed out.
- **checks that your feeds match your firmware.** If you run a vendor or snapshot build whose
  `/etc/opkg/distfeeds.conf` points at a different release, upgrades are blocked and the reason is
  explained — because in that situation opkg's own "upgradable" list is unreliable and some entries
  are really cross-build downgrades.
- **checks free space** before writing anything to flash.
- lets you select individual packages to upgrade when — and only when — the firmware and feed agree.

Devices that are not running OpenWrt (for example a stock ASUS router used as the gateway) are
detected and shown as unsupported rather than failing.

## Quick start for maintainers

```bash
./menu.sh
```

An interactive menu covering the whole loop: run checks, build, run locally
(against a throwaway database, without touching real routers), commit, push,
publish the Docker image, and verify that what is on Docker Hub is actually your
latest commit.

## Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/amstel85/iOpenWrt.git
   cd iOpenWrt
   ```

2. **Environment Configuration:**
   Copy the example environment file and fill in your details:
   ```bash
   cp .env.example .env
   ```
   Set your web login and `PORT` here. **Router credentials do not go in `.env`** — you add each
   router (IP, SSH port, username, password or key) from the web UI after logging in, and they are
   stored in the SQLite database.

   `.env.example` only covers the basics. These variables are also supported:

   | Variable | Default | Purpose |
   |---|---|---|
   | `frontend_user` | *(none)* | Web UI username. **Required** — login returns a 500 error if unset. |
   | `frontend_password` | *(none)* | Web UI password. **Required.** Note both names are lowercase. |
   | `PORT` | `8780` | Port the server listens on. |
   | `JWT_SECRET` | *auto-generated* | Optional. If unset, a random secret is generated on first run and saved to `data/.secrets.json`. |
   | `TELEGRAM_BOT_TOKEN` | *(none)* | Optional. Alerts when a new client joins. Both Telegram vars must be set or alerts are silently skipped. |
   | `TELEGRAM_CHAT_ID` | *(none)* | Optional. Chat to send alerts to. |
   | `DB_PATH` | `data/iopenwrt.db` | Override the database location. |
   | `SECRET_PATH` | `data/.secrets.json` | Override the secrets file location. |
   | `DISABLE_MONITOR` | *(unset)* | Set to `1` to start the API without polling routers or sweeping the subnet. Useful for local development. |

   > [!WARNING]
   > There is no user database — the login is checked directly against `frontend_user` and
   > `frontend_password` on every request. To change your credentials, edit them and restart the
   > container.

   > [!CAUTION]
   > **Back up `data/.secrets.json` together with the database.** Your routers' SSH credentials are
   > encrypted at rest using a key stored in that file. Restoring the database without it leaves the
   > stored credentials unreadable and you will have to re-enter them.

3. **Install Dependencies:**
   ```bash
   npm install
   cd frontend && npm install && cd ..
   ```

4. **Build Frontend:**
   ```bash
   cd frontend && npm run build && cd ..
   ```

## Running Locally

To start the server:
```bash
npm start
```

### Troubleshooting: Port already in use
If you see an error like `EADDRINUSE: address already in use 0.0.0.0:8780`, it means another process is using port 8780.
You can:
- Change the `PORT` in your `.env` file.
- Or find and kill the process:
  ```bash
  fuser -k 8780/tcp
  ```

## Running with Docker

This project is Docker-ready and can be deployed on any system running Docker (Linux, Windows, macOS, etc.) or specialized platforms like UNRAID.

### Using Docker Compose (Standard)

Docker Compose is the standard way to run the application on most systems (Linux, Windows, macOS). It handles environment variables and volume mappings automatically.
```bash
docker-compose up -d
```

### Deployment on UNRAID

For UNRAID users, follow these steps for a complete setup:

#### 1. Installation
1. Go to the **Docker** tab in your UNRAID dashboard.
2. Click **Add Container** at the bottom.
3. Configure the following settings:
   - **Name:** `iOpenWRT-Controller`
   - **Repository:** `amstel/iopenwrt`
   - **Network Type:** `Bridge` (standard) or your preferred custom network.

#### 2. Port Mapping
- Click **Add another Path, Port, Variable, Label or Device**.
- Choose **Port**:
  - **Container Port:** `8780`
  - **Host Port:** `8780` (or any available port on your Hosting server).

#### 3. Data Persistence (Crucial)
To ensure your settings and device list are saved when the container updates:
- Click **Add another Path, Port, Variable, Label or Device**.
- Choose **Path**:
  - **Name:** `App Data`
  - **Container Path:** `/app/data`
  - **Host Path:** `/mnt/user/appdata/iOpenWRT/data`

#### 4. Login Credentials (Environment Variables)
These are **required** — without them every login attempt fails with a server error. There is no
working fallback; `admin` / `admin_password` are only placeholders in `.env.example`.
- **frontend_user**: Your admin username.
- **frontend_password**: Your admin password.
- **JWT_SECRET**: A long random string of your own. See the environment table above for why this matters.

Changing your login later means editing these variables and restarting the container — there is no
password change in the UI.

> [!TIP]
> After the first run, your data is saved in the SQLite database within the mapped `data` folder.

#### 5. How to Update
1. Go to the **Docker** tab.
2. Click **Check for Updates**.
3. If an update is available, click **Update**.
4. UNRAID downloads the new image and restarts the container. Your data is preserved by the volume
   mapping in step 3 — as long as that mapping is present, an update never touches your device list.

Updates are **not automatic** unless you install the Community Applications *Auto Update
Applications* plugin and enable it for this container. Otherwise the container keeps running the old
image until you click Update yourself.

