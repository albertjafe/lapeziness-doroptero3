import * as THREE from './vendor/three.module.min.js';

const STORAGE_KEY = 'alberto_mystery_house_v1';

const FLOORS = [
  {
    name: 'Vestíbulo',
    subtitle: 'La primera puerta siempre parece conocida.',
    palette: { background: 0xd8d6ce, fog: 0xd8d6ce, wall: 0xe5e0d5, floor: 0x73796d, ceiling: 0xf0ece4, accent: 0xb89a42, door: 0x5f7c68 },
    doors: [
      { id: 'quiet-clock', name: 'Sala del reloj quieto', hint: 'La luz permanece encendida aunque nadie entra.', room: 'Un reloj sin agujas y una silla orientada hacia la pared.', side: -1, z: -2.5 },
      { id: 'service-stairs', name: 'Escalera de servicio', hint: 'Sube un piso más de lo que debería.', room: 'Los peldaños continúan detrás de una puerta demasiado baja.', side: 1, z: -8.5 },
      { id: 'unlisted-patio', name: 'Patio que no figura', hint: 'En los planos, aquí solo hay pared.', room: 'Un patio interior iluminado por un cielo que no cambia.', side: -1, z: -14.5 },
    ],
  },
  {
    name: 'Galería de las puertas',
    subtitle: 'Cada puerta recuerda haber sido abierta.',
    palette: { background: 0xcddbd2, fog: 0xcddbd2, wall: 0xbaccc0, floor: 0x687970, ceiling: 0xe4e8df, accent: 0x397b68, door: 0x708b80 },
    doors: [
      { id: 'rehearsal-room', name: 'Ensayo número 7', hint: 'Desde dentro se oye el comienzo, nunca el final.', room: 'Atriles vacíos esperan una entrada que llega siempre tarde.', side: 1, z: -2.5 },
      { id: 'duplicate-room', name: 'Habitación duplicada', hint: 'Todo aparece dos veces salvo tu reflejo.', room: 'Dos lámparas, dos mesas y una única sombra.', side: -1, z: -8.5 },
      { id: 'green-exit', name: 'Salida verde', hint: 'El letrero señala en ambas direcciones.', room: 'Un corredor estrecho vuelve exactamente al mismo punto.', side: 1, z: -14.5 },
    ],
  },
  {
    name: 'Archivo de la lluvia',
    subtitle: 'Aquí se archivan cosas que todavía no han ocurrido.',
    palette: { background: 0xd3cbd0, fog: 0xd3cbd0, wall: 0xb8adb4, floor: 0x686d73, ceiling: 0xe5dfe2, accent: 0x73586b, door: 0x8b6f7f },
    doors: [
      { id: 'rain-files', name: 'Archivo húmedo', hint: 'Las carpetas llevan fechas de la semana próxima.', room: 'El papel está seco, pero huele a lluvia reciente.', side: -1, z: -2.5 },
      { id: 'listening-room', name: 'Sala de escucha', hint: 'La grabación contiene unos segundos de mañana.', room: 'Una cinta gira sin carrete y reproduce tu respiración.', side: 1, z: -8.5 },
      { id: 'narrow-library', name: 'Biblioteca estrecha', hint: 'Los estantes se acercan cuando apartas la mirada.', room: 'Los lomos no tienen títulos, solo horas.', side: -1, z: -14.5 },
    ],
  },
  {
    name: 'Planta sin número',
    subtitle: 'El ascensor no reconoce esta altura.',
    palette: { background: 0xe3e2dc, fog: 0xe3e2dc, wall: 0xd2d2ca, floor: 0x505653, ceiling: 0xefeee8, accent: 0xc2a437, door: 0x3f4845 },
    doors: [
      { id: 'small-sun', name: 'Habitación del sol pequeño', hint: 'La ventana ilumina desde debajo del suelo.', room: 'Una esfera tibia flota donde debería estar la mesa.', side: 1, z: -2.5 },
      { id: 'wrong-stairs', name: 'Escalera incorrecta', hint: 'Todos los peldaños tienen la misma altura menos uno.', room: 'La escalera desciende y, sin embargo, el techo se aleja.', side: -1, z: -8.5 },
      { id: 'last-door', name: 'La última puerta', hint: 'Todavía no hemos decidido qué espera detrás.', room: 'Solo hay una luz encendida y espacio para el objeto final.', side: 1, z: -14.5 },
    ],
  },
];

