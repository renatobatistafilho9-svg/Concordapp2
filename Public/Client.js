// ===== Configuração básica =====
const socket = io();
const ICE_SERVERS = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

let localStream = null;
let myName = '';
let roomId = '';
const peers = {}; // socketId -> RTCPeerConnection
let ytPlayer = null;
let ytReady = false;
let applyingRemoteMusicState = false; // evita eco ao aplicar sync recebido

// ===== Elementos =====
const joinScreen = document.getElementById('joinScreen');
const callScreen = document.getElementById('callScreen');
const videoGrid = document.getElementById('videoGrid');
const roomLabel = document.getElementById('roomLabel');
const peopleCount = document.getElementById('peopleCount');
const nowPlaying = document.getElementById('nowPlaying');

// ===== Entrar na sala =====
document.getElementById('joinBtn').onclick = async () => {
  myName = document.getElementById('nameInput').value.trim() || 'Anônimo';
  roomId = document.getElementById('roomInput').value.trim();
  if (!roomId) { alert('Digita o código da sala'); return; }

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch (e) {
    alert('Não consegui acessar câmera/microfone. Verifique as permissões do navegador.');
    return;
  }

  addVideoBox('local', 'Você (local)', localStream, true);

  joinScreen.style.display = 'none';
  callScreen.style.display = 'flex';
  roomLabel.textContent = `Sala: ${roomId}`;

  socket.emit('join-room', { roomId, name: myName });
};

// ===== Vídeo helpers =====
function addVideoBox(id, label, stream, muted) {
  if (document.getElementById('box-' + id)) return;
  const box = document.createElement('div');
  box.className = 'videoBox';
  box.id = 'box-' + id;
  box.innerHTML = `<video autoplay playsinline ${muted ? 'muted' : ''}></video><div class="label">${label}</div>`;
  box.querySelector('video').srcObject = stream;
  videoGrid.appendChild(box);
  updatePeopleCount();
}
function removeVideoBox(id) {
  const box = document.getElementById('box-' + id);
  if (box) box.remove();
  updatePeopleCount();
}
function updatePeopleCount() {
  peopleCount.textContent = `${videoGrid.children.length} na chamada`;
}

// ===== WebRTC (mesh: uma conexão por par) =====
function createPeerConnection(peerId, peerName) {
  const pc = new RTCPeerConnection(ICE_SERVERS);
  peers[peerId] = pc;

  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit('signal', { to: peerId, data: { type: 'ice', candidate: e.candidate } });
    }
  };

  pc.ontrack = (e) => {
    addVideoBox(peerId, peerName, e.streams[0], false);
  };

  pc.onconnectionstatechange = () => {
    if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
      removeVideoBox(peerId);
    }
  };

  return pc;
}

async function callPeer(peerId, peerName) {
  const pc = createPeerConnection(peerId, peerName);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('signal', { to: peerId, data: { type: 'offer', sdp: offer, name: myName } });
}

// Quando eu entro, recebo a lista de quem já está na sala e ligo pra cada um
socket.on('room-users', (users) => {
  users.forEach((u) => callPeer(u.id, u.name));
});

// Alguém novo entrou — não preciso fazer nada, ele vai me ligar
socket.on('user-joined', () => {});

socket.on('signal', async ({ from, data }) => {
  if (data.type === 'offer') {
    const pc = createPeerConnection(from, data.name || 'Participante');
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('signal', { to: from, data: { type: 'answer', sdp: answer } });
  } else if (data.type === 'answer') {
    const pc = peers[from];
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
  } else if (data.type === 'ice') {
    const pc = peers[from];
    if (pc) {
      try { await pc.addIceCandidate(data.candidate); } catch (e) { /* ignora */ }
    }
  }
});

socket.on('user-left', ({ id }) => {
  if (peers[id]) { peers[id].close(); delete peers[id]; }
  removeVideoBox(id);
});

// ===== Controles de chamada =====
let micOn = true, camOn = true;
document.getElementById('micBtn').onclick = (e) => {
  micOn = !micOn;
  localStream.getAudioTracks().forEach((t) => (t.enabled = micOn));
  e.target.classList.toggle('off', !micOn);
};
document.getElementById('camBtn').onclick = (e) => {
  camOn = !camOn;
  localStream.getVideoTracks().forEach((t) => (t.enabled = camOn));
  e.target.classList.toggle('off', !camOn);
};
document.getElementById('leaveBtn').onclick = () => location.reload();

// ===== Música sincronizada (YouTube IFrame API) =====
function onYouTubeIframeAPIReady() {
  ytPlayer = new YT.Player('ytPlayer', {
    height: '160', width: '270',
    events: {
      onReady: () => { ytReady = true; },
    },
  });
}
window.onYouTubeIframeAPIReady = onYouTubeIframeAPIReady;

function extractVideoId(url) {
  const m = url.match(/(?:youtu\.be\/|v=|\/embed\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : (url.trim().length === 11 ? url.trim() : null);
}

document.getElementById('loadMusicBtn').onclick = () => {
  const url = document.getElementById('ytInput').value;
  const videoId = extractVideoId(url);
  if (!videoId) { alert('Cola um link válido do YouTube'); return; }
  socket.emit('music:load', { videoId });
};
document.getElementById('playBtn').onclick = () => {
  if (!ytPlayer) return;
  socket.emit('music:play', { time: ytPlayer.getCurrentTime() });
};
document.getElementById('pauseBtn').onclick = () => {
  if (!ytPlayer) return;
  socket.emit('music:pause', { time: ytPlayer.getCurrentTime() });
};

// Recebe o estado da música vindo do servidor e aplica no player local
socket.on('music:sync', (state) => {
  if (!state.videoId || !ytReady) {
    if (state.videoId) {
      // player ainda não carregou a API — tenta de novo em breve
      setTimeout(() => socket.emit('request-resync'), 500);
    }
    return;
  }
  applyingRemoteMusicState = true;

  const current = ytPlayer.getVideoData ? ytPlayer.getVideoData().video_id : null;
  if (current !== state.videoId) {
    ytPlayer.loadVideoById(state.videoId, state.time);
  } else {
    const drift = Math.abs(ytPlayer.getCurrentTime() - state.time);
    if (drift > 1.5) ytPlayer.seekTo(state.time, true);
  }

  if (state.isPlaying) ytPlayer.playVideo();
  else ytPlayer.pauseVideo();

  nowPlaying.textContent = `Tocando: ${state.videoId}`;
  setTimeout(() => (applyingRemoteMusicState = false), 300);
});
