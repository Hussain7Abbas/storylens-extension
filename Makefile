.PHONY: help install dev dev-firefox build build-firefox zip zip-firefox release-chrome submit-chrome typecheck orval i18n-parse

ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))

BLUE := $(shell printf '\033[34m')
GREEN := $(shell printf '\033[32m')
YELLOW := $(shell printf '\033[33m')
RESET := $(shell printf '\033[0m')

SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c

.DEFAULT_GOAL := help

help:
	@echo ""
	@echo "$(BLUE)Story Lens Extension$(RESET)"
	@echo "  $(GREEN)install$(RESET)        $(YELLOW)bun install$(RESET)"
	@echo "  $(GREEN)dev$(RESET)            Chrome dev server"
	@echo "  $(GREEN)dev-firefox$(RESET)    Firefox dev server"
	@echo "  $(GREEN)build$(RESET)          Chrome production build"
	@echo "  $(GREEN)build-firefox$(RESET)  Firefox production build"
	@echo "  $(GREEN)zip$(RESET)            build + zip for Chrome"
	@echo "  $(GREEN)zip-firefox$(RESET)    build + zip for Firefox"
	@echo "  $(GREEN)release-chrome$(RESET) production API client + Chrome store zip"
	@echo "  $(GREEN)submit-chrome$(RESET)  upload current version's zip to the Chrome Web Store"
	@echo "  $(GREEN)typecheck$(RESET)      TypeScript check"
	@echo "  $(GREEN)orval$(RESET)          regenerate API client from backend OpenAPI"
	@echo "  $(GREEN)i18n-parse$(RESET)     extract i18n keys"
	@echo ""

install:
	@cd "$(ROOT)" && bun install

dev:
	@cd "$(ROOT)" && bun run dev

dev-firefox:
	@cd "$(ROOT)" && bun run dev:firefox

build:
	@cd "$(ROOT)" && bun run build

build-firefox:
	@cd "$(ROOT)" && bun run build:firefox

zip: build
	@cd "$(ROOT)" && bun run zip

zip-firefox: build-firefox
	@cd "$(ROOT)" && bun run zip:firefox

release-chrome:
	@cd "$(ROOT)" && WXT_API_URL="https://storylens-api.iscoded.com" bun run zip

submit-chrome:
	@cd "$(ROOT)" && VERSION="$$(bun -p 'require("./package.json").version')" && \
		ZIP=".output/storylens-extension-$$VERSION-chrome.zip" && \
		test -f "$$ZIP" || { echo "Missing $$ZIP; run make release-chrome first"; exit 1; } && \
		bun run submit:chrome --chrome-zip "$$ZIP"

typecheck:
	@cd "$(ROOT)" && bun run typecheck

orval:
	@cd "$(ROOT)" && bun run orval

i18n-parse:
	@cd "$(ROOT)" && bun run i18n:parse
