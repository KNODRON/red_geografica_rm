'use strict';

const CONFIG = {
  center: [-33.52, -70.67],
  zoom: 10,
  nearbyKm: 1,
  networks: [
    { id: 'autopistas', label: 'AUTOPISTAS', color: '#4CAF50', file: 'data/autopistas.geojson', icon: 'A' },
    { id: 'municipalidades', label: 'MUNICIPALIDADES', color: '#8E44AD', file: 'data/municipalidades.json', icon: 'M' },
    { id: 'transportes', label: 'MINISTERIO DE TRANSPORTES', color: '#178BC1', file: 'data/transportes.geojson', icon: 'T' },
    { id: 'spd', label: 'S.P.D.', color: '#E74C3C', file: 'data/spd.geojson', icon: 'S' },
    { id: 'cuarteles', label: 'CUARTELES CARABINEROS', color: '#D4A017', file: 'data/cuarteles_rm.geojson', icon: 'C' },
    { id: 'aerodromos', label: 'AERÓDROMOS / AEROPUERTOS', color: '#F97316', file: 'data/aerodromos_RM.json', icon: 'A' },
    { id: 'helipuertos', label: 'HELIPUERTOS', color: '#2563EB', file: 'data/helipuertos_RM.json', icon: 'H' }
  ]
};

const state = {
  features: [],
  visible: [],
  selected: [],
  markers: new Map(),
  activeGroups: new Map(),
  baseMode: 'light',
  pointMode: true,
  referencePoint: null,
  queryMarker: null,
  selectedShape: null,
  drawHandler: null,
  ignoreMapClickUntil: 0
};

const map = L.map('map', { zoomControl: false, preferCanvas: true }).setView(CONFIG.center, CONFIG.zoom);
const tiles = {
  light: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 20, attribution: '&copy; OpenStreetMap &copy; CARTO' }),
  osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }),
  satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Esri' })
};
tiles.light.addTo(map);

const markerLayer = L.layerGroup().addTo(map);
const selectionLayer = L.featureGroup().addTo(map);

const $ = id => document.getElementById(id);

function normalizeText(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

function distanceKm(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const q = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(q), Math.sqrt(1 - q));
}

function coords(feature) {
  const [lng, lat] = feature.geometry.coordinates;
  return L.latLng(lat, lng);
}

function networkOf(feature) { return CONFIG.networks.find(n => n.id === feature.__network); }

function longAutopista(contract = '') {
  const value = String(contract).trim();
  const normalized = normalizeText(value);
  if (normalized.includes('santiago - los vilos')) return 'Ruta 5 Santiago–Los Vilos';
  if (normalized.includes('norte-sur') || normalized.includes('norte sur')) return 'Sistema Norte–Sur';
  if (normalized.includes('vespucio norte')) return 'Vespucio Norte';
  if (normalized.includes('vespucio sur')) return 'Vespucio Sur';
  if (normalized.includes('costanera norte')) return 'Costanera Norte';
  if (normalized.includes('americo vespucio oriente') || normalized.includes('av. americo vespucio oriente')) return 'Américo Vespucio Oriente';
  if (normalized.includes('acceso vial aeropuerto') || normalized.includes('aeropuerto')) return 'Acceso Vial Aeropuerto';
  return value || 'Otras autopistas';
}

function subgroupOf(feature) {
  const p = feature.properties || {};
  if (feature.__network === 'autopistas') return longAutopista(p.contrato);
  if (feature.__network === 'municipalidades') return p.municipalidad || p.nom_comuna || p.comuna || 'Municipalidad sin especificar';
  if (feature.__network === 'transportes') return p.red || p.subgrupo || p.tipo || 'Red MTT';
  if (feature.__network === 'spd') return p.red || p.subgrupo || 'Red de pórticos SPD';
  if (feature.__network === 'cuarteles') return p.prefectura || p.tipo || 'Cuarteles RM';
  if (feature.__network === 'aerodromos') return p.tipo || p.red || 'Infraestructura aeronáutica';
  if (feature.__network === 'helipuertos') return p.operador || p.red || 'Helipuertos RM';
  return 'Sin grupo';
}

