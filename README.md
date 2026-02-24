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
1. Navigate to the **Docker** tab in UNRAID.
2. Click **Add Container**.
3. Use `amstel85/iopenwrt` (if published) or build it locally using the `Dockerfile` provided.
4. Set the following Path mappings:
   - `/app/data` -> `/mnt/user/appdata/iOpenWRT/data`
5. Set the Port mapping:
   - `3000` -> `3000` (or your choice).

