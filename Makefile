# ==============================================================================
# StellarCred Unified Workspace Makefile
# ==============================================================================
# Provides a unified entry point across Rust contracts (cargo), Noir circuits
# (nargo/bb), Next.js frontend/SDK (pnpm), and indexer service (npm).
# ==============================================================================

SHELL := /bin/bash
.DEFAULT_GOAL := help

.PHONY: help all build test lint fmt clean \
        build-contracts test-contracts lint-contracts \
        compile-circuits check-circuits \
        build-frontend test-frontend lint-frontend test-sdk test-a11y \
        build-indexer test-indexer run-indexer

# ------------------------------------------------------------------------------
# Top-Level Orchestration Targets
# ------------------------------------------------------------------------------

## help: Display this help message with available targets
help:
	@echo "StellarCred Development Commands"
	@echo "================================"
	@echo "Usage: make [target]"
	@echo ""
	@echo "Top-Level Targets:"
	@echo "  make all             - Run build, test, and lint across all workspaces"
	@echo "  make build           - Build contracts, circuits, frontend, and indexer"
	@echo "  make test            - Run all unit, integration, and contract test suites"
	@echo "  make lint            - Run clippy, commitlint, and frontend linters"
	@echo "  make fmt             - Check or apply formatting across Rust and TS"
	@echo "  make clean           - Remove build artifacts and caches"
	@echo ""
	@echo "Focused Workspace Targets:"
	@echo "  make build-contracts - Compile Soroban contracts to wasm32v1-none"
	@echo "  make test-contracts  - Run cargo contract unit & snapshot tests"
	@echo "  make lint-contracts  - Run clippy with -D warnings on contracts"
	@echo "  make compile-circuits- Compile Noir zk circuits and derive VKs"
	@echo "  make build-frontend  - Build Next.js frontend web app"
	@echo "  make test-frontend   - Run frontend and SDK unit tests"
	@echo "  make lint-frontend   - Run ESLint on frontend code"
	@echo "  make test-sdk        - Run standalone @stellarcred/sdk integration tests"
	@echo "  make test-a11y       - Run axe-core accessibility tests (requires Playwright)"
	@echo "  make build-indexer   - Compile TypeScript indexer service"
	@echo "  make test-indexer    - Run Jest test suite for indexer"
	@echo "  make run-indexer     - Start local indexer service"

## all: Run build, test, and lint across all workspaces (CI mirror)
all: build test lint

## build: Build contracts, circuits, frontend, and indexer
build: build-contracts build-frontend build-indexer

## test: Run all unit and integration test suites
test: test-contracts test-frontend test-indexer

## lint: Run clippy and frontend linters
lint: lint-contracts lint-frontend

## fmt: Check Rust formatting
fmt:
	cargo fmt --all --check

## clean: Remove all target outputs and build artifacts
clean:
	cargo clean
	rm -rf frontend/.next frontend/dist services/indexer/dist circuits/target

# ------------------------------------------------------------------------------
# Contracts (Soroban / Rust)
# ------------------------------------------------------------------------------

## build-contracts: Compile Soroban WASM artifacts
build-contracts:
	cargo build --release --target wasm32v1-none --locked

## test-contracts: Run contract test suite
test-contracts:
	cargo test --locked

## lint-contracts: Run clippy on contract crates with warnings as errors
lint-contracts:
	cargo clippy --all-targets -- -D warnings

# ------------------------------------------------------------------------------
# Circuits (Noir / Aztec Barretenberg)
# ------------------------------------------------------------------------------

## compile-circuits: Compile Noir circuits and verify VK artifacts
compile-circuits:
	bash ./circuits/scripts/build.sh

# ------------------------------------------------------------------------------
# Frontend & SDK (Next.js / pnpm)
# ------------------------------------------------------------------------------

## build-frontend: Build frontend Next.js production bundle
build-frontend:
	cd frontend && pnpm build

## test-frontend: Run frontend SDK and theme tests
test-frontend:
	cd frontend && pnpm test && pnpm test:theme && pnpm --filter @stellarcred/issuer test

## lint-frontend: Run frontend ESLint and typecheck
lint-frontend:
	cd frontend && pnpm lint && pnpm exec tsc --noEmit

## test-sdk: Run SDK standalone integration tests
test-sdk:
	cd frontend/packages/sdk && pnpm typecheck && pnpm test:integration

## test-a11y: Run axe-core accessibility tests
test-a11y:
	cd frontend && pnpm test:e2e

# ------------------------------------------------------------------------------
# Indexer Service (Node.js / Express)
# ------------------------------------------------------------------------------

## build-indexer: Compile indexer TypeScript source
build-indexer:
	cd services/indexer && npm run build

## test-indexer: Run Jest tests for indexer
test-indexer:
	cd services/indexer && npm test

## run-indexer: Start the indexer service locally
run-indexer:
	cd services/indexer && npm start