function featureName(feature) {
  const p = feature.properties || {};
  return p.descripcio || p.nombre || p.name || `Punto ${p.objectid || ''}`.trim();
}

function featureId(feature) {
  const p = feature.properties || {};
  return p.id || p.codigo || p.codigo_oaci || p.codigo_iata || p.osm_id || p.objectid || 'S/I';
}

function featureCommune(feature) {
  const p = feature.properties || {};
  return p.nom_comuna || p.comuna || 'S/I';
}

function popupHtml(feature, distance = null) {
  const p = feature.properties || {};
  const n = networkOf(feature);
  const extraAeronautico = ['aerodromos', 'helipuertos'].includes(feature.__network) ? `
    <p><b>Código OACI:</b> ${escapeHtml(p.codigo_oaci || 'S/I')}</p>
    <p><b>Código IATA:</b> ${escapeHtml(p.codigo_iata || 'S/I')}</p>
    <p><b>Uso / operador:</b> ${escapeHtml(p.uso || p.operador || 'S/I')}</p>
    <p><b>Superficie:</b> ${escapeHtml(p.superficie || 'S/I')}</p>
    <p><b>Fuente:</b> ${escapeHtml(p.fuente || p.red || 'S/I')}</p>` : '';
  return `<div class="popup-card">
    <h3>${escapeHtml(featureName(feature))}</h3>
    <p><b>Red:</b> ${escapeHtml(n.label)}</p>
    <p><b>Grupo:</b> ${escapeHtml(subgroupOf(feature))}</p>
    <p><b>Comuna:</b> ${escapeHtml(featureCommune(feature))}</p>
    <p><b>Tramo / referencia:</b> ${escapeHtml(p.tramo || p.direccion || p.region || 'S/I')}</p>
    <p><b>Tipo:</b> ${escapeHtml(p.tipo_peaje || p.tipo || 'S/I')}</p>
    ${extraAeronautico}
    ${distance != null ? `<p><b>Distancia:</b> ${distance.toFixed(2)} km</p>` : ''}
  </div>`;
}

