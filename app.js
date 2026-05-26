// --- CONFIGURATION ---
const LANE_WIDTH = 3;
const LANES = [-LANE_WIDTH, 0, LANE_WIDTH]; // Left, Center, Right
const START_SPEED = 20;
const MAX_SPEED = 60;
const GRAVITY = -50;
const JUMP_VELOCITY = 20;
const SPAN_LENGTH = 150; // How far ahead to spawn
const Z_OFFSET = -10; // Start offset

// Colors
const COLOR_NEON_PINK = 0xff007f;
const COLOR_NEON_CYAN = 0x00ffff;
const COLOR_BG = 0x0a0a1a;
const COLOR_OBSTACLE = 0xff0044;

// --- STATE ---
let scene, camera, renderer, clock;
let player;
let isPlaying = false;
let score = 0;
let highScore = localStorage.getItem('neonRunnerHighScore') || 0;
let currentSpeed = START_SPEED;
let currentLane = 1; // 0, 1, 2
let yVelocity = 0;
let distanceTraveled = 0;

// Object Pools
const obstaclePool = [];
const crystalPool = [];
const activeObjects = [];

// DOM Elements
const uiLayer = document.getElementById('ui-layer');
const startScreen = document.getElementById('start-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const scoreEl = document.getElementById('score');
const highScoreEl = document.getElementById('high-score');
const finalScoreEl = document.getElementById('final-score');
const startBtn = document.getElementById('start-btn');
const restartBtn = document.getElementById('restart-btn');

highScoreEl.innerText = Math.floor(highScore);

// --- INITIALIZATION ---
function init() {
    // 1. Scene Setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(COLOR_BG);
    scene.fog = new THREE.Fog(COLOR_BG, 10, 100);

    // 2. Camera Setup
    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
    camera.position.set(0, 4, 10);
    camera.lookAt(0, 0, -20);

    // 3. Renderer Setup - Optimized for 120Hz/Adreno 619
    renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    renderer.setSize(window.innerWidth, window.innerHeight);
    // Limit pixel ratio to 1.5 max to save fill rate on mid-range devices while staying sharp
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.shadowMap.enabled = false; // Disable shadows for performance
    document.getElementById('game-container').appendChild(renderer.domElement);

    clock = new THREE.Clock();

    // 4. Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(COLOR_NEON_CYAN, 0.8);
    dirLight.position.set(10, 20, 0);
    scene.add(dirLight);

    // 5. Environment
    createGrid();
    createPlayer();

    // 6. Pre-fill Object Pools
    initPools();

    // 7. Event Listeners
    setupControls();

    // Throttled resize
    let resizeTimeout;
    window.addEventListener('resize', () => {
        if (resizeTimeout) clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(onWindowResize, 100);
    }, { passive: true });

    startBtn.addEventListener('click', startGame);
    restartBtn.addEventListener('click', startGame);

    // Start render loop
    requestAnimationFrame(animate);
}

// --- WORLD BUILDING ---
function createGrid() {
    // Simple wireframe grid for synthwave look
    const gridHelper = new THREE.GridHelper(200, 100, COLOR_NEON_PINK, COLOR_NEON_PINK);
    gridHelper.position.y = -0.5;
    scene.add(gridHelper);

    // Solid floor under grid
    const floorGeo = new THREE.PlaneGeometry(200, 200);
    const floorMat = new THREE.MeshBasicMaterial({ color: 0x050510 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.51;
    scene.add(floor);
}

function createPlayer() {
    const geo = new THREE.SphereGeometry(0.5, 16, 16);
    const mat = new THREE.MeshPhongMaterial({
        color: COLOR_NEON_CYAN,
        emissive: 0x004444,
        shininess: 100
    });
    player = new THREE.Mesh(geo, mat);
    player.position.set(LANES[currentLane], 0, 0);
    scene.add(player);
}

// --- POOLING SYSTEM ---
const boxGeo = new THREE.BoxGeometry(1.5, 1.5, 1.5);
const boxMat = new THREE.MeshPhongMaterial({ color: COLOR_OBSTACLE });

const crystalGeo = new THREE.OctahedronGeometry(0.5);
const crystalMat = new THREE.MeshPhongMaterial({ color: COLOR_NEON_CYAN, wireframe: true });

function initPools() {
    for (let i = 0; i < 30; i++) {
        // Obstacles
        const obs = new THREE.Mesh(boxGeo, boxMat);
        obs.visible = false;
        obs.type = 'obstacle';
        scene.add(obs);
        obstaclePool.push(obs);

        // Crystals
        const cry = new THREE.Mesh(crystalGeo, crystalMat);
        cry.visible = false;
        cry.type = 'crystal';
        scene.add(cry);
        crystalPool.push(cry);
    }
}

function spawnObject(zPos) {
    // 70% chance to spawn an object in a row
    if (Math.random() > 0.7) return;

    const laneIndex = Math.floor(Math.random() * 3);
    const xPos = LANES[laneIndex];

    // 80% chance obstacle, 20% crystal
    const isObstacle = Math.random() < 0.8;

    let obj;
    if (isObstacle) {
        if (obstaclePool.length === 0) return;
        obj = obstaclePool.pop();
        obj.position.set(xPos, 0.25, zPos);
    } else {
        if (crystalPool.length === 0) return;
        obj = crystalPool.pop();
        obj.position.set(xPos, 0.5, zPos);
    }

    obj.visible = true;
    activeObjects.push(obj);
}

function returnToPool(obj) {
    obj.visible = false;
    if (obj.type === 'obstacle') {
        obstaclePool.push(obj);
    } else {
        crystalPool.push(obj);
    }
}

// --- INPUT HANDLING ---
function setupControls() {
    // Keyboard
    window.addEventListener('keydown', (e) => {
        if (!isPlaying) return;
        if (e.key === 'ArrowLeft' || e.key === 'a') moveLeft();
        if (e.key === 'ArrowRight' || e.key === 'd') moveRight();
        if (e.key === 'ArrowUp' || e.key === 'w' || e.key === ' ') jump();
    });

    // Touch / Swipe
    let touchStartX = 0;
    let touchStartY = 0;

    const container = document.getElementById('game-container');

    container.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
    }, { passive: true });

    container.addEventListener('touchend', (e) => {
        if (!isPlaying) return;
        const touchEndX = e.changedTouches[0].screenX;
        const touchEndY = e.changedTouches[0].screenY;

        const dx = touchEndX - touchStartX;
        const dy = touchEndY - touchStartY;

        // Require minimum swipe distance
        if (Math.abs(dx) > 30 || Math.abs(dy) > 30) {
            if (Math.abs(dx) > Math.abs(dy)) {
                // Horizontal swipe
                if (dx > 0) moveRight();
                else moveLeft();
            } else {
                // Vertical swipe
                if (dy < 0) jump(); // Swipe up
            }
        }
    }, { passive: true });

    // UI Buttons
    document.getElementById('btn-left').addEventListener('touchstart', (e) => { e.preventDefault(); moveLeft(); });
    document.getElementById('btn-right').addEventListener('touchstart', (e) => { e.preventDefault(); moveRight(); });
    document.getElementById('btn-up').addEventListener('touchstart', (e) => { e.preventDefault(); jump(); });
}

function moveLeft() {
    if (currentLane > 0) currentLane--;
}

function moveRight() {
    if (currentLane < 2) currentLane++;
}

function jump() {
    if (player.position.y <= 0) {
        yVelocity = JUMP_VELOCITY;
    }
}

// --- GAME LOGIC ---
function startGame() {
    isPlaying = true;
    score = 0;
    currentSpeed = START_SPEED;
    distanceTraveled = 0;
    currentLane = 1;
    player.position.set(LANES[currentLane], 0, 0);
    yVelocity = 0;

    uiLayer.classList.add('hidden');
    startScreen.classList.add('hidden');
    gameOverScreen.classList.add('hidden');

    scoreEl.innerText = '0';

    // Clear active objects
    for (let i = activeObjects.length - 1; i >= 0; i--) {
        returnToPool(activeObjects[i]);
    }
    activeObjects.length = 0;

    // Initial spawn
    for (let i = 20; i < SPAN_LENGTH; i += 10) {
        spawnObject(-i);
    }

    clock.start();
}

function gameOver() {
    isPlaying = false;
    uiLayer.classList.remove('hidden');
    gameOverScreen.classList.remove('hidden');
    finalScoreEl.innerText = Math.floor(score);

    if (score > highScore) {
        highScore = score;
        localStorage.setItem('neonRunnerHighScore', highScore);
        highScoreEl.innerText = Math.floor(highScore);
    }
}

function update(dt) {
    if (!isPlaying) return;

    // Cap dt to prevent massive jumps if tab is inactive
    dt = Math.min(dt, 0.1);

    // 1. Move Player (Lerp to target lane)
    const targetX = LANES[currentLane];
    player.position.x += (targetX - player.position.x) * 15 * dt;

    // 2. Player Jump / Gravity
    if (player.position.y > 0 || yVelocity > 0) {
        yVelocity += GRAVITY * dt;
        player.position.y += yVelocity * dt;

        if (player.position.y <= 0) {
            player.position.y = 0;
            yVelocity = 0;
        }
    }

    // Rotate player
    player.rotation.x -= currentSpeed * dt * 0.5;

    // 3. Move World/Objects
    const moveAmount = currentSpeed * dt;
    distanceTraveled += moveAmount;

    // Score increases with distance
    score += moveAmount * 0.1;
    scoreEl.innerText = Math.floor(score);

    // Speed up gradually
    if (currentSpeed < MAX_SPEED) {
        currentSpeed += 0.5 * dt;
    }

    // Update active objects
    for (let i = activeObjects.length - 1; i >= 0; i--) {
        const obj = activeObjects[i];
        obj.position.z += moveAmount;

        // Crystal rotation
        if (obj.type === 'crystal') {
            obj.rotation.y += 2 * dt;
            obj.rotation.x += 1 * dt;
        }

        // Collision Detection
        if (obj.position.z > -1 && obj.position.z < 1) { // Near player Z
            const dist = player.position.distanceTo(obj.position);

            if (obj.type === 'obstacle' && dist < 1.2) {
                gameOver();
                return; // Stop updating
            } else if (obj.type === 'crystal' && dist < 1.5) {
                // Collect
                score += 50;
                scoreEl.innerText = Math.floor(score);
                returnToPool(obj);
                activeObjects.splice(i, 1);
                continue;
            }
        }

        // Recycle passed objects
        if (obj.position.z > camera.position.z + 5) {
            returnToPool(obj);
            activeObjects.splice(i, 1);

            // Spawn new object ahead
            spawnObject(-(SPAN_LENGTH - moveAmount));
        }
    }

    // Move Grid Texture (Illusion of movement)
    // Since we used a GridHelper, moving it and snapping back creates endless floor
    scene.children.find(c => c.type === "GridHelper").position.z = distanceTraveled % 10;
}

function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();
    update(dt);
    renderer.render(scene, camera);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Start
init();
