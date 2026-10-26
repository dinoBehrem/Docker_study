# Docker Study App

A small Node.js (Express) API you can use to practice Docker.

## Run locally

```bash
npm install
DATA_DIR=./data npm start    # or: DATA_DIR=./data npm run dev (restarts on file changes)
```

The app listens on `PORT` (default `3000`). Set `DATA_DIR` when running locally, because the default `/data` usually can't be created outside a container.

## Development

```bash
npm test          # runs tests in test/ with Node's built-in test runner
npm run lint      # runs ESLint
```

`eslint` is a devDependency: `npm ci` installs it, but `npm ci --omit=dev` (a production install) leaves it out.

## Environment variables

| Variable   | Default            | Description                    |
|------------|--------------------|--------------------------------|
| `PORT`     | `3000`             | Port the server listens on     |
| `HOST`     | `0.0.0.0`          | Interface to bind to           |
| `APP_ENV`  | `local`            | Shown in `/info`               |
| `APP_NAME` | `docker-study-app` | Shown in `/info`               |
| `DATA_DIR` | `/data`            | Directory holding `items.json` |

## Endpoints

| Method | Path         | Description                                        |
|--------|--------------|----------------------------------------------------|
| GET    | `/`          | Welcome message and list of endpoints              |
| GET    | `/health`    | Health check (useful for Docker `HEALTHCHECK`)     |
| GET    | `/info`      | Hostname (container ID), env vars, Node version    |
| GET    | `/items`     | List items (saved to `DATA_DIR/items.json`)        |
| GET    | `/items/:id` | Get one item                                       |
| POST   | `/items`     | Create an item: `{ "name": "...", "description": "..." }` |
| DELETE | `/items/:id` | Delete an item                                     |
| GET    | `/echo`      | Echo query params and request headers              |

## Docker

Write your own `Dockerfile`, then:

```bash
docker build -t docker-study-app .
docker run -d -p 3000:3000 --name study -e APP_ENV=docker docker-study-app
docker logs -f study
docker stop study && docker rm study
```

## Persistence

Items and the next id are saved to `items.json` inside `DATA_DIR`. Without a volume that file lives in the container's own filesystem, so it is lost when the container is removed. Mount a volume at `/data` to keep it:

```bash
# Named volume, managed by Docker
docker run -d -p 3000:3000 -v study-data:/data --name study docker-study-app

# Bind mount, so you can see items.json on your machine
docker run -d -p 3000:3000 -v "$(pwd)/data:/data" --name study docker-study-app
```

The image must create `/data` and give it to the `node` user (see the Dockerfile). Otherwise the app exits at startup with `Cannot use data directory /data`.

## Example calls

```bash
curl localhost:3000/
curl localhost:3000/health
curl localhost:3000/info
curl -X POST localhost:3000/items -H "Content-Type: application/json" -d '{"name":"first","description":"hello"}'
curl localhost:3000/items
curl localhost:3000/items/1
curl -X DELETE localhost:3000/items/1
curl "localhost:3000/echo?msg=hello"
```

Things to try:
- Compare `hostname` in `/info` with `docker ps`. It matches the container ID.
- Create items, then run `docker rm -f study` and start a new container **without** a volume. The items are gone, because a container's filesystem is thrown away with it.
- Do the same **with** `-v study-data:/data`. The items are still there, and new ids continue from where they left off.
- Run two containers on different host ports (`-p 3001:3000`) and compare their `/info`.