async function loadNetwork(network) {
  const response = await fetch(network.file, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${network.file}: HTTP ${response.status}`);
  const data = await response.json();

  // Acepta tanto GeoJSON FeatureCollection como arreglos simples
  // con propiedades lat/lng, como cuarteles_rm.geojson.
  const rawFeatures = Array.isArray(data)
    ? data.map((item, index) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [Number(item.lng ?? item.lon), Number(item.lat)]
        },
        properties: { ...item, objectid: item.objectid ?? index + 1 }
      }))
    : (data.features || []);

  return rawFeatures
    .filter(f => {
      const coordinates = f.geometry?.coordinates;
      return f.geometry?.type === 'Point' &&
        Array.isArray(coordinates) &&
        coordinates.length >= 2 &&
        Number.isFinite(Number(coordinates[0])) &&
        Number.isFinite(Number(coordinates[1]));
    })
    .map(f => ({
      ...f,
      geometry: {
        ...f.geometry,
        coordinates: [Number(f.geometry.coordinates[0]), Number(f.geometry.coordinates[1])]
      },
      __network: network.id,
      __subgroup: null
    }));
}

async function initialize() {
  bindUI();
  updateClock();
  setInterval(updateClock, 1000);

  try {
    const loaded = await Promise.all(CONFIG.networks.map(async network => {
      try { return await loadNetwork(network); }
      catch (error) { console.error(error); showToast(`No se pudo cargar ${network.label}.`); return []; }
    }));
    state.features = loaded.flat();
    state.features.forEach(f => { f.__subgroup = subgroupOf(f); });
    buildGroupState();
    renderNetworkTree();
    applyFilters();
    $('estadoCarga').textContent = 'Datos cargados';
    $('totalGeneral').textContent = state.features.length;
  } catch (error) {
    console.error(error);
    $('estadoCarga').textContent = 'Error de carga';
    showToast('No fue posible iniciar la plataforma. Revisa la consola.');
  }
}

function buildGroupState() {
  const principalIds = [
    'autopistas',
    'transportes',
    'spd'
  ];

  CONFIG.networks.forEach(network => {
    const groups = [
      ...new Set(
        state.features
          .filter(feature => feature.__network === network.id)
          .map(feature => feature.__subgroup)
      )
    ].sort((a, b) => a.localeCompare(b, 'es'));

    /*
     * Solo las redes principales comienzan activadas.
     * Las redes incluidas en "OTRAS REDES" comienzan ocultas.
     */
    state.activeGroups.set(
      network.id,
      principalIds.includes(network.id)
        ? new Set(groups)
        : new Set()
    );
  });
}

function renderNetworkTree() {
  const root = $('networkTree');
  root.innerHTML = '';

  const principalIds = ['autopistas', 'transportes', 'spd'];
  const otherIds = CONFIG.networks
    .map(network => network.id)
    .filter(id => !principalIds.includes(id));

  principalIds.forEach((id, index) => {
    const network = CONFIG.networks.find(item => item.id === id);
    if (network) root.appendChild(createNetworkSection(network, index === 0));
  });

  otherWrapper.className = 'other-networks';
  otherWrapper.innerHTML = `
    <button
      class="other-networks-header"
      type="button"
      aria-expanded="false"
    >
      <span class="other-arrow">►</span>
      <span>OTRAS REDES</span>
    </button>

    <div class="other-networks-body"></div>
  `;

  const otherBody = otherWrapper.querySelector('.other-networks-body');
  otherIds.forEach(id => {
    const network = CONFIG.networks.find(item => item.id === id);
    if (network) otherBody.appendChild(createNetworkSection(network, false));
  });

  otherWrapper.querySelector('.other-networks-header').addEventListener('click', () => {
    const isOpen = otherWrapper.classList.toggle('open');
    otherWrapper.querySelector('.other-arrow').textContent = isOpen ? '▼' : '►';
    otherWrapper.querySelector('.other-networks-header').setAttribute('aria-expanded', String(isOpen));
  });

  root.appendChild(otherWrapper);
}

function createNetworkSection(network, openByDefault = false) {
  const features = state.features.filter(feature => feature.__network === network.id);
  const groups = [...new Set(features.map(feature => feature.__subgroup))]
    .sort((a, b) => a.localeCompare(b, 'es'));

  const section = document.createElement('section');
  section.className = `network-group ${openByDefault ? 'open' : ''}`;
  section.style.setProperty('--group-color', network.color);
  section.innerHTML = `
    <button class="group-header" type="button" aria-expanded="${openByDefault}">
      <span class="group-icon" style="background:${network.color}">${network.icon}</span>
      <span class="group-name">${network.label}</span>
      <span class="group-count">${features.length}</span>
    </button>
    <div class="group-body"></div>
  `;

  const header = section.querySelector('.group-header');
  header.addEventListener('click', () => {
    const isOpen = section.classList.toggle('open');
    header.setAttribute('aria-expanded', String(isOpen));
  });

  const body = section.querySelector('.group-body');
  if (!groups.length) {
    body.innerHTML = '<div class="group-empty">Sin datos cargados por el momento.</div>';
  } else {
    const activeSet = state.activeGroups.get(network.id);
const allActive =
  groups.length > 0 &&
  groups.every(group => activeSet?.has(group));

body.appendChild(
  createLayerRow(
    network,
    '__all__',
    `Todas (${features.length})`,
    features.length,
    allActive
  )
);

groups.forEach(group => {
  const count = features.filter(
    feature => feature.__subgroup === group
  ).length;

  body.appendChild(
    createLayerRow(
      network,
      group,
      group,
      count,
      activeSet?.has(group) || false
    )
  );
});
}

  return section;
}

function createLayerRow(network, group, label, count, checked) {
  const row = document.createElement('label');
  row.className = 'layer-row';
  const input = document.createElement('input');
  input.type = 'checkbox'; input.checked = checked;
  input.dataset.network = network.id; input.dataset.group = group;
  const text = document.createElement('span'); text.textContent = label;
  const number = document.createElement('small'); number.textContent = count;
  row.append(input, text, number);
  input.addEventListener('change', () => {
    const set = state.activeGroups.get(network.id);
    const allInputs = [...document.querySelectorAll(`input[data-network="${network.id}"]`)];
    if (group === '__all__') {
      allInputs.filter(i => i.dataset.group !== '__all__').forEach(i => i.checked = input.checked);
      set.clear();
      if (input.checked) allInputs.filter(i => i.dataset.group !== '__all__').forEach(i => set.add(i.dataset.group));
    } else {
      input.checked ? set.add(group) : set.delete(group);
      const all = allInputs.find(i => i.dataset.group === '__all__');
      if (all) all.checked = allInputs.filter(i => i.dataset.group !== '__all__').every(i => i.checked);
    }
    applyFilters();
  });
  return row;
}

function applyFilters(ignoreSearchTerm = false) {
  const term = ignoreSearchTerm
    ? ''
    : normalizeText($('searchInput').value);
  state.visible = state.features.filter(feature => {
    if (!state.activeGroups.get(feature.__network)?.has(feature.__subgroup)) return false;
    if (!term) return true;
    const p = feature.properties || {};
    const haystack = normalizeText([featureName(feature), feature.__subgroup, featureCommune(feature), p.tramo, p.direccion, p.tipo_peaje, p.tipo, p.prefectura, p.provincia, p.codigo, p.codigo_oaci, p.codigo_iata, p.operador, p.uso, p.superficie, p.fuente, p.osm_id].join(' '));
    return haystack.includes(term);
  });
  renderMarkers();
  if (state.selected.length) {
    state.selected = state.selected.filter(f => state.visible.includes(f));
    renderResults();
  }
}

function renderMarkers() {
  markerLayer.clearLayers();
  state.markers.clear();
  state.visible.forEach(feature => {
    const network = networkOf(feature);
    const point = coords(feature);
    const marker = L.circleMarker(point, { radius: 6, color: '#fff', weight: 2, fillColor: network.color, fillOpacity: .95 });
    marker.bindPopup(() => popupHtml(feature, state.referencePoint ? distanceKm(state.referencePoint, point) : null));
    marker.on('click', ev => { L.DomEvent.stopPropagation(ev); focusFeature(feature); });
    marker.addTo(markerLayer);
    state.markers.set(feature, marker);
  });
}

function selectNearby(latlng) {
  clearSelection(false);
  state.referencePoint = latlng;
  state.queryMarker = L.circleMarker(latlng, { radius: 8, color: '#fff', weight: 3, fillColor: '#ff7b19', fillOpacity: 1 }).addTo(selectionLayer);
  const radius = L.circle(latlng, { radius: CONFIG.nearbyKm * 1000, color: '#2c8fee', weight: 2, dashArray: '7 6', fillColor: '#2c8fee', fillOpacity: .07 }).addTo(selectionLayer);
  state.selectedShape = radius;
  state.selected = state.visible.filter(f => distanceKm(latlng, coords(f)) <= CONFIG.nearbyKm).sort((a,b) => distanceKm(latlng,coords(a)) - distanceKm(latlng,coords(b)));
  renderResults();
}

function selectByLayer(layer) {
  state.referencePoint = layer.getBounds ? layer.getBounds().getCenter() : layer.getLatLng();
  state.selected = state.visible.filter(feature => {
    const point = coords(feature);
    if (layer instanceof L.Circle) return layer.getLatLng().distanceTo(point) <= layer.getRadius();
    if (layer instanceof L.Rectangle) return layer.getBounds().contains(point);
    if (layer instanceof L.Polygon) return pointInPolygon(point, layer.getLatLngs()[0]);
    return false;
  });
  state.selected.sort((a,b) => distanceKm(state.referencePoint,coords(a)) - distanceKm(state.referencePoint,coords(b)));
  renderResults();
}

function pointInPolygon(point, vertices) {
  let inside = false;
  const x = point.lng, y = point.lat;
  for (let i=0,j=vertices.length-1;i<vertices.length;j=i++) {
    const xi=vertices[i].lng, yi=vertices[i].lat, xj=vertices[j].lng, yj=vertices[j].lat;
    const intersect = ((yi>y)!==(yj>y)) && (x < (xj-xi)*(y-yi)/(yj-yi || Number.EPSILON)+xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function renderResults() {
  $('selectedTotal').textContent = state.selected.length;
  $('donutValue').textContent = state.selected.length;
  renderBreakdown();
  renderTable();
  updateSelectedMarkers();
}

function renderBreakdown() {
  const counts = new Map(CONFIG.networks.map(n => [n.id,0]));
  state.selected.forEach(f => counts.set(f.__network, (counts.get(f.__network)||0)+1));
  const root = $('breakdownList'); root.innerHTML = '';
  CONFIG.networks.forEach(n => {
    const row = document.createElement('div'); row.className='breakdown-row';
    row.innerHTML = `<i style="background:${n.color}"></i><span>${n.label}</span><strong>${counts.get(n.id)||0}</strong>`;
    root.appendChild(row);
  });
  const total = Math.max(state.selected.length,1);
  let start=0; const segments=[];
  CONFIG.networks.forEach(n => {
    const value=counts.get(n.id)||0; if(!value) return;
    const end=start+(value/total)*100; segments.push(`${n.color} ${start}% ${end}%`); start=end;
  });
  $('donutChart').style.setProperty('--segments', segments.length ? `conic-gradient(${segments.join(',')})` : 'conic-gradient(#303733 0 100%)');
}

function renderTable() {
  const body = $('resultsTable'); body.innerHTML='';
  state.selected.slice(0,8).forEach(feature => {
    const n=networkOf(feature); const point=coords(feature);
    const distance=state.referencePoint ? distanceKm(state.referencePoint,point) : null;
    const row=document.createElement('tr');
    row.innerHTML=`<td style="color:${n.color}">${escapeHtml(featureId(feature))}</td><td>${escapeHtml(featureName(feature))}</td><td>${escapeHtml(n.label)}</td><td>${escapeHtml(featureCommune(feature))}</td><td>${distance==null?'—':distance.toFixed(2)+' km'}</td>`;
    row.addEventListener('click',()=>focusFeature(feature)); body.appendChild(row);
  });
  if(!state.selected.length){ const row=document.createElement('tr'); row.innerHTML='<td colspan="5" style="text-align:center;color:#8d9891;padding:24px">Selecciona un punto o dibuja un área en el mapa.</td>'; body.appendChild(row); }
}

function updateSelectedMarkers() {
  state.markers.forEach((marker,feature)=>{
    const selected=state.selected.includes(feature); const n=networkOf(feature);
    marker.setStyle({ radius:selected?9:6, fillColor:selected?'#ff7016':n.color, weight:selected?3:2, fillOpacity:1 });
  });
}

function focusFeature(feature) {
  const marker=state.markers.get(feature); if(!marker) return;
  map.flyTo(coords(feature), Math.max(map.getZoom(),15), {duration:.7});
  setTimeout(()=>marker.openPopup(),600);
}

function clearSelection(resetResults=true) {
  selectionLayer.clearLayers();
  state.selectedShape=null; state.queryMarker=null; state.referencePoint=null;
  if(resetResults){ state.selected=[]; renderResults(); }
}

function startDraw(type) {
  clearSelection();
  if(state.drawHandler) state.drawHandler.disable();
  const options={ shapeOptions:{color:'#2c8fee',weight:3,dashArray:'8 6',fillColor:'#2c8fee',fillOpacity:.12} };
  if(type==='circle') state.drawHandler=new L.Draw.Circle(map,options);
  if(type==='rectangle') state.drawHandler=new L.Draw.Rectangle(map,options);
  if(type==='polygon') state.drawHandler=new L.Draw.Polygon(map,{...options,allowIntersection:false,showArea:true});
  state.pointMode=false; setActiveTool(`tool${type[0].toUpperCase()+type.slice(1)}`); state.drawHandler.enable();
}

function setActiveTool(id) { document.querySelectorAll('.tool-button').forEach(b=>b.classList.toggle('active',b.id===id)); }

async function executeSearch() {
  const query = $('searchInput').value.trim();

  if (!query) {
    applyFilters(true);
    showToast('Escribe una dirección, intersección o punto de interés.');
    return;
  }

  const searchButton = $('searchButton');
  searchButton.disabled = true;
  searchButton.textContent = '…';

  try {
    const found = await geocodeAddress(query);

    if (found) {
      /*
       * Recuperamos todos los puntos pertenecientes a las capas activadas.
       * El texto escrito corresponde a una dirección, no a un filtro de datos.
       */
      applyFilters(true);

      const latlng = L.latLng(found.lat, found.lon);

      map.flyTo(latlng, 16, {
        duration: 0.8
      });

      selectNearby(latlng);

      state.pointMode = false;
      setActiveTool('');

      showToast(
        `Ubicación encontrada. Se muestran los puntos dentro de ${CONFIG.nearbyKm} km.`
      );

      return;
    }

    /*
     * Si los geocodificadores no encuentran una dirección, buscamos dentro
     * de las capas propias: cámaras, pórticos, hospitales, cuarteles, etc.
     */
    const normalizedQuery = normalizeText(query);

    const internalMatches = state.features
      .filter(feature =>
        state.activeGroups
          .get(feature.__network)
          ?.has(feature.__subgroup)
      )
      .filter(feature => {
        const p = feature.properties || {};

        const searchableText = normalizeText([
          featureName(feature),
          feature.__subgroup,
          featureCommune(feature),
          p.direccion,
          p.tramo,
          p.municipalidad,
          p.prefectura,
          p.tipo,
          p.codigo,
          p.codigo_oaci,
          p.codigo_iata
        ].join(' '));

        return searchableText.includes(normalizedQuery);
      });

    if (internalMatches.length) {
      applyFilters(true);

      const feature = internalMatches[0];
      const latlng = coords(feature);

      map.flyTo(latlng, 16, {
        duration: 0.8
      });

      selectNearby(latlng);

      showToast(
        'Se encontró una coincidencia dentro de las capas de la plataforma.'
      );
    } else {
      applyFilters(true);

      showToast(
        'No se encontró la dirección. Prueba agregando la comuna.'
      );
    }
  } catch (error) {
    console.error('Error durante la búsqueda:', error);

    applyFilters(true);

    showToast(
      'No fue posible consultar la dirección. Revisa la conexión a Internet.'
    );
  } finally {
    searchButton.disabled = false;
    searchButton.textContent = '⌕';
  }
}

function splitIntersection(query) {
  const parts = query
    .split(/\s+(?:con|y|esquina)\s+|[&/]/i)
    .map(value => value.trim())
    .filter(Boolean);

  if (parts.length < 2) {
    return null;
  }

  return [parts[0], parts[1]];
}

function buildGeocodingQueries(query) {
  const original = query.trim();
  const intersection = splitIntersection(original);

  const variants = [original];

  if (intersection) {
    const [streetA, streetB] = intersection;

    variants.push(
      `${streetA} con ${streetB}`,
      `${streetA} y ${streetB}`,
      `${streetA} & ${streetB}`,
      `${streetA}, ${streetB}`
    );
  }

  const contexts = [
    'Región Metropolitana, Chile',
    'Santiago, Chile',
    'Chile'
  ];

  return [
    ...new Set(
      variants.flatMap(value =>
        contexts.map(context => `${value}, ${context}`)
      )
    )
  ];
}

function isInsideRM(lat, lon) {
  /*
   * Límite rectangular amplio para cubrir toda la Región Metropolitana,
   * incluyendo Tiltil, San Pedro, Alhué y San José de Maipo.
   */
  return (
    lat >= -34.35 &&
    lat <= -32.80 &&
    lon >= -71.80 &&
    lon <= -69.75
  );
}

async function geocodeWithArcGIS(candidate) {
  const params = new URLSearchParams({
    SingleLine: candidate,
    f: 'json',
    outFields: 'Match_addr,Addr_type,City,Region,Country',
    outSR: '4326',
    countryCode: 'CHL',
    maxLocations: '10',

    /*
     * Prioriza resultados próximos a Santiago, pero no impide consultar
     * comunas periféricas de la Región Metropolitana.
     */
    location: '-70.6693,-33.4489'
  });

  const url =
    'https://geocode.arcgis.com/arcgis/rest/services/' +
    'World/GeocodeServer/findAddressCandidates?' +
    params.toString();

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(
      `ArcGIS Geocoder respondió HTTP ${response.status}`
    );
  }

  const data = await response.json();

  const candidates = Array.isArray(data.candidates)
    ? data.candidates
    : [];

  const validCandidates = candidates
    .map(item => ({
      lat: Number(item.location?.y),
      lon: Number(item.location?.x),
      label:
        item.address ||
        item.attributes?.Match_addr ||
        candidate,
      score: Number(item.score || 0)
    }))
    .filter(item =>
      Number.isFinite(item.lat) &&
      Number.isFinite(item.lon) &&
      isInsideRM(item.lat, item.lon)
    )
    .sort((a, b) => b.score - a.score);

  return validCandidates[0] || null;
}

async function geocodeWithNominatim(candidate) {
  const params = new URLSearchParams({
    format: 'jsonv2',
    q: candidate,
    countrycodes: 'cl',
    viewbox: '-71.80,-32.80,-69.75,-34.35',
    bounded: '1',
    limit: '5',
    addressdetails: '1',
    'accept-language': 'es'
  });

  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?${params.toString()}`,
    {
      headers: {
        Accept: 'application/json'
      }
    }
  );

  if (!response.ok) {
    throw new Error(
      `Nominatim respondió HTTP ${response.status}`
    );
  }

  const results = await response.json();

  const validResults = results
    .map(item => ({
      lat: Number(item.lat),
      lon: Number(item.lon),
      label: item.display_name || candidate,
      importance: Number(item.importance || 0)
    }))
    .filter(item =>
      Number.isFinite(item.lat) &&
      Number.isFinite(item.lon) &&
      isInsideRM(item.lat, item.lon)
    )
    .sort((a, b) => b.importance - a.importance);

  return validResults[0] || null;
}

