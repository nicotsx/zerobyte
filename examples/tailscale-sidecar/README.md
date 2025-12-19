# Zerobyte + Tailscale sidecar (Docker Compose)

This example runs Zerobyte behind a Tailscale sidecar container so the Zerobyte web UI/API can be reached over your tailnet and Zerobyte can access other devices on your tailnet (based on the ACLs/tags you configure in Tailscale).

It uses a common “sidecar networking” pattern:

- The `tailscale` container brings up a Tailscale node
- The `zerobyte` container shares the `tailscale` network namespace (`network_mode: service:tailscale`)

## About Tailscale

Tailscale is a mesh VPN built on WireGuard. It connects devices and containers into a private network (“tailnet”) without opening inbound ports on your router or exposing services directly to the public internet.

In this example, Tailscale acts as a secure access layer in front of Zerobyte:

- You reach Zerobyte using the node’s tailnet IP/DNS name.
- Access can be restricted using Tailscale ACLs/tags.

## Prerequisites

- Docker + Docker Compose
- A Tailscale account and an auth key

This example supports two Tailscale modes:

- **Kernel mode** (`TS_USERSPACE=false`, default):
  - requires `/dev/net/tun` on the host
  - requires `NET_ADMIN`
  - may require `SYS_MODULE` on some hosts (kept commented out in the compose file)

- **Userspace mode** (`TS_USERSPACE=true`):
  - does **not** require `/dev/net/tun`
  - works better on Docker Desktop / restricted hosts
  - requires a small edit in the compose file (see Troubleshooting)

## Setup

1. Copy the env file and fill in your auth key:

   ```bash
   cp .env.example .env
   ```

2. Start the stack:

   ```bash
   docker compose up -d
   ```

3. In the Tailscale admin console, confirm the node is present (and approved if your policy requires it).

## Access

- Over Tailscale: `http://<tailscale-ip>:4096` or `http://<tailscale-name>:4096` (if MagicDNS is enabled)
- Locally (optional): the example publishes `4096:4096` on the host

If you want Zerobyte to be reachable only via Tailscale, remove the `ports:` section from the `tailscale` service in [docker-compose.yml](docker-compose.yml). Zerobyte will still be able to access the internet and other resources outside the tailnet, but UI will only be accessible over Tailscale with possibility to further restrict access to it with ACLs/tags.

## Notes

- `network_mode: service:tailscale` makes Zerobyte share the Tailscale container’s *entire* network namespace (interfaces + routing table).
- Traffic to tailnet IPs (typically `100.x.y.z`) goes over `tailscale0` and is governed by Tailscale ACLs; traffic to your LAN/Internet may still go over the normal network interface depending on routes and host firewall.
- If `--accept-routes` is used, the Tailscale container may add routes to your routing table that Zerobyte will also use and be able to access remote networks.
- If `--accept-dns` is used, Zerobyte will also use Tailscale’s DNS servers.
- Zerobyte still needs `SYS_ADMIN` and `/dev/fuse` if you intend to mount NFS/SMB/WebDAV volumes from inside the container.

The example uses these environment variables (see [.env.example](.env.example)):

- `TS_AUTHKEY` (required)
- `TS_HOSTNAME` (optional)
- `TS_EXTRA_ARGS` (optional; passed to `tailscale up`)
- `TS_USERSPACE` (optional; set to `true` to use userspace mode)
- `TZ` (optional)

## Troubleshooting

- If the `tailscale` container can’t start due to missing TUN support, ensure your host has `/dev/net/tun` available and that Docker is allowed to use it.
- If your tailnet uses ACLs/tags, set `TS_EXTRA_ARGS` accordingly (for example `--advertise-tags=tag:backup`).
- If the `tailscale` container fails due to Docker Desktop / missing TUN support: set `TS_USERSPACE=true` in your `.env`, remove the `/dev/net/tun:/dev/net/tun` device mapping in [docker-compose.yml](docker-compose.yml), and keep `SYS_MODULE` disabled (commented out).

To confirm the tailnet address of the container:

```bash
docker exec zerobyte-tailscale tailscale status
docker exec zerobyte-tailscale tailscale ip -4
```

To confirm received routes when `--accept-routes` is used in kernel mode:
(Missing routers could be due to ACLs or because `--accept-routes` is not set or not supported in userspace mode)
```bash
docker exec zerobyte-tailscale ip route
docker exec zerobyte-tailscale ip route show table 52
```