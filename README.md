# iOpenWRT Controller

A web-based controller and monitor for OpenWrt routers. Manage and monitor your network devices over SSH from a single dashboard, with no agent to install on the routers.

## Features

- Monitor multiple OpenWrt routers over SSH from one dashboard: load, memory, uptime, CPU
  temperature, live traffic rate, and per-radio wireless clients.
- Client discovery across the whole network, merging DHCP leases, ARP tables, static host entries
  and reverse DNS, with per-client custom names.
- A gateway-aware topology view and a Fleet page that checks firmware, 802.11r roaming and 2.4 GHz
  channel health across all your access points at once.
- Remote reboot, and optional Telegram alerts when a new client joins.
- Firmware and package management (see below).

> [!NOTE]
> The optional host-discovery sweep auto-detects your LAN from the gateway device's IP, so it works
> on any subnet out of the box. To force a specific network, set `SUBNET` (for example `192.168.1`).
> Either way the routers themselves are always polled directly over SSH.

### Firmware and package management

Each device page shows its firmware version, kernel, model and free flash space, and can check
`opkg` (or `apk` on OpenWrt 25.12+) for upgradable packages.

There is deliberately no "upgrade everything" button.

On OpenWrt, mass-upgrading packages is not the equivalent of `apt upgrade`. It is a well-known way
to brick a router. Flash space is tiny, and kernel modules are pinned to the exact kernel build the
firmware shipped with. The supported way to update an OpenWrt system is to flash a full firmware
image (sysupgrade), not to upgrade packages one by one.

So this tool:

- Refuses to touch protected packages: kernel modules, `libc`, `base-files`, `busybox`, the SSH
  server, `opkg` itself. These are shown in the list, marked, and greyed out.
- Checks that your feeds match your firmware. If you run a vendor or snapshot build whose feed
  config points at a different release, upgrades are blocked and the reason is explained, because in
  that situation opkg's own "upgradable" list is unreliable and some entries are really cross-build
  downgrades.
- Checks free space before writing anything to flash.
- Lets you select individual packages to upgrade only when the firmware and feed agree.

Devices that are not running OpenWrt (for example a stock router used as the gateway) are detected
and shown as unsupported rather than failing.

## Running with Docker

This project ships as a single Docker image and runs on any system with Docker (Linux, Windows,
macOS) or on UNRAID. The published image is `amstel/iopenwrt`.

> [!CAUTION]
> **Set your own login before exposing this anywhere.** The image ships with `admin` /
> `admin_password` baked in from `.env.example`, which means it works out of the box but anyone who
> can reach it can log in. Always override `frontend_user` and `frontend_password` with your own
> values (both names are lowercase).

### Docker Compose

```bash
docker-compose up -d
```

Set `frontend_user`, `frontend_password` and `PORT` in a `.env` file next to `docker-compose.yml`,
or pass them as environment variables. Router credentials do not go here. You add each router (IP,
SSH port, username, password or key) from the web UI after logging in, and they are stored encrypted
in the SQLite database.

### UNRAID

1. Docker tab, Add Container.
2. Repository: `amstel/iopenwrt`. Network: Bridge.
3. Port: container `8780`, host `8780` (or any free port).
4. Path (data persistence, important): container `/app/data`, host
   `/mnt/user/appdata/iOpenWRT/data`. Your device list and settings live here and survive updates.
5. Variables: `frontend_user` and `frontend_password` (your own), and optionally `JWT_SECRET`.
6. To update: Docker tab, Check for Updates, then Update. The data volume is preserved.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `frontend_user` | *(none)* | Web UI username. Required. Both names are lowercase. |
| `frontend_password` | *(none)* | Web UI password. Required. |
| `PORT` | `8780` | Port the server listens on. |
| `SUBNET` | *auto* | First three octets of the LAN to sweep, e.g. `192.168.1`. Auto-detected from the gateway device if unset. |
| `JWT_SECRET` | *auto-generated* | Optional. A random secret is generated on first run and saved to `data/.secrets.json` if unset. |
| `TELEGRAM_BOT_TOKEN` | *(none)* | Optional. Alerts when a new client joins. Both Telegram vars must be set or alerts are skipped. |
| `TELEGRAM_CHAT_ID` | *(none)* | Optional. Chat to send alerts to. |
| `DB_PATH` | `data/iopenwrt.db` | Override the database location. |
| `SECRET_PATH` | `data/.secrets.json` | Override the secrets file location. |
| `DISABLE_MONITOR` | *(unset)* | Set to `1` to start the API without polling routers or sweeping the subnet. Useful for development. |

> [!WARNING]
> There is no user database. The login is checked directly against `frontend_user` and
> `frontend_password` on every request. To change your credentials, edit them and restart.

> [!CAUTION]
> Back up `data/.secrets.json` together with the database. Your routers' SSH credentials are
> encrypted at rest using a key stored in that file. Restoring the database without it leaves the
> stored credentials unreadable and you will have to re-enter them.

## Running from source

```bash
git clone https://github.com/amstel85/iOpenWrt.git
cd iOpenWrt
cp .env.example .env          # then set frontend_user and frontend_password
npm install
cd frontend && npm install && npm run build && cd ..
npm start
```

If you see `EADDRINUSE ... 0.0.0.0:8780`, another process holds the port. Change `PORT` in `.env`,
or free it with `fuser -k 8780/tcp`.

## How it works

The controller opens a fresh SSH connection to each router on a schedule, runs one batched read-only
script, and parses the result. Nothing is installed on the routers. The device you mark as the
gateway is treated as the authoritative source of DHCP leases and client names.

## License

MIT. See [LICENSE](LICENSE).
