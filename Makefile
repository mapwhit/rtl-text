check: lint test

lint:
	./node_modules/.bin/biome ci

format:
	./node_modules/.bin/biome check --fix

test: build
	node --test $(TEST_OPTS)

test-cov: TEST_OPTS := --experimental-test-coverage
test-cov: test

.PHONY: check format lint test test-cov

WASM_JS = ./src/icu.js
C_FILES = $(wildcard ./src/*.c)
OBJ_FILES = $(C_FILES:.c=.o)

build: $(WASM_JS)

.PHONY: build

clean:
	rm -f $(WASM_JS) $(OBJ_FILES)

# Compile ICU wrapper to WebAssembly, embed all subresources as base64 string literals and export as a ES module
$(WASM_JS): $(OBJ_FILES)
	emcc -Oz -v -o $@ \
		$^ \
		-s USE_ICU=1 \
		-s ALLOW_MEMORY_GROWTH=1 \
		-s DEAD_FUNCTIONS="[]" \
		-s ENVIRONMENT="node,web" \
		-s EXIT_RUNTIME=0 \
		-s EXPORT_ES6=1 \
		-s EXPORTED_FUNCTIONS="['_ushape_arabic','_bidi_processText','_bidi_getLine','_bidi_getParagraphEndIndex','_bidi_setLine','_bidi_writeReverse','_bidi_getVisualRun','_malloc','_free']" \
		-s EXPORTED_RUNTIME_METHODS="['stringToUTF16','UTF16ToString','ccall','HEAPU8']" \
		-s FILESYSTEM=0 \
		-s IMPORTED_MEMORY=1 \
		-s INLINING_LIMIT=1 \
		-s MODULARIZE=1 \
		-s WASM_ASYNC_COMPILATION=1 \
		-s WASM=1 \
		--closure 0

.INTERMEDIATE: $(OBJ_FILES)

# Build ubidi and ushape wrappers
%.o: %.c
	emcc -Oz -s USE_ICU=1 -c $^ -o $@
