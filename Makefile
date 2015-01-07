all: \
	node_modules/.install \
	lib/underscore.js \
	lib/queue-from-async.js \
	dist/backbone-github.js \
	dist/backbone-github.min.js

node_modules/.install: package.json
	npm install && touch node_modules/.install

lib/underscore.js: node_modules/.install
	cp node_modules/underscore/underscore.js $@

lib/queue-from-async.js: node_modules/.install
	node_modules/.bin/browserify node_modules/queue-from-async/index.js --standalone async.queue -o $@

dist/backbone-github.js: index.js node_modules/.install
	node_modules/.bin/browserify $< -u backbone -u underscore -u queue-from-async -o $@

dist/backbone-github.min.js: dist/backbone-github.js node_modules/.install
	node_modules/.bin/uglifyjs $< -c -m -o $@
