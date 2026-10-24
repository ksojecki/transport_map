'use strict';

const CONFIG = { mapCenter: [54.389, 18.625], mapZoom: 11 };
const ADDRESS_HISTORY_KEY = 'gdansk-transit-addresses';
const LEGACY_ADDRESS_KEY = 'gdansk-transit-start';
const $ = (id) => document.getElementById(id);
const map = L.map('map', { preferCanvas: true }).setView(CONFIG.mapCenter, CONFIG.mapZoom);
for (const [name, z] of [
  ['coveragePane', 350],
  ['originWalkPane', 360],
  ['contourPane', 375],
  ['routesPane', 400],
  ['pointsPane', 450],
])
  map.createPane(name).style.zIndex = z;
map.getPane('coveragePane').style.opacity = map.getPane('originWalkPane').style.opacity = '0.75';
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© OpenStreetMap contributors',
}).addTo(map);
const directLayer = L.layerGroup().addTo(map),
  transferLayer = L.layerGroup().addTo(map);
const originLayer = L.layerGroup().addTo(map),
  coverageLayer = L.layerGroup().addTo(map);
const originWalkLayer = L.layerGroup().addTo(map),
  contourLayer = L.layerGroup().addTo(map);
const circleRenderer = L.svg({ pane: 'coveragePane' }),
  originWalkRenderer = L.svg({ pane: 'originWalkPane' });
const routeRenderer = L.canvas({ pane: 'routesPane' }),
  pointRenderer = L.canvas({ pane: 'pointsPane' });
let addressPoint = null,
  addressMarker = null,
  calculationTimer = null,
  calculationRequest = 0;
let suggestionTimer = null,
  suggestionRequest = 0,
  addressSuggestions = new Map();