const TOTAL_DOORS = FLOORS.reduce((total, floor) => total + floor.doors.length, 0);
const defaultState = () => ({ currentFloor: 0, discoveredDoors: [], developerAccess: true });

let state = loadState();
let renderer;
let scene;
let camera;
let world;
let canvas;
let resizeObserver;
let animationFrame;
let active = false;
let initialized = false;
let selectedDoor = 0;
let doorEntries = [];
let targetYaw = 0;
let yaw = 0;
let pitch = -0.02;
let targetPitch = -0.02;
let pointer = null;
let messageTimer;

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!parsed || !Array.isArray(parsed.discoveredDoors)) return defaultState();
    return {
      currentFloor: Math.max(0, Math.min(FLOORS.length - 1, Number(parsed.currentFloor) || 0)),
      discoveredDoors: parsed.discoveredDoors.filter(id => typeof id === 'string'),
      developerAccess: true,
    };
  } catch (error) {
    return defaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function byId(id) {
  return document.getElementById(id);
}

function init() {
  if (initialized) return true;
  const host = byId('houseCanvasHost');
  if (!host) return false;

  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch (error) {
    byId('houseLoading').innerHTML = '<strong>La escena 3D no ha podido abrirse.</strong><small>Puedes seguir usando el resto de la aplicación.</small>';
    byId('houseLoading').classList.add('is-error');
    return false;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.04;
  canvas = renderer.domElement;
  canvas.className = 'house-canvas';
  canvas.dataset.noViewSwipe = '';
  canvas.setAttribute('aria-label', 'Pasillo tridimensional de la casa misteriosa');
  host.appendChild(canvas);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(52, 1, 0.1, 80);
  camera.position.set(0, 2.15, 5.5);
  world = new THREE.Group();
  scene.add(world);

  bindControls();
  renderFloorRail();
  bindInterface();
  setFloor(state.currentFloor, false);
  resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  window.addEventListener('resize', resize, { passive: true });
  initialized = true;
  requestAnimationFrame(() => byId('houseStage')?.classList.add('is-ready'));
  return true;
}

function disposeObject(object) {
  object.traverse(child => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach(material => {
        if (material.map) material.map.dispose();
        material.dispose();
      });
    }
  });
}

function clearWorld() {
  while (world.children.length) {
    const child = world.children.pop();
    disposeObject(child);
  }
  doorEntries = [];
}

function material(color, roughness = 0.82, metalness = 0.02) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function addBox(parent, geometry, mat, position, options = {}) {
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.castShadow = options.castShadow !== false;
  mesh.receiveShadow = options.receiveShadow !== false;
  if (options.rotation) mesh.rotation.set(...options.rotation);
  parent.add(mesh);
  return mesh;
}