async function geocodeAddress(query) {
  const candidates = buildGeocodingQueries(query);

  /*
   * Primer intento: ArcGIS.
   */
  for (const candidate of candidates) {
    try {
      const result = await geocodeWithArcGIS(candidate);

      if (result) {
        return result;
      }
    } catch (error) {
      console.warn('ArcGIS no respondió:', error);
    }
  }

  /*
   * Segundo intento: OpenStreetMap/Nominatim.
   */
  for (const candidate of candidates) {
    try {
      const result = await geocodeWithNominatim(candidate);

      if (result) {
        return result;
      }
    } catch (error) {
      console.warn('Nominatim no respondió:', error);
    }
  }

  return null;
}

function bindUI() {  
  $('searchInput').addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      executeSearch();
    }
  });
  $('searchButton').addEventListener('click', executeSearch);
  $('btnCercanos').addEventListener('click',()=>{ state.pointMode=true; setActiveTool('toolPoint'); showToast(`Haz clic en el mapa. Se buscarán puntos a ${CONFIG.nearbyKm} km.`); });
  $('toolPoint').addEventListener('click',()=>{ state.pointMode=true; if(state.drawHandler)state.drawHandler.disable(); setActiveTool('toolPoint'); });
  $('toolCircle').addEventListener('click',()=>startDraw('circle'));
  $('toolRectangle').addEventListener('click',()=>startDraw('rectangle'));
  $('toolPolygon').addEventListener('click',()=>startDraw('polygon'));
  $('toolClear').addEventListener('click',()=>{ clearSelection(); state.pointMode=true; setActiveTool('toolPoint'); });
  $('btnZoomIn').addEventListener('click',()=>map.zoomIn());
  $('btnZoomOut').addEventListener('click',()=>map.zoomOut());
  $('btnCenter').addEventListener('click',()=>map.setView(CONFIG.center,CONFIG.zoom));
  $('btnLayers').addEventListener('click',cycleBaseMap);
  $('btnRestablecer').addEventListener('click',resetFilters);
  $('btnAgregar').addEventListener('click',()=>showToast('El ingreso de puntos quedará habilitado cuando definamos el sistema de administración y permisos.'));
  $('btnListadoCompleto').addEventListener('click',openFullList);
  $('modalClose').addEventListener('click',closeModal);
  $('modal').addEventListener('click',e=>{if(e.target===$('modal'))closeModal();});
  document.querySelectorAll('.nav-item').forEach(btn=>btn.addEventListener('click',()=>{
    document.querySelectorAll('.nav-item').forEach(b=>b.classList.remove('active')); btn.classList.add('active');
    if(btn.dataset.view!=='mapa') showToast(`${btn.textContent.trim()}: módulo preparado para una etapa posterior.`);
  }));
  map.on('click',e=>{ if(Date.now()<state.ignoreMapClickUntil) return; if(state.pointMode) selectNearby(e.latlng); });
  map.on(L.Draw.Event.CREATED,e=>{
    state.ignoreMapClickUntil=Date.now()+500; selectionLayer.clearLayers(); selectionLayer.addLayer(e.layer); state.selectedShape=e.layer; selectByLayer(e.layer); state.pointMode=false;
  });
}

