# Mapa transportu Trójmiasta

Lokalnie wymagany jest Node.js 24. Pierwsze uruchomienie pobiera aktualne pliki GTFS i tworzy bazę SQLite w `data/`:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm run setup
pnpm run build
pnpm start
```

Aplikacja działa pod adresem `http://localhost:3000`. Testy uruchomisz przez `pnpm test`.

## Hooki agentów i commitu

Po `pnpm install --frozen-lockfile` uruchom `pnpm run prepare`, żeby aktywować lokalny hook `pre-commit` (Husky).

Konfiguracje hooków repo-local:

- Codex: `.codex/hooks.json`
- OpenCode: `.opencode/hook/hooks.yaml`
- Copilot: `.github/hooks/agent-checks.json`

Wspólny entrypoint to `scripts/agent-checks.mjs`:

- tryb `changed` (zdarzenie edit): uruchamia `oxlint` + `oxfmt --check` tylko dla zmienionych plików
- tryb `full` (zdarzenie stop): uruchamia pełne `pnpm test`, `pnpm run lint`, `pnpm run format:check`

Commity są sprawdzane przez `lint-staged` w hooku `pre-commit`.

`pnpm run setup` odświeża dane, pobierając feedy Gdańska, Gdyni, SKM i POLREGIO. Nowa baza i pliki feedów zastępują poprzedni zestaw dopiero po poprawnym pobraniu i imporcie wszystkich źródeł; przy błędzie poprzednie dane pozostają dostępne. Błąd odświeżania na Render przerwie build i nie uruchomi nowej wersji. Dane aplikacji znajdują się w efemerycznym systemie plików usługi, więc odświeżenie następuje przy kolejnym buildzie; usunięcie instancji oznacza konieczność ponownego pobrania feedów.

Źródła danych: [ZTM Gdańsk](https://ckan.multimediagdansk.pl/dataset/c24aa637-3619-4dc2-a171-a23eec8f2172/resource/30e783e4-2bec-4a7d-bb22-ee3e3b26ca96/download/gtfsgoogle.zip), [ZKM Gdynia](http://api.zdiz.gdynia.pl/pt/gtfs.zip), [SKM](https://www.skm.pkp.pl/gtfs-mi-kpd.zip), [POLREGIO](https://transfer.polregio.pl/public/file/2xpjhbomseoindotgttcsg/GTFS.zip). Wyszukiwanie adresów korzysta z [Photon](https://photon.komoot.io/) i [Nominatim](https://nominatim.openstreetmap.org/); mapa używa kafelków [OpenStreetMap](https://www.openstreetmap.org/copyright). Szczegółowe adresy feedów GTFS są zdefiniowane w `src/setup.ts`.

Blueprint Render używa płatnego planu `1c-2g` (1 CPU, 2 GB RAM) w regionie Frankfurt. Lokalny proces zapytania o zasięg zużył 529 MB RSS; nie był to pomiar importu. Usługa nie ma trwałego dysku, a wdrożenia są ręczne.
