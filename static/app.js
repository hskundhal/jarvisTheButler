let isRecording = false;
let isProcessing = false;
let mediaRecorder;
let audioChunks = [];
let audioContext;
let analyser;
let streamSource;
let animationId;

// VAD (Voice Activity Detection) variables
const VOLUME_THRESHOLD = 35; // Increased significantly to handle Mac fan noise
const SILENCE_DURATION_MS = 2000; // 2 seconds of silence triggers sending
let silenceTimer = null;
let isSpeaking = false;
let localStream = null;
let currentMode = 'chat'; // 'chat' or 'notes'

// Graph Visualization Nodes
let nodes = [];
const NUM_NODES = 120; // Vastly increased node count for complexity

let isSlicing = false;
let compiledNotes = [];
let pendingRequests = 0;

const recordBtn = document.getElementById('recordButton');
const modeToggleBtn = document.getElementById('modeToggleBtn');
const statusText = document.getElementById('statusText');
const visualizerSection = document.querySelector('.visualizer-section');
const canvas = document.getElementById('visualizerCanvas');
const ctx = canvas.getContext('2d');
const chatHistory = document.getElementById('chatHistory');

// Set canvas size bigger for side-by-side layout node graph
canvas.width = 800; // Increased to match the CSS visually
canvas.height = 600;

class Node {
    constructor(canvasWidth, canvasHeight) {
        this.x = Math.random() * canvasWidth;
        this.y = Math.random() * canvasHeight;
        
        // Depth simulation (Z-axis conceptually)
        this.z = Math.random() * 2 + 0.1; // 0.1 to 2.1
        
        // Velocity (slower things are in the back)
        this.vx = (Math.random() - 0.5) * (1 / this.z);
        this.vy = (Math.random() - 0.5) * (1 / this.z);
        
        this.baseRadius = (Math.random() * 2 + 1) / this.z;
        this.radius = this.baseRadius;
    }
    
    update(canvasWidth, canvasHeight, frequency, isProcessing) {
        // Attractor logic: when thinking, pull nodes to center
        if (isProcessing) {
            let cx = canvasWidth / 2;
            let cy = canvasHeight / 2;
            let dx = cx - this.x;
            let dy = cy - this.y;
            this.vx += dx * 0.0005;
            this.vy += dy * 0.0005;
            
            // Add some jitter for "thinking"
            this.vx += (Math.random() - 0.5) * 0.5;
            this.vy += (Math.random() - 0.5) * 0.5;
            
            // Cap speed slightly higher during processing
            this.vx *= 0.95;
            this.vy *= 0.95;
        } else {
            // Calm drift mapping
            this.vx *= 0.99; // subtle friction
            this.vy *= 0.99;
            // Add ambient drift back
            this.vx += (Math.random() - 0.5) * 0.05 * (1/this.z);
            this.vy += (Math.random() - 0.5) * 0.05 * (1/this.z);
        }

        this.x += this.vx;
        this.y += this.vy;
        
        // Bounce off walls gently
        if (this.x < 0 || this.x > canvasWidth) this.vx *= -1;
        if (this.y < 0 || this.y > canvasHeight) this.vy *= -1;
        
        // Pulse based on audio frequency and depth
        this.radius = this.baseRadius + (frequency / (15 * this.z));
    }
}

// Initialize nodes
for(let i=0; i<NUM_NODES; i++) {
    nodes.push(new Node(canvas.width, canvas.height));
}

// Start continuous listening when user clicks the button for the first time
recordBtn.addEventListener('click', async () => {
    if (!localStream) {
        // First initialization
        await initContinuousListening();
    } else {
        // Toggle force stop/start
        if (isRecording) {
            stopListening(false);
            // Notes will publish automatically when pendingRequests hit 0
        } else {
            startListening();
        }
    }
});