function makePlaque(number, accent) {
  const plaqueCanvas = document.createElement('canvas');
  plaqueCanvas.width = 128;
  plaqueCanvas.height = 96;
  const context = plaqueCanvas.getContext('2d');
  context.fillStyle = '#f4f0e7';
  context.fillRect(0, 0, 128, 96);
  context.strokeStyle = `#${new THREE.Color(accent).getHexString()}`;
  context.lineWidth = 6;
  context.strokeRect(5, 5, 118, 86);
  context.fillStyle = '#252824';
  context.font = '600 42px Georgia';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(String(number).padStart(2, '0'), 64, 50);
  const texture = new THREE.CanvasTexture(plaqueCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  sprite.scale.set(0.72, 0.54, 1);
  return sprite;
}

function buildDoor(doorData, index, palette) {
  const pivot = new THREE.Group();
  pivot.position.set(doorData.side * 4.72, 0, doorData.z);
  world.add(pivot);

  const doorMat = material(palette.door, 0.65, 0.04);
  const panel = addBox(pivot, new THREE.BoxGeometry(0.16, 3.25, 1.78), doorMat, [0, 1.66, doorData.side * 0.89]);
  const insetMat = material(new THREE.Color(palette.door).offsetHSL(0, -0.02, 0.08), 0.72, 0.01);
  [-0.43, 0.43].forEach(localZ => {
    addBox(pivot, new THREE.BoxGeometry(0.025, 0.82, 0.58), insetMat, [-doorData.side * 0.09, 2.05, doorData.side * localZ], { castShadow: false });
    addBox(pivot, new THREE.BoxGeometry(0.025, 0.62, 0.58), insetMat, [-doorData.side * 0.09, 0.95, doorData.side * localZ], { castShadow: false });
  });

  const frameMat = material(0xe7dfd0, 0.55, 0.04);
  const frame = new THREE.Group();
  frame.position.copy(pivot.position);
  world.add(frame);
  addBox(frame, new THREE.BoxGeometry(0.28, 3.65, 0.18), frameMat, [0, 1.82, -1.08]);
  addBox(frame, new THREE.BoxGeometry(0.28, 3.65, 0.18), frameMat, [0, 1.82, 1.08]);
  addBox(frame, new THREE.BoxGeometry(0.28, 0.22, 2.34), frameMat, [0, 3.62, 0]);

  const handleMat = material(palette.accent, 0.25, 0.72);
  const handle = new THREE.Mesh(new THREE.SphereGeometry(0.095, 14, 10), handleMat);
  handle.position.set(-doorData.side * 0.14, 1.58, -doorData.side * 0.58);
  handle.castShadow = true;
  pivot.add(handle);

  const plaque = makePlaque(index + 1, palette.accent);
  plaque.position.set(-doorData.side * 0.13, 2.86, 0);
  plaque.rotation.y = doorData.side > 0 ? -Math.PI / 2 : Math.PI / 2;
  frame.add(plaque);

  [panel, handle].forEach(mesh => {
    mesh.userData.doorIndex = index;
  });
  doorEntries.push({ pivot, panel, handle, data: doorData, side: doorData.side, open: false, targetAngle: 0 });
}

function addFloorDetails(floorIndex, palette) {
  const accentMat = material(palette.accent, 0.38, 0.42);
  if (floorIndex === 0) {
    for (let i = 0; i < 3; i += 1) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42 + i * 0.17, 0.025, 8, 48), accentMat);
      ring.rotation.y = Math.PI / 2;
      ring.position.set(0, 2.3, -19.55 + i * 0.015);
      world.add(ring);
    }
  } else if (floorIndex === 1) {
    for (let z = -1; z > -19; z -= 3) {
      addBox(world, new THREE.BoxGeometry(8.6, 0.055, 0.045), accentMat, [0, 4.78, z], { castShadow: false });
    }
  } else if (floorIndex === 2) {
    const rainMat = new THREE.MeshStandardMaterial({ color: palette.accent, transparent: true, opacity: 0.42, roughness: 0.3 });
    for (let i = 0; i < 34; i += 1) {
      const x = -4.2 + ((i * 1.73) % 8.4);
      const z = -1 - ((i * 2.41) % 18);
      addBox(world, new THREE.BoxGeometry(0.018, 2.2 + (i % 4) * 0.36, 0.018), rainMat, [x, 3.5, z], { castShadow: false });
    }
  } else {
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.48, 32, 20), new THREE.MeshStandardMaterial({ color: 0xd9bd4a, emissive: 0xb89428, emissiveIntensity: 1.8, roughness: 0.55 }));
    sphere.position.set(0, 0.82, -18.9);
    sphere.castShadow = true;
    sphere.userData.floatObject = true;
    world.add(sphere);
    const light = new THREE.PointLight(0xf4d96a, 5.5, 11, 2);
    light.position.copy(sphere.position);
    light.userData.floatLight = true;
    world.add(light);
  }
}

