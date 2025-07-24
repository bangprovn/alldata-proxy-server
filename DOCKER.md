# Docker Setup for AllData Proxy Server

This document describes how to run the AllData Proxy Server using Docker.

## Prerequisites

- Docker installed on your system
- Docker Compose installed on your system

## Quick Start

1. Build and start the container:
```bash
docker-compose up -d
```

2. View logs:
```bash
docker-compose logs -f
```

3. Stop the container:
```bash
docker-compose down
```

## Persistent Data

The following directories are persisted between container updates:

- `cache/` - API response cache and database
- `public/app-alldata/alldata/` - Downloaded assets (HTML, images, CSS, etc.)

These directories are mounted as Docker volumes and will survive container restarts and updates.

## Environment Variables

You can override default environment variables by creating a `.env` file:

```env
NODE_ENV=production
PORT=3000
# Add other environment variables as needed
```

## Building for Production

To build a production image:

```bash
docker build -t alldata-proxy-server:latest .
```

## Volume Management

List volumes:
```bash
docker volume ls
```

Inspect a volume:
```bash
docker volume inspect alldata-proxy-server_cache_data
docker volume inspect alldata-proxy-server_public_app_alldata
```

## Backup and Restore

### Backup volumes:
```bash
# Backup cache volume
docker run --rm -v alldata-proxy-server_cache_data:/source -v $(pwd):/backup alpine tar czf /backup/cache_backup.tar.gz -C /source .

# Backup public/app-alldata/alldata volume
docker run --rm -v alldata-proxy-server_public_app_alldata:/source -v $(pwd):/backup alpine tar czf /backup/public_app_alldata_backup.tar.gz -C /source .
```

### Restore volumes:
```bash
# Restore cache volume
docker run --rm -v alldata-proxy-server_cache_data:/target -v $(pwd):/backup alpine tar xzf /backup/cache_backup.tar.gz -C /target

# Restore public/app-alldata/alldata volume
docker run --rm -v alldata-proxy-server_public_app_alldata:/target -v $(pwd):/backup alpine tar xzf /backup/public_app_alldata_backup.tar.gz -C /target
```

## Health Check

The container includes a health check that monitors the `/health` endpoint. You can check the container health status:

```bash
docker ps
docker inspect alldata-proxy-server --format='{{.State.Health.Status}}'
```

## Troubleshooting

1. **Container won't start**: Check logs with `docker-compose logs`
2. **Permission issues**: The container runs as non-root user (nodejs). Ensure volume permissions are correct.
3. **Port conflicts**: Ensure port 3000 is not already in use on your host.

## Security Notes

- The container runs as a non-root user for security
- Only necessary files are included in the image (see .dockerignore)
- Sensitive files like .env are excluded from the image