function popup(text) {
  const node = document.createElement('div');
  node.textContent = text;
  return node;
}
function validAddress(point) {
  return (
    point &&
    typeof point.address === 'string' &&
    point.address.trim() &&
    Number.isFinite(point.latitude) &&
    point.latitude >= -90 &&
    point.latitude <= 90 &&
    Number.isFinite(point.longitude) &&
    point.longitude >= -180 &&
    point.longitude <= 180
  );
}
function readAddressHistory() {
  try {
    const stored = JSON.parse(localStorage.getItem(ADDRESS_HISTORY_KEY) || '[]');
    const history = Array.isArray(stored) ? stored.filter(validAddress) : [];
    const legacy = JSON.parse(localStorage.getItem(LEGACY_ADDRESS_KEY) || 'null');
    if (
      validAddress(legacy) &&
      !history.some(
        (item) =>
          item.address.toLocaleLowerCase('pl-PL') === legacy.address.toLocaleLowerCase('pl-PL'),
      )
    )
      history.unshift(legacy);
    localStorage.setItem(ADDRESS_HISTORY_KEY, JSON.stringify(history));
    localStorage.removeItem(LEGACY_ADDRESS_KEY);
    return history;
  } catch {
    return [];
  }
}
function renderAddressHistory(history = readAddressHistory()) {
  const select = $('savedAddresses'),
    selected = select.value;
  select.replaceChildren(new Option('Wybierz zapisany adres', ''));
  for (const point of history) select.add(new Option(point.address, point.address));
  if (history.some((point) => point.address === selected)) select.value = selected;
}
function saveAddress(point) {
  const key = point.address.toLocaleLowerCase('pl-PL'),
    history = readAddressHistory();
  const next = [
    point,
    ...history.filter((item) => item.address.toLocaleLowerCase('pl-PL') !== key),
  ];
  try {
    localStorage.setItem(ADDRESS_HISTORY_KEY, JSON.stringify(next));
  } catch {
    /* Keep this address usable when storage is unavailable. */
  }
  renderAddressHistory(next);
}
function updateStatus(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}
function clearResults() {
  for (const layer of [
    directLayer,
    transferLayer,
    originLayer,
    coverageLayer,
    originWalkLayer,
    contourLayer,
  ])
    layer.clearLayers();
  $('directCount').textContent =
    $('transferCount').textContent =
    $('originCount').textContent =
      '–';
}
function updateWalkMinutes() {
  const minutes = Number($('walkMinutes').value);
  $('walkMinutesValue').textContent = `${minutes} min · do ${Math.round(minutes * 72)} m`;
}
function selectAddress(point, prefix = 'Ustawiono') {
  addressPoint = point;
  updateWalkMinutes();
  $('addressInput').value = point.address;
  const saved = readAddressHistory();
  $('savedAddresses').value = saved.some((item) => item.address === point.address)
    ? point.address
    : '';
  if (addressMarker) map.removeLayer(addressMarker);
  addressMarker = L.circleMarker([point.latitude, point.longitude], {
    pane: 'pointsPane',
    renderer: pointRenderer,
    radius: 9,
    color: '#fff',
    weight: 3,
    fillColor: '#111827',
    fillOpacity: 1,
  })
    .addTo(map)
    .bindPopup(popup(`Punkt początkowy: ${point.address}`));
  map.setView([point.latitude, point.longitude], 15);
  $('addressStatus').textContent = `${prefix}: ${point.address}`;
  $('addressStatus').classList.remove('error');
  scheduleCalculation();
}
async function api(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Błąd serwera (HTTP ${response.status})`);
  return body;
}
async function suggestAddresses() {
  const input = $('addressInput').value.trim(),
    request = ++suggestionRequest;
  addressSuggestions = new Map();
  $('addressSuggestions').replaceChildren();
  if (input.length < 3) return;
  try {
    const data = await api(`/api/addresses/suggest?q=${encodeURIComponent(input)}`);
    if (request !== suggestionRequest) return;
    for (const point of data.results || []) {
      if (!validAddress(point)) continue;
      addressSuggestions.set(point.address, point);
      $('addressSuggestions').append(new Option(point.address));
    }
  } catch {
    /* Suggestions are optional; manual address search remains available. */
  }
}
async function setAddress(event) {
  event.preventDefault();
  clearTimeout(suggestionTimer);
  const address = $('addressInput').value.trim(),
    request = ++suggestionRequest;
  if (!address) return;
  const button = $('addressSubmit'),
    status = $('addressStatus');
  button.disabled = true;
  status.classList.remove('error');
  status.textContent = 'Wyszukiwanie adresu...';
  try {
    let point =
      addressSuggestions.get(address) ||
      readAddressHistory().find((item) => item.address === address) ||
      null;
    if (!point) {
      const data = await api(`/api/addresses/search?q=${encodeURIComponent(address)}`);
      if (request !== suggestionRequest) return;
      point = data.results?.[0];
      if (!validAddress(point))
        throw new Error(
          'Nie znaleziono adresu w Trójmieście ani okolicznych gminach. Sprawdź wpis i spróbuj ponownie.',
        );
    }
    if (request !== suggestionRequest) return;
    saveAddress(point);
    selectAddress(point);
  } catch (error) {
    if (request === suggestionRequest) {
      status.textContent = error.message;
      status.classList.add('error');
    }
  } finally {
    button.disabled = false;
  }
}
function journeyColor(seconds) {
  const progress = Math.max(0, Math.min(1, seconds / (90 * 60))),
    from = [22, 163, 74],
    to = [220, 38, 38];
  return `#${from
    .map((value, i) =>
      Math.round(value + (to[i] - value) * progress)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}
function drawCoverage(data) {
  originWalkLayer.clearLayers();
  if (data.originWalk.radiusMeters > 0)
    originWalkLayer.addLayer(
      L.circle([data.originWalk.center.latitude, data.originWalk.center.longitude], {
        pane: 'originWalkPane',
        renderer: originWalkRenderer,
        radius: data.originWalk.radiusMeters,
        color: '#16a34a',
        weight: 2,
        opacity: 0.8,
        fillColor: '#16a34a',
        fillOpacity: 1,
        interactive: false,
      }),
    );
  const transferStops = new Set();
  const drawnSegments = new Map([
    [directLayer, new Set()],
    [transferLayer, new Set()],
  ]);
  for (const stop of data.originStops) {
    originLayer.addLayer(
      L.polyline(
        [
          [addressPoint.latitude, addressPoint.longitude],
          [stop.latitude, stop.longitude],
        ],
        {
          pane: 'routesPane',
          renderer: routeRenderer,
          color: '#111827',
          weight: 1,
          opacity: 0.45,
          dashArray: '4 5',
          interactive: false,
        },
      ),
    );
    originLayer.addLayer(
      L.circleMarker([stop.latitude, stop.longitude], {
        pane: 'pointsPane',
        renderer: pointRenderer,
        radius: 7,
        color: '#fff',
        weight: 2,
        fillColor: '#111827',
        fillOpacity: 1,
      }).bindPopup(popup(`Przystanek początkowy: ${stop.name}`)),
    );
  }
  for (const destination of [...data.destinations].reverse()) {
    const { stop, journey, path } = destination,
      direct = journey.kind === 'direct',
      layer = direct ? directLayer : transferLayer;
    const segments = drawnSegments.get(layer),
      routeColor = direct ? '#2563eb' : '#dc4753';
    for (const leg of path) {
      const from = leg.from,
        to = leg.to;
      if (leg.kind === 'transfer_walk') {
        layer.addLayer(
          L.polyline(
            [
              [from.latitude, from.longitude],
              [to.latitude, to.longitude],
            ],
            {
              pane: 'routesPane',
              renderer: routeRenderer,
              color: '#7c3aed',
              weight: 2,
              opacity: 0.9,
              dashArray: '2 5',
              interactive: false,
            },
          ),
        );
        continue;
      }
      const key = `${leg.provider || ''}:${leg.tripId || ''}:${leg.fromStopId}|${leg.toStopId}`;
      if (segments.has(key)) continue;
      segments.add(key);
      layer.addLayer(
        L.polyline(
          [
            [from.latitude, from.longitude],
            [to.latitude, to.longitude],
          ],
          {
            pane: 'routesPane',
            renderer: routeRenderer,
            color: routeColor,
            weight: 3,
            opacity: 0.75,
            dashArray: direct ? null : '7 5',
            interactive: false,
          },
        ),
      );
      if (direct) continue;
      const transferStop = data.destinations
        .flatMap((item) => item.transferStops)
        .find((item) => item.id === leg.toStopId);
      if (transferStop && !transferStops.has(transferStop.id)) {
        transferStops.add(transferStop.id);
        transferLayer.addLayer(
          L.circleMarker([transferStop.latitude, transferStop.longitude], {
            pane: 'pointsPane',
            renderer: pointRenderer,
            radius: 8,
            color: '#fff',
            weight: 2,
            fillColor: '#dc4753',
            fillOpacity: 1,
          }).bindPopup(popup(`Przesiadka: ${transferStop.name}`)),
        );
      }
    }
    const color = journeyColor(journey.durationSeconds);
    layer.addLayer(
      L.circleMarker([stop.latitude, stop.longitude], {
        pane: 'pointsPane',
        renderer: pointRenderer,
        radius: 4,
        color: '#fff',
        weight: 1,
        fillColor: color,
        fillOpacity: 1,
      }).bindPopup(
        popup(
          `${stop.name} — ${Math.round(journey.durationSeconds / 60)} min, ${direct ? 'bezpośrednio' : 'z przesiadką'}`,
        ),
      ),
    );
    coverageLayer.addLayer(
      L.circle([stop.latitude, stop.longitude], {
        renderer: circleRenderer,
        radius: destination.circle.radiusMeters,
        color,
        weight: 2,
        opacity: 0.8,
        fillColor: color,
        fillOpacity: 1,
      }).bindPopup(
        popup(
          `${stop.name} — ${Math.round(journey.durationSeconds / 60)} min, ${direct ? 'bezpośrednio' : 'z przesiadką'}`,
        ),
      ),
    );
  }
  for (const contour of data.contours)
    for (const line of contour.lines) {
      const coords = line.map(({ latitude, longitude }) => [latitude, longitude]);
      if (coords.length < 2) continue;
      const style = {
        pane: 'contourPane',
        interactive: true,
        color: '#fff',
        weight: 5,
        opacity: 0.95,
      };
      contourLayer.addLayer(L.polyline(coords, style));
      contourLayer.addLayer(
        L.polyline(coords, { ...style, color: '#111827', weight: 2.5 }).bindTooltip(
          `${contour.minutes} min`,
        ),
      );
    }
}
function requestBody() {
  return {
    latitude: addressPoint.latitude,
    longitude: addressPoint.longitude,
    date: $('travelDate').value,
    time: $('travelTime').value,
    journeyLimit: Number($('journeyLimit').value),
    walkMinutes: Number($('walkMinutes').value),
    minimumTransfer: Number($('minimumTransfer').value),
    includeTransfers: $('includeTransfers').checked,
  };
}
async function calculate() {
  const request = ++calculationRequest;
  clearResults();
  if (!addressPoint) {
    updateStatus('Ustaw adres, aby wyznaczyć przystanki początkowe.', true);
    $('reload').disabled = false;
    return;
  }
  const body = requestBody();
  if (!body.date || !body.time) {
    updateStatus('Sprawdź datę i godzinę podróży.', true);
    $('reload').disabled = false;
    return;
  }
  $('reload').disabled = true;
  updateStatus('Obliczanie połączeń...');
  try {
    const data = await api('/api/coverage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (request !== calculationRequest) return;
    $('directCount').textContent = data.counts.direct.toLocaleString('pl-PL');
    $('transferCount').textContent = data.counts.transfers.toLocaleString('pl-PL');
    $('originCount').textContent = data.counts.origins.toLocaleString('pl-PL');
    drawCoverage(data);
    const message = {
      outside_coverage: 'Data poza okresem dostępnych danych GTFS.',
      no_active_service: 'Brak aktywnych kursów dla wybranej daty i godziny.',
      no_origin_stops: 'Brak przystanków w zadanym czasie dojścia od adresu.',
    }[data.status];
    updateStatus(
      message ||
        `Gotowe: ${data.counts.origins} przystanków początkowych, ${data.counts.direct} tras bezpośrednich i ${data.counts.transfers} z przesiadką${body.includeTransfers ? '' : ' (ukryte)'}.`,
      Boolean(message),
    );
  } catch (error) {
    if (request === calculationRequest)
      updateStatus(`Nie udało się obliczyć połączeń: ${error.message}`, true);
  } finally {
    if (request === calculationRequest) $('reload').disabled = false;
  }
}
function scheduleCalculation() {
  calculationRequest++;
  clearTimeout(calculationTimer);
  calculationTimer = setTimeout(calculate, 0);
}
function updateRangeValue(id, suffix) {
  $(`${id}Value`).textContent = `${$(id).value} ${suffix}`;
}
function initialize() {
  const now = new Date();
  $('travelDate').value =
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  $('travelTime').value =
    `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  $('addressForm').addEventListener('submit', setAddress);
  $('addressInput').addEventListener('input', () => {
    clearTimeout(suggestionTimer);
    suggestionRequest++;
    addressSuggestions.clear();
    $('addressSuggestions').replaceChildren();
    if ($('addressInput').value.trim().length >= 3)
      suggestionTimer = setTimeout(suggestAddresses, 350);
  });
  $('savedAddresses').addEventListener('change', () => {
    suggestionRequest++;
    const point = readAddressHistory().find((item) => item.address === $('savedAddresses').value);
    if (point) selectAddress(point, 'Przywrócono');
  });
  $('reload').addEventListener('click', calculate);
  ['journeyLimit', 'minimumTransfer'].forEach((id) =>
    $(id).addEventListener('input', () => {
      updateRangeValue(id, 'min');
      scheduleCalculation();
    }),
  );
  $('walkMinutes').addEventListener('input', () => {
    updateWalkMinutes();
    scheduleCalculation();
  });
  ['travelDate', 'travelTime', 'includeTransfers'].forEach((id) =>
    $(id).addEventListener('input', scheduleCalculation),
  );
  renderAddressHistory();
  const saved = readAddressHistory()[0];
  if (saved) selectAddress(saved, 'Przywrócono');
}
initialize();