function buildFloor(index) {
  clearWorld();
  const floor = FLOORS[index];
  const p = floor.palette;
  scene.background = new THREE.Color(p.background);
  scene.fog = new THREE.Fog(p.fog, 10, 31);

  const floorMat = material(p.floor, 0.92, 0.01);
  const wallMat = material(p.wall, 0.92, 0.01);
  const ceilingMat = material(p.ceiling, 0.9, 0.01);
  addBox(world, new THREE.BoxGeometry(10.2, 0.22, 28), floorMat, [0, -0.15, -7.5], { castShadow: false });
  addBox(world, new THREE.BoxGeometry(0.22, 5.4, 28), wallMat, [-5.05, 2.55, -7.5], { castShadow: false });
  addBox(world, new THREE.BoxGeometry(0.22, 5.4, 28), wallMat, [5.05, 2.55, -7.5], { castShadow: false });
  addBox(world, new THREE.BoxGeometry(10.2, 0.18, 28), ceilingMat, [0, 5.18, -7.5], { castShadow: false });
  addBox(world, new THREE.BoxGeometry(10.2, 5.4, 0.22), wallMat, [0, 2.55, -21.4], { castShadow: false });

  const baseMat = material(new THREE.Color(p.wall).offsetHSL(0, 0, -0.09), 0.8, 0.02);
  addBox(world, new THREE.BoxGeometry(0.1, 0.24, 27), baseMat, [-4.88, 0.12, -7.5], { castShadow: false });
  addBox(world, new THREE.BoxGeometry(0.1, 0.24, 27), baseMat, [4.88, 0.12, -7.5], { castShadow: false });

  const hemi = new THREE.HemisphereLight(p.ceiling, p.floor, 2.25);
  world.add(hemi);
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xf7f3dc, emissive: 0xf4e9b7, emissiveIntensity: 1.55, roughness: 0.45 });
  [-0.5, -6.5, -12.5, -18.5].forEach((z, lightIndex) => {
    addBox(world, new THREE.BoxGeometry(2.8, 0.05, 0.22), lightMat, [0, 5.04, z], { castShadow: false });
    if (lightIndex % 2 === 0) {
      const point = new THREE.PointLight(0xfff1bf, 3.4, 10, 2);
      point.position.set(0, 4.7, z);
      point.castShadow = lightIndex === 0;
      world.add(point);
    }
  });

  const stripeMat = material(new THREE.Color(p.accent).offsetHSL(0, -0.18, 0.05), 0.8, 0.02);
  for (let z = 3; z > -21; z -= 2) {
    addBox(world, new THREE.BoxGeometry(0.035, 0.025, 1.05), stripeMat, [0, -0.01, z], { castShadow: false });
  }

  floor.doors.forEach((door, doorIndex) => buildDoor(door, doorIndex, p));
  addFloorDetails(index, p);
  selectedDoor = Math.min(selectedDoor, floor.doors.length - 1);
  updateDoorHighlight();
}

function renderFloorRail() {
  const rail = byId('houseFloorRail');
  if (!rail) return;
  rail.innerHTML = FLOORS.map((floor, index) => `
    <button type="button" data-house-floor="${index}" aria-label="Ir a ${floor.name}">
      <span>${String(index).padStart(2, '0')}</span>
      <small>${floor.name}</small>
    </button>
  `).join('');
  rail.querySelectorAll('[data-house-floor]').forEach(button => {
    button.addEventListener('click', () => setFloor(Number(button.dataset.houseFloor)));
  });
}

function setFloor(index, announce = true) {
  const safeIndex = Math.max(0, Math.min(FLOORS.length - 1, Number(index) || 0));
  state.currentFloor = safeIndex;
  selectedDoor = 0;
  saveState();
  if (world) buildFloor(safeIndex);
  yaw = 0;
  targetYaw = 0;
  pitch = -0.02;
  targetPitch = -0.02;
  updateUI();
  const stage = byId('houseStage');
  stage?.classList.add('is-switching');
  setTimeout(() => stage?.classList.remove('is-switching'), 360);
  if (announce) showMessage(`Estrato ${String(safeIndex).padStart(2, '0')}: ${FLOORS[safeIndex].name}`);
}

