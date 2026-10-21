SHELL := /bin/bash

.PHONY: install check dev build up down migrate seed token

install:
	npm ci

check:
	npm run check

dev:
	npm run dev

build:
	npm run build

up:
	docker compose -f deploy/docker-compose.yml up -d --build

down:
	docker compose -f deploy/docker-compose.yml down

migrate:
	npm run db:migrate

seed:
	npm run seed:demo

token:
	npm run token:issue -- --role official --subject local-official
