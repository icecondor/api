all:
	npm run build
test:
	rm -fr jsonlake-test lmdb-data-test
	npm run test
format:
	./node_modules/.bin/tsfmt --replace
run:
	npm run start


