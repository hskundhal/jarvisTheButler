import os
import subprocess
import ollama
import whisper
import warnings
import sys

# Suppress FP16 warning on CPU
warnings.filterwarnings("ignore", category=UserWarning)

def listen():
    """Records audio and transcribes it using Whisper."""
    print("\n[Listening...] (Press Ctrl+C to stop)")
    model = whisper.load_model("base") # 'base' is fast on 16GB Mac
    
    # Simple recording using 'sox' or 'ffmpeg' or just using a dedicated library
    # For simplicity in this POC, we'll assume the user has a .wav file or 
    # we'll use a library like 'sounddevice' if available.
    # To keep it zero-dependency on external binary recorders, we'll use 'sox' which is common on mac.
    
    os.system("rec -c 1 -r 16000 input.wav trim 0 5") # Record 5 seconds
    
    result = model.transcribe("input.wav")
    text = result["text"].strip()
    print(f"You said: {text}")
    return text

def speak(text):
    """Uses macOS 'say' command to speak."""
    print(f"Assistant: {text}")
    subprocess.run(["say", text])

def main():
    print("--- Local Voice Assistant (Powered by Ollama + Whisper) ---")
    
    # Check if ollama is running
    try:
        ollama.list()
    except Exception:
        print("Error: Ollama is not running. Please start Ollama first.")
        return

    while True:
        try:
            user_input = listen()
            if not user_input:
                continue
                
            if "quit" in user_input.lower() or "exit" in user_input.lower():
                speak("Goodbye!")
                break

            # Send to Ollama
            response = ollama.chat(model='llama3.2:3b', messages=[
                {'role': 'user', 'content': user_input},
            ])
            
            assistant_reply = response['message']['content']
            speak(assistant_reply)
            
        except KeyboardInterrupt:
            print("\nExiting...")
            break
        except Exception as e:
            print(f"Error: {e}")

if __name__ == "__main__":
    main()
