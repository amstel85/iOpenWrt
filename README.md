# iOpenWRT Controller

A web-based controller and monitor for OpenWrt routers. Manage and monitor your network devices via SSH/ubus.

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
   *Note: Set your `PORT`, router credentials, and login credentials in `.env`.*

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
If you see an error like `EADDRINUSE: address already in use 0.0.0.0:3000`, it means another process is using port 3000.
You can:
- Change the `PORT` in your `.env` file.
- Or find and kill the process:
  ```bash
  fuser -k 3000/tcp
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
   - **Repository:** `amstel85/iopenwrt`
   - **Network Type:** `Bridge` (standard) or your preferred custom network.

#### 2. Port Mapping
- Click **Add another Path, Port, Variable, Label or Device**.
- Choose **Port**:
  - **Container Port:** `3000`
  - **Host Port:** `3000` (or any available port on your Hosting server).

#### 3. Data Persistence (Crucial)
To ensure your settings and device list are saved when the container updates:
- Click **Add another Path, Port, Variable, Label or Device**.
- Choose **Path**:
  - **Name:** `App Data`
  - **Container Path:** `/app/data`
  - **Host Path:** `/mnt/user/appdata/iOpenWRT/data`

#### 4. Initial Setup (Environment Variables)
Add these variables to set your initial login credentials:
- **frontend_user**: Your desired admin username (default: `admin`).
- **frontend_password**: Your desired admin password (default: `admin_password`).

> [!TIP]
> After the first run, your data is saved in the SQLite database within the mapped `data` folder.

#### 5. How to Update
When a new version is released:
1. Go to the **Docker** tab.
2. Click **Check for Updates**.
3. If an update is available, click **Update**.
4. UNRAID will download the new image and restart the container. Your data will be preserved thanks to the volume mapping in step 3.