function updateUI() {
  const floor = FLOORS[state.currentFloor];
  const door = floor.doors[selectedDoor];
  byId('houseFloorKicker').textContent = `ESTRATO ${String(state.currentFloor).padStart(2, '0')}`;
  byId('houseFloorTitle').textContent = floor.name;
  byId('houseFloorSubtitle').textContent = floor.subtitle;
  const count = state.discoveredDoors.length;
  byId('houseDiscoveryCount').textContent = `${count} de ${TOTAL_DOORS} puertas`;
  byId('houseDiscoveryBar').style.width = `${(count / TOTAL_DOORS) * 100}%`;
  document.querySelectorAll('[data-house-floor]').forEach(button => {
    const current = Number(button.dataset.houseFloor) === state.currentFloor;
    button.classList.toggle('active', current);
    button.setAttribute('aria-current', current ? 'true' : 'false');
  });
  const discovered = state.discoveredDoors.includes(door.id);
  byId('houseDoorStatus').textContent = `${discovered ? 'DESCUBIERTA' : 'PUERTA'} ${String(selectedDoor + 1).padStart(2, '0')}`;
  byId('houseDoorTitle').textContent = door.name;
  byId('houseDoorHint').textContent = discovered ? door.room : door.hint;
  byId('houseDoorOpen').textContent = doorEntries[selectedDoor]?.open ? 'Cerrar' : 'Abrir';
  byId('houseDoorObjective').innerHTML = discovered
    ? '<span class="is-found"></span>Descubierta en este boceto.'
    : '<span></span>Prototipo libre: después conectaremos esta puerta a un objetivo.';
  updateDoorHighlight();
}

function updateDoorHighlight() {
  doorEntries.forEach((entry, index) => {
    if (!entry.panel?.material) return;
    entry.panel.material.emissive.setHex(index === selectedDoor ? FLOORS[state.currentFloor].palette.accent : 0x000000);
    entry.panel.material.emissiveIntensity = index === selectedDoor ? 0.14 : 0;
  });
}

function selectDoor(index) {
  const doors = FLOORS[state.currentFloor].doors;
  selectedDoor = (index + doors.length) % doors.length;
  const door = doors[selectedDoor];
  targetYaw = THREE.MathUtils.clamp(door.side * 0.32, -0.38, 0.38);
  targetPitch = door.z < -10 ? 0.01 : -0.03;
  updateUI();
}

function toggleSelectedDoor() {
  const entry = doorEntries[selectedDoor];
  if (!entry) return;
  entry.open = !entry.open;
  entry.targetAngle = entry.open ? (entry.side > 0 ? -1.32 : 1.32) : 0;
  if (entry.open && !state.discoveredDoors.includes(entry.data.id)) {
    state.discoveredDoors.push(entry.data.id);
    saveState();
    showMessage(`Descubierta: ${entry.data.name}`);
  }
  updateUI();
}

function discoverFloor() {
  FLOORS[state.currentFloor].doors.forEach(door => {
    if (!state.discoveredDoors.includes(door.id)) state.discoveredDoors.push(door.id);
  });
  saveState();
  updateUI();
  showMessage('Planta descubierta');
}

function discoverAll() {
  state.discoveredDoors = FLOORS.flatMap(floor => floor.doors.map(door => door.id));
  saveState();
  updateUI();
  showMessage('Todas las puertas están disponibles');
}

function resetPrototype() {
  state = defaultState();
  saveState();
  setFloor(0, false);
  showMessage('Boceto restablecido');
}

function showMessage(text) {
  const message = byId('houseMessage');
  if (!message) return;
  clearTimeout(messageTimer);
  message.textContent = text;
  message.classList.add('show');
  messageTimer = setTimeout(() => message.classList.remove('show'), 2800);
}

function toggleDevPanel(force) {
  const panel = byId('houseDevPanel');
  const toggle = byId('houseDevToggle');
  const open = typeof force === 'boolean' ? force : panel.hidden;
  panel.hidden = !open;
  toggle.setAttribute('aria-expanded', String(open));
}

function bindInterface() {
  byId('houseDoorPrev').addEventListener('click', () => selectDoor(selectedDoor - 1));
  byId('houseDoorNext').addEventListener('click', () => selectDoor(selectedDoor + 1));
  byId('houseDoorOpen').addEventListener('click', toggleSelectedDoor);
  byId('houseDevToggle').addEventListener('click', () => toggleDevPanel());
  byId('houseDevClose').addEventListener('click', () => toggleDevPanel(false));
  byId('houseDevUnlockAll').addEventListener('click', discoverAll);
  byId('houseDevRevealFloor').addEventListener('click', discoverFloor);
  byId('houseDevReset').addEventListener('click', resetPrototype);
}

