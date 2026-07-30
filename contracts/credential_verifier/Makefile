default: build

all: test

test: build
	cargo test

build:
	stellar contract build
	@ls -l ../../target/wasm32v1-none/release/*.wasm || true

fmt:
	cargo fmt --all

clean:
	cargo clean
