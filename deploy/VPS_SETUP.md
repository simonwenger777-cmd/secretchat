# VPS setup for secretchat

This setup keeps Cloudflare Worker/D1 as the API and database, while the VPS serves the public site and proxies `/api/*`.

## 1. DNS

Point the domain directly to the VPS, not through Cloudflare proxy:

```text
A    exsslx.ru      VPS_IP    DNS only
A    www.exsslx.ru  VPS_IP    DNS only
```

In Cloudflare DNS this means the cloud icon must be gray.

## 2. Worker origin

The Caddyfile needs a reachable Worker origin for `/api/*`.

Good options:

```text
https://secretchat.YOUR_WORKERS_SUBDOMAIN.workers.dev
```

or a separate Cloudflare Worker custom domain, for example:

```text
https://api-origin.exsslx.ru
```

Do not use `https://exsslx.ru` as the origin, because that will point back to the VPS and create a proxy loop.

## 3. Install Caddy on Ubuntu/Debian

```bash
sudo apt update
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

## 4. Upload site files

Copy the contents of `public` to:

```text
/var/www/secretchat
```

The server directory should contain `index.html`, `app.js`, `style.css`, and the other public assets directly inside it.

## 5. Install Caddyfile

Copy `deploy/Caddyfile` to:

```text
/etc/caddy/Caddyfile
```

Then replace:

```text
https://CHANGE_ME_WORKER_ORIGIN
```

with your Worker origin.

Apply it:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

## 6. Check

```bash
curl -I https://exsslx.ru
curl "https://exsslx.ru/api/messages?room=test&since=0"
```

The API check should return:

```json
[]
```
