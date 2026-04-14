let isRecording = false;
let isProcessing = false;
let mediaRecorder;
let audioChunks = [];
let audioContext;
let analyser;
let streamSource;
let animationId;

// VAD (Voice Activity Detection) variables
const VOLUME_THRESHOLD = 5; // Adjust based on mic sensitivity
const SILENCE_DURATION_MS = 1500; // 1.5s of silence triggers sending
let silenceTimer = null;
let isSpeaking = false;
let localStream = null;

// Graph Visualization Nodes
let nodes = [];
const NUM_NODES = 50;

const recordBtn = document.getElementById('recordButton');
const statusText = document.getElementById('statusText');
const visualizerSection = document.querySelector('.visualizer-section');
const canvas = document.getElementById('visualizerCanvas');
const ctx = canvas.getContext('2d');
const chatHistory = document.getElementById('chatHistory');

// Set canvas size bigger for node graph
canvas.width = 600;
canvas.height = 400;

class Node {
    constructor(canvasWidth, canvasHeight) {
        this.x = Math.random() * canvasWidth;
        this.y = Math.random() * canvasHeight;
        this.vx = (Math.random() - 0.5) * 1;
        this.vy = (Math.random() - 0.5) * 1;
        this.baseRadius = Math.random() * 2 + 1;
        this.radius = this.baseRadius;
    }
    
    update(canvasWidth, canvasHeight, frequency) {
        this.x += this.vx;
        this.y += this.vy;
        
        // Bounce off walls
        if (this.x < 0 || this.x > canvasWidth) this.vx *= -1;
        if (this.y < 0 || this.y > canvasHeight) this.vy *= -1;
        
        // Pulse based on audio frequency
        this.radius = this.baseRadius + (frequency / 10);
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
            stopListening();
            recordBtn.innerHTML = "Play"; // Swap icon theoretically
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
        
        // Hide orb since we use node graph
        const orb = document.querySelector('.orb');
        if(orb) orb.style.display = 'none';
        
    } catch (err) {
        console.error("Error accessing microphone:", err);
        alert("Microphone access is required to use the voice assistant.");
    }
}

function startListening() {
    if(isProcessing) return; // Don't listen while generating reply
    
    mediaRecorder = new MediaRecorder(localStream);
    audioChunks = [];
    
    mediaRecorder.addEventListener('dataavailable', event => {
        audioChunks.push(event.data);
    });
    
    mediaRecorder.addEventListener('stop', () => {
        if (audioChunks.length > 0 && !isProcessing) {
            processAudio();
        }
    });
    
    mediaRecorder.start();
    isRecording = true;
    isSpeaking = false;
    
    statusText.innerText = 'Listening continuously...';
    visualizerSection.classList.add('recording');
    recordBtn.classList.add('active');
}

function stopListening(forProcessing=false) {
    if(mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
    }
    isRecording = false;
    isSpeaking = false;
    clearTimeout(silenceTimer);
    
    if (forProcessing) {
        statusText.innerText = 'Thinking...';
        visualizerSection.classList.remove('recording');
        visualizerSection.classList.add('processing');
    } else {
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
                    stopListening(true); // stop and trigger process
                }, SILENCE_DURATION_MS);
            }
        }
    }
    
    // Draw Node Graph
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Update and draw nodes
    for(let i=0; i<nodes.length; i++) {
        // Tie node frequency to different parts of the spectrum
        let freq = dataArray[i % bufferLength];
        nodes[i].update(canvas.width, canvas.height, freq);
        
        ctx.beginPath();
        ctx.arc(nodes[i].x, nodes[i].y, nodes[i].radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(69, 243, 255, ${0.5 + (freq/512)})`;
        ctx.fill();
        
        // Draw connecting lines if close
        for(let j=i+1; j<nodes.length; j++) {
            let dx = nodes[i].x - nodes[j].x;
            let dy = nodes[i].y - nodes[j].y;
            let dist = Math.sqrt(dx*dx + dy*dy);
            
            if (dist < 100) {
                ctx.beginPath();
                ctx.moveTo(nodes[i].x, nodes[i].y);
                ctx.lineTo(nodes[j].x, nodes[j].y);
                let alpha = 1 - (dist / 100);
                // Make lines light up based on overall volume
                ctx.strokeStyle = `rgba(255, 0, 127, ${alpha * (0.2 + (avgVolume/100))})`;
                ctx.lineWidth = 1 + (avgVolume/50);
                ctx.stroke();
            }
        }
    }
}

async function processAudio() {
    isProcessing = true;
    
    const audioBlob = new Blob(audioChunks);
    const formData = new FormData();
    formData.append('audio', audioBlob, 'record.webm');
    
    try {
        const response = await fetch('/process_audio', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (data.user_text && data.assistant_reply) {
            addMessage('user-msg', data.user_text);
            addMessage('ai-msg', data.assistant_reply);
        }
        
    } catch (error) {
        console.error('Error processing audio:', error);
    } finally {
        // Wait an arbitrary time assuming the Mac is speaking before continuing to listen
        // Realistically we'd need a continuous callback from backend when speech ends, 
        // but for now a static delay or just resuming immediately allows it to go.
        // Let's resume listening after 2 seconds to give it time to talk, 
        // OR better yet, change the backend to wait for 'say' to finish before returning the json payload!
        
        isProcessing = false;
        visualizerSection.classList.remove('processing');
        startListening(); // Resume listening!
    }
}

function addMessage(className, text) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${className}`;
    msgDiv.textContent = text;
    chatHistory.appendChild(msgDiv);
    
    chatHistory.scrollTop = chatHistory.scrollHeight;
}