async function initContinuousListening() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setupVisualizer(localStream);
        drawVisualizer();
        startListening();
        
    } catch (err) {
        console.error("Error accessing microphone:", err);
        alert("Microphone access is required to use the voice assistant.");
    }
}

function startListening() {
    if(mediaRecorder && mediaRecorder.state === "recording") return; // Keep going
    
    mediaRecorder = new MediaRecorder(localStream);
    audioChunks = [];
    
    mediaRecorder.addEventListener('dataavailable', event => {
        audioChunks.push(event.data);
    });
    
    mediaRecorder.addEventListener('stop', () => {
        if (audioChunks.length > 0) {
            // Keep a copy and clear so next recording cycle starts fresh
            let capturedBlob = new Blob(audioChunks);
            audioChunks = [];
            if (!isSlicing && !isProcessing && currentMode === 'chat') {
                // Manually stopped chat mode
                processAudioInBackground(capturedBlob);
            } else if (isSlicing || currentMode === 'notes') {
                // Background slicing triggered by VAD
                processAudioInBackground(capturedBlob);
            }
        }
    });
    
    mediaRecorder.start();
    isRecording = true;
    isSpeaking = false;
    isSlicing = false;
    
    statusText.innerText = currentMode === 'notes' ? 'Meeting Notes Active...' : 'Listening continuously...';
    visualizerSection.classList.add('recording');
    recordBtn.classList.add('active');
}

modeToggleBtn.addEventListener('click', () => {
    if (currentMode === 'chat') {
        currentMode = 'notes';
        modeToggleBtn.innerHTML = 'Switch to Chat Mode';
        modeToggleBtn.classList.add('notes-active');
        if (isRecording) statusText.innerText = 'Meeting Notes Active...';
    } else {
        currentMode = 'chat';
        modeToggleBtn.innerHTML = 'Switch to Notes Mode';
        modeToggleBtn.classList.remove('notes-active');
        if (isRecording) statusText.innerText = 'Listening continuously...';
    }
});

function stopListening(forProcessing=false) {
    if(mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
    }
    isRecording = false;
    isSpeaking = false;
    clearTimeout(silenceTimer);
    
    if (forProcessing && currentMode === 'chat') {
        statusText.innerText = 'Thinking...';
        visualizerSection.classList.remove('recording');
        visualizerSection.classList.add('processing');
    } else if (!forProcessing) {
        statusText.innerText = 'Paused';
        visualizerSection.classList.remove('recording');
        recordBtn.classList.remove('active');
    }
}

function setupVisualizer(stream) {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    streamSource = audioContext.createMediaStreamSource(stream);
    streamSource.connect(analyser);
}