function resetFilters() {
  $('searchInput').value = '';

  /*
   * Recupera la configuración inicial:
   * redes principales activas y otras redes desactivadas.
   */
  buildGroupState();
  renderNetworkTree();
  applyFilters(true);
  clearSelection();

  showToast(
    'Filtros restablecidos. Solo se muestran las redes principales.'
  );
}

function cycleBaseMap(){
  const modes=['light','osm','satellite']; const idx=modes.indexOf(state.baseMode); const next=modes[(idx+1)%modes.length];
  map.removeLayer(tiles[state.baseMode]); tiles[next].addTo(map); tiles[next].bringToBack(); state.baseMode=next;
  showToast(`Mapa base: ${next==='light'?'claro':next==='osm'?'OpenStreetMap':'satelital'}.`);
}

function openFullList(){
  $('modalTitle').textContent=`Listado completo (${state.selected.length})`;
  const rows=state.selected.map(feature=>{ const n=networkOf(feature); const d=state.referencePoint?distanceKm(state.referencePoint,coords(feature)):null; return `<tr><td>${escapeHtml(featureId(feature))}</td><td>${escapeHtml(featureName(feature))}</td><td>${escapeHtml(n.label)}</td><td>${escapeHtml(feature.__subgroup)}</td><td>${escapeHtml(featureCommune(feature))}</td><td>${d==null?'—':d.toFixed(2)+' km'}</td></tr>`; }).join('');
  $('modalContent').innerHTML=`<table><thead><tr><th>ID</th><th>Nombre</th><th>Organismo</th><th>Grupo</th><th>Comuna</th><th>Distancia</th></tr></thead><tbody>${rows||'<tr><td colspan="6">No hay resultados seleccionados.</td></tr>'}</tbody></table>`;
  $('modal').classList.add('open'); $('modal').setAttribute('aria-hidden','false');
}
function closeModal(){ $('modal').classList.remove('open'); $('modal').setAttribute('aria-hidden','true'); }

function updateClock(){ const now=new Date(); $('fechaActual').textContent=now.toLocaleDateString('es-CL'); $('horaActual').textContent=now.toLocaleTimeString('es-CL'); }
function showToast(message){ const old=document.querySelector('.toast'); if(old)old.remove(); const el=document.createElement('div'); el.className='toast'; el.textContent=message; document.body.appendChild(el); setTimeout(()=>el.remove(),3200); }

document.addEventListener('DOMContentLoaded', initialize);
