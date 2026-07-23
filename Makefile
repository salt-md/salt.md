.PHONY: all frontend backend build clean

all: build

frontend:
	cd web && (npm ci || npm install) && npm run build

backend:
	go mod tidy
	# -trimpath: sonst landen die absoluten Pfade des Bauenden (inkl. Benutzername)
	# in der Binary — unnötig preisgegeben und verhindert reproduzierbare Builds.
	CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o salt .

build: frontend backend

clean:
	rm -rf web/dist web/node_modules salt