function drawVisualizer() {
    animationId = requestAnimationFrame(drawVisualizer);
    
    if (!analyser) return;
    
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);
    
    // Calculate average volume
    let sum = 0;
    for(let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
    }
    let avgVolume = sum / bufferLength;
    
    // Silence Detection Logic
    if (isRecording) {
        if (avgVolume > VOLUME_THRESHOLD) {
            // We hear something!
            isSpeaking = true;
            clearTimeout(silenceTimer); // Reset silence timer
            silenceTimer = null;
        } else if (isSpeaking && avgVolume <= VOLUME_THRESHOLD) {
            // Volume dropped, start silence timer if not already started
            if (!silenceTimer) {
                silenceTimer = setTimeout(() => {
                    // Silence lasted long enough!
                    if (currentMode === 'notes') {
                        // Slicing trick: we stop then instantly restart to ship the audio track
                        if (mediaRecorder.state === "recording") {
                            isSlicing = true;
                            mediaRecorder.stop();
                            mediaRecorder.start();
                        }
                    } else {
                        stopListening(true); // stop and trigger process (chat mode)
                    }
                }, SILENCE_DURATION_MS);
            }
        }
    }
    
    // Draw Node Graph
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Update and draw nodes
    for(let i=0; i<nodes.length; i++) {
        // Tie node frequency to different parts of the spectrum
        let freq = dataArray[i % bufferLength] || 0;
        nodes[i].update(canvas.width, canvas.height, freq, isProcessing);
        
        ctx.beginPath();
        ctx.arc(nodes[i].x, nodes[i].y, nodes[i].radius, 0, Math.PI * 2);
        
        // Color shift based on depth and processing state
        if (isProcessing) {
            ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(1, 0.2 + (1/nodes[i].z))})`;
        } else {
            ctx.fillStyle = `rgba(0, 255, 65, ${Math.min(1, 0.1 + (freq/255) + (0.5/nodes[i].z))})`;
        }
        ctx.fill();
        
        // Draw connecting lines if close
        for(let j=i+1; j<nodes.length; j++) {
            let dx = nodes[i].x - nodes[j].x;
            let dy = nodes[i].y - nodes[j].y;
            let dist = Math.sqrt(dx*dx + dy*dy);
            
            // Connect closer pairs when listening, extend radius gracefully when processing as they cluster
            let connectDist = isProcessing ? 120 : 150; 
            
            if (dist < connectDist) { 
                ctx.beginPath();
                ctx.moveTo(nodes[i].x, nodes[i].y);
                ctx.lineTo(nodes[j].x, nodes[j].y);
                let alpha = 1 - (dist / connectDist);
                
                if (isProcessing) {
                    ctx.strokeStyle = `rgba(200, 255, 200, ${alpha * 0.15})`;
                    ctx.lineWidth = 0.5 + (1/nodes[i].z)*0.5;
                } else {
                    ctx.strokeStyle = `rgba(0, 255, 65, ${alpha * (0.05 + (avgVolume/255)) * (1/nodes[i].z)})`;
                    ctx.lineWidth = 0.5 + (avgVolume/80);
                }
                ctx.stroke();
            }
        }
    }
}

async function processAudioInBackground(audioBlob) {
    if (currentMode === 'chat') {
        isProcessing = true; // Block UI for normal chatting
        visualizerSection.classList.add('processing');
    }
    
    pendingRequests++;
    
    const formData = new FormData();
    formData.append('audio', audioBlob, 'record.webm');
    formData.append('mode', currentMode);
    
    try {
        const response = await fetch('/process_audio', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (data.user_text && data.assistant_reply && data.assistant_reply.indexOf('[No notes]') === -1) {
            addMessage('user-msg', data.user_text);
            
            if (data.is_notes) {
                addMessage('ai-msg', `📝 Sent to ledger: ${data.assistant_reply}`);
                compiledNotes.push(data.assistant_reply);
            } else {
                addMessage('ai-msg', data.assistant_reply);
                // Speak the response IF NOT IN NOTES MODE
                await fetch('/speak', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({text: data.assistant_reply})
                });
            }
        }
    } catch (error) {
        console.error('Error processing audio:', error);
    } finally {
        pendingRequests--;
        
        if (currentMode === 'chat') {
            isProcessing = false;
            visualizerSection.classList.remove('processing');
            startListening(); // Resume listening!
        } else {
            // Notes mode: if recording stopped and all background fetches are done, publish notes
            if (!isRecording && pendingRequests === 0 && compiledNotes.length > 0) {
                publishFinalNotes();
            }
        }
    }
}

function publishFinalNotes() {
    if (compiledNotes.length === 0) return;
    let md = "📌 <strong>FINAL MEETING NOTES:</strong><br><br>";
    compiledNotes.forEach(note => {
        md += `• ${note}<br>`;
    });
    addMessage('ai-msg', md, true);
    compiledNotes = []; // clear ledger
}

function addMessage(className, text, isHTML = false) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${className}`;
    if (isHTML) {
        msgDiv.innerHTML = text;
    } else {
        msgDiv.textContent = text;
    }
    chatHistory.appendChild(msgDiv);
    chatHistory.scrollTop = chatHistory.scrollHeight;
}