function bindControls() {
  canvas.addEventListener('pointerdown', event => {
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const dx = event.clientX - pointer.lastX;
    const dy = event.clientY - pointer.lastY;
    if (Math.abs(event.clientX - pointer.x) + Math.abs(event.clientY - pointer.y) > 7) pointer.moved = true;
    targetYaw = THREE.MathUtils.clamp(targetYaw - dx * 0.0045, -0.55, 0.55);
    targetPitch = THREE.MathUtils.clamp(targetPitch - dy * 0.003, -0.18, 0.14);
    pointer.lastX = event.clientX;
    pointer.lastY = event.clientY;
  });
  canvas.addEventListener('pointerup', event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    if (!pointer.moved) pickDoor(event.clientX, event.clientY);
    pointer = null;
  });
  canvas.addEventListener('pointercancel', () => { pointer = null; });
  canvas.addEventListener('wheel', event => {
    camera.position.z = THREE.MathUtils.clamp(camera.position.z + event.deltaY * 0.0025, 3.8, 7.2);
  }, { passive: true });
}

function pickDoor(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const pointerVector = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(pointerVector, camera);
  const hits = raycaster.intersectObjects(doorEntries.flatMap(entry => [entry.panel, entry.handle]), false);
  if (!hits.length) return;
  selectDoor(Number(hits[0].object.userData.doorIndex));
}

function resize() {
  const host = byId('houseCanvasHost');
  if (!host || !renderer || !camera) return;
  const width = Math.max(1, host.clientWidth);
  const height = Math.max(1, host.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.fov = width < 600 ? 61 : 52;
  camera.updateProjectionMatrix();
}

function renderFrame(time = 0) {
  if (!renderer || !scene || !camera) return;
  yaw += (targetYaw - yaw) * 0.075;
  pitch += (targetPitch - pitch) * 0.075;
  camera.rotation.order = 'YXZ';
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;
  camera.position.x = Math.sin(time * 0.00018) * 0.025;
  camera.position.y = 2.15 + Math.sin(time * 0.00045) * 0.012;
  doorEntries.forEach(entry => {
    entry.pivot.rotation.y += (entry.targetAngle - entry.pivot.rotation.y) * 0.11;
  });
  world?.traverse(child => {
    if (child.userData.floatObject) child.position.y = 0.82 + Math.sin(time * 0.0012) * 0.08;
    if (child.userData.floatLight) child.position.y = 0.82 + Math.sin(time * 0.0012) * 0.08;
  });
  renderer.render(scene, camera);
}

function loop(time) {
  if (!active) return;
  renderFrame(time);
  animationFrame = requestAnimationFrame(loop);
}

function enter() {
  active = true;
  if (!init()) return;
  resize();
  updateUI();
  cancelAnimationFrame(animationFrame);
  animationFrame = requestAnimationFrame(loop);
}

function exitHouse() {
  active = false;
  cancelAnimationFrame(animationFrame);
  toggleDevPanel(false);
}

function samplePixels() {
  if (!renderer) return { colored: 0, unique: 0 };
  renderFrame(performance.now());
  const gl = renderer.getContext();
  const width = gl.drawingBufferWidth;
  const height = gl.drawingBufferHeight;
  const colors = new Set();
  let colored = 0;
  const pixel = new Uint8Array(4);
  for (let x = 1; x < 8; x += 1) {
    for (let y = 1; y < 8; y += 1) {
      gl.readPixels(Math.floor(width * x / 8), Math.floor(height * y / 8), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      const key = `${pixel[0]},${pixel[1]},${pixel[2]}`;
      colors.add(key);
      if (pixel[0] + pixel[1] + pixel[2] > 20) colored += 1;
    }
  }
  return { colored, unique: colors.size, width, height };
}

window.mysteryHouseEnter = enter;
window.mysteryHouseExit = exitHouse;
window.__mysteryHouseDebug = {
  getState: () => JSON.parse(JSON.stringify(state)),
  selectFloor: setFloor,
  selectDoor,
  openSelected: toggleSelectedDoor,
  samplePixels,
};

window.addEventListener('app:viewchange', event => {
  if (event.detail?.name === 'casa') enter();
  else exitHouse();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') exitHouse();
  else if (document.body.dataset.view === 'casa') enter();
});

if (document.body.dataset.view === 'casa') enter();
