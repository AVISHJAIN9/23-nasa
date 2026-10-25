.PHONY: install dev build start test lint fmt seed docker-up docker-down check sim-test sim-run ml-test ml-eval demo

demo:
	cd backend && npm run demo

install:
	cd backend && npm install

dev:
	cd backend && npm run dev

build:
	cd backend && npm run build

start:
	cd backend && npm start

test:
	cd backend && npm test

lint:
	cd backend && npm run lint

fmt:
	cd backend && npm run format

fmt-check:
	cd backend && npm run format:check

seed:
	cd backend && npm run seed:users

check: lint fmt-check build test

sim-test:
	cd simulator && python -m pytest

sim-run:
	cd simulator && python -m src.cli --scenario normal_day --duration 60 --dry-run

ml-test:
	python -m pytest ml-sidecar/tests -v

ml-eval:
	python ml-sidecar/eval/evaluate.py

docker-up:
	docker compose up --build -d

docker-down:
	docker compose down

