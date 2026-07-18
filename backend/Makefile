.PHONY: build run test clean migrate-up migrate-down migrate-create migrate-version migrate-fresh

# Database migration settings
MIGRATIONS_PATH=internal/db/migrations
DATABASE_URL?=postgres://darkforest:darkforest_secret@localhost:5432/darkforest?sslmode=disable

build:
	go build -o bin/server ./cmd/server

run:
	go run ./cmd/server

test:
	go test ./...

fmt:
	gofmt -w .

lint:
	@if [ -n "$$(gofmt -l .)" ]; then \
		echo "以下文件格式不正确:"; \
		gofmt -l .; \
		exit 1; \
	fi

clean:
	rm -rf bin/

# Database migration commands (requires golang-migrate)
# Install: go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@latest

migrate-up:
	@echo Running database migrations...
	migrate -path $(MIGRATIONS_PATH) -database "$(DATABASE_URL)" up

migrate-down:
	@echo Rolling back database migrations...
	migrate -path $(MIGRATIONS_PATH) -database "$(DATABASE_URL)" down 1

migrate-create:
	@set /p name="Enter migration name: " && migrate create -ext sql -dir $(MIGRATIONS_PATH) -seq %name%

migrate-version:
	@echo Checking migration version...
	migrate -path $(MIGRATIONS_PATH) -database "$(DATABASE_URL)" version

migrate-fresh:
	@echo Dropping and recreating database...
	migrate -path $(MIGRATIONS_PATH) -database "$(DATABASE_URL)" drop -f
	migrate -path $(MIGRATIONS_PATH) -database "$(DATABASE_URL)" up

# Docker commands
docker-up:
	docker compose -f ../docker-compose.yml up -d
	@echo Waiting for PostgreSQL to be ready...
	sleep 5

docker-down:
	docker compose -f ../docker-compose.yml down

docker-logs:
	docker compose -f ../docker-compose.yml logs -f postgres