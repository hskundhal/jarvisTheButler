from flask import Flask, render_template, request, jsonify
import os
import subprocess
import ollama
import whisper
import warnings

# Suppress warnings
warnings.filterwarnings("ignore", category=UserWarning)

app = Flask(__name__)

# Load whisper model globally (tiny.en is fast)
print("Loading Whisper model...")
model = whisper.load_model("tiny.en", device="cpu") 
print("Whisper model loaded.")

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/process_audio", methods=["POST"])
def process_audio():
    if "audio" not in request.files:
        return jsonify({"error": "No audio file provided"}), 400
        
    audio_file = request.files["audio"]
    # Usually the browser sends webm or ogg, which whisper can process natively (via ffmpeg)
    file_path = "temp_recording.webm"
    audio_file.save(file_path)
    
    try:
        # Transcribe audio
        result = model.transcribe(file_path)
        user_text = result["text"].strip()
        
        if not user_text:
            return jsonify({"user_text": "", "assistant_reply": ""})
            
        # Send to Ollama
        response = ollama.chat(model='llama3.2:1b', messages=[
            {'role': 'user', 'content': user_text},
        ])
        
        assistant_reply = response['message']['content']
        
        # Make the Mac speak the text synchronously so the web request waits
        # This prevents the microphone from accidentally picking up the assistant's own voice
        subprocess.run(["say", assistant_reply])
        
        # We can clean up the file
        if os.path.exists(file_path):
            os.remove(file_path)
            
        return jsonify({
            "user_text": user_text,
            "assistant_reply": assistant_reply
        })
        
    except Exception as e:
        print(f"Error processing audio: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
