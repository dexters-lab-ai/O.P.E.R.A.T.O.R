/**************************** Three.js Setup ****************************/
const bgCanvas = document.getElementById('bg-canvas');
const bgRenderer = new THREE.WebGLRenderer({ canvas: bgCanvas, alpha: true });
bgRenderer.setSize(window.innerWidth, window.innerHeight);
const bgScene = new THREE.Scene();
const bgCamera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 1000);
bgCamera.position.z = 30;

// Sentinel Canvas
const sentinelCanvas = document.getElementById('sentinel-canvas');
const sentinelRenderer = new THREE.WebGLRenderer({ canvas: sentinelCanvas, alpha: true });
sentinelRenderer.setSize(sentinelCanvas.clientWidth, sentinelCanvas.clientHeight);
const sentinelScene = new THREE.Scene();
const sentinelCamera = new THREE.PerspectiveCamera(75, sentinelCanvas.clientWidth/sentinelCanvas.clientHeight, 0.1, 1000);
sentinelCamera.position.z = 5;

// State Management
let isTaskRunning = false;
let sentinelState = 'idle'; // 'idle', 'tasking', 'normal'
let taskResults = [];
let activeTasks = [];
let scheduledTasks = [];
let repetitiveTasks = [];

/**************************** Wormhole & Sentinel Animation ****************************/
const wormholeGeometry = new THREE.TorusGeometry(10, 3, 16, 100);
const wormholeMaterial = new THREE.ShaderMaterial({
  uniforms: { time: { value: 0.0 }, glowColor: { value: new THREE.Color(0x00ddeb) } },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform float time;
    uniform vec3 glowColor;
    varying vec2 vUv;
    void main() {
      float dist = distance(vUv, vec2(0.5));
      float glow = 0.1 + 0.5 * sin(time + dist * 10.0);
      vec3 color = mix(vec3(0.0), glowColor, glow);
      gl_FragColor = vec4(color, 0.8 - dist);
    }
  `,
  side: THREE.DoubleSide,
  transparent: true
});
const wormhole = new THREE.Mesh(wormholeGeometry, wormholeMaterial);
wormhole.rotation.x = Math.PI / 2;
bgScene.add(wormhole);

const particleCount = 2000;
const particlesGeometry = new THREE.BufferGeometry();
const positions = new Float32Array(particleCount * 3);
const colors = new Float32Array(particleCount * 3);
const velocities = new Float32Array(particleCount * 3);
for (let i = 0; i < particleCount * 3; i += 3) {
  const theta = Math.random() * Math.PI * 2;
  const radius = 10 + Math.random() * 5;
  positions[i] = Math.cos(theta) * radius;
  positions[i + 1] = (Math.random() - 0.5) * 2;
  positions[i + 2] = Math.sin(theta) * radius;
  const col = Math.random() > 0.5 ? new THREE.Color(0x00ddeb) : new THREE.Color(0xff00cc);
  colors[i] = col.r;
  colors[i + 1] = col.g;
  colors[i + 2] = col.b;
  velocities[i] = (Math.random() - 0.5) * 0.05;
  velocities[i + 1] = (Math.random() - 0.5) * 0.05;
  velocities[i + 2] = (Math.random() - 0.5) * 0.05;
}
particlesGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
particlesGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
const particlesMaterial = new THREE.PointsMaterial({
  size: 0.15,
  vertexColors: true,
  transparent: true,
  opacity: 0.9,
  blending: THREE.AdditiveBlending
});
const particles = new THREE.Points(particlesGeometry, particlesMaterial);
bgScene.add(particles);

// Sentinel Robot Setup
const sentinelGroup = new THREE.Group();
const body = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 32), new THREE.MeshBasicMaterial({ color: 0x6e3eff }));
sentinelGroup.add(body);
const eye = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.1), new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
eye.position.set(0, 0.2, 1);
eye.rotation.z = Math.PI / 4;
sentinelGroup.add(eye);
const mouth = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.1), new THREE.MeshBasicMaterial({ color: 0xffffff }));
mouth.position.set(0, -0.3, 1);
sentinelGroup.add(mouth);
const leftHand = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 16), new THREE.MeshBasicMaterial({ color: 0x6e3eff }));
leftHand.position.set(-0.8, -0.5, 0);
const rightHand = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 16), new THREE.MeshBasicMaterial({ color: 0x6e3eff }));
rightHand.position.set(0.8, -0.5, 0);
sentinelGroup.add(leftHand, rightHand);
const thruster = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.5, 16), new THREE.MeshBasicMaterial({ color: 0xaaaaaa }));
thruster.position.set(0, -1.2, 0);
thruster.rotation.x = Math.PI;
sentinelGroup.add(thruster);
const smokeCount = 50;
const smokeGeometry = new THREE.BufferGeometry();
const smokePositions = new Float32Array(smokeCount * 3);
const smokeVelocities = new Float32Array(smokeCount * 3);
for (let i = 0; i < smokeCount * 3; i += 3) {
  smokePositions[i] = (Math.random() - 0.5) * 0.2;
  smokePositions[i + 1] = -1.5;
  smokePositions[i + 2] = (Math.random() - 0.5) * 0.2;
  smokeVelocities[i] = (Math.random() - 0.5) * 0.02;
  smokeVelocities[i + 1] = -0.05;
  smokeVelocities[i + 2] = (Math.random() - 0.5) * 0.02;
}
smokeGeometry.setAttribute('position', new THREE.BufferAttribute(smokePositions, 3));
const smokeMaterial = new THREE.PointsMaterial({
  color: 0x888888,
  size: 0.1,
  transparent: true,
  opacity: 0.5,
  blending: THREE.AdditiveBlending
});
const smoke = new THREE.Points(smokeGeometry, smokeMaterial);
sentinelGroup.add(smoke);
sentinelScene.add(sentinelGroup);

let time = 0;
function animate() {
  requestAnimationFrame(animate);
  time += 0.02;
  wormholeMaterial.uniforms.time.value = time;
  wormhole.rotation.z += 0.01;
  const pPos = particlesGeometry.attributes.position.array;
  for (let i = 0; i < particleCount * 3; i += 3) {
    const x = pPos[i], z = pPos[i + 2];
    const dist = Math.sqrt(x * x + z * z);
    if (dist > 0) {
      const speed = isTaskRunning ? 0.15 / dist : 0.05 / dist;
      pPos[i] -= (x / dist) * speed;
      pPos[i + 2] -= (z / dist) * speed;
      if (dist < 3) {
        const theta = Math.random() * Math.PI * 2;
        const radius = 10 + Math.random() * 5;
        pPos[i] = Math.cos(theta) * radius;
        pPos[i + 2] = Math.sin(theta) * radius;
      }
    }
    pPos[i] += velocities[i];
    pPos[i + 1] += velocities[i + 1];
    pPos[i + 2] += velocities[i + 2];
  }
  particlesGeometry.attributes.position.needsUpdate = true;
  particles.visible = true;
  
  // Sentinel Animation
  if (sentinelState === 'idle') {
    sentinelGroup.position.y = Math.sin(time) * 0.5;
    leftHand.position.x = -0.8 + Math.sin(time * 2) * 0.2;
    rightHand.position.x = 0.8 - Math.sin(time * 2) * 0.2;
    eye.material.opacity = 0.9 + Math.sin(time * 3) * 0.1;
    const sPos = smoke.geometry.attributes.position.array;
    for (let i = 0; i < smokeCount * 3; i += 3) {
      sPos[i] += smokeVelocities[i];
      sPos[i + 1] += smokeVelocities[i + 1];
      sPos[i + 2] += smokeVelocities[i + 2];
      if (sPos[i + 1] < -2) {
        sPos[i] = (Math.random() - 0.5) * 0.2;
        sPos[i + 1] = -1.5;
        sPos[i + 2] = (Math.random() - 0.5) * 0.2;
      }
    }
    smoke.geometry.attributes.position.needsUpdate = true;
  } else if (sentinelState === 'tasking') {
    sentinelGroup.position.y = 2 + Math.sin(time * 2) * 0.2;
    sentinelGroup.rotation.y += 0.05;
    eye.material.color.set(0x00ff00);
    eye.material.opacity = 1.0;
  } else {
    sentinelGroup.position.y = 2;
    sentinelGroup.rotation.y = 0;
    eye.material.color.set(0xff0000);
    eye.material.opacity = 0.9;
  }
  bgRenderer.render(bgScene, bgCamera);
  sentinelRenderer.render(sentinelScene, sentinelCamera);
}
animate();

window.addEventListener('resize', () => {
  bgCamera.aspect = window.innerWidth / window.innerHeight;
  bgCamera.updateProjectionMatrix();
  bgRenderer.setSize(window.innerWidth, window.innerHeight);
  sentinelCamera.aspect = sentinelCanvas.clientWidth / sentinelCanvas.clientHeight;
  sentinelCamera.updateProjectionMatrix();
  sentinelRenderer.setSize(sentinelCanvas.clientWidth, sentinelCanvas.clientHeight);
});

/**************************** Splash Screen Animation ****************************/
document.addEventListener('DOMContentLoaded', () => {
  const loadingProgress = document.getElementById('loading-progress');
  let progress = 0;
  const interval = setInterval(() => {
    progress += 5;
    loadingProgress.style.width = `${progress}%`;
    if (progress >= 100) {
      clearInterval(interval);
      setTimeout(() => {
        document.getElementById('splash-screen').style.opacity = '0';
        setTimeout(() => {
          document.getElementById('splash-screen').style.display = 'none';
          if (!localStorage.getItem('operatorIntroShown')) {
            document.getElementById('intro-overlay').style.display = 'flex';
          }
          sentinelCanvas.style.display = 'block';
          sentinelState = 'idle';
        }, 500);
      }, 500);
    }
  }, 100);
});

/**************************** DOMContentLoaded & Form Event Listeners ****************************/
document.addEventListener('DOMContentLoaded', () => {
  // NLI (Chat) Form
  const nliForm = document.getElementById('nli-form');
  if (nliForm) {
    nliForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const prompt = document.getElementById('nli-prompt').value.trim();
      if (!prompt) {
        showNotification('Please enter a command', 'error');
        return;
      }
      document.getElementById('nli-results').innerHTML = '';
      clearTaskResults();
      showNotification('Executing command...', 'success');
      try {
        const res = await fetch('/nli', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ prompt })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error);
        document.getElementById('nli-results').innerHTML = `<div class="ai-result">
          <h5>AI Response:</h5>
          <pre>${JSON.stringify(data.result, null, 2)}</pre>
        </div>`;
      } catch (err) {
        showNotification(err.message, 'error');
      }
    });
  }
  
  // Manual Task – load via URL parameters if available
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('url') && urlParams.get('command')) {
    document.getElementById('manual-url').value = decodeURIComponent(urlParams.get('url'));
    document.getElementById('manual-command').value = decodeURIComponent(urlParams.get('command'));
    toggleTaskTab('manual');
  }
  
  loadActiveTasks();
  loadHistory();
  setInterval(() => { loadActiveTasks(); loadHistory(); }, 5000);
  
  // Mode Toggle
  document.getElementById('mode-toggle').onclick = () => {
    document.body.classList.toggle('light-mode');
  };
  
  // Intro Overlay Controls
  document.getElementById('close-intro').addEventListener('click', () => {
    document.getElementById('intro-overlay').style.display = 'none';
    localStorage.setItem('operatorIntroShown', 'true');
  });
  document.getElementById('show-intro-later').addEventListener('click', () => {
    document.getElementById('intro-overlay').style.display = 'none';
  });
  document.getElementById('start-using').addEventListener('click', () => {
    document.getElementById('intro-overlay').style.display = 'none';
    localStorage.setItem('operatorIntroShown', 'true');
  });
  document.getElementById('guide-link').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('intro-overlay').style.display = 'flex';
  });
  
  // Tab Switching for Task Types
  const taskTypeTabs = document.getElementById('task-type-tabs');
  taskTypeTabs.addEventListener('click', (e) => {
    if (e.target.classList.contains('tab-btn')) {
      document.querySelectorAll('#task-type-tabs .tab-btn').forEach(tab => tab.classList.remove('active'));
      e.target.classList.add('active');
      toggleTaskTab(e.target.dataset.taskType);
    }
  });
  
  // Active Tasks Subtabs
  const activeSubtabs = document.querySelectorAll('.active-tasks-subtabs .tab-btn');
  activeSubtabs.forEach(tab => {
    tab.addEventListener('click', () => {
      activeSubtabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.subtab-content').forEach(c => c.classList.remove('active'));
      document.getElementById(`${tab.dataset.subtab}-tasks-content`).classList.add('active');
    });
  });
  
  // Sonic Operations
  const sonicOperations = document.getElementById('sonic-operations');
  if (sonicOperations) {
    sonicOperations.addEventListener('click', (e) => {
      if (e.target.classList.contains('tab-btn')) {
        document.querySelectorAll('#sonic-operations .tab-btn').forEach(tab => tab.classList.remove('active'));
        e.target.classList.add('active');
        const operation = e.target.dataset.sonicOperation;
        const bridgeForm = document.getElementById('bridge-form');
        const stakeForm = document.getElementById('stake-form');
        if (bridgeForm && stakeForm) {
          if (operation === 'bridge') {
            bridgeForm.style.display = 'block';
            stakeForm.style.display = 'none';
          } else {
            bridgeForm.style.display = 'none';
            stakeForm.style.display = 'block';
          }
        }
      }
    });
    const bridgeForm = document.getElementById('bridge-form');
    if (bridgeForm) {
      bridgeForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const url = document.getElementById('bridge-url').value.trim();
        const command = document.getElementById('bridge-command').value.trim();
        if (!command) { showNotification('Please enter bridge operation details', 'error'); return; }
        executeTaskWithAnimation(url, command, 'sonic-bridge');
      });
    }
    const stakeForm = document.getElementById('stake-form');
    if (stakeForm) {
      stakeForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const url = document.getElementById('stake-url').value.trim();
        const command = document.getElementById('stake-command').value.trim();
        if (!command) { showNotification('Please enter staking details', 'error'); return; }
        executeTaskWithAnimation(url, command, 'sonic-stake');
      });
    }
    const bridgeBtn = document.getElementById('bridge-btn');
    const stakeBtn = document.getElementById('stake-btn');
    if (bridgeBtn) {
      bridgeBtn.addEventListener('click', () => {
        const url = document.getElementById('sonic-url').value.trim();
        const command = document.getElementById('sonic-command').value.trim();
        if (!url || !command) { showNotification('Please enter both URL and command', 'error'); return; }
        executeTaskWithAnimation(url, command, 'sonic-bridge');
      });
    }
    if (stakeBtn) {
      stakeBtn.addEventListener('click', () => {
        const url = document.getElementById('sonic-url').value.trim();
        const command = document.getElementById('sonic-command').value.trim();
        if (!url || !command) { showNotification('Please enter both URL and command', 'error'); return; }
        executeTaskWithAnimation(url, command, 'sonic-stake');
      });
    }
  }
  
  // Repetitive Task Form
  const repetitiveTaskForm = document.getElementById('repetitive-task-form');
  if (repetitiveTaskForm) {
    repetitiveTaskForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const url = document.getElementById('repetitive-url').value.trim();
      const command = document.getElementById('repetitive-command').value.trim();
      const interval = parseInt(document.getElementById('repetitive-interval').value);
      if (!url || !command || !interval) { showNotification('Please fill in all fields for the repetitive task', 'error'); return; }
      if (interval < 1) { showNotification('Interval must be at least 1 second', 'error'); return; }
      const task = { id: Date.now(), url, command, interval };
      task.intervalId = setInterval(() => executeTaskWithAnimation(url, command, 'repetitive'), interval * 1000);
      addRepetitiveTask(task);
      showNotification('Repetitive task saved and started!', 'success');
    });
    document.getElementById('run-repetitive-task').addEventListener('click', async () => {
      const url = document.getElementById('repetitive-url').value.trim();
      const command = document.getElementById('repetitive-command').value.trim();
      if (!url || !command) { showNotification('Please enter both URL and command', 'error'); return; }
      try {
        showNotification(`Executing repetitive task: ${command}`, 'success');
        const result = await executeTask(url, command);
        result.taskType = 'repetitive';
        addTaskResult(result);
        addToHistory(url, command, result);
      } catch (error) {
        console.error('Error executing repetitive task:', error);
        showNotification(`Task execution failed: ${error.message}`, 'error');
      }
    });
    updateRepetitiveTasks();
  }
  
  // Scheduled Task Form
  const scheduleTaskForm = document.getElementById('schedule-task-form');
  if (scheduleTaskForm) {
    scheduleTaskForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const url = document.getElementById('schedule-url').value.trim();
      const command = document.getElementById('scheduled-command').value.trim();
      const scheduledTime = document.getElementById('scheduled-time').value;
      if (!url || !command || !scheduledTime) { showNotification('Please fill in all scheduled task fields', 'error'); return; }
      const time = new Date(scheduledTime);
      if (isNaN(time) || time <= new Date()) { showNotification('Please enter a valid future date and time', 'error'); return; }
      const task = { id: Date.now(), url, command, scheduledTime: time.toISOString() };
      scheduleTask(task);
      showNotification(`Task scheduled for ${time.toLocaleString()}`, 'success');
    });
    updateScheduledTasksList();
    checkScheduledTasks();
  }
});

/******************** Helper: Toggle Task Tab ********************/
function toggleTaskTab(taskType) {
  document.querySelectorAll('.task-section').forEach(section => section.classList.remove('active'));
  if (taskType === 'nli') { document.getElementById('nli-section').classList.add('active'); }
  else if (taskType === 'manual') { document.getElementById('manual-section').classList.add('active'); }
  else if (taskType === 'active-tasks') { document.getElementById('active-tasks-section').classList.add('active'); }
  else if (taskType === 'repetitive') { document.getElementById('repetitive-section').classList.add('active'); }
  else if (taskType === 'scheduled') { document.getElementById('scheduled-section').classList.add('active'); }
  else if (taskType === 'sonic') { document.getElementById('sonic-section').classList.add('active'); }
}

/******************** Task Execution Functions ********************/
/******************** Task Execution Functions ********************/
async function executeTaskWithAnimation(url, command, taskType) {
  if (!url || !command) {
    showNotification("Please enter both URL and command", "error");
    return;
  }
  try {
    showNotification("Task started – please wait...", "success");
    isTaskRunning = true;
    sentinelState = 'tasking';
    sentinelCanvas.style.display = 'block';
    particles.visible = true;
    const result = await executeTask(url, command);
    result.taskType = taskType;
    addTaskResult(result);
    addToHistory(url, command, result);
    showNotification("Task completed successfully!", "success");
    isTaskRunning = false;
    sentinelState = 'normal';
  } catch (error) {
    console.error("Error executing task:", error);
    showNotification(`Task execution failed: ${error.message}`, "error");
    isTaskRunning = false;
    sentinelState = 'normal';
    // Fetch the latest history to ensure the error is reflected
    await loadHistory();
  }
}

async function executeTask(url, command) {
  return new Promise(async (resolve, reject) => {
    try {
      const res = await fetch('/automate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ url, command })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Task execution failed');
      const taskId = data.taskId;

      // Use the /tasks/:id/stream endpoint for real-time updates
      const eventSource = new EventSource(`/tasks/${taskId}/stream`);
      eventSource.onmessage = (event) => {
        const update = JSON.parse(event.data);
        if (update.done) {
          eventSource.close();
          if (update.status === 'error') {
            reject(new Error(update.error || 'Task failed'));
            return;
          }
          // Fetch the final result from history
          fetch('/history', { credentials: 'same-origin' })
            .then(res => res.json())
            .then(history => {
              const historyItem = history.find(h => h._id === taskId);
              if (historyItem) {
                resolve({
                  taskId: historyItem._id,
                  command,
                  url,
                  output: typeof historyItem.result === 'object'
                    ? JSON.stringify(historyItem.result.raw || historyItem.result, null, 2)
                    : historyItem.result,
                  aiOutput: historyItem.result.aiPrepared?.summary || 'No AI summary available',
                  timestamp: historyItem.timestamp,
                  screenshot: historyItem.result.raw?.screenshotPath,
                  report: historyItem.result.runReport
                });
              } else {
                reject(new Error("Task result not found in history"));
              }
            })
            .catch(err => {
              reject(new Error("Error fetching task result: " + err.message));
            });
        }
        // Update active tasks UI with progress
        loadActiveTasks();
      };
      eventSource.onerror = (err) => {
        eventSource.close();
        reject(new Error("Error streaming task updates"));
      };
    } catch (err) {
      showNotification("Error executing task: " + err.message, "error");
      reject(err);
    }
  });
}

/******************** Task Results & History Functions ********************/
function clearTaskResults() {
  taskResults = [];
  document.getElementById('ai-results').innerHTML = '';
  document.getElementById('raw-results').innerHTML = '';
  document.getElementById('output-container').innerHTML = '<p id="no-results" class="text-muted">No results yet. Run a task to see output here.</p>';
  document.getElementById('sentinel-canvas').style.display = 'block';
  sentinelState = 'idle';
}
document.getElementById('clear-results').addEventListener('click', clearTaskResults);

function addTaskResult(result) {
  taskResults.unshift(result);
  const aiResults = document.getElementById('ai-results');
  const rawResults = document.getElementById('raw-results');
  const noResults = document.getElementById('no-results');
  if (noResults) noResults.remove();
  const timestamp = new Date(result.timestamp);
  const formattedTime = timestamp.toLocaleTimeString() + ' ' + timestamp.toLocaleDateString();
  let icon = 'fas fa-globe';
  if (result.taskType === 'sonic-bridge') icon = 'fas fa-exchange-alt';
  if (result.taskType === 'sonic-stake') icon = 'fas fa-lock';
  if (result.taskType === 'repetitive') icon = 'fas fa-redo';
  if (result.taskType === 'scheduled') icon = 'fas fa-clock';
  const aiCard = document.createElement('div');
  aiCard.className = 'ai-result';
  aiCard.innerHTML = `
    <h4><i class="${icon}"></i> ${result.url}</h4>
    <p class="command-text"><strong>Command:</strong> ${result.command}</p>
    <p>${result.aiOutput || 'No AI summary available.'}</p>
    <div class="meta">
      <span>${formattedTime}</span>
      <div class="share-buttons">
        <a href="#" onclick="copyResult('${result.taskId}')"><i class="fas fa-copy"></i></a>
        <a href="#" onclick="rerunTask('${result.taskId}')"><i class="fas fa-redo"></i></a>
      </div>
    </div>
  `;
  const rawCard = document.createElement('div');
  rawCard.className = 'output-card';
  rawCard.innerHTML = `
    <h4>Raw Output</h4>
    <pre>${result.output}</pre>
    ${result.screenshot ? `<img src="${result.screenshot}" alt="Task Screenshot" style="max-width: 100%; margin-top: 10px;">` : ''}
    ${result.report ? `<a href="${result.report}" target="_blank" class="btn btn-primary btn-sm mt-2">View Report</a>` : ''}
  `;
  aiResults.prepend(aiCard);
  rawResults.prepend(rawCard);
  document.getElementById('sentinel-canvas').style.display = 'none';
  document.getElementById('output-container').style.display = 'block';
  sentinelState = 'normal';
  isTaskRunning = false;
  document.querySelectorAll('.result-tab').forEach(tab => tab.classList.remove('active'));
  document.querySelector('.result-tab[data-tab="ai"]').classList.add('active');
  document.getElementById('ai-results').classList.add('active');
  document.getElementById('raw-results').classList.remove('active');
  showNotification('Task result added!', 'success');
}

async function loadActiveTasks() {
  try {
    const response = await fetch('/tasks/active', { credentials: 'same-origin' });
    if (!response.ok) {
      if (response.status === 401) {
        window.location.href = '/login.html';
        return;
      }
      throw new Error(`Failed to load active tasks: ${response.statusText}`);
    }

    const tasks = await response.json();
    activeTasks = tasks;
    const tasksContainer = document.getElementById('active-tasks-container');

    if (!tasks || tasks.length === 0) {
      tasksContainer.innerHTML = '<p id="no-active-tasks" class="text-muted">No active tasks. Run a task to see it here.</p>';
      updateActiveTasksTab();
      return;
    }

    tasksContainer.innerHTML = '';
    tasks.forEach(task => {
      const taskElement = createTaskElement(task);
      tasksContainer.appendChild(taskElement);
    });

    updateActiveTasksTab();
  } catch (error) {
    console.error('Error loading active tasks:', error);
    showNotification('Failed to load active tasks. Please try again.', 'error');
  }
}

function updateActiveTasksTab(){
  const tab = document.getElementById('active-tasks-tab');
  if (activeTasks.length > 0) {
    const processing = activeTasks.filter(task => task.status === 'processing');
    tab.innerHTML = processing.length > 0 ?
      `<i class="fas fa-spinner fa-spin"></i> Active Tasks (${processing.length})` :
      `<i class="fas fa-tasks"></i> Active Tasks (${activeTasks.length})`;
  } else {
    tab.innerHTML = '<i class="fas fa-tasks"></i> Active Tasks';
  }
}

async function loadActiveTasks() {
  try {
    const response = await fetch('/tasks/active', { credentials: 'same-origin' });
    if (!response.ok) {
      if (response.status === 401) {
        window.location.href = '/login.html';
        return;
      }
      throw new Error(`Failed to load active tasks: ${response.statusText}`);
    }

    const tasks = await response.json();
    activeTasks = tasks;
    const tasksContainer = document.getElementById('active-tasks-container');

    if (!tasks || tasks.length === 0) {
      tasksContainer.innerHTML = '<p id="no-active-tasks" class="text-muted">No active tasks. Run a task to see it here.</p>';
      updateActiveTasksTab();
      return;
    }

    tasksContainer.innerHTML = '';
    tasks.forEach(task => {
      const taskElement = createTaskElement(task);
      tasksContainer.appendChild(taskElement);
    });

    updateActiveTasksTab();
  } catch (error) {
    console.error('Error loading active tasks:', error);
    showNotification('Failed to load active tasks. Please try again.', 'error');
  }
}

function createTaskElement(task) {
  const element = document.createElement('div');
  element.className = 'active-task';
  element.dataset.taskId = task._id;
  let statusClass = 'pending';
  let statusIcon = 'clock';
  switch(task.status) {
    case 'processing':
      statusClass = 'processing';
      statusIcon = 'spinner fa-spin';
      break;
    case 'completed':
      statusClass = 'completed';
      statusIcon = 'check';
      break;
    case 'error':
      statusClass = 'error';
      statusIcon = 'exclamation-triangle';
      break;
  }
  element.innerHTML = `
    <div class="task-header">
      <h4><i class="fas fa-${statusIcon}"></i> ${task.command}</h4>
      <span class="task-status ${statusClass}">${task.status}</span>
      <button class="cancel-task-btn btn btn-danger btn-sm">Cancel</button>
    </div>
    <div class="task-url"><i class="fas fa-link"></i> ${task.url}</div>
    <div class="task-progress-container">
      <div class="task-progress" style="width: ${task.progress || 0}%"></div>
    </div>
    <div class="task-meta">
      <span class="task-time"><i class="fas fa-play"></i> Started: ${new Date(task.startTime).toLocaleTimeString()}</span>
      ${task.endTime ? `<span class="task-time"><i class="fas fa-flag-checkered"></i> Ended: ${new Date(task.endTime).toLocaleTimeString()}</span>` : ''}
    </div>
    ${task.error ? `<div class="task-error"><i class="fas fa-exclamation-circle"></i> ${task.error}</div>` : ''}
  `;
  // Add cancel event listener
  element.querySelector('.cancel-task-btn').addEventListener('click', async () => {
    try {
      const response = await fetch(`/tasks/${task._id}/cancel`, { method: 'POST', credentials: 'same-origin' });
      const result = await response.json();
      if (result.success) {
        showNotification('Task canceled successfully!');
        // Optionally, remove the task from the UI immediately.
        element.remove();
      } else {
        showNotification(result.error, 'error');
      }
    } catch (err) {
      showNotification('Error canceling task: ' + err.message, 'error');
    }
  });
  return element;
}

/******************** Repetitive Task Functions ********************/
function addRepetitiveTask(task) {
  repetitiveTasks.push(task);
  const container = document.getElementById('repetitive-tasks-container');
  if (document.getElementById('no-repetitive-tasks')) {
    document.getElementById('no-repetitive-tasks').remove();
  }
  const taskElem = document.createElement('div');
  taskElem.classList.add('repetitive-task');
  taskElem.innerHTML = `
    <div>
      <p>${task.command}</p>
      <div class="interval">Interval: ${task.interval} seconds</div>
    </div>
    <div class="actions">
      <button class="btn btn-danger btn-sm btn-icon cancel-repetitive-task"><i class="fas fa-times"></i> Cancel</button>
    </div>
  `;
  container.prepend(taskElem);
  taskElem.querySelector('.cancel-repetitive-task').addEventListener('click', () => {
    clearInterval(task.intervalId);
    repetitiveTasks = repetitiveTasks.filter(t => t.id !== task.id);
    taskElem.remove();
    if (repetitiveTasks.length === 0) {
      container.innerHTML = '<p id="no-repetitive-tasks" class="text-muted">No repetitive tasks.</p>';
    }
    showNotification('Repetitive task cancelled!');
  });
  task.intervalId = setInterval(() => executeTaskWithAnimation(task.url, task.command, 'repetitive'), task.interval * 1000);
}

window.deleteRepetitiveTask = function(taskId) {
  const taskIndex = repetitiveTasks.findIndex(t => t.id === taskId);
  if (taskIndex !== -1) {
    clearInterval(repetitiveTasks[taskIndex].intervalId);
    repetitiveTasks.splice(taskIndex, 1);
    updateRepetitiveTasks(); // Re-render the repetitive task list.
    showNotification('Repetitive task deleted', 'success');
  } else {
    showNotification('Task not found', 'error');
  }
};

function updateRepetitiveTasks() {
  const container = document.getElementById('repetitive-tasks-container');
  if (!container) return;
  const tasks = JSON.parse(localStorage.getItem('repetitiveTasks') || '[]');
  if (tasks.length === 0) {
    container.innerHTML = '<p id="no-repetitive-tasks" class="text-muted">No repetitive tasks. Use the Repetitive Task tab to create one.</p>';
    return;
  }
  container.innerHTML = '';
  tasks.forEach(task => {
    const taskElem = document.createElement('div');
    taskElem.className = 'repetitive-task';
    taskElem.dataset.taskId = task.id;
    taskElem.innerHTML = `
      <div class="task-info">
        <h4>${task.command.length > 30 ? task.command.substring(0, 30) + '...' : task.command}</h4>
        <p><i class="fas fa-link"></i> ${task.url}</p>
      </div>
      <div class="task-actions">
        <button class="btn btn-sm btn-primary" onclick="executeRepetitiveTask(${task.id})"><i class="fas fa-play"></i> Run</button>
        <button class="btn btn-sm btn-danger" onclick="deleteRepetitiveTask(${task.id})"><i class="fas fa-trash"></i></button>
      </div>
    `;
    container.appendChild(taskElem);
  });
}

window.executeRepetitiveTask = async function(taskId) {
  const tasks = JSON.parse(localStorage.getItem('repetitiveTasks') || '[]');
  const task = tasks.find(t => t.id === taskId);
  if (!task) {
    showNotification('Task not found', 'error');
    return;
  }
  try {
    showNotification(`Executing repetitive task: ${task.command}`, 'success');
    const result = await executeTask(task.url, task.command);
    result.taskType = 'repetitive';
    addTaskResult(result);
    addToHistory(task.url, task.command, result);
  } catch (error) {
    console.error('Error executing repetitive task:', error);
    showNotification(`Task execution failed: ${error.message}`, 'error');
  }
};

/******************** Scheduled Task Functions ********************/
function scheduleTask(task) {
  scheduledTasks.push(task);
  const container = document.getElementById('scheduled-tasks-container');
  if (document.getElementById('no-scheduled-tasks')) {
    document.getElementById('no-scheduled-tasks').remove();
  }
  const taskElem = document.createElement('div');
  taskElem.classList.add('scheduled-task');
  taskElem.innerHTML = `
    <div>
      <p>${task.command}</p>
      <div class="time">Scheduled for: ${new Date(task.scheduledTime).toLocaleString()}</div>
    </div>
    <div class="actions">
      <button class="btn btn-danger btn-sm btn-icon cancel-scheduled-task"><i class="fas fa-times"></i> Cancel</button>
    </div>
  `;
  container.prepend(taskElem);
  const timeUntil = new Date(task.scheduledTime).getTime() - Date.now();
  if (timeUntil < 2147483647) {
    setTimeout(() => executeScheduledTask(task), timeUntil);
  }
  taskElem.querySelector('.cancel-scheduled-task').addEventListener('click', () => {
    scheduledTasks = scheduledTasks.filter(t => t.id !== task.id);
    taskElem.remove();
    if (scheduledTasks.length === 0) {
      container.innerHTML = '<p id="no-scheduled-tasks" class="text-muted">No scheduled tasks. Use the Scheduled Task tab to create one.</p>';
    }
  });
}

function updateScheduledTasksList() {
  const container = document.getElementById('scheduled-tasks-container');
  if (!container) return;
  if (scheduledTasks.length === 0) {
    container.innerHTML = '<p id="no-scheduled-tasks" class="text-muted">No scheduled tasks. Use the Scheduled Task tab to create one.</p>';
    return;
  }
  container.innerHTML = '';
  scheduledTasks.forEach(task => {
    const taskElem = document.createElement('div');
    taskElem.className = 'scheduled-task';
    taskElem.dataset.taskId = task.id;
    const scheduledTime = new Date(task.scheduledTime);
    const formattedTime = scheduledTime.toLocaleTimeString() + ' ' + scheduledTime.toLocaleDateString();
    taskElem.innerHTML = `
      <div>
        <p>${task.command}</p>
        <p class="time"><i class="fas fa-clock"></i> ${formattedTime}</p>
      </div>
      <div class="actions">
        <button class="btn btn-sm btn-danger cancel-scheduled-task"><i class="fas fa-times"></i></button>
      </div>
    `;
    container.appendChild(taskElem);
    taskElem.querySelector('.cancel-scheduled-task').addEventListener('click', () => {
      scheduledTasks = scheduledTasks.filter(t => t.id !== task.id);
      taskElem.remove();
      if (scheduledTasks.length === 0) {
        container.innerHTML = '<p id="no-scheduled-tasks" class="text-muted">No scheduled tasks. Use the Scheduled Task tab to create one.</p>';
      }
    });
  });
}

async function executeScheduledTask(task) {
  const idx = scheduledTasks.findIndex(t => t.id === task.id);
  if (idx === -1) return;
  scheduledTasks.splice(idx, 1);
  try {
    const result = await executeTask(task.url, task.command);
    result.taskType = 'scheduled';
    addTaskResult(result);
    addToHistory(task.url, task.command, result);
    showNotification('Scheduled task executed successfully!');
  } catch (error) {
    showNotification('Error executing scheduled task', 'error');
    console.error(error);
  }
  updateScheduledTasksList();
}

function checkScheduledTasks() {
  scheduledTasks.forEach(task => {
    const scheduledTime = new Date(task.scheduledTime);
    const timeUntil = scheduledTime.getTime() - Date.now();
    if (timeUntil <= 0) {
      executeScheduledTask(task);
    } else if (timeUntil < 2147483647) {
      setTimeout(() => executeScheduledTask(task), timeUntil);
    }
  });
  updateScheduledTasksList();
}


// Manual Task (Fix 3, 10)
document.getElementById('run-manual-task').addEventListener('click', async () => {
  const url = document.getElementById('manual-url').value.trim();
  const command = document.getElementById('manual-command').value.trim();
  if (!url || !command) {
    showNotification('Please enter both URL and command.', 'error');
    return;
  }
  // Set loading state
  isTaskRunning = true;
  sentinelState = 'tasking';
  document.getElementById('sentinel-canvas').style.display = 'block';
  document.getElementById('output-container').innerHTML = ''; // clear previous results
  try {
    const res = await fetch('/automate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ url, command })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    // Optionally, poll or listen for the result (your existing polling in loadActiveTasks should update the UI)
    showNotification("Task submitted successfully!", "success");
  } catch (error) {
    showNotification(error.message, 'error');
  } finally {
    // Reset task animation state if needed.
    isTaskRunning = false;
    sentinelState = 'normal';
  }
});

/******************** History Functions ********************/
async function loadHistory() {
  try {
    const response = await fetch('/history', { credentials: 'same-origin' });
    if (!response.ok) {
      if (response.status === 401) {
        window.location.href = '/login.html';
        return;
      }
      throw new Error(`Failed to load history: ${response.statusText}`);
    }
    const history = await response.json();
    const historyList = document.getElementById('history-list');
    historyList.innerHTML = ''; // Clear existing history
    if (history && history.length > 0) {
      history.forEach(item => {
        addToHistory(item.url || 'Unknown URL', item.command, {
          taskId: item._id,
          command: item.command,
          timestamp: item.timestamp,
          output: typeof item.result === 'object' ? JSON.stringify(item.result.raw || item.result, null, 2) : item.result,
          aiOutput: item.result.aiPrepared?.summary || 'No AI summary available',
          screenshot: item.result.raw?.screenshotPath,
          report: item.result.runReport
        });
      });
      document.querySelectorAll('#history-list .output-card').forEach(card => {
        card.removeEventListener('click', handleHistoryCardClick);
        card.addEventListener('click', handleHistoryCardClick);
      });
    } else {
      historyList.innerHTML = '<p id="no-history" class="text-muted">No task history. Run a task to start building your history.</p>';
    }
  } catch (error) {
    console.error('Error loading history:', error);
    showNotification('Error loading history. Please refresh or log in again.', 'error');
  }
}

const loadedHistoryIds = new Set();
function addToHistory(url, command, result) {
  if (loadedHistoryIds.has(result.taskId)) return;
  loadedHistoryIds.add(result.taskId);
  const historyList = document.getElementById('history-list');
  if (document.getElementById('no-history')) {
    document.getElementById('no-history').remove();
  }
  const historyItem = document.createElement('div');
  historyItem.className = 'output-card';
  historyItem.dataset.taskId = result.taskId;
  const timestamp = new Date(result.timestamp);
  const formattedTime = timestamp.toLocaleTimeString() + ' ' + timestamp.toLocaleDateString();
  const escapedCommand = command.replace(/'/g, "\\'");
  historyItem.innerHTML = `
    <h4><i class="fas fa-history"></i> Task: ${command.length > 30 ? command.substring(0, 30) + '...' : command}</h4>
    <p>URL: ${url}</p>
    <div class="meta">
      <span>${formattedTime}</span>
      <div class="share-buttons">
        <a href="#" onclick="event.stopPropagation(); rerunHistoryTask('${result.taskId}', '${url}', '${escapedCommand}')"><i class="fas fa-redo"></i></a>
        <a href="#" onclick="event.stopPropagation(); deleteHistoryTask('${result.taskId}')"><i class="fas fa-trash"></i></a>
      </div>
    </div>
  `;
  historyItem.addEventListener('click', () => {
    showHistoryPopup(result);
  });
  historyList.prepend(historyItem);
}

function handleHistoryCardClick(e) {
  if (e.target.tagName === 'A' || e.target.closest('a')) return;
  const taskId = this.dataset.taskId;
  const popup = document.getElementById('history-popup');
  const details = document.getElementById('history-details-content');
  fetch(`/history/${taskId}`, { credentials: 'same-origin' })
    .then(res => res.json())
    .then(item => {
      if (item) {
        const result = item.result || {};
        details.innerHTML = `
          <h5>Task: ${item.command}</h5>
          <p><strong>URL:</strong> ${item.url}</p>
          <p><strong>Timestamp:</strong> ${new Date(item.timestamp).toLocaleString()}</p>
          <h5>AI-Prepared Output:</h5>
          <pre>${result.aiPrepared?.summary || 'No AI-prepared summary available'}</pre>
          <h5>Raw Output:</h5>
          <pre>${result.raw?.pageText || 'No raw output available'}</pre>
          ${result.runReport ? `<a href="${result.runReport}" target="_blank" class="btn btn-primary btn-sm">View Report</a>` : '<p>No report available</p>'}
        `;
        popup.classList.add('active');
      } else {
        details.innerHTML = '<p>History item not found</p>';
        popup.classList.add('active');
      }
    })
    .catch(err => {
      console.error('Error fetching history details:', err);
      details.innerHTML = '<p>Error loading task details</p>';
      popup.classList.add('active');
    });
}

document.addEventListener('DOMContentLoaded', () => {
  const clearHistoryButton = document.getElementById('clear-history');
  if (clearHistoryButton) {
    clearHistoryButton.addEventListener('click', async () => {
      try {
        const res = await fetch('/history', { method: 'DELETE', credentials: 'same-origin' });
        if (!res.ok) throw new Error('Failed to clear history');
        document.getElementById('history-list').innerHTML = '<p id="no-history" class="text-muted">No task history. Run a task to start building your history.</p>';
        showNotification('History cleared!');
      } catch (error) {
        showNotification('Error clearing history', 'error');
        console.error(error);
      }
    });
  }
});

/**************************** Notification Function ****************************/
function showNotification(message, type = 'success') {
  const notification = document.getElementById('notification');
  const messageEl = document.getElementById('notification-message');
  messageEl.textContent = message;
  notification.className = 'notification';
  notification.classList.add(type === 'error' ? 'danger' : 'success');
  notification.classList.add('show');
  setTimeout(() => { notification.classList.remove('show'); }, 3000);
}

/**************************** Global Helpers ****************************/
window.copyResult = function(taskId) {
  const resultCard = document.querySelector(`#raw-results .output-card[data-task-id="${taskId}"]`);
  const output = resultCard ? resultCard.querySelector('pre').textContent : '';
  navigator.clipboard.writeText(output)
    .then(() => { showNotification('Result copied to clipboard!'); })
    .catch(() => { showNotification('Failed to copy result', 'error'); });
};

window.rerunTask = function(taskId) {
  const result = taskResults.find(r => r.taskId === taskId);
  if (!result) return;
  document.getElementById('manual-url').value = result.url;
  document.getElementById('manual-command').value = result.command;
  document.querySelectorAll('.tab-btn').forEach(tab => tab.classList.remove('active'));
  document.getElementById('manual-tab').classList.add('active');
  document.querySelectorAll('.task-section').forEach(section => section.classList.remove('active'));
  document.getElementById('manual-section').classList.add('active');
};

window.rerunHistoryTask = function(taskId, url, command) {
  document.getElementById('manual-url').value = url;
  document.getElementById('manual-command').value = command;
  document.querySelectorAll('.tab-btn').forEach(tab => tab.classList.remove('active'));
  document.getElementById('manual-tab').classList.add('active');
  document.querySelectorAll('.task-section').forEach(section => section.classList.remove('active'));
  document.getElementById('manual-section').classList.add('active');
};

window.deleteHistoryTask = async function(taskId) {
  try {
    await fetch(`/history/${taskId}`, { method: 'DELETE', credentials: 'same-origin' });
    const item = document.querySelector(`.output-card[data-task-id="${taskId}"]`);
    if (item) item.remove();
    if (document.getElementById('history-list').children.length === 0) {
      document.getElementById('history-list').innerHTML = '<p id="no-history" class="text-muted">No task history. Run a task to start building your history.</p>';
    }
    showNotification('History item deleted!');
  } catch (error) {
    showNotification('Error deleting history item', 'error');
    console.error(error);
  }
};
