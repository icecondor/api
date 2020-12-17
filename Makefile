all:
	npm run build
test:
	npm run test
format:
	./node_modules/.bin/tsfmt --replace
run:
	npm run start


