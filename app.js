const $ = id => document.getElementById(id);
const video = $('video'), preview = $('preview'), stampLayer = $('stampLayer'), frameBox = $('frameBox');
let stream = null, facing = 'environment', renderer = null, captureCanvas = null, captureRenderer = null;
let lastFile = null, lastUrl = null, torchOn = false;

const load = (k, d) => { try { const v = localStorage.getItem('film.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } };
const store = (k, v) => { try { localStorage.setItem('film.' + k, JSON.stringify(v)); } catch {} };

const state = {
  look: load('look', '800T Noche'),
  grainOn: load('grainOn', true),
  leakOn: load('leakOn', false),
  dateOn: load('dateOn', false),
  frame: load('frame', 'Sin marco'),
  leakSeed: Math.random() * 100
};
if (!LOOKS[state.look]) state.look = '800T Noche';
if (!(state.frame in FRAMES)) state.frame = 'Sin marco';

// ---------- UI de looks y extras ----------
function renderChips() {
  const box = $('looks'); box.innerHTML = '';
  for (const name of Object.keys(LOOKS)) {
    const b = document.createElement('button'); b.textContent = name; b.classList.toggle('on', name === state.look);
    b.onclick = () => { state.look = name; store('look', name); renderChips(); };
    box.appendChild(b);
  }
  for (const b of document.querySelectorAll('#extras button')) {
    const x = b.dataset.x;
    if (x === 'frame') { b.textContent = state.frame; b.classList.toggle('on', state.frame !== 'Sin marco'); }
    else b.classList.toggle('on', state[x + 'On']);
  }
  lastStampSize = '';
}
document.querySelectorAll('#extras button').forEach(b => b.onclick = () => {
  const x = b.dataset.x;
  if (x === 'frame') { const names = Object.keys(FRAMES); state.frame = names[(names.indexOf(state.frame) + 1) % names.length]; store('frame', state.frame); }
  else { state[x + 'On'] = !state[x + 'On']; store(x + 'On', state[x + 'On']); if (x === 'leak') state.leakSeed = Math.random() * 100; }
  renderChips();
});

// ---------- Cámara ----------
async function openCamera() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: facing }, width: { ideal: 4096 }, height: { ideal: 4096 } }
  });
  video.srcObject = stream;
  await video.play();
  if (!video.videoWidth) await new Promise(r => video.addEventListener('loadedmetadata', r, { once: true }));
  const track = stream.getVideoTracks()[0];
  const caps = track.getCapabilities ? track.getCapabilities() : {};
  $('torchBtn').hidden = !caps.torch; $('torchSpacer').hidden = !!caps.torch;
  torchOn = false; $('torchBtn').classList.remove('on');
  $('info').textContent = `${video.videoWidth}×${video.videoHeight} · ${(video.videoWidth * video.videoHeight / 1e6).toFixed(1)} MP`;
}

// ---------- Vista previa: mismo encuadre, marco y fecha que la foto final ----------
let lastStampSize = '';
function layoutPreview() {
  const box = $('viewfinder').getBoundingClientRect();
  const vw = video.videoWidth, vh = video.videoHeight;
  const bFrac = FRAMES[state.frame] ? FRAME_FRAC * Math.min(vw, vh) : 0; // en px de la foto
  const totalW = vw + 2 * bFrac, totalH = vh + 2 * bFrac;
  const scale = Math.min(box.width / totalW, box.height / totalH);
  const w = vw * scale, h = vh * scale, b = bFrac * scale;
  frameBox.style.padding = b + 'px';
  frameBox.style.background = FRAMES[state.frame] || 'transparent';
  preview.style.width = w + 'px'; preview.style.height = h + 'px';
  stampLayer.style.left = b + 'px'; stampLayer.style.top = b + 'px';
  stampLayer.style.width = w + 'px'; stampLayer.style.height = h + 'px';
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
  const key = `${pw}x${ph}|${state.dateOn}`;
  if (key !== lastStampSize) {
    lastStampSize = key;
    stampLayer.width = pw; stampLayer.height = ph;
    const ctx = stampLayer.getContext('2d'); ctx.clearRect(0, 0, pw, ph);
    if (state.dateOn) drawDateStamp(ctx, pw, ph);
  }
  return [pw, ph];
}

function loop(t) {
  if (video.readyState >= 2 && video.videoWidth) {
    const [w, h] = layoutPreview();
    renderer.draw(video, w, h, { ...state, seed: (t * 0.01) % 100, mirror: facing === 'user' });
  }
  requestAnimationFrame(loop);
}

// ---------- Foto ----------
async function takePhoto() {
  if (!video.videoWidth) return;
  const w = video.videoWidth, h = video.videoHeight;
  if (!captureCanvas) { captureCanvas = document.createElement('canvas'); captureRenderer = new FilmRenderer(captureCanvas, { preserve: true }); }
  captureRenderer.draw(video, w, h, { ...state, seed: Math.random() * 100, mirror: facing === 'user' });

  const b = FRAMES[state.frame] ? Math.round(FRAME_FRAC * Math.min(w, h)) : 0;
  const out = document.createElement('canvas'); out.width = w + 2 * b; out.height = h + 2 * b;
  const ctx = out.getContext('2d');
  if (b) { ctx.fillStyle = FRAMES[state.frame]; ctx.fillRect(0, 0, out.width, out.height); }
  ctx.drawImage(captureCanvas, b, b);
  if (state.dateOn) { ctx.save(); ctx.translate(b, b); drawDateStamp(ctx, w, h); ctx.restore(); }

  const blob = await new Promise(r => out.toBlob(r, 'image/jpeg', 0.95));
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  lastFile = new File([blob], `film-${stamp}.jpg`, { type: 'image/jpeg' });
  if (lastUrl) URL.revokeObjectURL(lastUrl);
  lastUrl = URL.createObjectURL(blob);
  $('shot').src = lastUrl;
  $('review').hidden = false;
  if (state.leakOn) state.leakSeed = Math.random() * 100; // nueva fuga para la siguiente foto
}

async function savePhoto() {
  if (!lastFile) return;
  // En iPhone, la hoja de compartir ofrece "Guardar imagen" en Fotos.
  if (navigator.canShare && navigator.canShare({ files: [lastFile] })) {
    try { await navigator.share({ files: [lastFile] }); } catch (e) { if (e.name !== 'AbortError') console.error(e); return; }
  } else {
    const a = document.createElement('a'); a.href = lastUrl; a.download = lastFile.name; a.click();
  }
  $('review').hidden = true;
}

$('startBtn').onclick = async () => {
  try {
    renderer = renderer || new FilmRenderer(preview);
    await openCamera();
    $('start').hidden = true;
    requestAnimationFrame(loop);
  } catch (e) {
    $('startMsg').textContent = 'No se pudo abrir la cámara: ' + e.message;
  }
};
$('shutter').onclick = takePhoto;
$('saveBtn').onclick = savePhoto;
$('discardBtn').onclick = () => { $('review').hidden = true; };
$('flipBtn').onclick = async () => { facing = facing === 'environment' ? 'user' : 'environment'; try { await openCamera(); } catch (e) { $('info').textContent = e.message; } };
$('torchBtn').onclick = async () => {
  const track = stream && stream.getVideoTracks()[0]; if (!track) return;
  torchOn = !torchOn;
  try { await track.applyConstraints({ advanced: [{ torch: torchOn }] }); $('torchBtn').classList.toggle('on', torchOn); }
  catch (e) { torchOn = false; $('info').textContent = 'Flash no disponible'; }
};
renderChips();
