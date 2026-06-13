#!/bin/sh

set -e

# Wait for database to be ready
echo "Waiting for database connection..."
while ! nc -z postgres 5432; do
  sleep 1
done

# Run database migrations
echo "Running database migrations..."
/app/server migrate

# Start the server
echo "Starting application..."
exec /app/server